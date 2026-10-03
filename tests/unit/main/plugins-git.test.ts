/**
 * Marketplaces and plugins in git repositories, against real git and local
 * bare repositories (no network): a Claude-format marketplace whose entries
 * use every source kind Claude's official marketplace does (`./relative`,
 * `url`, `git-subdir`, an inline `"strict": false` entry) plus one elastic
 * cannot install; fetching it, installing from each, an update, and the
 * merged catalog with its compatibility labels.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCatalog, compatibilityOf } from "../../../src/main/plugins/catalog";
import { keyOf, parseGitRemote } from "../../../src/main/plugins/git";
import type { PluginHost } from "../../../src/main/plugins/host";
import { readMarketplace } from "../../../src/main/plugins/manifest";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { PluginService } from "../../../src/main/plugins/service";

let dir: string;
beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "elastic-git-"))); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(file: string, content: string | object) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();
}

/** A work tree committed and cloned bare; answers the bare repository's file URL and the work tree. */
function repo(name: string, files: Record<string, string | object>): { url: string; work: string; head: () => string } {
  const work = path.join(dir, "work", name);
  for (const [file, content] of Object.entries(files)) write(path.join(work, file), content);
  git(work, "init", "-q");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "first");
  const bare = path.join(dir, "remote", `${name}.git`);
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);
  git(work, "remote", "add", "origin", bare);
  return { url: `file://${bare}`, work, head: () => git(work, "rev-parse", "HEAD") };
}

const host = () => ({ setServers: vi.fn(), closePlugin: vi.fn(async () => {}), listTools: vi.fn(async () => []), signedIn: () => false }) as unknown as PluginHost;

describe("git remotes", () => {
  it("reads owner/repo, URLs and paths, and compares them without .git, case or credentials", () => {
    expect(parseGitRemote("anthropics/claude-plugins-official")).toMatchObject({ url: "https://github.com/anthropics/claude-plugins-official.git", slug: "anthropics-claude-plugins-official" });
    expect(keyOf("https://github.com/Figma/MCP-Server-Guide.git")).toBe(keyOf("git@github.com:figma/mcp-server-guide"));
    expect(() => parseGitRemote("not a repo")).toThrow(/owner\/repo/);
  });
});

describe("a git marketplace", () => {
  it("fetches in the background, installs every kind of entry, and offers an update", async () => {
    const tool = repo("tool", {
      ".codex-plugin/plugin.json": { name: "tool", version: "1.0.0" },
      ".mcp.json": { mcpServers: { tool: { command: "node", args: ["server.mjs"] } } },
      "server.mjs": "",
    });
    const mono = repo("mono", {
      "plugins/deep/.claude-plugin/plugin.json": { name: "deep" },
      "plugins/deep/skills/deep-skill/SKILL.md": "---\nname: deep-skill\n---\n",
      "README.md": "",
    });
    const market = repo("market", {
      ".claude-plugin/marketplace.json": {
        name: "test-market",
        plugins: [
          { name: "local", source: "./plugins/local", version: "1.0.0" },
          { name: "lsp", source: "./plugins/lsp", strict: false, lspServers: { ts: { command: "typescript-language-server", args: ["--stdio"] } } },
          { name: "tool", source: { source: "url", url: tool.url, sha: tool.head() } },
          { name: "deep", source: { source: "git-subdir", url: mono.url, path: "plugins/deep", ref: "main", sha: mono.head() } },
          { name: "npm-thing", source: { source: "npm", package: "x" } },
        ],
      },
      "plugins/local/.codex-plugin/plugin.json": { name: "local", version: "1.0.0", interface: { displayName: "Local one" } },
      "plugins/local/skills/hello/SKILL.md": "---\nname: hello\n---\n",
      "plugins/lsp/README.md": "a language server only",
    });

    const data = path.join(dir, "userData", "plugins");
    const registry = new PluginRegistry(path.join(data, "installed.json"));
    const service = new PluginService({ registry, host: host(), dataDir: data, defaultMarketplaces: [market.url] });
    service.startBackground();
    const listed = service.marketplaces();
    expect(listed).toEqual([expect.objectContaining({ kind: "git", status: "fetching", url: market.url })]);
    await service.fetchRemote(listed[0]!.file);
    const fetched = service.marketplaces()[0]!;
    expect(fetched).toMatchObject({ status: "ready", name: "test-market", commit: market.head() });
    expect(fetched.plugins.map((entry) => entry.name)).toEqual(["local", "lsp", "tool", "deep", "npm-thing"]);

    const catalog = Object.fromEntries(service.catalog().map((entry) => [entry.name, entry]));
    expect(catalog.local!.displayName).toBe("Local one");
    expect(catalog.local!.compat).toMatchObject({ level: "works", detail: "1 skill" });
    expect(catalog.lsp!.compat).toMatchObject({ level: "partly", detail: expect.stringMatching(/language server/) });
    expect(catalog.tool!.compat.level).toBe("unknown");
    expect(catalog["npm-thing"]!.compat).toMatchObject({ level: "unavailable", label: "Can't install" });

    const file = fetched.file;
    const local = await service.installFromMarketplace(file, "local");
    // Copied out of the clone, at the marketplace's commit.
    expect(local.root).toBe(path.join(data, "cache", "test-market", "local", market.head().slice(0, 12)));
    expect(local.skills).toEqual(["hello"]);
    expect(local.source).toMatchObject({ kind: "marketplace", commit: market.head() });
    const lsp = await service.installFromMarketplace(file, "lsp");
    expect(lsp.name).toBe("lsp");
    expect(fs.existsSync(path.join(lsp.root, ".claude-plugin", "plugin.json"))).toBe(true);
    const remote = await service.installFromMarketplace(file, "tool");
    expect(remote.servers.map((server) => server.name)).toEqual(["tool"]);
    expect(remote.source).toMatchObject({ commit: tool.head() });
    const deep = await service.installFromMarketplace(file, "deep");
    expect(deep.root.endsWith(path.join("plugins", "deep"))).toBe(true);
    expect(deep.skills).toEqual(["deep-skill"]);
    await expect(service.installFromMarketplace(file, "npm-thing")).rejects.toThrow(/npm/);
    expect(service.catalog().find((entry) => entry.name === "local")!.installedId).toBe("local");

    // A new version of the local plugin lands in the marketplace.
    write(path.join(market.work, "plugins/local/.codex-plugin/plugin.json"), { name: "local", version: "1.1.0" });
    git(market.work, "commit", "-q", "-am", "local 1.1.0");
    git(market.work, "push", "-q", "origin", "HEAD:main");
    expect(service.plugin("local")!.updateAvailable).toBe(false);
    await service.fetchRemote(file.replace(/\/\.claude-plugin\/marketplace\.json$/, ""));
    expect(service.marketplaces()[0]!.commit).toBe(market.head());
    expect(service.plugin("local")!.updateAvailable).toBe(true);
    expect(service.plugin("tool")!.updateAvailable).toBe(false);
    const updated = await service.update("local");
    expect(updated).toMatchObject({ version: "1.1.0", updateAvailable: false });
    expect(fs.existsSync(local.root)).toBe(false);

    // Removing the marketplace removes its clone, not the plugins installed from it.
    service.removeMarketplace(service.marketplaces()[0]!.file);
    expect(service.marketplaces()).toEqual([]);
    expect(service.plugin("tool")).not.toBeNull();
  }, 60_000);

  it("says why a fetch failed, without throwing", async () => {
    const data = path.join(dir, "userData", "plugins");
    const service = new PluginService({ registry: new PluginRegistry(path.join(data, "installed.json")), host: host(), dataDir: data });
    const added = service.addMarketplace(`file://${path.join(dir, "nowhere.git")}`);
    await service.fetchRemote(added.file);
    expect(service.marketplaces()[0]).toMatchObject({ status: "failed", error: expect.any(String) });
  });

  it("adds the default marketplaces once; one the person removed stays removed", () => {
    const data = path.join(dir, "userData", "plugins");
    const registry = new PluginRegistry(path.join(data, "installed.json"));
    const service = new PluginService({ registry, host: host(), dataDir: data, defaultMarketplaces: ["a/one", "b/two"] });
    vi.spyOn(service, "fetchRemote").mockResolvedValue();
    service.startBackground();
    expect(service.marketplaces().map((market) => market.url)).toEqual(["https://github.com/a/one.git", "https://github.com/b/two.git"]);
    service.removeMarketplace(service.marketplaces()[0]!.file);
    const again = new PluginService({ registry, host: host(), dataDir: data, defaultMarketplaces: ["a/one", "b/two"] });
    vi.spyOn(again, "fetchRemote").mockResolvedValue();
    again.startBackground();
    expect(again.marketplaces().map((market) => market.url)).toEqual(["https://github.com/b/two.git"]);
  });
});

describe("before and after adding", () => {
  it("previews what a repository would add without adding or keeping anything", async () => {
    const market = repo("preview-market", {
      ".claude-plugin/marketplace.json": { name: "preview-market", plugins: [{ name: "one", description: "The first", source: "./one" }, { name: "two", source: "./two" }] },
      "one/.claude-plugin/plugin.json": { name: "one" },
      "two/.claude-plugin/plugin.json": { name: "two" },
    });
    const data = path.join(dir, "userData", "plugins");
    const service = new PluginService({ registry: new PluginRegistry(path.join(data, "installed.json")), host: host(), dataDir: data });
    const preview = await service.previewMarketplace(market.url);
    expect(preview).toMatchObject({ displayName: "preview-market", official: false, added: false, commit: market.head(), plugins: [{ name: "one", description: "The first" }, { name: "two", description: "" }] });
    expect(service.marketplaces()).toEqual([]);
    expect(fs.readdirSync(path.join(data, "previews"))).toEqual([]);
  });

  it("turns one skill off and keeps the rest", () => {
    const plugin = path.join(dir, "skilled");
    write(path.join(plugin, ".codex-plugin", "plugin.json"), { name: "skilled" });
    write(path.join(plugin, "skills", "a", "SKILL.md"), "---\nname: a\n---\n");
    write(path.join(plugin, "skills", "b", "SKILL.md"), "---\nname: b\n---\n");
    const data = path.join(dir, "userData", "plugins");
    const file = path.join(data, "installed.json");
    const registry = new PluginRegistry(file);
    registry.install("skilled", { kind: "local", path: plugin });
    const service = new PluginService({ registry, host: host(), dataDir: data });
    expect(service.setSkillEnabled("skilled", "a", false)).toMatchObject({ skills: ["a", "b"], disabledSkills: ["a"], enabled: true });
    expect(new PluginRegistry(file).get("skilled")?.disabledSkills).toEqual(["a"]);
    expect(() => service.setSkillEnabled("skilled", "nope", false)).toThrow(/no skill "nope"/);
    expect(service.setSkillEnabled("skilled", "a", true).disabledSkills).toEqual([]);
  });
});

describe("the catalog", () => {
  function folderMarket(root: string, name: string, plugins: Array<{ name: string; files: Record<string, string | object> }>) {
    write(path.join(dir, root, ".claude-plugin", "marketplace.json"), { name, plugins: plugins.map((plugin) => ({ name: plugin.name, source: `./${plugin.name}` })) });
    for (const plugin of plugins) for (const [file, content] of Object.entries(plugin.files)) write(path.join(dir, root, plugin.name, file), content);
    return path.join(dir, root);
  }

  it("shows a plugin two marketplaces offer once, preferring the one with a Codex manifest", () => {
    const claude = folderMarket("claude", "claude-market", [{ name: "linear", files: { ".claude-plugin/plugin.json": { name: "linear" }, ".mcp.json": { linear: { type: "http", url: "https://mcp.linear.app/mcp" } } } }]);
    const codex = folderMarket("codex", "codex-market", [{ name: "linear", files: { ".codex-plugin/plugin.json": { name: "linear", interface: { displayName: "Linear" } }, ".mcp.json": { mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } } } } }]);
    const data = path.join(dir, "userData", "plugins");
    const service = new PluginService({ registry: new PluginRegistry(path.join(data, "installed.json")), host: host(), dataDir: data });
    service.addMarketplace(claude);
    service.addMarketplace(codex);
    const catalog = service.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ displayName: "Linear", compat: { level: "signin", label: "May need sign-in" } });
    expect(catalog[0]!.sources.map((source) => [source.marketplaceName, source.codex])).toEqual([["codex-market", true], ["claude-market", false]]);
  });

  it("leads with the listing that works best and borrows the face of the others", () => {
    // Codex's Linear carries a ChatGPT app elastic skips (Partly) but the logo, site and prompts;
    // Claude's is the bare server (May need sign-in). Claude's leads; the card still shows Codex's face.
    const claude = folderMarket("claude", "claude-plugins-official", [{ name: "linear", files: { ".claude-plugin/plugin.json": { name: "linear", author: { name: "Linear" } }, ".mcp.json": { linear: { type: "http", url: "https://mcp.linear.app/mcp" } } } }]);
    write(path.join(claude, ".claude-plugin", "marketplace.json"), { name: "claude-plugins-official", plugins: [{ name: "linear", source: "./linear", homepage: "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/linear" }] });
    const codex = folderMarket("codex", "codex-market", [{ name: "linear", files: {
      ".codex-plugin/plugin.json": { name: "linear", version: "5.0.1", homepage: "https://linear.app/", apps: "./.app.json", interface: { displayName: "Linear", developerName: "Linear Orbit, Inc", websiteURL: "https://linear.app/", logo: "./assets/logo.png", defaultPrompt: ["Triage the issues for this task"] } },
      ".mcp.json": { mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } } },
      ".app.json": { apps: { linear: { id: "connector_1" } } },
      "assets/logo.png": "\x89PNG",
    } }]);
    const markets = [claude, codex].map((root) => ({ ...readMarketplace(root), kind: "local" as const, url: null }));
    const [entry] = buildCatalog(markets, { bySource: new Map(), ids: new Set() });
    expect(entry!.sources.map((source) => source.marketplaceName)).toEqual(["claude-plugins-official", "codex-market"]);
    expect(entry).toMatchObject({
      displayName: "Linear", compat: { level: "signin" }, version: "5.0.1", homepage: "https://linear.app/",
      publisher: "Linear", needs: ["sign-in"], adds: { servers: ["linear (mcp.linear.app)"], skills: [] },
      prompts: ["Triage the issues for this task"], verified: false, example: false,
    });
    expect(entry!.logo).toMatch(/^data:image\/png;base64,/);
  });

  it("says a single working part in the singular", () => {
    const root = path.join(dir, "one");
    write(path.join(root, ".codex-plugin", "plugin.json"), { name: "one" });
    write(path.join(root, ".mcp.json"), { mcpServers: { one: { url: "https://mcp.example.com/mcp" } } });
    write(path.join(root, ".app.json"), { apps: { one: { id: "connector_1" } } });
    expect(compatibilityOf({ path: root, remote: null, inline: null, unsupported: null }).detail).toBe("a server at mcp.example.com works here; elastic does not run its ChatGPT apps");
  });

  it("leaves out catalogs' test fixtures, marks elastic's examples, and names and trusts the official catalogs", () => {
    const official = folderMarket("official", "claude-plugins-official", [
      { name: "fakechat", files: { ".claude-plugin/plugin.json": { name: "fakechat" }, "skills/s/SKILL.md": "---\nname: s\n---\n" } },
      { name: "keys", files: { ".claude-plugin/plugin.json": { name: "keys" }, ".mcp.json": { keys: { command: "npx", args: ["-y", "keys-mcp"], env: { KEYS_API_KEY: "" } } } } },
    ]);
    const examples = folderMarket("examples", "examples", [{ name: "tables", files: { ".codex-plugin/plugin.json": { name: "tables" }, "skills/t/SKILL.md": "---\nname: t\n---\n" } }]);
    const catalog = buildCatalog([
      { ...readMarketplace(official), kind: "git", url: "https://github.com/anthropics/claude-plugins-official.git" },
      { ...readMarketplace(examples), kind: "builtin", url: null },
    ], { bySource: new Map(), ids: new Set() });
    expect(catalog.map((entry) => entry.name).sort()).toEqual(["keys", "tables"]);
    const keys = catalog.find((entry) => entry.name === "keys")!;
    expect(keys).toMatchObject({ verified: true, needs: ["api-key", "download"], example: false, sources: [{ marketplaceName: "Claude official" }] });
    expect(catalog.find((entry) => entry.name === "tables")).toMatchObject({ example: true, verified: true, adds: { servers: [], skills: ["t"] } });
  });

  it("labels what elastic cannot run", () => {
    const root = path.join(dir, "p");
    write(path.join(root, ".codex-plugin", "plugin.json"), { name: "review" });
    write(path.join(root, ".mcp.json"), { mcpServers: { review: { command: "./bin/codex-launcher" } } });
    expect(compatibilityOf({ path: root, remote: null, inline: null, unsupported: null })).toMatchObject({ level: "codex", label: "Needs Codex" });
    write(path.join(root, ".app.json"), { apps: { figma: { id: "connector_1" } } });
    write(path.join(root, "skills", "s", "SKILL.md"), "---\nname: s\n---\n");
    expect(compatibilityOf({ path: root, remote: null, inline: null, unsupported: null })).toMatchObject({ level: "partly", detail: expect.stringMatching(/ChatGPT apps.*Codex only/) });
    const hooks = path.join(dir, "h");
    write(path.join(hooks, ".claude-plugin", "plugin.json"), { name: "h" });
    write(path.join(hooks, "hooks", "hooks.json"), {});
    write(path.join(hooks, "commands", "go.md"), "");
    expect(compatibilityOf({ path: hooks, remote: null, inline: null, unsupported: null })).toMatchObject({ level: "partly", detail: "elastic does not run its hooks, slash commands" });
    expect(readMarketplace).toBeDefined();
  });
});
