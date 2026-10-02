/**
 * Reading a plugin folder: its manifest, its MCP servers, its skills, its
 * logo. Plain `node:fs` over a path, so it is testable without Electron.
 *
 * The manifest is the Codex plugin format, looked for where each host keeps
 * it: `.codex-plugin/plugin.json` (Codex), `.claude-plugin/plugin.json`
 * (Claude Code), or a bare `plugin.json`. Servers come from `mcpServers` (a
 * path to a JSON file holding `{ "mcpServers": {...} }`, or that map inline),
 * else from a `.mcp.json` beside the manifest's folder; skills from `skills`
 * (a directory of `<name>/SKILL.md`), else `skills/` when it exists.
 */
import fs from "node:fs";
import path from "node:path";

import {
  PluginManifestSchema,
  PluginMcpConfigSchema,
  type PluginManifest,
  type PluginServerConfig,
} from "../../shared/plugins";

export const MANIFEST_LOCATIONS = [
  path.join(".codex-plugin", "plugin.json"),
  path.join(".claude-plugin", "plugin.json"),
  "plugin.json",
] as const;

export type ReadPlugin = {
  root: string;
  manifestFile: string;
  manifest: PluginManifest;
  servers: Record<string, PluginServerConfig>;
  /** Absolute directory of `<name>/SKILL.md` folders, or null. */
  skillsDir: string | null;
  skills: string[];
  logo: string | null;
};

/** Inside `root`, refused outside it: a manifest cannot point the app at someone else's files. */
export function insidePlugin(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  const back = path.relative(path.resolve(root), resolved);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`${relative} is outside the plugin folder`);
  }
  return resolved;
}

export function findManifest(root: string): string | null {
  for (const location of MANIFEST_LOCATIONS) {
    const file = path.join(root, location);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  }
  return null;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** `${CLAUDE_PLUGIN_ROOT}` and `${PLUGIN_ROOT}` in a command, an argument or a value. */
export function expandPluginRoot(value: string, root: string): string {
  return value.replaceAll("${CLAUDE_PLUGIN_ROOT}", root).replaceAll("${PLUGIN_ROOT}", root);
}

function readServers(root: string, manifest: PluginManifest): Record<string, PluginServerConfig> {
  let raw: unknown = null;
  if (typeof manifest.mcpServers === "string") {
    raw = readJson(insidePlugin(root, manifest.mcpServers));
  } else if (manifest.mcpServers && typeof manifest.mcpServers === "object") {
    raw = "mcpServers" in manifest.mcpServers ? manifest.mcpServers : { mcpServers: manifest.mcpServers };
  } else if (fs.existsSync(path.join(root, ".mcp.json"))) {
    raw = readJson(path.join(root, ".mcp.json"));
  }
  if (raw === null) return {};
  const parsed = PluginMcpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`the plugin's MCP servers are not valid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  for (const name of Object.keys(parsed.data.mcpServers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`MCP server name "${name}" must be letters, digits, dashes and underscores`);
  }
  return parsed.data.mcpServers;
}

function readSkills(root: string, manifest: PluginManifest): { dir: string | null; names: string[] } {
  const dir = manifest.skills ? insidePlugin(root, manifest.skills) : path.join(root, "skills");
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return { dir: null, names: [] };
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.statSync(path.join(dir, entry.name, "SKILL.md"), { throwIfNoEntry: false })?.isFile())
    .map((entry) => entry.name)
    .sort();
  return { dir, names };
}

const LOGO_TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_LOGO_BYTES = 256 * 1024;

/** The manifest's logo as a data URL, or null when there is none it can show. */
function readLogo(root: string, manifest: PluginManifest): string | null {
  const relative = manifest.interface?.logo ?? manifest.interface?.composerIcon;
  if (!relative) return null;
  try {
    const file = insidePlugin(root, relative);
    const type = LOGO_TYPES[path.extname(file).toLowerCase()];
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!type || !stat?.isFile() || stat.size > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Read a plugin folder. Throws with a sentence when it is not one. */
export function readPlugin(root: string): ReadPlugin {
  const resolved = path.resolve(root);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${resolved} is not a folder`);
  const manifestFile = findManifest(resolved);
  if (!manifestFile) {
    throw new Error(`no plugin manifest in ${resolved} (looked for ${MANIFEST_LOCATIONS.join(", ")})`);
  }
  const parsed = PluginManifestSchema.safeParse(readJson(manifestFile));
  if (!parsed.success) {
    throw new Error(`the manifest is not valid: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`).join("; ")}`);
  }
  const manifest = parsed.data;
  const skills = readSkills(resolved, manifest);
  return { root: resolved, manifestFile, manifest, servers: readServers(resolved, manifest), skillsDir: skills.dir, skills: skills.names, logo: readLogo(resolved, manifest) };
}

export type MarketplaceFile = {
  file: string;
  root: string;
  name: string;
  displayName: string;
  plugins: Array<{ name: string; description: string; category: string | null; path: string }>;
};

export const MARKETPLACE_LOCATIONS = [
  path.join(".agents", "plugins", "marketplace.json"),
  path.join(".claude-plugin", "marketplace.json"),
  "marketplace.json",
] as const;

/**
 * A marketplace: Codex's `.agents/plugins/marketplace.json` or Claude Code's
 * `.claude-plugin/marketplace.json`, given as the file or the folder holding
 * it. Each plugin's local `source` is relative to the marketplace's root (the
 * folder that holds `.agents` or `.claude-plugin`). Remote sources are listed
 * with their reason and cannot be installed from here.
 */
export function readMarketplace(input: string): MarketplaceFile {
  const resolved = path.resolve(input);
  let file = resolved;
  if (fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    const found = MARKETPLACE_LOCATIONS.map((location) => path.join(resolved, location)).find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error(`no marketplace in ${resolved} (looked for ${MARKETPLACE_LOCATIONS.join(", ")})`);
    file = found;
  }
  const root = file.endsWith(path.join(".agents", "plugins", "marketplace.json"))
    ? path.resolve(path.dirname(file), "..", "..")
    : file.endsWith(path.join(".claude-plugin", "marketplace.json")) ? path.resolve(path.dirname(file), "..") : path.dirname(file);
  const raw = readJson(file) as { name?: unknown; interface?: { displayName?: unknown }; plugins?: unknown };
  if (!Array.isArray(raw.plugins)) throw new Error(`${file} lists no plugins`);
  const plugins = raw.plugins.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { name?: unknown; description?: unknown; category?: unknown; source?: unknown };
    if (typeof item.name !== "string") return [];
    const source = typeof item.source === "string" ? item.source
      : item.source && typeof item.source === "object" && (item.source as { source?: unknown }).source === "local"
        ? (item.source as { path?: unknown }).path : null;
    if (typeof source !== "string") return [];
    let target: string;
    try { target = insidePlugin(root, source); } catch { return []; }
    return [{ name: item.name, description: typeof item.description === "string" ? item.description : "", category: typeof item.category === "string" ? item.category : null, path: target }];
  });
  const name = typeof raw.name === "string" ? raw.name : path.basename(root);
  const displayName = typeof raw.interface?.displayName === "string" ? raw.interface.displayName : name;
  return { file, root, name, displayName, plugins };
}
