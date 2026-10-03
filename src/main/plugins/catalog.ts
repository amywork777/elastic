/**
 * The Plugins page's one list: every marketplace's entries, merged, with the
 * same plugin offered by several marketplaces shown once.
 *
 * Two entries are the same plugin when they come from the same repository
 * folder (a git URL plus a subfolder, or the same folder on disk), and then
 * when they have the same name: Linear in Claude's marketplace and in Codex's
 * is one card. The card keeps every source; the first is the one Install uses:
 * a folder on disk with a Codex manifest (`.codex-plugin`, where MCP App views
 * are declared) first, then any folder on disk, then a remote repository.
 *
 * Each card also says whether it will work here, from what is on disk and
 * without installing anything (`compatibilityOf`). A remote entry is read
 * when it is installed, and says so.
 *
 * Plain `node:fs`, no Electron.
 */
import fs from "node:fs";
import path from "node:path";

import type { CatalogEntry, CatalogSource, Compatibility } from "../../shared/plugins";
import { keyOf } from "./git";
import { expandPluginRoot, findManifest, type MarketplaceEntryFile, type MarketplaceFile } from "./manifest";

export type CatalogMarket = MarketplaceFile & {
  kind: CatalogSource["kind"];
  /** The repository a git marketplace was cloned from, or null. */
  url: string | null;
};

type Json = Record<string, unknown>;

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

const isDir = (target: string) => fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
const isFile = (target: string) => fs.statSync(target, { throwIfNoEntry: false })?.isFile() ?? false;

function serversOf(dir: string, manifest: Json): Record<string, Json> {
  let raw: unknown = null;
  if (typeof manifest.mcpServers === "string") raw = readJson(path.resolve(dir, manifest.mcpServers));
  else if (manifest.mcpServers && typeof manifest.mcpServers === "object") raw = manifest.mcpServers;
  else if (isFile(path.join(dir, ".mcp.json"))) raw = readJson(path.join(dir, ".mcp.json"));
  if (!raw || typeof raw !== "object") return {};
  const map = "mcpServers" in (raw as Json) ? (raw as Json).mcpServers : raw;
  return map && typeof map === "object" ? map as Record<string, Json> : {};
}

/** A command only Codex supplies: a launcher the plugin does not carry, or Codex itself. */
function codexOnly(dir: string, server: Json): boolean {
  const command = typeof server.command === "string" ? expandPluginRoot(server.command, dir) : "";
  const args = Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === "string").map((arg) => expandPluginRoot(arg, dir)) : [];
  if (/(^|\/)codex(\.exe)?$/.test(command) || [command, ...args].some((part) => /\.codex\/|CODEX_HOME|codex-app/.test(part))) return true;
  if (command.startsWith("./") || command.startsWith("../")) return !isFile(path.resolve(dir, command));
  return false;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Whether a plugin will work in elastic, read from its folder (or the entry's
 * inline manifest) without installing it. Works: MCP servers that run here
 * and skills. May need sign-in: a remote server. Partly: parts elastic
 * ignores (Claude Code's hooks, commands, agents, language servers, output
 * styles; ChatGPT apps). Needs Codex: nothing but launchers Codex supplies.
 */
export function compatibilityOf(entry: Pick<MarketplaceEntryFile, "path" | "remote" | "inline" | "unsupported">): Compatibility {
  if (entry.unsupported) return { level: "unavailable", label: "Can't install", detail: entry.unsupported };
  const dir = entry.path && isDir(entry.path) ? entry.path : null;
  if (!dir && !entry.inline) {
    const host = entry.remote ? keyOf(entry.remote.url).replace(/^https:\/\//, "").split("/")[0] : null;
    return { level: "unknown", label: "Checked on install", detail: host ? `elastic reads this plugin from ${host} when you install it` : "elastic reads this plugin when you install it" };
  }
  const manifestFile = dir ? findManifest(dir) : null;
  const manifest = ((manifestFile ? readJson(manifestFile) : null) ?? entry.inline ?? {}) as Json;
  const servers = dir ? serversOf(dir, manifest) : (manifest.mcpServers && typeof manifest.mcpServers === "object" ? manifest.mcpServers as Record<string, Json> : {});
  const skills = dir && isDir(path.join(dir, typeof manifest.skills === "string" ? manifest.skills : "skills"))
    ? fs.readdirSync(path.join(dir, typeof manifest.skills === "string" ? manifest.skills : "skills")).filter((name) => isFile(path.join(dir, typeof manifest.skills === "string" ? manifest.skills : "skills", name, "SKILL.md"))).length
    : 0;

  const remote: string[] = [];
  const codex: string[] = [];
  let local = 0;
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server !== "object") continue;
    if (typeof server.url === "string") {
      try { remote.push(new URL(server.url).host); } catch { remote.push(name); }
    } else if (dir && codexOnly(dir, server)) codex.push(name);
    else if (typeof server.command === "string") local += 1;
  }
  const ignored: string[] = [];
  const has = (key: string, folder?: string, file?: string) =>
    manifest[key] !== undefined || (dir !== null && ((folder !== undefined && isDir(path.join(dir, folder))) || (file !== undefined && isFile(path.join(dir, file)))));
  if (has("hooks", undefined, "hooks/hooks.json") || (dir !== null && isFile(path.join(dir, "hooks.json")))) ignored.push("hooks");
  if (has("commands", "commands")) ignored.push("slash commands");
  if (has("agents", "agents")) ignored.push("subagents");
  if (manifest.lspServers !== undefined) ignored.push("a language server");
  if (has("outputStyles", "output-styles")) ignored.push("output styles");
  const apps = dir && isFile(path.join(dir, ".app.json")) ? Object.keys(((readJson(path.join(dir, ".app.json")) as Json | null)?.apps as Json | undefined) ?? {}) : [];
  if (apps.length > 0) ignored.push("ChatGPT apps");

  const usable = local + remote.length + skills;
  const parts = [
    local > 0 ? plural(local, "MCP server") : null,
    remote.length > 0 ? `a server at ${[...new Set(remote)].join(", ")}` : null,
    skills > 0 ? plural(skills, "skill") : null,
  ].filter(Boolean).join(", ");
  if (codex.length > 0 && usable === 0) {
    return { level: "codex", label: "Needs Codex", detail: `its ${codex.join(", ")} server runs a launcher only Codex supplies` };
  }
  if (ignored.length > 0 || codex.length > 0) {
    const skipped = [...ignored, ...(codex.length > 0 ? [`the ${codex.join(", ")} server (Codex only)`] : [])];
    return usable === 0
      ? { level: apps.length > 0 && ignored.length === 1 ? "codex" : "partly", label: apps.length > 0 && ignored.length === 1 ? "Needs ChatGPT" : "Partly", detail: `elastic does not run its ${skipped.join(", ")}` }
      : { level: "partly", label: "Partly", detail: `${parts} work here; elastic does not run its ${skipped.join(", ")}` };
  }
  if (remote.length > 0) return { level: "signin", label: "May need sign-in", detail: `${parts}; you sign in to ${[...new Set(remote)].join(", ")} if it asks` };
  if (usable === 0) return { level: "partly", label: "Partly", detail: "it has no MCP servers or skills elastic can use" };
  return { level: "works", label: "Works", detail: parts };
}

/** What two entries are compared by: their repository folder, or their folder on disk. */
function sourceKey(market: CatalogMarket, entry: MarketplaceEntryFile): string {
  if (entry.remote) return `${keyOf(entry.remote.url)}#${(entry.remote.subdir ?? "").replace(/^\.?\/+|\/+$/g, "")}`;
  if (entry.path && market.url) return `${keyOf(market.url)}#${path.relative(market.root, entry.path).split(path.sep).join("/").replace(/^\.$/, "")}`;
  return entry.path ? path.resolve(entry.path) : `${market.file}#${entry.name}`;
}

function rank(source: CatalogSource): number {
  return source.kind === "bundled" ? 0 : source.codex ? 1 : source.onDisk ? 2 : 3;
}

function displayNameOf(entry: MarketplaceEntryFile): string | null {
  if (!entry.path || !isDir(entry.path)) return null;
  const file = findManifest(entry.path);
  const manifest = file ? readJson(file) as Json | null : null;
  const name = (manifest?.interface as Json | undefined)?.displayName;
  return typeof name === "string" && name ? name : null;
}

/** The merged list. `installed` maps `<marketplace file>#<entry name>` and plugin ids to installed plugin ids. */
export function buildCatalog(markets: CatalogMarket[], installed: { bySource: Map<string, string>; ids: Set<string> }): CatalogEntry[] {
  type Group = { key: string; names: Set<string>; items: Array<{ market: CatalogMarket; entry: MarketplaceEntryFile; source: CatalogSource; compat: Compatibility }> };
  const byKey = new Map<string, Group>();
  for (const market of markets) {
    for (const entry of market.plugins) {
      const key = sourceKey(market, entry);
      const group = byKey.get(key) ?? { key, names: new Set(), items: [] };
      const onDisk = entry.path !== null && isDir(entry.path);
      group.items.push({
        market,
        entry,
        source: {
          marketplace: market.file,
          marketplaceName: market.displayName,
          name: entry.name,
          kind: market.kind,
          onDisk,
          codex: onDisk && isFile(path.join(entry.path!, ".codex-plugin", "plugin.json")),
          url: entry.remote?.url ?? market.url,
        },
        compat: compatibilityOf(entry),
      });
      group.names.add(entry.name.toLowerCase());
      byKey.set(key, group);
    }
  }
  // Then by name: the same plugin listed by two marketplaces from two folders.
  const byName = new Map<string, Group>();
  const merged: Group[] = [];
  for (const group of byKey.values()) {
    const existing = [...group.names].map((name) => byName.get(name)).find(Boolean);
    if (existing) {
      existing.items.push(...group.items);
      for (const name of group.names) { existing.names.add(name); byName.set(name, existing); }
    } else {
      merged.push(group);
      for (const name of group.names) byName.set(name, group);
    }
  }
  return merged.map((group) => {
    const items = [...group.items].sort((a, b) => rank(a.source) - rank(b.source));
    const first = items[0]!;
    const installedId = items.map((item) => installed.bySource.get(`${item.source.marketplace}#${item.source.name}`)).find(Boolean)
      ?? (installed.ids.has(first.entry.name) ? first.entry.name : null);
    return {
      key: group.key,
      name: first.entry.name,
      displayName: displayNameOf(first.entry) ?? first.entry.name,
      description: items.map((item) => item.entry.description).find(Boolean) ?? "",
      category: items.map((item) => item.entry.category).find(Boolean) ?? null,
      version: first.entry.version,
      homepage: items.map((item) => item.entry.homepage).find(Boolean) ?? null,
      compat: first.compat,
      sources: items.map((item) => item.source),
      installedId,
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
