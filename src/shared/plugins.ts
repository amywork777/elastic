/**
 * Plugins: what an installed plugin is, as main and the renderer share it.
 *
 * A plugin is a folder with a manifest in the Codex plugin format
 * (`.codex-plugin/plugin.json`; `.claude-plugin/plugin.json` is read too). It
 * gives agents MCP servers (`mcpServers`, a path to a `.mcp.json` or the map
 * itself) and skills (`skills`, a directory of `<name>/SKILL.md`). Its UI is
 * not in the manifest: like Codex, the app asks each MCP server for its tools
 * and reads the ones that carry an MCP Apps UI (`_meta.ui.resourceUri`). A
 * tool's `_meta["openai/ui"].entrypoints` (or the neutral `_meta.ui.entrypoints`)
 * says where it shows up:
 *
 *   { type: "global" }                    a page in the sidebar, under the plugin
 *   { type: "thread" }                    a tab a session's explorer can open
 *   { type: "file", extensions: [...] }   how files of those extensions render
 *
 * A UI tool that names none is a `thread` tool.
 *
 * See docs/plugins.md for the authoring guide and the Codex research (private research repo)
 * for where each shape comes from.
 */
import { z } from "zod";

/** The MIME type an MCP App's UI resource is served as (MCP Apps, SEP-1865). */
export const MCP_APP_MIME = "text/html;profile=mcp-app";
/** The client capability extension that tells a server this host renders MCP Apps. */
export const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";
/**
 * The client capability extension that tells a server which of Codex's UI entrypoints this host
 * presents (a rail page, a thread tab, a file handler), so a server can offer tabs to any host that
 * declares them rather than to a list of client names. No standard names one yet: this is
 * text-to-cad's (`dev.texttocad/tabs`, cadgen 0.7.9; earthtojake/text-to-cad #509, #510), which
 * also asks what elastic already does: one server process per thread, and the thread's folder
 * through MCP roots.
 */
export const UI_ENTRYPOINTS_EXTENSION = "dev.texttocad/tabs";
export const UI_ENTRYPOINTS = ["global", "thread", "file"] as const;

/** One MCP server as a plugin's `.mcp.json` declares it: Codex's keys, and Claude Code's. */
export const PluginServerConfigSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  /** Codex: names of the app's environment variables passed through to the server. */
  env_vars: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  /** Streamable HTTP, instead of a command. */
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** Codex writes `enabled: false` into bundled configs it enables per install; read but not obeyed. */
  enabled: z.boolean().optional(),
  startup_timeout_sec: z.number().positive().optional(),
  tool_timeout_sec: z.number().positive().optional(),
  /**
   * elastic's own tools for a domain (`browser`, `documents`, `pdf`, `terminals`): the server
   * the app serves itself, scoped to each session, instead of a process the plugin starts.
   * Only the plugins that ship with the app may name one (`resources/bundled`).
   */
  builtin: z.string().regex(/^[a-z][a-z-]*$/).optional(),
}).passthrough().refine((server) => Boolean(server.command || server.url || server.builtin), "a server needs a command or a url");
export type PluginServerConfig = z.infer<typeof PluginServerConfigSchema>;

export const PluginMcpConfigSchema = z.object({ mcpServers: z.record(z.string(), PluginServerConfigSchema) });

/** The manifest, as far as this app reads it. Unknown keys are kept and ignored. */
export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i, "a plugin name is letters, digits, dots, dashes and underscores"),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.union([z.string(), z.object({ name: z.string().optional(), url: z.string().optional(), email: z.string().optional() }).passthrough()]).optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  skills: z.string().optional(),
  mcpServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  interface: z.object({
    displayName: z.string().optional(),
    shortDescription: z.string().optional(),
    longDescription: z.string().optional(),
    developerName: z.string().optional(),
    category: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    composerIcon: z.string().optional(),
    logo: z.string().optional(),
    logoDark: z.string().optional(),
    brandColor: z.string().optional(),
    defaultPrompt: z.array(z.string()).optional(),
    websiteURL: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginEntrypointSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("thread") }),
  z.object({ type: z.literal("file"), extensions: z.array(z.string()).default([]) }),
]);
export type PluginEntrypoint = z.infer<typeof PluginEntrypointSchema>;

/** A tool with a UI: one MCP tool whose result an MCP App renders. */
export const PluginToolSchema = z.object({
  /** `<server>/<tool>`: unique inside its plugin, and what a tab and a command name it by. */
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  title: z.string(),
  description: z.string().default(""),
  /** The `ui://` resource the result renders in. */
  resourceUri: z.string(),
  entrypoints: z.array(PluginEntrypointSchema).default([]),
  /** MCP Apps: who may call it. `["app"]` alone hides it from the model. */
  visibility: z.array(z.enum(["model", "app"])).default(["model", "app"]),
  /** The tool's icon (an `icons[].src`), usually a data URL. */
  icon: z.string().nullable().default(null),
  /** MCP's `annotations.readOnlyHint`: calling it changes nothing, so a relaunch may call it again. */
  readOnly: z.boolean().default(false),
});
export type PluginTool = z.infer<typeof PluginToolSchema>;

/**
 * Whether a tab may call the tool again on its own (a relaunch showing its last view): a tool
 * that says it only reads, or one only the app calls (`visibility: ["app"]`), which exists to
 * draw the view.
 */
export function safeToRepeat(tool: Pick<PluginTool, "readOnly" | "visibility">): boolean {
  return tool.readOnly || (tool.visibility.length === 1 && tool.visibility[0] === "app");
}

export const PluginServerStateSchema = z.object({
  name: z.string(),
  /** `app`: one of elastic's own servers, served by the app (`builtin`). */
  transport: z.enum(["stdio", "http", "app"]),
  /** idle: not started yet; ready: listed its tools; signin: a remote server that needs the person to sign in; failed: see `error`. */
  status: z.enum(["idle", "starting", "ready", "signin", "failed"]),
  /** A remote server with saved credentials (Sign out is offered). */
  signedIn: z.boolean().default(false),
  error: z.string().nullable().default(null),
  /** Every tool it lists, by name: the model's and the app's. */
  toolNames: z.array(z.string()).default([]),
});
export type PluginServerState = z.infer<typeof PluginServerStateSchema>;

export const PluginSourceSchema = z.discriminatedUnion("kind", [
  /** A folder on disk, used in place (edits show up on refresh). */
  z.object({ kind: z.literal("local"), path: z.string() }),
  /**
   * A plugin listed in a marketplace.json; `path` is where it resolved to. From a
   * git marketplace or a remote entry, `path` is its copy in the plugin cache and
   * `commit` the commit it was copied at (what an update is checked against).
   */
  z.object({ kind: z.literal("marketplace"), marketplace: z.string(), name: z.string(), path: z.string(), commit: z.string().nullable().optional() }),
]);
export type PluginSource = z.infer<typeof PluginSourceSchema>;

/** An installed plugin, as the sidebar and Settings show it. */
export const PluginRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  version: z.string().nullable(),
  description: z.string(),
  developer: z.string().nullable(),
  /** A data URL, or null for the generic icon. */
  logo: z.string().nullable(),
  brandColor: z.string().nullable(),
  source: PluginSourceSchema,
  root: z.string(),
  enabled: z.boolean(),
  /** Why the manifest could not be read, or null. A broken plugin stays listed so it can be removed. */
  error: z.string().nullable(),
  servers: z.array(PluginServerStateSchema),
  skills: z.array(z.string()),
  tools: z.array(PluginToolSchema),
  defaultPrompts: z.array(z.string()).default([]),
  /** Ships with the app (`resources/bundled`): it can be turned off, not uninstalled. */
  bundled: z.boolean().default(false),
  /** Its marketplace (or repository) has a newer commit than the one it was installed at. */
  updateAvailable: z.boolean().default(false),
});
export type PluginRecord = z.infer<typeof PluginRecordSchema>;

/** One plugin a marketplace offers. */
export const MarketplaceEntrySchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  /** Its folder inside the marketplace, or null when it is in another repository. */
  path: z.string().nullable(),
  installed: z.boolean(),
});
export type MarketplaceEntry = z.infer<typeof MarketplaceEntrySchema>;

export const MarketplaceSchema = z.object({
  /** The marketplace.json this was read from; for a git marketplace not fetched yet, its clone folder. */
  file: z.string(),
  name: z.string(),
  displayName: z.string(),
  /** bundled: elastic's own; builtin: ships with the app; local: a folder; git: a repository elastic fetches. */
  kind: z.enum(["bundled", "builtin", "local", "git"]).default("local"),
  url: z.string().nullable().default(null),
  commit: z.string().nullable().default(null),
  fetchedAt: z.number().nullable().default(null),
  status: z.enum(["ready", "fetching", "failed"]).default("ready"),
  error: z.string().nullable().default(null),
  plugins: z.array(MarketplaceEntrySchema),
});
export type Marketplace = z.infer<typeof MarketplaceSchema>;

/** Whether a plugin will work here, read from its manifest without installing it. */
export const CompatibilitySchema = z.object({
  level: z.enum(["works", "signin", "partly", "codex", "unavailable", "unknown"]),
  /** The card's label: Works, May need sign-in, Partly, Needs Codex, Needs ChatGPT, Can't install, Checked on install. */
  label: z.string(),
  /** One sentence: what works and what elastic skips. */
  detail: z.string(),
});
export type Compatibility = z.infer<typeof CompatibilitySchema>;

/** One marketplace's listing of a catalog entry. */
export const CatalogSourceSchema = z.object({
  marketplace: z.string(),
  marketplaceName: z.string(),
  /** Its name in that marketplace. */
  name: z.string(),
  kind: z.enum(["bundled", "builtin", "local", "git"]),
  /** Its folder is on disk (inside the marketplace), not in another repository. */
  onDisk: z.boolean(),
  /** That folder has a Codex manifest, where MCP App views are declared. */
  codex: z.boolean(),
  url: z.string().nullable(),
});
export type CatalogSource = z.infer<typeof CatalogSourceSchema>;

/** One card on the Plugins page: a plugin, however many marketplaces offer it. */
export const CatalogEntrySchema = z.object({
  key: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  version: z.string().nullable(),
  homepage: z.string().nullable(),
  /** The plugin's own logo (a small data URL), when its folder is on disk; else null. */
  logo: z.string().nullable().default(null),
  compat: CompatibilitySchema,
  /** The first is what Install uses; the rest are alternates. */
  sources: z.array(CatalogSourceSchema).min(1),
  installedId: z.string().nullable(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/** Where a tool call comes from: a session's explorer (its own server processes) or the app (a global page). */
export const PluginScopeSchema = z.object({
  sessionId: z.string().nullable(),
  projectId: z.string().nullable(),
  root: z.string().nullable(),
});
export type PluginScope = z.infer<typeof PluginScopeSchema>;

/** A tool id is `<server>/<tool>`. */
export function pluginToolId(server: string, tool: string): string {
  return `${server}/${tool}`;
}

export function toolHasEntry(tool: PluginTool, type: PluginEntrypoint["type"]): boolean {
  return tool.entrypoints.some((entry) => entry.type === type);
}

/** The extensions a tool renders, lowercased without the dot. */
export function fileExtensionsOf(tool: PluginTool): string[] {
  return tool.entrypoints.flatMap((entry) => entry.type === "file" ? entry.extensions : [])
    .map((extension) => extension.replace(/^\./, "").toLowerCase()).filter(Boolean);
}

/**
 * The UI facts of one MCP tool, from its `_meta`. Null for a tool without a
 * UI resource. Reads MCP Apps' `ui.resourceUri` (and the older flat
 * `ui/resourceUri`, and `openai/outputTemplate`), `ui.visibility`, and the
 * entrypoints from `openai/ui` or `ui`.
 */
export function readToolUi(server: string, tool: { name: string; title?: string; description?: string; annotations?: { title?: string; readOnlyHint?: boolean }; icons?: Array<{ src?: string }>; _meta?: Record<string, unknown> }): PluginTool | null {
  const meta = (tool._meta ?? {}) as Record<string, unknown>;
  const ui = (typeof meta.ui === "object" && meta.ui ? meta.ui : {}) as Record<string, unknown>;
  const openaiUi = (typeof meta["openai/ui"] === "object" && meta["openai/ui"] ? meta["openai/ui"] : {}) as Record<string, unknown>;
  const resourceUri = [ui.resourceUri, meta["ui/resourceUri"], meta["openai/outputTemplate"]].find((value): value is string => typeof value === "string" && value.length > 0);
  if (!resourceUri) return null;
  const rawEntries = Array.isArray(openaiUi.entrypoints) ? openaiUi.entrypoints : Array.isArray(ui.entrypoints) ? ui.entrypoints : [];
  const entrypoints = rawEntries.flatMap((entry) => {
    const parsed = PluginEntrypointSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const visibility = Array.isArray(ui.visibility)
    ? ui.visibility.filter((value): value is "model" | "app" => value === "model" || value === "app")
    : ["model", "app"] as Array<"model" | "app">;
  return {
    id: pluginToolId(server, tool.name),
    server,
    tool: tool.name,
    title: tool.title ?? tool.annotations?.title ?? tool.name,
    description: tool.description ?? "",
    resourceUri,
    // A UI tool that names no place still has one: a tab a session can open.
    entrypoints: entrypoints.length > 0 ? entrypoints : [{ type: "thread" }],
    visibility: visibility.length > 0 ? visibility : ["model", "app"],
    icon: tool.icons?.find((icon) => typeof icon.src === "string")?.src ?? null,
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}
