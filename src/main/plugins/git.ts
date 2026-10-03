/**
 * Git, for marketplaces and plugins that live in a repository: a shallow clone
 * pinned to a commit, a fetch of the latest, and the commit a folder is at.
 *
 * The person's own `git` and credentials do the work (a private repository
 * works when their credential helper or SSH key does); the app stores no
 * token. `GIT_TERMINAL_PROMPT=0` turns a missing credential into an error
 * instead of a prompt nobody sees, and `GIT_LFS_SKIP_SMUDGE=1` keeps Git LFS
 * objects (models, media) as pointers: a plugin is code and skills. Every call
 * has a deadline. A clone lands in a temporary sibling and is renamed into
 * place only when complete, so a half clone is never read as a marketplace.
 *
 * Plain `node:child_process`, no Electron, so the unit tests drive real git
 * against a local bare repository.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GIT_TIMEOUT_MS = 180_000;

export type GitRemote = {
  /** What git is given: an https, ssh or file URL. */
  url: string;
  /** A stable folder name for it: `owner-repo` for GitHub, else a cleaned host and path. */
  slug: string;
  /** The URL without credentials, `.git` or a trailing slash, lowercased: what two entries are compared by. */
  key: string;
};

/**
 * `owner/repo` (GitHub), an https or ssh URL, or a local path to a repository.
 * Throws with a sentence for anything else.
 */
export function parseGitRemote(input: string): GitRemote {
  const text = input.trim();
  if (!text) throw new Error("name a repository: owner/repo or a git URL");
  let url: string;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    url = `https://github.com/${text.replace(/\.git$/, "")}.git`;
  } else if (/^(https?|ssh|git|file):\/\//.test(text) || /^[\w.-]+@[\w.-]+:/.test(text)) {
    url = text;
  } else if (path.isAbsolute(text)) {
    url = text;
  } else {
    throw new Error(`"${text}" is not owner/repo or a git URL`);
  }
  return { url, slug: slugOf(url), key: keyOf(url) };
}

export function keyOf(url: string): string {
  let text = url.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.*)$/.exec(text);
  if (scp) text = `https://${scp[1]}/${scp[2]}`;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "file:") text = `https://${parsed.host}${parsed.pathname}`;
  } catch { /* a path */ }
  return text.replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();
}

function slugOf(url: string): string {
  const key = keyOf(url);
  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(key);
  const raw = github ? `${github[1]}-${github[2]}` : key.replace(/^https:\/\//, "").replace(/^file:\/\//, "");
  return raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "repository";
}

function git(args: string[], cwd?: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_ASKPASS: "", SSH_ASKPASS: "" },
    }, (error, stdout, stderr) => {
      if (error) {
        const said = String(stderr || "").trim().split("\n").filter(Boolean).slice(-2).join(" ");
        const why = (error as NodeJS.ErrnoException).code === "ENOENT" ? "git is not installed (elastic uses your git to fetch plugins)"
          : error.killed ? `git ${args[0]} took longer than ${GIT_TIMEOUT_MS / 1000} s`
            : said || error.message;
        reject(new Error(why));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Clone `url` into `dir` at one commit: `sha` when given, else the tip of
 * `ref` (a branch or tag), else the default branch. Replaces `dir` only when
 * the clone is complete. Answers the commit it is at.
 */
export async function shallowClone(url: string, dir: string, options: { ref?: string | null; sha?: string | null; signal?: AbortSignal } = {}): Promise<string> {
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(dir)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await git(["init", "-q", temporary], undefined, options.signal);
    await git(["remote", "add", "origin", url], temporary, options.signal);
    const want = options.sha ?? options.ref ?? "HEAD";
    try {
      await git(["fetch", "-q", "--depth", "1", "origin", want], temporary, options.signal);
    } catch (error) {
      // A server that will not serve a commit by its id: fetch the ref and look for it there.
      if (!options.sha) throw error;
      await git(["fetch", "-q", "--depth", "50", "origin", options.ref ?? "HEAD"], temporary, options.signal);
    }
    await git(["checkout", "-q", "--detach", options.sha ?? "FETCH_HEAD"], temporary, options.signal);
    const commit = await headCommit(temporary);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(temporary, dir);
    return commit;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Move a clone to the latest commit of `ref` (or its default branch). Answers the commit. */
export async function fetchLatest(dir: string, ref?: string | null, signal?: AbortSignal): Promise<string> {
  await git(["fetch", "-q", "--depth", "1", "origin", ref ?? "HEAD"], dir, signal);
  await git(["checkout", "-q", "--detach", "FETCH_HEAD"], dir, signal);
  return headCommit(dir);
}

export function headCommit(dir: string): Promise<string> {
  return git(["rev-parse", "HEAD"], dir);
}

/** Copy a plugin folder out of a clone: no `.git`, no installed dependencies, no symlinks (the target's content instead). */
export function copyPluginFolder(from: string, to: string): void {
  const parent = path.dirname(to);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(to)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.cpSync(from, temporary, {
      recursive: true,
      dereference: true,
      filter: (source) => ![".git", "node_modules", ".venv", "__pycache__", ".DS_Store"].includes(path.basename(source)),
    });
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(temporary, to);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
