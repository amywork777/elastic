/**
 * "Also restore files to before this prompt", for an edit of a chat's latest prompt
 * (`restorePreview`, `restoreTree`): the files the turn changed go back to the turn's mark, and
 * only those — what the person had uncommitted before the turn, what is ignored and what they
 * staged stay as they were — the preview names exactly what the restore then does, and the state
 * before the restore is pinned so it can be taken back. Ported from an undo-last-turn attempt.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as git from "@main/projects/git";

import { cleanGitTemplates, gitIn, repositoryWithWorktrees } from "./git-fixtures";

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});
afterAll(cleanGitTemplates);

const exists = (file: string) => stat(file).then(() => true, () => false);

/** A repository with a tracked `gone.txt` and `.gitignore`, uncommitted notes, and a turn mark taken. */
async function beforeTurn(): Promise<{ root: string; mark: string }> {
  const { root } = await repositoryWithWorktrees(temporary);
  await writeFile(path.join(root, "gone.txt"), "keep me\n");
  await writeFile(path.join(root, ".gitignore"), "build/\n");
  await gitIn(root, "add", "gone.txt", ".gitignore");
  await gitIn(root, "commit", "--quiet", "-m", "more");
  // The person's own uncommitted work from before the turn.
  await writeFile(path.join(root, "notes.txt"), "mine\n");
  await writeFile(path.join(root, "README.md"), "one\ntwo\nthree\n");
  const mark = await git.snapshotTree(root, "s1/turn");
  if (!mark) throw new Error("no mark");
  return { root, mark };
}

/** What the agent does in its turn. */
async function agentTurn(root: string) {
  await writeFile(path.join(root, "README.md"), "rewritten by the agent\n");
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await writeFile(path.join(root, "src", "deep", "new.ts"), "export {};\n");
  await rm(path.join(root, "gone.txt"));
  await mkdir(path.join(root, "build"), { recursive: true });
  await writeFile(path.join(root, "build", "out.js"), "ignored\n");
}

describe("restoring a turn's files", () => {
  it("previews exactly what it then puts back, nothing else, and leaves the index alone", async () => {
    const { root, mark } = await beforeTurn();
    await gitIn(root, "add", "README.md");
    const stagedBefore = (await gitIn(root, "diff", "--cached", "--name-only")).stdout;
    await agentTurn(root);

    const preview = await git.restorePreview(root, mark);
    // The preview wrote nothing.
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("rewritten by the agent\n");
    expect(await git.readMark(root, "s1/restore")).toBeNull();

    const result = await git.restoreTree(root, mark, "s1/restore");

    expect(preview).toEqual({ restored: ["README.md", "gone.txt"], removed: ["src/deep/new.ts"], kept: [] });
    expect({ restored: result.restored, removed: result.removed, kept: result.kept }).toEqual(preview);
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("one\ntwo\nthree\n");
    expect(await readFile(path.join(root, "gone.txt"), "utf8")).toBe("keep me\n");
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("mine\n");
    // The folders the turn made went with its file; the ignored build output is not the review's.
    expect(await exists(path.join(root, "src"))).toBe(false);
    expect(await readFile(path.join(root, "build", "out.js"), "utf8")).toBe("ignored\n");
    expect((await gitIn(root, "diff", "--cached", "--name-only")).stdout).toBe(stagedBefore);
  });

  it("pins the state it replaced, so the restore can be taken back", async () => {
    const { root, mark } = await beforeTurn();
    await agentTurn(root);
    await git.restoreTree(root, mark, "s1/restore");

    const before = await git.readMark(root, "s1/restore");
    expect(before).toMatch(/^[0-9a-f]{40}/);
    await git.restoreTree(root, before!, "s1/redo");

    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("rewritten by the agent\n");
    expect(await readFile(path.join(root, "src", "deep", "new.ts"), "utf8")).toBe("export {};\n");
    expect(await exists(path.join(root, "gone.txt"))).toBe(false);
  });

  it("leaves a file too large for any snapshot in place, and the preview says so", async () => {
    const { root, mark } = await beforeTurn();
    await writeFile(path.join(root, "export.step"), Buffer.alloc(git.SNAPSHOT_MAX_BYTES + 1, 1));

    expect((await git.restorePreview(root, mark)).kept).toEqual(["export.step"]);
    const result = await git.restoreTree(root, mark, "s1/restore");

    expect(result.kept).toEqual(["export.step"]);
    expect(await exists(path.join(root, "export.step"))).toBe(true);
  });

  it("changes nothing and pins nothing when the tree already matches", async () => {
    const { root, mark } = await beforeTurn();
    expect(await git.restorePreview(root, mark)).toEqual({ restored: [], removed: [], kept: [] });
    const result = await git.restoreTree(root, mark, "s1/restore");
    expect(result).toEqual({ restored: [], removed: [], kept: [], before: null });
    expect(await git.readMark(root, "s1/restore")).toBeNull();
  });

  it("refuses a tree id or a mark name that is not one", async () => {
    const { root } = await beforeTurn();
    await expect(git.restorePreview(root, "--output=/tmp/x")).rejects.toThrow(git.GitError);
    await expect(git.restoreTree(root, "--output=/tmp/x", "s1/restore")).rejects.toThrow(git.GitError);
    await expect(git.restoreTree(root, "a".repeat(40), "../restore")).rejects.toThrow(git.GitError);
  });
});
