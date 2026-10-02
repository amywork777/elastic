import { ArrowRight, Blocks, ChevronLeft, FileType, FolderPlus, Link2, MoreHorizontal, Plus, RefreshCw, Search, Store, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Input } from "@renderer/components/ui/input";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { Spinner } from "@renderer/components/ui/spinner";
import { Switch } from "@renderer/components/ui/switch";
import { cn } from "@renderer/lib/utils";
import { PluginLogo } from "@renderer/plugins/PluginLogo";
import { claimedExtensions, handlersFor, usePlugins } from "@renderer/plugins/store";
import { newSessionKey, useComposer } from "@renderer/state/composer";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import { useUi, type Surface } from "@renderer/state/ui";
import type { MarketplaceEntry, PluginRecord } from "@shared/plugins";

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (IpcError: )?/, "") : String(error));

type View = Extract<Surface, { kind: "plugins" }>["view"];

function usePluginsView(): [View, (view: View) => void] {
  const surface = useUi((state) => state.surface);
  const setSurface = useUi((state) => state.setSurface);
  return [surface.kind === "plugins" ? surface.view : "browse", (view) => setSurface({ kind: "plugins", view })];
}

/** Add ▾: a plugin folder, or a marketplace. */
function AddMenu() {
  const [, show] = usePluginsView();
  const installFolder = async () => {
    try {
      const plugin = await window.workbench.plugins.installFolder({});
      if (plugin) { toast.success(`${plugin.displayName} installed`); show({ plugin: plugin.id }); }
    } catch (error) { toast.error(message(error)); }
  };
  const addMarketplace = async () => {
    try {
      const market = await window.workbench.plugins.addMarketplace({});
      if (market) { toast.success(`${market.displayName} added`); show("browse"); }
    } catch (error) { toast.error(message(error)); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-7 gap-1 text-xs" size="sm" variant="secondary"><Plus className="size-3.5" /> Add</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void installFolder()}><FolderPlus className="size-4" /> Install a plugin folder…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void addMarketplace()}><Store className="size-4" /> Add a marketplace…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The sidebar under the rail's Plugins: Browse, File types, and every installed plugin. */
function PluginsSidebar() {
  const [view, show] = usePluginsView();
  const plugins = usePlugins((state) => state.plugins);
  const ready = usePlugins((state) => state.ready);
  const row = (active: boolean) => cn(
    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
  return (
    <div className="flex h-full flex-col border-sidebar-border border-r bg-sidebar">
      <div className="app-drag h-[var(--titlebar-height)] shrink-0" data-sidebar-titlebar />
      <div className="px-3 pb-2 font-medium text-muted-foreground text-xs">Plugins</div>
      <div className="space-y-0.5 px-2">
        <button className={row(view === "browse")} onClick={() => show("browse")} type="button"><Blocks className="size-4" /> Browse</button>
        <button className={row(view === "file-types")} onClick={() => show("file-types")} type="button"><FileType className="size-4" /> File types</button>
      </div>
      <div className="mt-4 px-3 pb-1 font-medium text-muted-foreground text-xs">Installed</div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 px-2 pb-3">
          {!ready ? <div className="px-2 py-1 text-muted-foreground text-xs">Loading…</div> : null}
          {ready && plugins.length === 0 ? <div className="px-2 py-1 text-muted-foreground text-xs">Nothing installed yet.</div> : null}
          {plugins.map((plugin) => (
            <button className={row(typeof view === "object" && view.plugin === plugin.id)} key={plugin.id} onClick={() => show({ plugin: plugin.id })} type="button">
              <PluginLogo className={cn("size-4", !plugin.enabled && "opacity-50")} plugin={plugin} />
              <span className={cn("truncate", !plugin.enabled && "text-muted-foreground")}>{plugin.displayName}</span>
              {plugin.error || plugin.servers.some((server) => server.status === "failed") ? <span aria-label="Has a problem" className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive" />
                : plugin.servers.some((server) => server.status === "signin") ? <span aria-label="Needs sign-in" className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" /> : null}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 pb-6">
      <div className="min-w-0 flex-1">
        <h1 className="font-semibold text-xl">{title}</h1>
        {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function InstallButton({ marketplace, entry }: { marketplace: string; entry: MarketplaceEntry }) {
  const [busy, setBusy] = useState(false);
  const [, show] = usePluginsView();
  const install = async () => {
    setBusy(true);
    try {
      const plugin = await window.workbench.plugins.installFromMarketplace({ marketplace, name: entry.name });
      toast.success(`${plugin.displayName} plugin installed`, { action: { label: "Try now", onClick: () => show({ plugin: plugin.id }) } });
    } catch (error) {
      toast.error(message(error));
    } finally { setBusy(false); }
  };
  if (entry.installed) return <span className="text-muted-foreground text-xs">Installed</span>;
  return (
    <Button aria-label={`Install ${entry.name}`} className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void install()} size="sm" variant="secondary">
      {busy ? <><Spinner className="size-3.5" /> Installing</> : <><Plus className="size-3.5" /> Install</>}
    </Button>
  );
}

/** Browse: every marketplace's plugins, grouped by marketplace, searchable. */
function BrowsePage() {
  const marketplaces = usePlugins((state) => state.marketplaces);
  const installed = usePlugins((state) => state.plugins);
  const [query, setQuery] = useState("");
  const [, show] = usePluginsView();
  const [refreshing, setRefreshing] = useState(false);
  const needle = query.trim().toLowerCase();
  const matches = (entry: MarketplaceEntry) => !needle || `${entry.name} ${entry.description} ${entry.category ?? ""}`.toLowerCase().includes(needle);
  const refresh = async () => {
    setRefreshing(true);
    try { await window.workbench.plugins.refresh(); } catch (error) { toast.error(message(error)); } finally { setRefreshing(false); }
  };
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <PageHeader
        actions={<>
          <Button aria-label="Refresh" className="size-7" disabled={refreshing} onClick={() => void refresh()} size="icon" variant="ghost"><RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /></Button>
          <AddMenu />
        </>}
        description="Plugins give agents new tools (MCP servers) and skills, and can add their own views: a tab, a page on the rail, or how a file type opens."
        title="Plugins"
      />
      <div className="relative mb-6">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
        <Input aria-label="Search plugins" className="h-8 pl-8 text-sm" onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" value={query} />
      </div>
      {marketplaces.length === 0 ? <p className="text-muted-foreground text-sm">No marketplaces. Add one, or install a plugin folder, from Add.</p> : null}
      {marketplaces.map((market) => {
        const entries = market.plugins.filter(matches);
        if (entries.length === 0) return null;
        return (
          <section className="mb-8" key={market.file}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="font-medium text-sm">{market.displayName}</h2>
              <span className="truncate text-muted-foreground text-xs" title={market.file}>{market.plugins.length} plugin{market.plugins.length === 1 ? "" : "s"}</span>
            </div>
            <div className="divide-y divide-border rounded-lg border">
              {entries.map((entry) => {
                const record = installed.find((plugin) => plugin.root === entry.path) ?? null;
                return (
                  <div className="flex items-center gap-3 px-3 py-2.5" key={entry.name}>
                    {record ? <PluginLogo className="size-8" plugin={record} /> : <PluginLogo className="size-8" plugin={{ logo: null, brandColor: null, displayName: entry.name }} />}
                    <button className="min-w-0 flex-1 text-left" disabled={!record} onClick={() => record && show({ plugin: record.id })} type="button">
                      <div className="truncate font-medium text-sm">{record?.displayName ?? entry.name}</div>
                      <div className="truncate text-muted-foreground text-xs">{entry.description || record?.description || "No description"}</div>
                    </button>
                    <InstallButton entry={entry} marketplace={market.file} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A plugin's page, drawn from its manifest: logo, prompts to try, what it brings, its servers. */
function DetailPage({ plugin }: { plugin: PluginRecord }) {
  const [, show] = usePluginsView();
  const setSurface = useUi((state) => state.setSurface);
  // A prompt chip goes into the box of whatever the sessions surface shows: the
  // open session, or a new one in the selected project.
  const tryPrompt = (prompt: string) => {
    const session = useSessions.getState().activeId;
    const project = useProjects.getState().activeId;
    const key = session ?? (project ? newSessionKey(project) : null);
    if (key) {
      useComposer.getState().setDraft(key, prompt);
      useComposer.getState().requestFocus(key);
    } else {
      void navigator.clipboard.writeText(prompt);
      toast("Copied the prompt. Open a folder to start a session with it.");
    }
    setSurface({ kind: "home" });
  };
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); } catch (error) { toast.error(message(error)); } finally { setBusy(false); }
  };
  const apps = plugin.tools;
  const info: Array<[string, string | null]> = [
    ["Developer", plugin.developer],
    ["Version", plugin.version],
    ["Source", plugin.bundled ? "Ships with elastic" : plugin.source.kind === "marketplace" ? `${plugin.source.name} from a marketplace` : "Local folder"],
    ["Folder", plugin.root],
  ];
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <button className="mb-4 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground" onClick={() => show("browse")} type="button">
        <ChevronLeft className="size-3.5" /> Plugins
      </button>
      <div className="flex items-start gap-4 pb-6">
        <PluginLogo className="size-14 rounded-xl" plugin={plugin} />
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-xl">{plugin.displayName}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{plugin.description || "No description"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch aria-label={plugin.enabled ? "Turn off" : "Turn on"} checked={plugin.enabled} disabled={busy}
              onCheckedChange={(enabled) => void act(() => window.workbench.plugins.setEnabled({ id: plugin.id, enabled }))} />
            {plugin.enabled ? "On" : "Off"}
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="More" className="size-7" size="icon" variant="ghost"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(plugin.root)}><Link2 className="size-4" /> Copy folder path</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void act(() => window.workbench.plugins.refresh())}><RefreshCw className="size-4" /> Reload from disk</DropdownMenuItem>
              {plugin.bundled ? null : <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => void act(async () => {
                  await window.workbench.plugins.uninstall({ id: plugin.id });
                  toast.success(`${plugin.displayName} uninstalled`);
                  show("browse");
                })}><Trash2 className="size-4" /> Uninstall</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {plugin.error ? <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">{plugin.error}</div> : null}

      {plugin.defaultPrompts.length > 0 ? (
        <div className="mb-8 space-y-1.5 rounded-xl bg-gradient-to-br from-muted to-muted/30 p-4">
          {plugin.defaultPrompts.map((prompt) => (
            <button className="flex w-full items-center gap-2 rounded-md bg-background/70 px-3 py-2 text-left text-sm hover:bg-background" key={prompt}
              onClick={() => tryPrompt(prompt)} type="button">
              <PluginLogo className="size-4" plugin={plugin} /><span className="flex-1 truncate">{prompt}</span><ArrowRight className="size-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}

      <Section title={`Views ${apps.length}`}>
        {apps.length === 0 ? <Empty>{plugin.enabled ? "No views. Its tools are for agents only." : "Turn it on to see its views."}</Empty> : apps.map((tool) => (
          <Row key={tool.id} primary={tool.title} secondary={[
            tool.entrypoints.map((entry) => entry.type === "global" ? "rail page" : entry.type === "thread" ? "tab" : `opens .${entry.extensions.join(", .")}`).join(" · "),
            tool.description,
          ].filter(Boolean).join(" — ")}
          action={tool.entrypoints.some((entry) => entry.type === "global")
            ? <Button className="h-7 text-xs" onClick={() => setSurface({ kind: "app", pluginId: plugin.id, toolId: tool.id })} size="sm" variant="secondary">Open</Button> : null} />
        ))}
      </Section>

      <Section title={`Skills ${plugin.skills.length}`}>
        {plugin.skills.length === 0 ? <Empty>No skills.</Empty> : plugin.skills.map((skill) => <Row key={skill} primary={skill} secondary="Every new session gets it while the plugin is on." />)}
      </Section>

      <Section title={`MCP servers ${plugin.servers.length}`}>
        {plugin.servers.length === 0 ? <Empty>No servers.</Empty> : plugin.servers.map((server) => (
          <Row key={server.name} primary={server.name}
            secondary={server.status === "failed" ? server.error ?? "Failed to start"
              : server.status === "ready" ? `${server.toolNames.length} tool${server.toolNames.length === 1 ? "" : "s"}: ${server.toolNames.join(", ")}`
                : server.status === "signin" ? "Sign in to use its tools. The sign-in opens in your browser."
                  : server.status === "starting" ? "Starting…" : plugin.enabled ? "Not started" : "Off"}
            tone={server.status === "failed" ? "error" : undefined}
            action={server.status === "signin"
              ? <Button className="h-7 text-xs" disabled={busy} onClick={() => void act(async () => {
                toast("Finish signing in in your browser.");
                await window.workbench.plugins.signIn({ id: plugin.id, server: server.name });
                toast.success(`Signed in to ${server.name}`);
              })} size="sm">Sign in</Button>
              : server.signedIn
                ? <Button className="h-7 text-xs" disabled={busy} onClick={() => void act(() => window.workbench.plugins.signOut({ id: plugin.id, server: server.name }))} size="sm" variant="ghost">Sign out</Button>
                : null} />
        ))}
      </Section>

      <Section title="Information">
        <dl className="divide-y divide-border rounded-lg border text-sm">
          {info.map(([label, value]) => (
            <div className="flex gap-4 px-3 py-2" key={label}>
              <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all">{value ?? "Unavailable"}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-8"><h2 className="mb-2 font-medium text-sm">{title}</h2>{children}</section>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
function Row({ primary, secondary, action, tone }: { primary: string; secondary?: string; action?: React.ReactNode; tone?: "error" }) {
  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{primary}</div>
        {secondary ? <div className={cn("whitespace-pre-wrap break-words text-xs", tone === "error" ? "text-destructive" : "text-muted-foreground")}>{secondary}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** File types: every extension a plugin claims, with who opens it. */
function FileTypesPage() {
  const plugins = usePlugins((state) => state.plugins);
  const fileHandlers = usePlugins((state) => state.fileHandlers);
  const extensions = useMemo(() => claimedExtensions({ plugins }), [plugins]);
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <PageHeader description="Choose who opens each file type a plugin can show. Built-in is always there." title="File types" />
      {extensions.length === 0 ? <Empty>No plugin opens files yet.</Empty> : (
        <div className="divide-y divide-border rounded-lg border">
          {extensions.map((extension) => {
            const handlers = handlersFor(extension, { plugins });
            const chosen = fileHandlers[extension];
            const value = chosen === "builtin" || handlers.some((entry) => entry.handler === chosen) ? chosen! : handlers[0]?.handler ?? "builtin";
            return (
              <div className="flex items-center gap-3 px-3 py-2" key={extension}>
                <span className="w-20 text-sm">.{extension}</span>
                <select aria-label={`Open .${extension} with`} className="ml-auto h-7 rounded-md border bg-background px-2 text-sm"
                  onChange={(event) => void window.workbench.plugins.setFileHandler({ extension, handler: event.target.value }).catch((error: unknown) => toast.error(message(error)))}
                  value={value}>
                  <option value="builtin">Built-in</option>
                  {handlers.map((entry) => <option key={entry.handler} value={entry.handler}>{entry.plugin.displayName}{handlers.filter((other) => other.plugin.id === entry.plugin.id).length > 1 ? ` · ${entry.tool.title}` : ""}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The rail's Plugins: its own sidebar and page. */
export function PluginsSurface({ sidebarWidth }: { sidebarWidth: number }) {
  const [view] = usePluginsView();
  const plugin = usePlugins((state) => (typeof view === "object" ? state.plugins.find((entry) => entry.id === view.plugin) ?? null : null));
  return (
    <div className="flex h-full min-w-0 flex-1">
      <aside aria-label="Plugins sidebar" className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}><PluginsSidebar /></aside>
      <main className="min-w-0 flex-1 bg-background" data-testid="plugins-page">
        <div className="app-drag h-[var(--titlebar-height)] shrink-0" />
        <ScrollArea className="h-[calc(100%-var(--titlebar-height))]">
          {view === "file-types" ? <FileTypesPage /> : plugin ? <DetailPage plugin={plugin} /> : <BrowsePage />}
        </ScrollArea>
      </main>
    </div>
  );
}
