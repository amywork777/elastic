#!/usr/bin/env node
/**
 * Code Review's MCP server: GitHub pull requests through the person's own
 * GitHub CLI. Every call is `gh` (`gh search prs`, `gh pr view`, `gh api`),
 * so the sign-in is the one the person already has; this server stores no
 * token and asks for none. No dependencies: newline-delimited JSON-RPC on
 * stdio, like the Tables example (resources/plugins/plugins/csv-table).
 *
 * Tools agents see:
 *   list_prs, get_pr, get_pr_diff, list_review_comments   read
 *   add_review_comment, submit_review                       write (the agent's
 *                                                          own permission flow asks)
 *   show_pr        a pull request (or a repository's list) in a tab; its UI is
 *                  the `thread` entrypoint, so a session's + menu opens it too
 * For the app only:
 *   code_review_home   the rail page (`global`): needs your review, yours,
 *                      recently updated, across GitHub
 *
 * `ELASTIC_GH` names the gh executable (the tests' stub); otherwise `gh` on PATH.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_URI = "ui://code-review/review.html";
const UI_MIME = "text/html;profile=mcp-app";
const GH = process.env.ELASTIC_GH || "gh";
const GH_TIMEOUT_MS = 30_000;
const MAX_DIFF_BYTES = 1_500_000;
const LIST_LIMIT = 30;

export const SIGN_IN = "Sign in with `gh auth login` in a terminal, then reopen Code Review.";
export const INSTALL_GH = "Code Review needs the GitHub CLI. Install it from https://cli.github.com, then run `gh auth login`.";

/** A failure the person can act on: no gh, or gh signed out. */
class GhUnavailable extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

/** Run gh and return its stdout; a missing gh or a signed-out one becomes a GhUnavailable. */
export function gh(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(GH, args, { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if (error.code === "ENOENT") return reject(new GhUnavailable(INSTALL_GH, "missing"));
      const text = `${stderr || ""}${stdout || ""}`.trim();
      if (error.code === 4 || /gh auth login|not logged in|authentication required|HTTP 401/i.test(text)) {
        return reject(new GhUnavailable(SIGN_IN, "signed-out"));
      }
      if (error.killed) return reject(new Error(`gh ${args[0]} took longer than ${GH_TIMEOUT_MS / 1000} s`));
      reject(new Error(text.split("\n").slice(-3).join("\n") || `gh ${args.join(" ")} failed`));
    });
  });
}

const json = async (args, options) => JSON.parse((await gh(args, options)) || "null");

/** `owner/name`, from a `repo` argument, a pull request URL, or the session's folder. */
async function repoFor(args, roots) {
  if (typeof args.url === "string") {
    const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(args.url);
    if (match) return match[1];
  }
  if (typeof args.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(args.repo)) return args.repo;
  if (typeof args.repo === "string" && args.repo) throw new Error(`"${args.repo}" is not owner/name`);
  for (const root of roots) {
    try {
      const name = (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: root })).trim();
      if (name) return name;
    } catch (error) {
      if (error instanceof GhUnavailable) throw error;
    }
  }
  return null;
}

function numberFor(args) {
  if (typeof args.url === "string") {
    const match = /\/pull\/(\d+)/.exec(args.url);
    if (match) return Number(match[1]);
  }
  const number = Number(args.number);
  if (!Number.isInteger(number) || number <= 0) throw new Error("name the pull request: `number` (and `repo`), or its `url`");
  return number;
}

const author = (value) => value?.login ?? value?.name ?? "";

function listItem(entry, repo) {
  return {
    repo: entry.repository?.nameWithOwner ?? repo,
    number: entry.number,
    title: entry.title,
    author: author(entry.author),
    updatedAt: entry.updatedAt,
    url: entry.url,
    draft: Boolean(entry.isDraft),
    branch: entry.headRefName ?? null,
    review: entry.reviewDecision ?? null,
  };
}

const SEARCH_FIELDS = "number,title,repository,author,updatedAt,url,isDraft";
const LIST_FIELDS = "number,title,author,updatedAt,url,isDraft,headRefName,reviewDecision";

/** Open pull requests: one repository's, or across GitHub when there is none. */
export async function listPrs({ repo = null, filter = "all", limit = LIST_LIMIT } = {}) {
  if (repo) {
    const args = ["pr", "list", "-R", repo, "--state", "open", "--limit", String(limit), "--json", LIST_FIELDS];
    if (filter === "review-requested") args.push("--search", "review-requested:@me");
    if (filter === "authored") args.push("--author", "@me");
    return (await json(args)).map((entry) => listItem(entry, repo));
  }
  const args = ["search", "prs", "--state", "open", "--limit", String(limit), "--json", SEARCH_FIELDS, "--sort", "updated"];
  if (filter === "review-requested") args.push("--review-requested", "@me");
  else if (filter === "authored") args.push("--author", "@me");
  else args.push("--involves", "@me");
  return (await json(args)).map((entry) => listItem(entry, null));
}

/** The three groups of the rail page, as Codex's Code Review lists them. */
export async function home() {
  const [review, yours, recent] = await Promise.all([
    listPrs({ filter: "review-requested" }),
    listPrs({ filter: "authored" }),
    listPrs({ filter: "all" }),
  ]);
  const seen = new Set([...review, ...yours].map((pr) => pr.url));
  return { view: "home", sections: { review, yours, recent: recent.filter((pr) => !seen.has(pr.url)) } };
}

function checkState(check) {
  const value = String(check.conclusion || check.state || check.status || "").toUpperCase();
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(value)) return "passed";
  if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(value)) return "failed";
  return "pending";
}

const PR_FIELDS = "number,title,body,author,state,isDraft,headRefName,baseRefName,headRefOid,url,createdAt,updatedAt,additions,deletions,changedFiles,reviewDecision,statusCheckRollup,files";

export async function getPr(repo, number) {
  const pr = await json(["pr", "view", String(number), "-R", repo, "--json", PR_FIELDS]);
  const checks = (pr.statusCheckRollup ?? []).map((check) => ({ name: check.name || check.context || "check", state: checkState(check), url: check.detailsUrl || check.targetUrl || null }));
  return {
    repo,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: author(pr.author),
    state: pr.state,
    draft: Boolean(pr.isDraft),
    head: pr.headRefName,
    base: pr.baseRefName,
    headSha: pr.headRefOid,
    url: pr.url,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    review: pr.reviewDecision ?? null,
    checks,
    files: (pr.files ?? []).map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
  };
}

/** The unified diff, whole or one file's, cut at a size the view and the model can take. */
export async function getDiff(repo, number, only = null) {
  let diff = await gh(["pr", "diff", String(number), "-R", repo, "--color", "never"]);
  if (only) {
    const files = diff.split(/(?=^diff --git )/m);
    diff = files.filter((part) => part.startsWith(`diff --git a/${only} `) || part.includes(` b/${only}\n`)).join("");
  }
  const truncated = Buffer.byteLength(diff) > MAX_DIFF_BYTES;
  if (truncated) diff = Buffer.from(diff).subarray(0, MAX_DIFF_BYTES).toString("utf8").replace(/\n[^\n]*$/, "\n");
  return { diff, truncated };
}

export async function getComments(repo, number) {
  const [inline, reviews] = await Promise.all([
    json(["api", `repos/${repo}/pulls/${number}/comments?per_page=100`]),
    json(["api", `repos/${repo}/pulls/${number}/reviews?per_page=100`]),
  ]);
  return {
    comments: (inline ?? []).map((comment) => ({
      id: comment.id,
      path: comment.path,
      line: comment.line ?? null,
      originalLine: comment.original_line ?? null,
      side: comment.side ?? "RIGHT",
      body: comment.body,
      author: comment.user?.login ?? "",
      createdAt: comment.created_at,
      inReplyTo: comment.in_reply_to_id ?? null,
      url: comment.html_url,
    })),
    reviews: (reviews ?? []).filter((review) => review.state !== "PENDING").map((review) => ({
      id: review.id,
      state: review.state,
      body: review.body ?? "",
      author: review.user?.login ?? "",
      submittedAt: review.submitted_at,
    })),
  };
}

export async function addComment(repo, number, { path: file, line, side = "RIGHT", body, inReplyTo = null }) {
  if (typeof body !== "string" || !body.trim()) throw new Error("a comment needs a `body`");
  if (inReplyTo) {
    const reply = await json(["api", "-X", "POST", `repos/${repo}/pulls/${number}/comments/${Number(inReplyTo)}/replies`, "-f", `body=${body}`]);
    return { id: reply.id, url: reply.html_url };
  }
  if (typeof file !== "string" || !Number.isInteger(Number(line))) throw new Error("an inline comment needs `path` and `line`");
  const sha = (await gh(["pr", "view", String(number), "-R", repo, "--json", "headRefOid", "--jq", ".headRefOid"])).trim();
  const comment = await json(["api", "-X", "POST", `repos/${repo}/pulls/${number}/comments`,
    "-f", `body=${body}`, "-f", `commit_id=${sha}`, "-f", `path=${file}`, "-F", `line=${Number(line)}`, "-f", `side=${side === "LEFT" ? "LEFT" : "RIGHT"}`]);
  return { id: comment.id, url: comment.html_url };
}

const EVENTS = { comment: "COMMENT", approve: "APPROVE", request_changes: "REQUEST_CHANGES" };

export async function submitReview(repo, number, { event, body = "" }) {
  const name = EVENTS[String(event).toLowerCase()];
  if (!name) throw new Error("`event` is comment, approve or request_changes");
  if (name !== "APPROVE" && !String(body).trim()) throw new Error(`${event} needs a \`body\``);
  const review = await json(["api", "-X", "POST", `repos/${repo}/pulls/${number}/reviews`, "-f", `event=${name}`, "-f", `body=${body}`]);
  return { id: review.id, state: review.state, url: review.html_url };
}

const REPO = { type: "string", description: "owner/name. Defaults to the session folder's GitHub repository." };
const NUMBER = { type: "integer", description: "The pull request number." };
const URL_ARG = { type: "string", description: "The pull request's URL, instead of `repo` and `number`." };
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const TOOLS = [
  {
    name: "list_prs",
    title: "List pull requests",
    description: "Open pull requests: the session repository's, or across GitHub involving the person when there is no repository. `filter`: review-requested (waiting on the person's review), authored (theirs), or all.",
    inputSchema: { type: "object", properties: { repo: REPO, filter: { type: "string", enum: ["review-requested", "authored", "all"] }, limit: { type: "integer", minimum: 1, maximum: 100 } } },
    annotations: READ,
  },
  {
    name: "get_pr",
    title: "Get a pull request",
    description: "A pull request's title, description, branches, review state, checks and changed files.",
    inputSchema: { type: "object", properties: { repo: REPO, number: NUMBER, url: URL_ARG } },
    annotations: READ,
  },
  {
    name: "get_pr_diff",
    title: "Get a pull request's diff",
    description: "The unified diff of a pull request, or of one file in it (`path`).",
    inputSchema: { type: "object", properties: { repo: REPO, number: NUMBER, url: URL_ARG, path: { type: "string", description: "Only this file." } } },
    annotations: READ,
  },
  {
    name: "list_review_comments",
    title: "List review comments",
    description: "A pull request's inline review comments (with file, line and thread) and its submitted reviews.",
    inputSchema: { type: "object", properties: { repo: REPO, number: NUMBER, url: URL_ARG } },
    annotations: READ,
  },
  {
    name: "add_review_comment",
    title: "Add a review comment",
    description: "Post an inline comment on a line of a pull request's diff (`path`, `line`, `side` RIGHT for the new version, LEFT for the old), or a reply to a thread (`in_reply_to`, a comment id). Posts under the person's GitHub account: only when they asked for it.",
    inputSchema: {
      type: "object",
      required: ["body"],
      properties: { repo: REPO, number: NUMBER, url: URL_ARG, path: { type: "string" }, line: { type: "integer" }, side: { type: "string", enum: ["RIGHT", "LEFT"] }, body: { type: "string" }, in_reply_to: { type: "integer" } },
    },
    annotations: WRITE,
  },
  {
    name: "submit_review",
    title: "Submit a review",
    description: "Submit a review of a pull request under the person's GitHub account: comment, approve or request_changes, with a `body` (required unless approving). Only when they asked for it.",
    inputSchema: { type: "object", required: ["event"], properties: { repo: REPO, number: NUMBER, url: URL_ARG, event: { type: "string", enum: ["comment", "approve", "request_changes"] }, body: { type: "string" } } },
    annotations: WRITE,
  },
  {
    name: "show_pr",
    title: "Pull request",
    description: "Show a pull request to the person in a Code Review tab beside the chat: checks, files, the diff with its comment threads, and review buttons. Without a number, the repository's open pull requests.",
    inputSchema: { type: "object", properties: { repo: REPO, number: NUMBER, url: URL_ARG } },
    annotations: READ,
    _meta: {
      ui: { resourceUri: UI_URI, visibility: ["model", "app"] },
      "openai/ui": { entrypoints: [{ type: "thread" }] },
    },
  },
  {
    name: "code_review_home",
    title: "Code Review",
    description: "The Code Review page.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
    _meta: {
      ui: { resourceUri: UI_URI, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  },
];

let roots = [];
let rootsListed = false;
let clientCapabilities = null;
let nextId = 1;
const waiting = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ask(method, params) {
  const id = `server-${nextId++}`;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

async function currentRoots() {
  if (!clientCapabilities?.roots || rootsListed) return roots;
  try {
    const answer = await ask("roots/list", {});
    roots = (answer.roots ?? []).map((root) => fileURLToPath(root.uri));
  } catch { /* a client without roots: no repository */ }
  rootsListed = true;
  return roots;
}

const text = (value) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
const ok = (summary, structured) => ({ content: [{ type: "text", text: summary }], structuredContent: structured });

async function target(args) {
  const repo = await repoFor(args, await currentRoots());
  if (!repo) throw new Error("no repository: pass `repo` (owner/name) or `url`, or open a session in a GitHub checkout");
  return { repo, number: numberFor(args) };
}

async function callTool(name, args) {
  switch (name) {
    case "code_review_home": {
      const data = await home();
      const count = (list) => list.length;
      return ok(`Needs your review: ${count(data.sections.review)}. Yours: ${count(data.sections.yours)}. Recently updated: ${count(data.sections.recent)}.`, data);
    }
    case "list_prs": {
      const repo = await repoFor(args, await currentRoots());
      const prs = await listPrs({ repo, filter: args.filter ?? "all", limit: args.limit ?? LIST_LIMIT });
      return ok(prs.length ? prs.map((pr) => `${pr.repo}#${pr.number} ${pr.title} (${pr.author}${pr.draft ? ", draft" : ""})`).join("\n") : "No open pull requests.", { repo, prs });
    }
    case "get_pr": {
      const { repo, number } = await target(args);
      const pr = await getPr(repo, number);
      return ok(text({ ...pr, body: pr.body.slice(0, 4000) }), pr);
    }
    case "get_pr_diff": {
      const { repo, number } = await target(args);
      const { diff, truncated } = await getDiff(repo, number, typeof args.path === "string" ? args.path : null);
      return ok(`${diff}${truncated ? "\n[diff truncated; ask for one file with `path`]" : ""}`, { repo, number, truncated });
    }
    case "list_review_comments": {
      const { repo, number } = await target(args);
      const data = await getComments(repo, number);
      return ok(text(data), data);
    }
    case "add_review_comment": {
      const { repo, number } = await target(args);
      const posted = await addComment(repo, number, { path: args.path, line: args.line, side: args.side, body: args.body, inReplyTo: args.in_reply_to });
      return ok(`Commented on ${repo}#${number}: ${posted.url ?? posted.id}`, posted);
    }
    case "submit_review": {
      const { repo, number } = await target(args);
      const review = await submitReview(repo, number, { event: args.event, body: args.body });
      return ok(`Submitted a ${String(args.event).replace("_", " ")} review on ${repo}#${number}.`, review);
    }
    case "show_pr": {
      const repo = await repoFor(args, await currentRoots());
      const hasNumber = typeof args.url === "string" || args.number !== undefined;
      if (!hasNumber) {
        if (!repo) {
          const data = await home();
          return ok("Showing the person's pull requests across GitHub.", data);
        }
        const prs = await listPrs({ repo });
        return ok(`Showing ${repo}'s ${prs.length} open pull request${prs.length === 1 ? "" : "s"}.`, { view: "list", repo, prs });
      }
      const number = numberFor(args);
      if (!repo) throw new Error("no repository: pass `repo` (owner/name) or `url`");
      const [pr, { diff, truncated }, threads] = await Promise.all([getPr(repo, number), getDiff(repo, number), getComments(repo, number)]);
      const failed = pr.checks.filter((check) => check.state === "failed").length;
      return ok(`Showing ${repo}#${number} "${pr.title}" to the person: ${pr.changedFiles} files, +${pr.additions} -${pr.deletions}, ${pr.checks.length} checks${failed ? ` (${failed} failing)` : ""}, ${threads.comments.length} inline comments.`,
        { view: "pr", pr, diff, truncated, ...threads });
    }
    default:
      throw new Error(`no tool named ${name}`);
  }
}

/** A tool's failure as a result the view (and the model) can read: sign-in states say what to do. */
async function safeCall(name, args) {
  try {
    return await callTool(name, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof GhUnavailable ? error.reason : null;
    return { isError: true, content: [{ type: "text", text: message }], structuredContent: { view: "error", reason, message } };
  }
}

async function handle(message) {
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize":
      clientCapabilities = params.capabilities ?? {};
      return {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "code-review", version: "0.1.0" },
        instructions: "GitHub pull requests through the person's GitHub CLI. Use show_pr to put a pull request in front of the person. Post comments or reviews only when they ask; they post under the person's account.",
      };
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call": return safeCall(params.name, params.arguments ?? {});
    case "resources/list": return { resources: [{ uri: UI_URI, name: "Code Review", mimeType: UI_MIME }] };
    case "resources/read":
      if (params.uri !== UI_URI) throw Object.assign(new Error(`no resource ${params.uri}`), { code: -32002 });
      return { contents: [{ uri: UI_URI, mimeType: UI_MIME, text: fs.readFileSync(path.join(here, "ui.html"), "utf8") }] };
    default:
      if (id === undefined) return undefined;
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method === undefined && message.id !== undefined) {
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
      return;
    }
    if (message.method === "notifications/roots/list_changed") { rootsListed = false; return; }
    if (message.id === undefined) return;
    Promise.resolve(handle(message)).then(
      (result) => send({ jsonrpc: "2.0", id: message.id, result }),
      (error) => send({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32603, message: error.message } }),
    );
  });
  lines.on("close", () => process.exit(0));
}
