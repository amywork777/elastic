import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileWatchers, type FileChange } from "@main/explorer/fs";

/**
 * One recursive `fs.watch` per root on macOS and Windows (`WatchLimits.native`), in place of
 * chokidar's watch per folder: no handle per directory to open, run out of, or close one by one
 * on the main thread when a chat switch leaves the folder. Real file system, real watcher.
 */
const nativeOs = process.platform === "darwin" || process.platform === "win32";
const drivers = vi.hoisted(() => ({ chokidar: vi.fn() }));
vi.mock("chokidar", () => ({ watch: drivers.chokidar }));

let root: string;
let watchers: FileWatchers;
let changes: FileChange[];

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "elastic-native-")));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
  await fs.writeFile(path.join(root, ".gitignore"), "dist/\n");
  changes = [];
  watchers = new FileWatchers((_root, batch) => changes.push(...batch), undefined, { backgroundDirectories: 5_000, native: true });
  drivers.chokidar.mockReset();
});
afterEach(async () => {
  await watchers.closeAll();
  await fs.rm(root, { recursive: true, force: true });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

describe.runIf(nativeOs)("the native recursive watcher", () => {
  it("reports files made, changed and removed anywhere under the root, without chokidar", async () => {
    await watchers.watch(root);
    await settle();
    await fs.writeFile(path.join(root, "src", "a.ts"), "one");
    await vi.waitFor(() => expect(changes).toContainEqual(expect.objectContaining({ path: "src/a.ts", kind: "changed", directory: false })), { timeout: 5_000 });
    await fs.rm(path.join(root, "src", "a.ts"));
    await vi.waitFor(() => expect(changes).toContainEqual(expect.objectContaining({ path: "src/a.ts", kind: "removed" })), { timeout: 5_000 });
    expect(drivers.chokidar).not.toHaveBeenCalled();
  });

  it("drops what the background watcher ignores: node_modules and git-ignored folders", async () => {
    await fs.mkdir(path.join(root, "dist"));
    await watchers.watch(root);
    await settle();
    await fs.writeFile(path.join(root, "node_modules", "dep", "index.js"), "x");
    await fs.writeFile(path.join(root, "dist", "out.js"), "x");
    await fs.writeFile(path.join(root, "src", "seen.ts"), "x");
    await vi.waitFor(() => expect(changes.map((change) => change.path)).toContain("src/seen.ts"), { timeout: 5_000 });
    await settle();
    expect(changes.map((change) => change.path).filter((p) => p.startsWith("node_modules") || p.startsWith("dist"))).toEqual([]);
  });

  it("closes at once, however many folders the root has", async () => {
    for (let index = 0; index < 300; index += 1) await fs.mkdir(path.join(root, "src", `d${index}`, "inner"), { recursive: true });
    await watchers.watch(root);
    const started = performance.now();
    await watchers.unwatch(root);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
