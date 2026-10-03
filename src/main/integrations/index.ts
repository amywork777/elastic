/** App-owned domain integrations: registry, per-session MCP credentials, skills and renderer relay. */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage, shell } from "electron";
import type { McpServer } from "@agentclientprotocol/sdk";
import type { IntegrationCommand } from "../../shared/ipc/integrations";
import type { Session } from "../../shared/types";
import { appVersion, appRoot, resourcesDir } from "../app-paths";
import { projects, sessions } from "../db/repositories";
import * as git from "../projects/git";
import { createActions, RendererCommands, workspaceDirectory } from "./actions";
import { createTerminalActions } from "./terminals/actions";
import { explorerTerminals } from "../ipc/explorer";
import { sessionRuntimePath } from "../runtime-path";
import { BrowserConnections } from "../browser/connections";
import { integrations } from "./registry.mjs";
import { McpBridge, PLUGIN_INTEGRATION_PREFIX, type BridgeSession, type PluginRpcHandler } from "./mcp-bridge";
import { composeSkillSources, EMPTY_SKILLS, materialiseSkillsRoot, skillsPreamble, SKILLS_ROOT_ENV, type SkillSummary, type SkillsRoot } from "./skills";
import { APP_NAME } from "../../shared/brand";
import { pluginToolId, readToolUi } from "../../shared/plugins";
import { loginEnv } from "../agents/shell-env";
import { FORWARDED_METHODS, PluginHost, type ForwardedMethod } from "../plugins/host";
import { readPlugin } from "../plugins/manifest";
import { AuthStore, PLAIN_CODEC, type Codec } from "../plugins/oauth";
import { PluginRegistry } from "../plugins/registry";
import { PluginService, type PluginsSnapshot } from "../plugins/service";
let bridgeInstance: McpBridge | null = null;
let skillsInstance: SkillsRoot = EMPTY_SKILLS;
let commandsInstance: RendererCommands | null = null;
let pluginsInstance: PluginService | null = null;
/** The enabled plugins' skill folders the skills root was last built from. */
let skillSourcesKey = "";
/**
 * The MCP server script and how to run it. The command is this very Electron
 * binary told to be Node (`ELECTRON_RUN_AS_NODE`): the one interpreter a
 * packaged app is sure to have, on every platform. In a checkout the source
 * resolves the SDK from `apps/desktop/node_modules`; packaged, the bundle
 * `scripts/build-mcp.mjs` wrote is unpacked beside the asar so it can be run
 * by path (electron-builder.yml, `asarUnpack`).
 */
export function mcpServerScript(): { command: string; args: string[]; env: Record<string, string> } {
  const script = app.isPackaged
    ? path.join(appRoot().replace(/app\.asar$/, "app.asar.unpacked"), "out", "app-mcp", "server.mjs")
    : path.join(appRoot(), "resources", "app-mcp", "server.mjs");
  // The skills root travels in the environment: `list_skills` and
  // `read_skill` read it directly, without a round trip through main.
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (skillsInstance.root) {
    env[SKILLS_ROOT_ENV] = skillsInstance.root;
  }
  return { command: process.execPath, args: [script], env };
}

/** The materialised skills root, or null when no skills were composed into the app. */
export function skillsRoot(): string | null {
  return skillsInstance.root;
}

/** What that root holds — the Settings page's list, and the preamble's. */
export function skillSummaries(): SkillSummary[] {
  return skillsInstance.skills;
}

/**
 * The text block in front of the first prompt of a session with an agent that
 * ignores additional directories (`skillRoots: "preamble"`).
 */
export function sessionPreamble(): string | null {
  return skillsInstance.root ? skillsPreamble(skillsInstance.root, skillsInstance.skills) : null;
}

export function rendererCommands(): RendererCommands {
  if (!commandsInstance) {
    throw new Error("app integrations are not initialised");
  }
  return commandsInstance;
}

export function plugins(): PluginService {
  if (!pluginsInstance) {
    throw new Error("plugins are not initialised");
  }
  return pluginsInstance;
}

/** The examples marketplace that ships inside the app: `resources/plugins`. */
export function builtinMarketplace(): string {
  return path.join(resourcesDir(), "plugins");
}

/** The plugins that carry elastic's own tools and skills (browser, documents, PDF, terminals): `resources/bundled`. */
export function bundledMarketplace(): string {
  return path.join(resourcesDir(), "bundled");
}

/**
 * The marketplaces a first run lists beside elastic's own: Claude Code's
 * official one, Codex's (`openai/plugins`, "Codex official"), and
 * text-to-cad's. Fetched in the background; a person can remove any of them.
 * Codex's `openai-primary-runtime` lives only inside Codex's runtime, so it is
 * not among them.
 */
const DEFAULT_MARKETPLACES = ["anthropics/claude-plugins-official", "openai/plugins", "earthtojake/text-to-cad"];

/** The integration every session gets whatever is on: opening, revealing and listing its tabs. */
const CORE_INTEGRATION = "workspace";

/** Each app integration a bundled plugin may name, with the tool names it serves. */
function appServerTools(): Record<string, string[]> {
  return Object.fromEntries(integrations.filter((integration) => integration.id !== CORE_INTEGRATION)
    .map((integration) => [integration.id, integration.tools.map((tool) => tool.name)]));
}

/** Remote servers' credentials sealed by the OS keychain; plain only where the platform has no keychain. */
function safeStorageCodec(): Codec {
  if (!safeStorage.isEncryptionAvailable()) return PLAIN_CODEC;
  return {
    seal: (text) => `v1:${safeStorage.encryptString(text).toString("base64")}`,
    open: (sealed) => sealed.startsWith("v1:") ? safeStorage.decryptString(Buffer.from(sealed.slice(3), "base64")) : sealed,
  };
}

export async function initIntegrations(deps: { sendCommand: (command: IntegrationCommand) => void; cancelCommand: (requestId: string) => void; pluginsChanged?: (snapshot: PluginsSnapshot) => void }): Promise<void> {
  const userData = app.getPath("userData");
  const host = new PluginHost({
    environment: () => loginEnv(),
    clientName: APP_NAME,
    clientVersion: appVersion(),
    pathPrefix: sessionRuntimePath,
    auth: { store: new AuthStore(path.join(userData, "plugins", "auth.json"), safeStorageCodec()), open: (url) => shell.openExternal(url.href) },
  });
  pluginsInstance = new PluginService({
    registry: new PluginRegistry(path.join(userData, "plugins", "installed.json")),
    host,
    builtinMarketplaces: () => [bundledMarketplace(), builtinMarketplace()],
    bundled: { marketplace: bundledMarketplace(), appServers: appServerTools() },
    dataDir: path.join(userData, "plugins"),
    defaultMarketplaces: DEFAULT_MARKETPLACES,
    changed: (snapshot) => {
      refreshSkills(userData);
      deps.pluginsChanged?.(snapshot);
    },
  });
  skillsInstance = materialiseSkills(userData);
  void pluginsInstance.listAll();
  // E2E runs get no network: their marketplaces are the ones a spec adds.
  if (process.env.WORKBENCH_NO_DEFAULT_MARKETPLACES !== "1") pluginsInstance.startBackground();
  commandsInstance = new RendererCommands({
    sessionRoot,
    send: deps.sendCommand,
    cancel: deps.cancelCommand,
    newId: () => randomUUID(),
  });

  const actionDeps = { sessionRoot, send: deps.sendCommand, cancel: deps.cancelCommand, newId: () => randomUUID() };
  const browsers = new BrowserConnections(actionDeps, commandsInstance, path.join(app.getPath("userData"), "browser-artifacts"));
  const actions = { ...createActions(actionDeps, commandsInstance),
    ...createTerminalActions(actionDeps, commandsInstance, explorerTerminals, sessionRuntimePath),
    browser_connection: (session: BridgeSession, _params: Record<string, unknown>, signal?: AbortSignal) => browsers.connect(session, signal) };
  bridgeInstance = new McpBridge(actions, mcpServerScript, browsers, pluginRpc(commandsInstance));
  await bridgeInstance.start();
}

/**
 * The skills root for this app version, rebuilt when the version (or the
 * composed set) has changed and left alone otherwise. A failure here is not
 * fatal: sessions then get no additional directory and no preamble, and the
 * reason goes to the application log.
 */
function materialiseSkills(userData: string): SkillsRoot {
  // A leftover from the version of this app that installed a plugin into each
  // agent's global configuration. There is no such thing now (README, "Skills
  // and tools in a session"), so the record it kept is deleted on sight.
  fs.rmSync(path.join(userData, "plugin-installs.json"), { force: true });
  try {
    const sources = skillSources();
    skillSourcesKey = JSON.stringify(sources);
    const composed = materialiseSkillsRoot({
      source: composeSkillSources(path.join(userData, "skills-source"), sources),
      base: path.join(userData, "skills"),
      version: appVersion(),
    });
    if (!composed.root) {
      console.info("[skills] no skills: none composed into resources/skills (run npm run build) and no enabled plugin has any");
    }
    return composed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[skills] could not materialise the skills root: ${message}`);
    return EMPTY_SKILLS;
  }
}

/** Each enabled plugin's skills, the bundled ones (elastic's own) included. */
function skillSources(): Array<{ owner: string; dir: string; names: string[] }> {
  const sources: Array<{ owner: string; dir: string; names: string[] }> = [];
  for (const plugin of pluginsInstance?.plugins() ?? []) {
    if (!plugin.enabled || plugin.error || plugin.skills.length === 0) continue;
    try {
      const read = readPlugin(plugin.root);
      if (read.skillsDir) sources.push({ owner: plugin.bundled ? APP_NAME : `the ${plugin.displayName} plugin`, dir: read.skillsDir, names: read.skills });
    } catch { /* listed with its error; it has no skills to give */ }
  }
  return sources;
}

/** Rebuild the skills root when the enabled plugins' skills changed; later sessions get them. */
function refreshSkills(userData: string): void {
  if (JSON.stringify(skillSources()) !== skillSourcesKey) skillsInstance = materialiseSkills(userData);
}

/**
 * `plugin_rpc`: an agent's MCP request to a plugin server, through its proxy.
 * A tool with a UI that an agent calls opens (or updates) that tool's tab in
 * the session's explorer with the call's input and result, the way an MCP
 * Apps host shows a tool result in its view.
 */
function pluginRpc(commands: RendererCommands): PluginRpcHandler {
  return async (session, target, request, signal) => {
    const service = plugins();
    if (!service.hasServer(target.pluginId, target.server)) {
      throw new Error(`the plugin "${target.pluginId}" is not enabled, or has no server "${target.server}"`);
    }
    if (!(request.method in FORWARDED_METHODS)) throw new Error(`${request.method} is not forwarded to plugin servers`);
    const method = request.method as ForwardedMethod;
    const result = await service.agentRequest(session.sessionId, session.cwd, target.pluginId, target.server, method, request.params, signal);
    if (method === "tools/call") {
      const name = String(request.params.name ?? "");
      const listed = service.listedTool(target.pluginId, target.server, name);
      const ui = listed ? readToolUi(target.server, listed) : null;
      const failed = (result as { isError?: boolean } | null)?.isError === true;
      if (ui && !failed && ui.entrypoints.some((entry) => entry.type === "thread")) {
        void showToolResult(commands, session, target.pluginId, pluginToolId(target.server, name), request.params.arguments, result)
          .catch((error) => console.warn(`[plugins] could not show ${name}'s result:`, error instanceof Error ? error.message : error));
      }
    }
    return result;
  };
}

async function showToolResult(commands: RendererCommands, session: BridgeSession, pluginId: string, toolId: string, input: unknown, result: unknown): Promise<void> {
  const workspace = sessionRoot(session);
  if (!workspace) return;
  await commands.request({ kind: "open-tool", sessionId: session.sessionId, projectId: session.projectId, root: workspace.root,
    ...(await workspaceDirectory(workspace.directory)),
    params: { pluginId, toolId, call: { arguments: input ?? {}, result } } });
}

/** Resolve only the session's recorded workspace; a missing worktree never grants checkout access. */
function sessionRoot(session: BridgeSession): { directory: string; root: string | null } | null {
  const owner = sessions.get(session.sessionId);
  if (!owner || owner.archived || owner.projectId !== session.projectId || owner.cwd !== session.cwd) return null;
  const project = projects.get(session.projectId);
  const cwd = path.resolve(owner.cwd);
  if (!project || !fs.existsSync(cwd)) return null;
  return { directory: cwd, root: git.samePath(cwd, project.path) ? null : cwd };
}

/**
 * The MCP servers every session gets: the app's workspace server, the app's
 * own servers the enabled bundled plugins carry (`app-<integration>`, each
 * under its own per-session token), then a proxy for each enabled plugin
 * server, named by the server (or `<plugin>-<server>` when two plugins use one
 * name). A bundled plugin turned off takes its server, and so its token, out
 * of later sessions.
 */
export function mcpServersFor(session: Pick<Session, "id" | "projectId" | "cwd">): McpServer[] {
  if (!bridgeInstance?.address()) {
    return [];
  }
  const bridgeSession = { sessionId: session.id, projectId: session.projectId, cwd: session.cwd };
  const servers = [bridgeInstance.serverFor(bridgeSession, CORE_INTEGRATION)];
  for (const app of pluginsInstance?.appServers() ?? []) servers.push(bridgeInstance.serverFor(bridgeSession, app.integration, app.name));
  const hosted = pluginsInstance?.hostedServers() ?? [];
  const taken = new Set(servers.map((server) => server.name));
  const counts = new Map<string, number>();
  for (const server of hosted) counts.set(server.name, (counts.get(server.name) ?? 0) + 1);
  for (const server of hosted) {
    const name = (counts.get(server.name) ?? 0) > 1 || taken.has(server.name) ? `${server.pluginId}-${server.name}` : server.name;
    taken.add(name);
    servers.push(bridgeInstance.serverFor(bridgeSession, `${PLUGIN_INTEGRATION_PREFIX}${server.pluginId}/${server.name}`, name));
  }
  return servers;
}

export function forgetSession(sessionId: string): void {
  bridgeInstance?.revoke(sessionId);
  void pluginsInstance?.closeScope(sessionId);
}
export async function shutdownIntegrations(): Promise<void> {
  commandsInstance?.dispose();
  try { await bridgeInstance?.stop(); } finally { await pluginsInstance?.dispose(); }
}
