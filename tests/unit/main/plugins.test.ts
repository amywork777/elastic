/**
 * The plugin system's Electron-free half: reading manifests and marketplaces,
 * the registry, `readToolUi`, and the app-protocol policy. The servers
 * themselves are driven in plugins-servers.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clearStorageData = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("electron", () => ({ protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }, session: { defaultSession: { clearStorageData } } }));

import { appPolicy, frameNavigationAllowed, releaseApp, stageApp } from "../../../src/main/plugins/app-protocol";
import { expandPluginRoot, insidePlugin, readMarketplace, readPlugin } from "../../../src/main/plugins/manifest";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { appOnly } from "../../../src/main/plugins/service";
import { fileExtensionsOf, readToolUi } from "../../../src/shared/plugins";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-plugins-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(relative: string, content: string | object) {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

describe("readPlugin", () => {
  it("reads a Codex manifest with servers in a separate file, skills and a logo", () => {
    write("p/.codex-plugin/plugin.json", { name: "demo", version: "1.0.0", mcpServers: "./servers.json", skills: "./skills/", interface: { displayName: "Demo", logo: "./logo.svg" } });
    write("p/servers.json", { mcpServers: { main: { command: "node", args: ["${PLUGIN_ROOT}/server.mjs"] } } });
    write("p/skills/one/SKILL.md", "---\nname: one\n---\n");
    write("p/skills/not-a-skill/README.md", "");
    write("p/logo.svg", "<svg/>");
    const read = readPlugin(path.join(dir, "p"));
    expect(read.manifest.name).toBe("demo");
    expect(Object.keys(read.servers)).toEqual(["main"]);
    expect(read.servers.main!.args).toEqual(["${PLUGIN_ROOT}/server.mjs"]);
    expect(read.skills).toEqual(["one"]);
    expect(read.logo).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("reads a Claude Code manifest with inline servers, and a bare .mcp.json beside it", () => {
    write("a/.claude-plugin/plugin.json", { name: "inline", mcpServers: { s: { command: "x" } } });
    expect(Object.keys(readPlugin(path.join(dir, "a")).servers)).toEqual(["s"]);
    write("b/.claude-plugin/plugin.json", { name: "beside" });
    write("b/.mcp.json", { mcpServers: { t: { url: "https://example.com/mcp" } } });
    expect(readPlugin(path.join(dir, "b")).servers.t!.url).toBe("https://example.com/mcp");
    // Linear's plugin: a bare map of servers, no `mcpServers` key.
    write("c/.claude-plugin/plugin.json", { name: "bare" });
    write("c/.mcp.json", { linear: { type: "http", url: "https://mcp.linear.app/mcp" } });
    expect(readPlugin(path.join(dir, "c")).servers.linear!.url).toBe("https://mcp.linear.app/mcp");
  });

  it("says why a folder is not a plugin", () => {
    fs.mkdirSync(path.join(dir, "empty"));
    expect(() => readPlugin(path.join(dir, "empty"))).toThrow(/no plugin manifest/);
    write("bad/plugin.json", { name: "has spaces" });
    expect(() => readPlugin(path.join(dir, "bad"))).toThrow(/manifest is not valid/);
    write("noserver/plugin.json", { name: "n", mcpServers: { s: { args: [] } } });
    expect(() => readPlugin(path.join(dir, "noserver"))).toThrow(/command or a url/);
  });

  it("refuses paths that leave the plugin folder", () => {
    write("escape/plugin.json", { name: "escape", mcpServers: "../outside.json" });
    write("outside.json", { mcpServers: {} });
    expect(() => readPlugin(path.join(dir, "escape"))).toThrow(/outside the plugin folder/);
    expect(() => insidePlugin(dir, "../x")).toThrow();
    expect(insidePlugin(dir, "a/b")).toBe(path.join(dir, "a", "b"));
  });

  it("expands the plugin root in commands", () => {
    expect(expandPluginRoot("${CLAUDE_PLUGIN_ROOT}/a ${PLUGIN_ROOT}/b", "/r")).toBe("/r/a /r/b");
  });
});

describe("readMarketplace", () => {
  it("reads Codex's .agents/plugins/marketplace.json, resolving local sources from its root", () => {
    write("m/.agents/plugins/marketplace.json", {
      name: "mine", interface: { displayName: "Mine" },
      plugins: [
        { name: "a", description: "A", source: { source: "local", path: "./plugins/a" } },
        { name: "b", source: "./plugins/b" },
        { name: "remote", source: { source: "github", repo: "x/y" } },
        { name: "escape", source: "../../elsewhere" },
      ],
    });
    const market = readMarketplace(path.join(dir, "m"));
    expect(market.displayName).toBe("Mine");
    expect(market.plugins.map((plugin) => plugin.name)).toEqual(["a", "b"]);
    expect(market.plugins[0]!.path).toBe(path.join(dir, "m", "plugins", "a"));
  });

  it("reads the app's own examples marketplace", () => {
    const market = readMarketplace(path.resolve("resources/plugins"));
    expect(market.plugins.map((plugin) => plugin.name)).toEqual(["csv-table", "filesystem", "memory", "mcp-app-demo"]);
    for (const plugin of market.plugins) expect(() => readPlugin(plugin.path)).not.toThrow();
  });
});

describe("PluginRegistry", () => {
  it("keeps installs, toggles, handlers and consent across instances, and forgets a plugin's on uninstall", () => {
    const file = path.join(dir, "installed.json");
    const registry = new PluginRegistry(file);
    registry.install("demo", { kind: "local", path: "/p" }, 5);
    registry.setEnabled("demo", false);
    registry.setFileHandler(".CSV", "demo/tables/show");
    registry.allowFiles("/project", "demo");
    registry.addMarketplace("/m.json");
    const again = new PluginRegistry(file);
    expect(again.get("demo")).toMatchObject({ enabled: false, installedAt: 5 });
    expect(again.fileHandlers()).toEqual({ csv: "demo/tables/show" });
    expect(again.fileConsent()).toEqual({ "/project": ["demo"] });
    expect(again.marketplaces()).toEqual(["/m.json"]);
    again.install("demo", { kind: "local", path: "/p" });
    expect(again.get("demo")!.enabled).toBe(false);
    again.uninstall("demo");
    expect(again.fileHandlers()).toEqual({});
    expect(again.fileConsent()).toEqual({ "/project": [] });
  });

  it("sets a broken file aside instead of overwriting it", () => {
    const file = write("installed.json", "{ not json");
    const registry = new PluginRegistry(file);
    expect(registry.list()).toEqual([]);
    expect(fs.existsSync(`${file}.bad`)).toBe(true);
  });
});

describe("readToolUi", () => {
  it("reads MCP Apps' resourceUri, visibility and Codex's entrypoints", () => {
    const tool = readToolUi("s", { name: "view", _meta: {
      ui: { resourceUri: "ui://x", visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }, { type: "file", extensions: [".STEP", "stp"] }, { type: "nonsense" }] },
    } })!;
    expect(tool.id).toBe("s/view");
    expect(tool.visibility).toEqual(["app"]);
    expect(tool.entrypoints.map((entry) => entry.type)).toEqual(["global", "file"]);
    expect(fileExtensionsOf(tool)).toEqual(["step", "stp"]);
    expect(appOnly({ _meta: { ui: { visibility: ["app"] } } })).toBe(true);
    expect(appOnly({ _meta: { ui: { visibility: ["app", "model"] } } })).toBe(false);
  });

  it("accepts the older flat key, defaults to a thread tool, and skips tools without a UI", () => {
    expect(readToolUi("s", { name: "t", _meta: { "ui/resourceUri": "ui://y" } })!.entrypoints).toEqual([{ type: "thread" }]);
    expect(readToolUi("s", { name: "plain" })).toBeNull();
  });
});

describe("mcp-app:// documents", () => {
  it("serves under a policy with no network unless the resource asks, and drops released documents", () => {
    expect(appPolicy(undefined)).toContain("connect-src 'none'");
    const policy = appPolicy({ connectDomains: ["https://api.example.com", "bad domain; script-src *"], resourceDomains: ["https://cdn.example.com"] });
    expect(policy).toContain("connect-src https://api.example.com");
    expect(policy).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.example.com");
    expect(policy).not.toContain("bad domain");
    // text-to-cad's CAD page declares the schemes its workers fetch from.
    expect(appPolicy({ connectDomains: ["data:", "blob:", "javascript:"] })).toContain("connect-src data: blob:;");
    const url = stageApp("<p>hi</p>", undefined);
    expect(url).toMatch(/^mcp-app:\/\/[0-9a-f]{24}\/index\.html$/);
    releaseApp(url);
    // The frame's origin goes with it: nothing it stored is left for a later one.
    expect(clearStorageData).toHaveBeenCalledWith({ origin: url.replace(/\/index\.html$/, "") });
  });

  it("gives every staged document an origin of its own", () => {
    const origins = new Set(Array.from({ length: 20 }, () => new URL(stageApp("<p/>", undefined)).hostname));
    expect(origins.size).toBe(20);
  });

  it("keeps an app's frame on its own origin", () => {
    const own = "mcp-app://aaaaaaaaaaaaaaaaaaaaaaaa/index.html";
    expect(frameNavigationAllowed(own, "mcp-app://aaaaaaaaaaaaaaaaaaaaaaaa/other.html")).toBe(true);
    expect(frameNavigationAllowed(own, "mcp-app://bbbbbbbbbbbbbbbbbbbbbbbb/index.html")).toBe(false);
    expect(frameNavigationAllowed(own, "file:///Applications/elastic.app/Contents/Resources/app/out/renderer/index.html")).toBe(false);
    expect(frameNavigationAllowed(own, "http://localhost:5173/")).toBe(false);
    expect(frameNavigationAllowed(own, "https://example.com/")).toBe(false);
    expect(frameNavigationAllowed(own, "javascript:alert(1)")).toBe(false);
    // Frames that are not apps (the browser's own pages live in views, not frames) are not this rule's.
    expect(frameNavigationAllowed("about:blank", "https://example.com/")).toBe(true);
  });
});
