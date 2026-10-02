/**
 * Plugins, as the rest of main sees them: what is installed and on, what
 * each plugin's MCP servers offer, and the one way in to those servers.
 *
 * Three layers, each its own file: `registry.ts` keeps what the person chose
 * (installed, enabled, handlers, consent), `manifest.ts` reads a plugin folder,
 * `host.ts` runs the servers. This file joins them into the records Settings
 * and the sidebar draw (`PluginRecord`), answers the renderer's and the
 * agents' MCP requests, and says when anything changed. No Electron import,
 * so the unit and integration tests drive the real thing.
 *
 * Tool listing is in the background: `snapshot()` answers at once with what
 * is known, and each server's tools arrive with a `changed` call when it has
 * started (or failed to). A plugin with a slow `npx` server never holds up the
 * window.
 */
import path from "node:path";

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import {
  readToolUi,
  type Marketplace,
  type PluginRecord,
  type PluginServerState,
  type PluginSource,
  type PluginTool,
} from "../../shared/plugins";
import { APP_SCOPE, type ForwardedMethod, type HostedServer, type PluginHost } from "./host";
import { readMarketplace, readPlugin, type ReadPlugin } from "./manifest";
import type { PluginRegistry } from "./registry";

export type PluginsSnapshot = {
  plugins: PluginRecord[];
  marketplaces: Marketplace[];
  fileHandlers: Record<string, string>;
  fileConsent: Record<string, string[]>;
};

export type PluginServiceDeps = {
  registry: PluginRegistry;
  host: PluginHost;
  /** Marketplaces that ship with the app: always listed, never removable. */
  builtinMarketplaces?: () => string[];
  /**
   * The plugins that ship with the app and carry its own tools: their marketplace, whose
   * plugins are installed on start and kept pointing at the app's copy, and the tool names
   * of each app server (`builtin`) they may name. Turned off, never uninstalled.
   */
  bundled?: { marketplace: string; appServers: Readonly<Record<string, readonly string[]>> };
  /** Called after anything a snapshot shows has changed. */
  changed?: (snapshot: PluginsSnapshot) => void;
};

type Loaded = {
  id: string;
  source: PluginSource;
  enabled: boolean;
  read: ReadPlugin | null;
  error: string | null;
};

type ServerTools = { status: PluginServerState["status"]; error: string | null; tools: Tool[] };

/** One of the app's own servers a bundled plugin carries: `integration` is what the bridge serves. */
export type AppServer = { pluginId: string; name: string; integration: string };

/** A plugin's id: its manifest name, which is also its folder's identity in a marketplace. */
export function pluginIdFor(read: ReadPlugin): string {
  return read.manifest.name;
}

export class PluginService {
  private loaded: Loaded[] = [];
  /** `<pluginId>/<server>` → what it listed. */
  private readonly tools = new Map<string, ServerTools>();
  private listing = new Map<string, Promise<void>>();
  private generation = 0;

  constructor(private readonly deps: PluginServiceDeps) {
    this.installBundled();
    this.reload();
  }

  /** The bundled marketplace's folder, or null when the app ships none. */
  private bundledRoot(): string | null {
    if (!this.deps.bundled) return null;
    try { return readMarketplace(this.deps.bundled.marketplace).root; } catch { return null; }
  }

  private isBundled(root: string | undefined): boolean {
    const bundled = this.bundledRoot();
    if (!bundled || !root) return false;
    const back = path.relative(bundled, path.resolve(root));
    return back !== "" && !back.startsWith("..") && !path.isAbsolute(back);
  }

  /**
   * Every bundled plugin is installed, at the app's copy: a first run adds them (on), an
   * update or a move of the app repoints them and keeps whether the person turned one off.
   */
  private installBundled(): void {
    if (!this.deps.bundled) return;
    let market: ReturnType<typeof readMarketplace>;
    try { market = readMarketplace(this.deps.bundled.marketplace); } catch (error) {
      console.warn("[plugins] the bundled marketplace could not be read:", error instanceof Error ? error.message : error);
      return;
    }
    for (const entry of market.plugins) {
      const current = this.registry.get(entry.name);
      if (current?.source.kind === "marketplace" && current.source.marketplace === market.file && path.resolve(current.source.path) === path.resolve(entry.path)) continue;
      this.registry.install(entry.name, { kind: "marketplace", marketplace: market.file, name: entry.name, path: entry.path });
    }
  }

  private get registry(): PluginRegistry { return this.deps.registry; }
  private get host(): PluginHost { return this.deps.host; }

  private emit(): void {
    this.deps.changed?.(this.snapshot());
  }

  /** Re-read every installed plugin from disk and hand the host what it may run. */
  reload(): void {
    this.generation += 1;
    this.loaded = this.registry.list().map((entry) => {
      try {
        return { id: entry.id, source: entry.source, enabled: entry.enabled, read: readPlugin(entry.source.path), error: null };
      } catch (error) {
        return { id: entry.id, source: entry.source, enabled: entry.enabled, read: null, error: error instanceof Error ? error.message : String(error) };
      }
    });
    this.host.setServers(this.hostedServers());
    // Listings of servers that are gone, off, or changed are forgotten.
    const live = new Set(this.hostedServers().map((server) => `${server.pluginId}/${server.name}`));
    for (const key of [...this.tools.keys()]) if (!live.has(key)) this.tools.delete(key);
    this.listing = new Map();
  }

  /** Every server the host starts: of every enabled, readable plugin, but the app's own. */
  hostedServers(): HostedServer[] {
    return this.loaded.flatMap((plugin) => plugin.enabled && plugin.read
      ? Object.entries(plugin.read.servers).filter(([, config]) => !config.builtin).map(([name, config]) => ({ pluginId: plugin.id, root: plugin.read!.root, name, config }))
      : []);
  }

  /** The app's own servers the enabled bundled plugins carry; a session gets each (`mcpServersFor`). */
  appServers(): AppServer[] {
    return this.loaded.flatMap((plugin) => plugin.enabled && plugin.read
      ? Object.entries(plugin.read.servers).flatMap(([name, config]) => config.builtin && this.appServerError(plugin, config.builtin) === null
        ? [{ pluginId: plugin.id, name, integration: config.builtin }] : [])
      : []);
  }

  /** Why a plugin may not have this app server, or null when it may. */
  private appServerError(plugin: Loaded, integration: string): string | null {
    if (!this.isBundled(plugin.read?.root)) return "only the plugins that ship with elastic can use its own tools";
    if (!this.deps.bundled?.appServers[integration]) return `elastic has no tools called "${integration}"`;
    return null;
  }

  /** Start listing every enabled server's tools, once per reload. Resolves when all have answered or failed. */
  listAll(): Promise<void> {
    return Promise.all(this.hostedServers().map((server) => this.listServer(server.pluginId, server.name))).then(() => {});
  }

  private listServer(pluginId: string, server: string): Promise<void> {
    const key = `${pluginId}/${server}`;
    const existing = this.listing.get(key);
    if (existing) return existing;
    const generation = this.generation;
    this.tools.set(key, { status: "starting", error: null, tools: [] });
    const run = this.host.listTools(pluginId, server).then(
      (tools) => ({ status: "ready" as const, error: null, tools }),
      async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && error.name === "SignInRequired") return { status: "signin" as const, error: null, tools: [] };
        return { status: "failed" as const, error: message, tools: [] };
      },
    ).then((result) => {
      if (generation !== this.generation) return;
      this.tools.set(key, result);
      this.emit();
    });
    this.listing.set(key, run);
    return run;
  }

  private record(plugin: Loaded): PluginRecord {
    const read = plugin.read;
    const manifest = read?.manifest;
    const author = manifest?.author;
    const servers: PluginServerState[] = read ? Object.entries(read.servers).map(([name, config]) => {
      if (config.builtin) {
        const error = this.appServerError(plugin, config.builtin);
        return {
          name,
          transport: "app" as const,
          status: error ? "failed" as const : plugin.enabled ? "ready" as const : "idle" as const,
          error,
          toolNames: error ? [] : [...(this.deps.bundled?.appServers[config.builtin] ?? [])],
          signedIn: false,
        };
      }
      const listed = this.tools.get(`${plugin.id}/${name}`);
      return {
        name,
        transport: config.url ? "http" : "stdio",
        status: plugin.enabled ? listed?.status ?? "idle" : "idle",
        error: listed?.error ?? null,
        toolNames: listed?.tools.map((tool) => tool.name) ?? [],
        signedIn: config.url ? this.host.signedIn(plugin.id, name) : false,
      };
    }) : [];
    const tools: PluginTool[] = read && plugin.enabled ? Object.keys(read.servers).flatMap((name) =>
      (this.tools.get(`${plugin.id}/${name}`)?.tools ?? []).flatMap((tool) => {
        const ui = readToolUi(name, tool);
        return ui ? [ui] : [];
      })) : [];
    return {
      id: plugin.id,
      name: manifest?.name ?? plugin.id,
      displayName: manifest?.interface?.displayName ?? manifest?.name ?? plugin.id,
      version: manifest?.version ?? null,
      description: manifest?.interface?.shortDescription ?? manifest?.description ?? "",
      developer: manifest?.interface?.developerName ?? (typeof author === "string" ? author : author?.name ?? null),
      logo: read?.logo ?? null,
      brandColor: manifest?.interface?.brandColor ?? null,
      source: plugin.source,
      root: read?.root ?? plugin.source.path,
      enabled: plugin.enabled,
      error: plugin.error,
      servers,
      skills: read?.skills ?? [],
      tools,
      defaultPrompts: manifest?.interface?.defaultPrompt ?? [],
      bundled: this.isBundled(read?.root ?? plugin.source.path),
    };
  }

  plugins(): PluginRecord[] {
    return this.loaded.map((plugin) => this.record(plugin));
  }

  plugin(id: string): PluginRecord | null {
    const found = this.loaded.find((plugin) => plugin.id === id);
    return found ? this.record(found) : null;
  }

  marketplaces(): Marketplace[] {
    const installed = new Set(this.loaded.map((plugin) => plugin.source.path));
    const files = [...new Set([...(this.deps.builtinMarketplaces?.() ?? []), ...this.registry.marketplaces()])];
    return files.flatMap((file) => {
      try {
        const market = readMarketplace(file);
        return [{
          file: market.file,
          name: market.name,
          displayName: market.displayName,
          plugins: market.plugins.map((entry) => ({ ...entry, displayName: entry.name, installed: installed.has(entry.path) })),
        }];
      } catch (error) {
        console.warn(`[plugins] marketplace ${file} could not be read:`, error instanceof Error ? error.message : error);
        return [];
      }
    });
  }

  snapshot(): PluginsSnapshot {
    return {
      plugins: this.plugins(),
      marketplaces: this.marketplaces(),
      fileHandlers: this.registry.fileHandlers(),
      fileConsent: this.registry.fileConsent(),
    };
  }

  /** Re-read everything and list tools again: Refresh, and after any change. */
  async refresh(): Promise<PluginsSnapshot> {
    this.reload();
    this.emit();
    void this.listAll();
    return this.snapshot();
  }

  /** Install a plugin folder, used in place. Throws with a sentence when it is not one. */
  async installFolder(folder: string): Promise<PluginRecord> {
    const read = readPlugin(folder);
    return this.installRead(read, { kind: "local", path: read.root });
  }

  async installFromMarketplace(file: string, name: string): Promise<PluginRecord> {
    const market = readMarketplace(file);
    const entry = market.plugins.find((plugin) => plugin.name === name);
    if (!entry) throw new Error(`${market.displayName} has no plugin named "${name}"`);
    const read = readPlugin(entry.path);
    return this.installRead(read, { kind: "marketplace", marketplace: market.file, name, path: read.root });
  }

  private async installRead(read: ReadPlugin, source: PluginSource): Promise<PluginRecord> {
    const id = pluginIdFor(read);
    const clash = this.registry.get(id);
    if (clash && path.resolve(clash.source.path) !== path.resolve(read.root)) {
      throw new Error(`a different plugin named "${id}" is already installed from ${clash.source.path}; uninstall it first`);
    }
    await this.host.closePlugin(id);
    this.registry.install(id, source);
    this.reload();
    this.emit();
    await this.listAll();
    return this.plugin(id)!;
  }

  /** Sign in to a plugin's remote server (the system browser), then list its tools again. */
  async signIn(id: string, server: string): Promise<PluginRecord> {
    await this.host.signIn(id, server);
    return this.relist(id, server);
  }

  async signOut(id: string, server: string): Promise<PluginRecord> {
    await this.host.signOut(id, server);
    return this.relist(id, server);
  }

  private async relist(id: string, server: string): Promise<PluginRecord> {
    this.listing.delete(`${id}/${server}`);
    await this.listServer(id, server);
    this.emit();
    return this.plugin(id)!;
  }

  async uninstall(id: string): Promise<void> {
    const found = this.loaded.find((plugin) => plugin.id === id);
    if (found && this.isBundled(found.read?.root ?? found.source.path)) throw new Error(`${id} ships with elastic: turn it off instead`);
    await this.host.closePlugin(id);
    this.registry.uninstall(id);
    this.reload();
    this.emit();
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginRecord> {
    if (!enabled) await this.host.closePlugin(id);
    this.registry.setEnabled(id, enabled);
    this.reload();
    this.emit();
    if (enabled) await this.listAll();
    return this.plugin(id)!;
  }

  addMarketplace(input: string): Marketplace {
    const market = readMarketplace(input);
    this.registry.addMarketplace(market.file);
    this.emit();
    return this.marketplaces().find((entry) => entry.file === market.file)!;
  }

  removeMarketplace(file: string): void {
    this.registry.removeMarketplace(file);
    this.emit();
  }

  setFileHandler(extension: string, handler: string | null): void {
    this.registry.setFileHandler(extension, handler);
    this.emit();
  }

  allowFiles(projectPath: string, pluginId: string): void {
    this.registry.allowFiles(projectPath, pluginId);
    this.emit();
  }

  filesAllowed(projectPath: string, pluginId: string): boolean {
    return this.registry.fileConsent()[projectPath]?.includes(pluginId) ?? false;
  }

  /** The enabled plugin's tool with a UI, by `<server>/<tool>` id, or null. */
  uiTool(pluginId: string, toolId: string): PluginTool | null {
    return this.plugin(pluginId)?.tools.find((tool) => tool.id === toolId) ?? null;
  }

  /** Whether an enabled plugin has this server. */
  hasServer(pluginId: string, server: string): boolean {
    return this.host.has(pluginId, server);
  }

  /**
   * One MCP request for a scope: a session's id (its own processes) or null
   * for the app. A list the server has no capability for answers empty
   * instead of failing, so a proxy can always forward all of them.
   */
  async request(scope: string | null, pluginId: string, server: string, method: ForwardedMethod, params: Record<string, unknown> = {}, options: { roots?: string[]; signal?: AbortSignal } = {}): Promise<unknown> {
    const client = await this.host.client(scope ?? APP_SCOPE, pluginId, server, options.roots);
    const capabilities = client.getServerCapabilities() ?? {};
    const empty: Partial<Record<ForwardedMethod, unknown>> = {
      "tools/list": { tools: [] },
      "resources/list": { resources: [] },
      "resources/templates/list": { resourceTemplates: [] },
      "prompts/list": { prompts: [] },
    };
    const family = method.split("/")[0] as "tools" | "resources" | "prompts";
    if (!capabilities[family] && method in empty) return empty[method];
    return this.host.request(scope ?? APP_SCOPE, pluginId, server, method, params, options);
  }

  /**
   * A request from an agent's proxy. The model never sees a tool its server
   * marked for the app alone (`ui.visibility: ["app"]`), and cannot call one.
   */
  async agentRequest(sessionId: string, cwd: string, pluginId: string, server: string, method: ForwardedMethod, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const options = { roots: [cwd], signal };
    if (method === "tools/list") {
      const result = await this.request(sessionId, pluginId, server, method, params, options) as { tools: Tool[]; nextCursor?: string };
      return { ...result, tools: result.tools.filter((tool) => !appOnly(tool)) };
    }
    if (method === "tools/call") {
      const name = String(params.name ?? "");
      const listed = this.tools.get(`${pluginId}/${server}`)?.tools.find((tool) => tool.name === name);
      if (listed && appOnly(listed)) throw new Error(`${name} is for the plugin's own UI, not for agents`);
    }
    return this.request(sessionId, pluginId, server, method, params, options);
  }

  /** The listed tool, from the last listing, or null. */
  listedTool(pluginId: string, server: string, name: string): Tool | null {
    return this.tools.get(`${pluginId}/${server}`)?.tools.find((tool) => tool.name === name) ?? null;
  }

  closeScope(scope: string): Promise<void> {
    return this.host.closeScope(scope);
  }

  dispose(): Promise<void> {
    return this.host.dispose();
  }
}

/** MCP Apps: a tool whose visibility is the app alone is hidden from the model. */
export function appOnly(tool: Pick<Tool, "_meta">): boolean {
  const ui = (tool._meta as { ui?: { visibility?: unknown } } | undefined)?.ui;
  return Array.isArray(ui?.visibility) && ui.visibility.length > 0 && ui.visibility.every((entry) => entry === "app");
}
