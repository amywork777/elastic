/**
 * `plugins.*`: what is installed, installing and removing, and the renderer's
 * way to a plugin's MCP servers (its MCP Apps call their own server's tools
 * and read its `ui://` resources through `plugins.request`).
 *
 * Every change main makes is pushed whole as `plugins.changed`, so the
 * sidebar, the Plugins page and every open tab read one snapshot.
 *
 * `invoke` comes from `./define`, not from `../ipc` (see ./skills.ts).
 */
import { z } from "zod";

import { CatalogEntrySchema, MarketplaceSchema, PluginRecordSchema } from "../plugins";
import { invoke } from "./define";

export const PluginsSnapshotSchema = z.object({
  plugins: z.array(PluginRecordSchema),
  marketplaces: z.array(MarketplaceSchema),
  /** Every marketplace's plugins, merged into one list (`src/main/plugins/catalog.ts`). */
  catalog: z.array(CatalogEntrySchema).default([]),
  /** Extension → "builtin" or `<pluginId>/<toolId>`. */
  fileHandlers: z.record(z.string(), z.string()),
  /** Project path → plugin ids allowed to open its files. */
  fileConsent: z.record(z.string(), z.array(z.string())),
});
export type PluginsSnapshot = z.infer<typeof PluginsSnapshotSchema>;

/** The MCP requests a renderer may make of a plugin server. */
export const PluginRequestMethodSchema = z.enum([
  "tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get",
]);

/** Which processes a request reaches: a session's (its id) or the app's (no session). */
const ScopeSchema = z.object({
  sessionId: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  /** The session's worktree, or null for the project directory. */
  root: z.string().nullable().optional(),
});

const Id = z.object({ id: z.string().min(1) });

export const pluginsContract = {
  plugins: {
    list: invoke(z.void(), PluginsSnapshotSchema),
    /** Re-read every plugin from disk and list its tools again. */
    refresh: invoke(z.void(), PluginsSnapshotSchema),
    /** A folder chooser, then install what it found. Null when cancelled. */
    installFolder: invoke(z.object({ path: z.string().min(1).optional() }), PluginRecordSchema.nullable()),
    installFromMarketplace: invoke(z.object({ marketplace: z.string().min(1), name: z.string().min(1) }), PluginRecordSchema),
    uninstall: invoke(Id, z.void()),
    setEnabled: invoke(z.object({ id: z.string().min(1), enabled: z.boolean() }), PluginRecordSchema),
    /** Sign in to one of a plugin's remote servers, in the system browser. Resolves when it is done. */
    signIn: invoke(z.object({ id: z.string().min(1), server: z.string().min(1) }), PluginRecordSchema),
    signOut: invoke(z.object({ id: z.string().min(1), server: z.string().min(1) }), PluginRecordSchema),
    /**
     * Add a marketplace: `source` is a repository (`owner/repo` or a git URL), fetched in the
     * background; `path` a folder; neither opens a folder chooser. Null when cancelled.
     */
    addMarketplace: invoke(z.object({ path: z.string().min(1).optional(), source: z.string().min(1).max(500).optional() }), MarketplaceSchema.nullable()),
    removeMarketplace: invoke(z.object({ file: z.string().min(1) }), z.void()),
    /** Fetch every git marketplace again (in the background); answers at once. */
    refreshMarketplaces: invoke(z.void(), PluginsSnapshotSchema),
    /** Install a plugin again from its marketplace's latest commit. */
    update: invoke(Id, PluginRecordSchema),
    /** Choose who renders an extension; null puts it back to the default. */
    setFileHandler: invoke(z.object({ extension: z.string().min(1), handler: z.string().min(1).nullable() }), z.void()),
    /** The person said yes: this plugin may open this project's files. */
    allowFiles: invoke(z.object({ projectId: z.string().min(1), pluginId: z.string().min(1) }), z.void()),
    /** One MCP request to one of a plugin's servers. */
    request: invoke(
      z.object({ pluginId: z.string().min(1), server: z.string().min(1), method: PluginRequestMethodSchema, params: z.record(z.string(), z.unknown()).default({}), scope: ScopeSchema }),
      z.unknown(),
    ),
    /**
     * Open a file in a plugin's file tool: main resolves the path inside the
     * project, checks the person allowed this plugin, and calls the tool with
     * `{ file: { name, resourceUri } }` (Codex's shape). Answers the tool's
     * input and result for the frame.
     */
    openFile: invoke(
      z.object({ pluginId: z.string().min(1), toolId: z.string().min(1), path: z.string().min(1), scope: ScopeSchema.extend({ projectId: z.string().min(1) }) }),
      z.object({ arguments: z.record(z.string(), z.unknown()), result: z.unknown(), absolutePath: z.string() }),
    ),
    /** Serve an MCP App's HTML from its own `mcp-app://` URL, under the policy its `_meta.ui.csp` asks for. */
    stageApp: invoke(z.object({ html: z.string().max(16 * 1024 * 1024), csp: z.unknown().optional() }), z.object({ url: z.string() })),
    releaseApp: invoke(z.object({ url: z.string() }), z.void()),
  },
} as const;

export const pluginsEvents = {
  "plugins.changed": PluginsSnapshotSchema,
} as const;
