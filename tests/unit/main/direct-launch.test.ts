import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cachedBin, directLaunch, pinnedPackage } from "@main/agents/direct-launch";
import { CLAUDE_ADAPTER, agentProvider } from "@main/agents/registry";

const claude = agentProvider("claude-code")!.launch;
const pinned = { name: CLAUDE_ADAPTER.package, version: CLAUDE_ADAPTER.version, bin: CLAUDE_ADAPTER.bin };
const scratch: string[] = [];

function cache(entries: { hash: string; name: string; version: string; bin: Record<string, string> | string; file?: string }[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-launch-"));
  scratch.push(root);
  for (const entry of entries) {
    const dir = path.join(root, "_npx", entry.hash, "node_modules", ...entry.name.split("/"));
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: entry.name, version: entry.version, bin: entry.bin }));
    if (entry.file !== undefined) fs.writeFileSync(path.join(dir, entry.file), "#!/usr/bin/env node\n");
  }
  return root;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("direct launch", () => {
  it("reads the pinned npm exec launch, and nothing else", () => {
    expect(pinnedPackage(claude)).toEqual({ name: CLAUDE_ADAPTER.package, version: CLAUDE_ADAPTER.version, bin: CLAUDE_ADAPTER.bin, rest: [] });
    expect(pinnedPackage({ command: "claude", args: [] })).toBeNull();
    expect(pinnedPackage({ command: "npm", args: ["exec", "--", "x"] })).toBeNull();
  });

  it("finds the bin of that exact version in the npx cache", () => {
    const root = cache([
      { hash: "aaa", name: CLAUDE_ADAPTER.package, version: "0.0.1", bin: { [CLAUDE_ADAPTER.bin]: "dist/index.js" }, file: "dist/index.js" },
      { hash: "bbb", name: CLAUDE_ADAPTER.package, version: CLAUDE_ADAPTER.version, bin: { [CLAUDE_ADAPTER.bin]: "dist/index.js" }, file: "dist/index.js" },
    ]);
    const script = cachedBin(root, pinned);
    expect(script).toBe(path.join(root, "_npx", "bbb", "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js"));
  });

  it("refuses a bin that is missing or points outside its package", () => {
    const root = cache([
      { hash: "aaa", name: CLAUDE_ADAPTER.package, version: CLAUDE_ADAPTER.version, bin: { [CLAUDE_ADAPTER.bin]: "dist/missing.js" } },
      { hash: "bbb", name: CLAUDE_ADAPTER.package, version: CLAUDE_ADAPTER.version, bin: { [CLAUDE_ADAPTER.bin]: "../../../../evil.js" } },
    ]);
    expect(cachedBin(root, pinned)).toBeNull();
  });

  it("launches node on the cached bin, and keeps npm exec when it cannot", async () => {
    const root = cache([{ hash: "bbb", name: CLAUDE_ADAPTER.package, version: CLAUDE_ADAPTER.version, bin: { [CLAUDE_ADAPTER.bin]: "dist/index.js" }, file: "dist/index.js" }]);
    const probes = { npmCache: async () => root, node: async () => "/usr/local/bin/node", platform: "darwin" as const };
    const direct = await directLaunch(claude, {}, probes);
    expect(direct.command).toBe("/usr/local/bin/node");
    expect(direct.args).toEqual([cachedBin(root, pinned)]);
    expect(direct.env).toEqual(claude.env);

    expect(await directLaunch(claude, {}, { ...probes, platform: "win32" })).toBe(claude);
    expect(await directLaunch(claude, {}, { ...probes, node: async () => null })).toBe(claude);
    expect(await directLaunch(claude, {}, { ...probes, npmCache: async () => path.join(root, "nowhere") })).toBe(claude);
  });
});
