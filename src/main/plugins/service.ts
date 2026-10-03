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
import fs from "node:fs";
import path from "node:path";

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import {
  readToolUi,
  type CatalogEntry,
  type Marketplace,
  type PluginRecord,
  type PluginServerState,
  type PluginSource,
  type PluginTool,
} from "../../shared/plugins";
import { APP_SCOPE, type ForwardedMethod, type HostedServer, type PluginHost } from "./host";
import { buildCatalog, type CatalogMarket } from "./catalog";
import { copyPluginFolder, fetchLatest, keyOf, parseGitRemote, shallowClone } from "./git";
import { insidePlugin, readMarketplace, readPlugin, type MarketplaceEntryFile, type MarketplaceFile, type ReadPlugin } from "./manifest";
import type { PluginRegistry, RemoteMarketplace } from "./registry";

export type PluginsSnapshot = {
  plugins: PluginRecord[];
  marketplaces: Marketplace[];
  catalog: CatalogEntry[];
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
  /**
   * `<userData>/plugins`: git marketplaces are cloned under `marketplaces/`, and plugins from
   * them (or from other repositories) copied under `cache/`, one folder per commit.
   */
  dataDir?: string;
  /** Repositories added as marketplaces on the first run (`owner/repo` or git URLs). */
  defaultMarketplaces?: readonly string[];
  /** A git marketplace older than this is fetched again in the background. */
  staleAfterMs?: number;
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
  /** Clone folder → its fetch in flight. */
  private readonly fetching = new Map<string, Promise<void>>();
  private catalogCache: { signature: string; catalog: CatalogEntry[] } | null = null;

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
      if (!entry.path) continue;
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
      ? Object.entries(plugin.read.servers).filter(([, config]) => !config.builtin).map(([name, config]) => ({
        pluginId: plugin.id, root: plugin.read!.root, name, config,
        // A Claude Code manifest (or none: a marketplace entry's inline one) starts its servers in the project.
        workingDir: plugin.read!.manifestFile === "" || plugin.read!.manifestFile.includes(`${path.sep}.claude-plugin${path.sep}`) ? "project" as const : "plugin" as const,
      }))
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
      updateAvailable: this.updateAvailable(plugin),
    };
  }

  /**
   * Whether the plugin's marketplace now offers something newer: another commit
   * for a remote entry, a different version (or different files, when neither
   * names one) for a folder in a git marketplace. Folder marketplaces are used
   * in place and are always current.
   */
  private updateAvailable(plugin: Loaded): boolean {
    const source = plugin.source;
    if (source.kind !== "marketplace" || !source.commit) return false;
    const remote = this.registry.remoteMarketplaces().find((item) => isInside(item.dir, source.marketplace) || item.dir === source.marketplace);
    let entry: MarketplaceEntryFile | undefined;
    try { entry = readMarketplace(source.marketplace).plugins.find((item) => item.name === source.name); } catch { return false; }
    if (!entry) return false;
    if (entry.remote) return entry.remote.sha !== null && entry.remote.sha !== source.commit;
    if (!remote?.commit || remote.commit === source.commit || !entry.path) return false;
    try {
      const latest = readPlugin(entry.path, entry.inline);
      const installed = plugin.read?.manifest.version ?? null;
      if (latest.manifest.version && installed) return latest.manifest.version !== installed;
      return fingerprint(entry.path) !== fingerprint(source.path);
    } catch { return false; }
  }

  plugins(): PluginRecord[] {
    return this.loaded.map((plugin) => this.record(plugin));
  }

  plugin(id: string): PluginRecord | null {
    const found = this.loaded.find((plugin) => plugin.id === id);
    return found ? this.record(found) : null;
  }

  /** Every marketplace this app lists, read: the bundled one, the examples, folders, then git clones. */
  private markets(): Array<{ market: MarketplaceFile | null; kind: Marketplace["kind"]; remote: RemoteMarketplace | null; file: string }> {
    const bundled = this.deps.bundled?.marketplace ?? null;
    const builtins = [...new Set(this.deps.builtinMarketplaces?.() ?? [])];
    const read = (file: string) => {
      try { return readMarketplace(file); } catch (error) {
        console.warn(`[plugins] marketplace ${file} could not be read:`, error instanceof Error ? error.message : error);
        return null;
      }
    };
    const local = [...builtins, ...this.registry.marketplaces().filter((file) => !builtins.includes(file))].map((file) => ({
      market: read(file),
      kind: (bundled && path.resolve(file) === path.resolve(bundled) ? "bundled" : builtins.includes(file) ? "builtin" : "local") as Marketplace["kind"],
      remote: null,
      file,
    }));
    const remotes = this.registry.remoteMarketplaces().map((remote) => ({
      market: remote.commit && fs.existsSync(remote.dir) ? (() => { try { return readMarketplace(remote.dir); } catch { return null; } })() : null,
      kind: "git" as const,
      remote,
      file: remote.dir,
    }));
    return [...local.filter((item) => item.market !== null), ...remotes];
  }

  marketplaces(): Marketplace[] {
    const installed = new Set(this.loaded.flatMap((plugin) => plugin.source.kind === "marketplace" ? [`${plugin.source.marketplace}#${plugin.source.name}`] : [plugin.source.path]));
    return this.markets().map(({ market, kind, remote, file }) => {
      const failed = remote?.error && !this.fetching.has(remote.dir);
      const status: Marketplace["status"] = remote && this.fetching.has(remote.dir) ? "fetching" : failed ? "failed" : "ready";
      return {
        file: market?.file ?? file,
        name: market?.name ?? (remote ? parseGitRemote(remote.url).slug : path.basename(file)),
        displayName: market?.displayName ?? (remote ? keyOf(remote.url).replace(/^https:\/\/(github\.com\/)?/, "") : path.basename(file)),
        kind,
        url: remote?.url ?? null,
        commit: remote?.commit ?? null,
        fetchedAt: remote?.fetchedAt ?? null,
        status,
        error: remote?.error ?? null,
        plugins: (market?.plugins ?? []).map((entry) => ({
          name: entry.name,
          displayName: entry.name,
          description: entry.description,
          category: entry.category,
          path: entry.path,
          installed: installed.has(`${market!.file}#${entry.name}`) || (entry.path !== null && installed.has(entry.path)),
        })),
      };
    });
  }

  /** The merged list, rebuilt only when a marketplace or what is installed changed. */
  catalog(): CatalogEntry[] {
    const markets = this.markets().filter((item) => item.market !== null);
    const bySource = new Map<string, string>();
    for (const plugin of this.loaded) {
      if (plugin.source.kind === "marketplace") bySource.set(`${plugin.source.marketplace}#${plugin.source.name}`, plugin.id);
    }
    const signature = JSON.stringify([
      markets.map((item) => [item.market!.file, item.remote?.commit ?? null, fs.statSync(item.market!.file, { throwIfNoEntry: false })?.mtimeMs ?? 0]),
      [...bySource.entries()], this.loaded.map((plugin) => plugin.id),
    ]);
    if (this.catalogCache?.signature === signature) return this.catalogCache.catalog;
    const catalog = buildCatalog(
      markets.map((item): CatalogMarket => ({ ...item.market!, kind: item.kind, url: item.remote?.url ?? null })),
      { bySource, ids: new Set(this.loaded.map((plugin) => plugin.id)) },
    );
    this.catalogCache = { signature, catalog };
    return catalog;
  }

  snapshot(): PluginsSnapshot {
    return {
      plugins: this.plugins(),
      marketplaces: this.marketplaces(),
      catalog: this.catalog(),
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

  /**
   * Install one entry of a marketplace. From a folder marketplace it is used in
   * place; from a git marketplace its folder is copied into the plugin cache at
   * the marketplace's commit; from another repository (`url`, `github`,
   * `git-subdir`) that repository is cloned into the cache at the entry's
   * commit. An entry with no manifest of its own (`"strict": false`) gets the
   * entry as its manifest, written into the cached copy.
   */
  async installFromMarketplace(file: string, name: string): Promise<PluginRecord> {
    const found = this.markets().find((item) => item.market && (item.market.file === file || item.file === file));
    const market = found?.market ?? readMarketplace(file);
    const entry = market.plugins.find((plugin) => plugin.name === name);
    if (!entry) throw new Error(`${market.displayName} has no plugin named "${name}"`);
    if (entry.unsupported) throw new Error(entry.unsupported);
    const remote = found?.remote ?? null;
    let root: string;
    let commit: string | null = null;
    if (entry.remote) {
      const target = this.cacheFolder(market, entry, entry.remote.sha ?? "latest");
      commit = await shallowClone(entry.remote.url, target, { ref: entry.remote.ref, sha: entry.remote.sha });
      root = entry.remote.subdir ? insidePlugin(target, entry.remote.subdir) : target;
    } else if (remote && entry.path) {
      commit = remote.commit;
      root = this.cacheFolder(market, entry, commit ?? "latest");
      copyPluginFolder(entry.path, root);
    } else {
      root = entry.path!;
    }
    if (entry.inline && root !== entry.path) {
      const manifest = path.join(root, ".claude-plugin", "plugin.json");
      if (!fs.existsSync(manifest) && !fs.existsSync(path.join(root, ".codex-plugin", "plugin.json"))) {
        fs.mkdirSync(path.dirname(manifest), { recursive: true });
        fs.writeFileSync(manifest, `${JSON.stringify({ name: entry.name, description: entry.description, ...entry.inline }, null, 2)}\n`);
      }
    }
    const read = readPlugin(root, entry.inline ? { name: entry.name, description: entry.description, ...entry.inline } : null);
    return this.installRead(read, { kind: "marketplace", marketplace: market.file, name, path: read.root, commit });
  }

  /** `<dataDir>/cache/<marketplace>/<plugin>/<commit>`: one folder per installed commit. */
  private cacheFolder(market: MarketplaceFile, entry: MarketplaceEntryFile, commit: string): string {
    if (!this.deps.dataDir) throw new Error("this app keeps no plugin cache; install the plugin from a folder");
    const clean = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "plugin";
    return path.join(this.deps.dataDir, "cache", clean(market.name), clean(entry.name), clean(commit.slice(0, 12)));
  }

  /** Install a plugin again from its marketplace as it is now. */
  async update(id: string): Promise<PluginRecord> {
    const current = this.registry.get(id);
    if (!current || current.source.kind !== "marketplace") throw new Error(`${id} was not installed from a marketplace`);
    const previous = current.source.path;
    const record = await this.installFromMarketplace(current.source.marketplace, current.source.name);
    if (this.deps.dataDir && path.resolve(previous) !== path.resolve(record.root) && isInside(path.join(this.deps.dataDir, "cache"), previous)) {
      fs.rmSync(previous, { recursive: true, force: true });
    }
    return record;
  }

  private async installRead(read: ReadPlugin, source: PluginSource): Promise<PluginRecord> {
    const id = pluginIdFor(read);
    const clash = this.registry.get(id);
    const sameEntry = clash?.source.kind === "marketplace" && source.kind === "marketplace"
      && clash.source.marketplace === source.marketplace && clash.source.name === source.name;
    if (clash && !sameEntry && path.resolve(clash.source.path) !== path.resolve(read.root)) {
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

  /**
   * Add a marketplace: a folder (or its marketplace.json) on disk, or a git
   * repository (`owner/repo`, a URL), cloned in the background. Answers at once.
   */
  addMarketplace(input: string): Marketplace {
    if (fs.existsSync(input)) {
      const market = readMarketplace(input);
      this.registry.addMarketplace(market.file);
      this.emit();
      return this.marketplaces().find((entry) => entry.file === market.file)!;
    }
    const remote = this.addRemote(input);
    this.emit();
    void this.fetchRemote(remote.dir);
    return this.marketplaces().find((entry) => entry.file === remote.dir)!;
  }

  private addRemote(input: string): RemoteMarketplace {
    if (!this.deps.dataDir) throw new Error("this app cannot fetch marketplaces; add a folder instead");
    const [repository, ref] = input.trim().split("#");
    const parsed = parseGitRemote(repository!);
    const existing = this.registry.remoteMarketplaces().find((item) => keyOf(item.url) === parsed.key);
    if (existing) return existing;
    const entry: RemoteMarketplace = { url: parsed.url, ref: ref || null, dir: path.join(this.deps.dataDir, "marketplaces", parsed.slug), commit: null, fetchedAt: null, error: null };
    this.registry.putRemoteMarketplace(entry);
    return entry;
  }

  removeMarketplace(file: string): void {
    const remote = this.registry.remoteMarketplaces().find((item) => item.dir === file || isInside(item.dir, file));
    if (remote) {
      this.registry.removeRemoteMarketplace(remote.dir);
      fs.rmSync(remote.dir, { recursive: true, force: true });
    } else {
      this.registry.removeMarketplace(file);
    }
    this.emit();
  }

  /**
   * First run: add the default marketplaces once (a person who removes one keeps
   * it removed). Then fetch, in the background, every git marketplace never
   * fetched or older than `staleAfterMs`. Never waits on the network.
   */
  startBackground(now = Date.now()): void {
    if (!this.registry.defaultsAdded()) {
      for (const source of this.deps.defaultMarketplaces ?? []) {
        try { this.addRemote(source); } catch (error) { console.warn(`[plugins] default marketplace ${source}:`, error instanceof Error ? error.message : error); }
      }
      this.registry.markDefaultsAdded();
      this.emit();
    }
    const stale = this.deps.staleAfterMs ?? 6 * 60 * 60 * 1000;
    for (const remote of this.registry.remoteMarketplaces()) {
      if (!remote.commit || !fs.existsSync(remote.dir) || (remote.fetchedAt ?? 0) < now - stale) void this.fetchRemote(remote.dir);
    }
  }

  /** Fetch every git marketplace again; answers at once, each lands with a change. */
  refreshMarketplaces(): PluginsSnapshot {
    for (const remote of this.registry.remoteMarketplaces()) void this.fetchRemote(remote.dir);
    return this.snapshot();
  }

  /** Clone, or move to the latest commit; one fetch per marketplace at a time. Resolves when done, never rejects. */
  fetchRemote(dir: string): Promise<void> {
    const inFlight = this.fetching.get(dir);
    if (inFlight) return inFlight;
    const run = (async () => {
      const remote = this.registry.remoteMarketplaces().find((item) => item.dir === dir);
      if (!remote) return;
      this.emit();
      try {
        const commit = fs.existsSync(path.join(dir, ".git"))
          ? await fetchLatest(dir, remote.ref)
          : await shallowClone(remote.url, dir, { ref: remote.ref });
        readMarketplace(dir);
        this.registry.putRemoteMarketplace({ ...remote, commit, fetchedAt: Date.now(), error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[plugins] fetching ${remote.url}: ${message}`);
        this.registry.putRemoteMarketplace({ ...remote, error: message });
      }
    })().finally(() => {
      this.fetching.delete(dir);
      this.emit();
    });
    this.fetching.set(dir, run);
    return run;
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
function isInside(parent: string, child: string): boolean {
  const back = path.relative(path.resolve(parent), path.resolve(child));
  return back === "" || (!back.startsWith("..") && !path.isAbsolute(back));
}

/** A folder's files and sizes, for "did it change" when no version says. */
function fingerprint(dir: string): string {
  const parts: string[] = [];
  const walk = (folder: string, prefix: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", ".claude-plugin"].includes(entry.name)) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else parts.push(`${prefix}${entry.name}:${fs.statSync(full).size}`);
    }
  };
  try { walk(dir, ""); } catch { return ""; }
  return parts.join("|");
}

export function appOnly(tool: Pick<Tool, "_meta">): boolean {
  const ui = (tool._meta as { ui?: { visibility?: unknown } } | undefined)?.ui;
  return Array.isArray(ui?.visibility) && ui.visibility.length > 0 && ui.visibility.every((entry) => entry === "app");
}
