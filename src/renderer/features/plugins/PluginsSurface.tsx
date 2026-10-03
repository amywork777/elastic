import { ArrowRight, Blocks, ChevronLeft, Download, FileType, FolderPlus, GitBranch, Link2, MoreHorizontal, Plus, RefreshCw, Search, Store, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
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
import type { CatalogEntry, CatalogSource, Compatibility, Marketplace, PluginRecord } from "@shared/plugins";

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (IpcError: )?/, "") : String(error));

type View = Extract<Surface, { kind: "plugins" }>["view"];

function usePluginsView(): [View, (view: View) => void] {
  const surface = useUi((state) => state.surface);
  const setSurface = useUi((state) => state.setSurface);
  return [surface.kind === "plugins" ? surface.view : "browse", (view) => setSurface({ kind: "plugins", view })];
}

/** Add ▾: a marketplace from GitHub (or any git URL), a marketplace folder, or a plugin folder. */
function AddMenu() {
  const [, show] = usePluginsView();
  const [githubOpen, setGithubOpen] = useState(false);
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-7 gap-1 text-xs" size="sm" variant="secondary"><Plus className="size-3.5" /> Add</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setGithubOpen(true)}><GitBranch className="size-4" /> Add a marketplace from GitHub…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void addMarketplace()}><Store className="size-4" /> Add a marketplace folder…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void installFolder()}><FolderPlus className="size-4" /> Install a plugin folder…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddFromGithub onOpenChange={setGithubOpen} open={githubOpen} />
    </>
  );
}

/** The repository box: `owner/repo` or a git URL, fetched in the background with the person's own git. */
function AddFromGithub({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const market = await window.workbench.plugins.addMarketplace({ source: value.trim() });
      if (market) toast.success(`Fetching ${market.displayName}. Its plugins appear in the list when it arrives.`);
      setValue("");
      onOpenChange(false);
    } catch (error) { toast.error(message(error)); } finally { setBusy(false); }
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a marketplace from GitHub</DialogTitle>
          <DialogDescription>A repository with a Codex or Claude Code marketplace. elastic fetches it with your git, so private repositories work when your git can reach them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <Input aria-label="Repository" autoFocus className="h-8 text-sm" onChange={(event) => setValue(event.target.value)} placeholder="owner/repo or https://…" value={value} />
        </form>
        <DialogFooter>
          <Button disabled={busy || !value.trim()} onClick={() => void submit()} size="sm">{busy ? <><Spinner className="size-3.5" /> Adding</> : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            <button className={row(typeof view === "object" && "plugin" in view && view.plugin === plugin.id)} key={plugin.id} onClick={() => show({ plugin: plugin.id })} type="button">
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

const COMPAT_TONE: Record<Compatibility["level"], string> = {
  works: "bg-emerald-500",
  signin: "bg-amber-500",
  partly: "bg-sky-500",
  codex: "bg-muted-foreground/60",
  unavailable: "bg-muted-foreground/60",
  unknown: "bg-muted-foreground/30",
};

/** Works / May need sign-in / Partly / Needs Codex …: a dot and a word, the sentence on hover. */
function CompatLabel({ compat }: { compat: Compatibility }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
      <span aria-hidden className={cn("size-1.5 rounded-full", COMPAT_TONE[compat.level])} />
      {compat.label}
    </span>
  );
}

const SOURCE_KIND: Record<CatalogSource["kind"], string> = { bundled: "ships with elastic", builtin: "ships with elastic", local: "a folder", git: "a repository" };

function sourceText(source: CatalogSource): string {
  return source.url ? `${source.marketplaceName} · ${source.url.replace(/^https:\/\//, "").replace(/\.git$/, "")}` : `${source.marketplaceName} · ${SOURCE_KIND[source.kind]}`;
}

function InstallButton({ entry, source }: { entry: CatalogEntry; source?: CatalogSource }) {
  const [busy, setBusy] = useState(false);
  const [, show] = usePluginsView();
  const from = source ?? entry.sources[0]!;
  const install = async () => {
    setBusy(true);
    try {
      const plugin = await window.workbench.plugins.installFromMarketplace({ marketplace: from.marketplace, name: from.name });
      toast.success(`${plugin.displayName} plugin installed`, { action: { label: "Open", onClick: () => show({ plugin: plugin.id }) } });
    } catch (error) {
      toast.error(message(error));
    } finally { setBusy(false); }
  };
  if (entry.installedId && !source) return <span className="text-muted-foreground text-xs">Installed</span>;
  if (entry.compat.level === "unavailable" && !source) return null;
  return (
    <Button aria-label={`Install ${entry.name}${source ? ` from ${source.marketplaceName}` : ""}`} className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void install()} size="sm" variant="secondary">
      {busy ? <><Spinner className="size-3.5" /> Installing</> : <><Plus className="size-3.5" /> Install</>}
    </Button>
  );
}

/** Browse: one list of every marketplace's plugins, the same plugin once, searchable. */
function BrowsePage() {
  const catalog = usePlugins((state) => state.catalog);
  const marketplaces = usePlugins((state) => state.marketplaces);
  const installed = usePlugins((state) => state.plugins);
  const [query, setQuery] = useState("");
  const [, show] = usePluginsView();
  const [refreshing, setRefreshing] = useState(false);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => catalog.filter((entry) => !needle
    || `${entry.name} ${entry.displayName} ${entry.description} ${entry.category ?? ""}`.toLowerCase().includes(needle)), [catalog, needle]);
  const fetching = marketplaces.filter((market) => market.status === "fetching");
  const refresh = async () => {
    setRefreshing(true);
    try {
      await window.workbench.plugins.refresh();
      await window.workbench.plugins.refreshMarketplaces();
    } catch (error) { toast.error(message(error)); } finally { setRefreshing(false); }
  };
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <PageHeader
        actions={<>
          <Button aria-label="Refresh" className="size-7" disabled={refreshing} onClick={() => void refresh()} size="icon" variant="ghost"><RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /></Button>
          <AddMenu />
        </>}
        description="Plugins give agents new tools (MCP servers) and skills, and can add their own views: a tab, a page on the rail, or how a file type opens. Plugins made for Codex and Claude Code work here."
        title="Plugins"
      />
      <div className="relative mb-2">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
        <Input aria-label="Search plugins" className="h-8 pl-8 text-sm" onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${catalog.length} plugins`} value={query} />
      </div>
      <p aria-live="polite" className="mb-4 h-4 text-muted-foreground text-xs" role="status">
        {fetching.length > 0 ? <><Spinner className="mr-1 inline size-3" /> Fetching {fetching.map((market) => market.displayName).join(", ")}…</> : null}
      </p>
      {catalog.length === 0 ? <p className="text-muted-foreground text-sm">No plugins listed yet. Add a marketplace, or install a plugin folder, from Add.</p> : null}
      {catalog.length > 0 && visible.length === 0 ? <p className="text-muted-foreground text-sm">No plugin matches "{query}".</p> : null}
      {visible.length > 0 ? (
        <div className="divide-y divide-border rounded-lg border" data-testid="plugin-catalog">
          {visible.map((entry) => {
            const record = entry.installedId ? installed.find((plugin) => plugin.id === entry.installedId) ?? null : null;
            return (
              <div className="flex items-center gap-3 px-3 py-2.5" data-catalog-entry={entry.name} key={entry.key}>
                <PluginLogo className="size-8" plugin={record ?? { logo: null, brandColor: null, displayName: entry.displayName }} />
                <button className="min-w-0 flex-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => show(record ? { plugin: record.id } : { entry: entry.key })} type="button">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">{record?.displayName ?? entry.displayName}</span>
                    <CompatLabel compat={entry.compat} />
                  </div>
                  <div className="truncate text-muted-foreground text-xs">{entry.description || record?.description || "No description"}</div>
                </button>
                {record?.updateAvailable ? <UpdateButton plugin={record} /> : <InstallButton entry={entry} />}
              </div>
            );
          })}
        </div>
      ) : null}
      <SourcesSection marketplaces={marketplaces} />
    </div>
  );
}

function UpdateButton({ plugin }: { plugin: PluginRecord }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button aria-label={`Update ${plugin.displayName}`} className="h-7 gap-1 text-xs" disabled={busy} size="sm" variant="secondary"
      onClick={() => void (async () => {
        setBusy(true);
        try { await window.workbench.plugins.update({ id: plugin.id }); toast.success(`${plugin.displayName} updated`); } catch (error) { toast.error(message(error)); } finally { setBusy(false); }
      })()}>
      {busy ? <><Spinner className="size-3.5" /> Updating</> : <><Download className="size-3.5" /> Update</>}
    </Button>
  );
}

/** Where the list comes from: each marketplace, how fresh it is, and Remove for the ones a person can drop. */
function SourcesSection({ marketplaces }: { marketplaces: Marketplace[] }) {
  if (marketplaces.length === 0) return null;
  return (
    <section className="mt-10" data-testid="plugin-sources">
      <h2 className="mb-2 font-medium text-sm">Sources</h2>
      <div className="divide-y divide-border rounded-lg border">
        {marketplaces.map((market) => (
          <div className="flex items-center gap-3 px-3 py-2" key={market.file}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{market.displayName}</div>
              <div className={cn("truncate text-xs", market.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {market.status === "fetching" ? "Fetching…"
                  : market.status === "failed" ? `Could not fetch: ${market.error ?? "unknown error"}`
                    : [`${market.plugins.length} plugin${market.plugins.length === 1 ? "" : "s"}`,
                      market.kind === "bundled" || market.kind === "builtin" ? "ships with elastic" : market.url ? market.url.replace(/^https:\/\//, "").replace(/\.git$/, "") : "a folder",
                      market.commit ? market.commit.slice(0, 7) : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            {market.kind === "local" || market.kind === "git" ? (
              <Button aria-label={`Remove ${market.displayName}`} className="h-7 text-xs" size="sm" variant="ghost"
                onClick={() => void window.workbench.plugins.removeMarketplace({ file: market.file }).catch((error: unknown) => toast.error(message(error)))}>Remove</Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A catalog card that is not installed: what it is, whether it works here, and every marketplace that offers it. */
function EntryPage({ entry }: { entry: CatalogEntry }) {
  const [, show] = usePluginsView();
  const [first, ...alternates] = entry.sources;
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <button className="mb-4 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground" onClick={() => show("browse")} type="button">
        <ChevronLeft className="size-3.5" /> Plugins
      </button>
      <div className="flex items-start gap-4 pb-6">
        <PluginLogo className="size-14 rounded-xl" plugin={{ logo: null, brandColor: null, displayName: entry.displayName }} />
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-xl">{entry.displayName}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{entry.description || "No description"}</p>
        </div>
        <InstallButton entry={entry} />
      </div>
      <Section title="In elastic">
        <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
          <CompatLabel compat={entry.compat} />
          <p className="min-w-0 flex-1 text-muted-foreground text-xs">{entry.compat.detail}</p>
        </div>
      </Section>
      <Section title="Information">
        <dl className="divide-y divide-border rounded-lg border text-sm">
          {([["Version", entry.version], ["Category", entry.category], ["Website", entry.homepage], ["Source", first ? sourceText(first) : null]] as Array<[string, string | null]>).map(([label, value]) => (
            <div className="flex gap-4 px-3 py-2" key={label}>
              <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all">{value ?? "Unavailable"}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {alternates.length > 0 ? (
        <Section title="Also offered by">
          {alternates.map((source) => (
            <Row action={<InstallButton entry={entry} source={source} />} key={`${source.marketplace}#${source.name}`} primary={source.marketplaceName}
              secondary={sourceText(source)} />
          ))}
        </Section>
      ) : null}
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
  const marketplaceName = (file: string) => usePlugins.getState().marketplaces.find((market) => market.file === file)?.displayName ?? "a marketplace";
  const info: Array<[string, string | null]> = [
    ["Developer", plugin.developer],
    ["Version", plugin.version],
    ["Source", plugin.bundled ? "Ships with elastic" : plugin.source.kind === "marketplace"
      ? `${plugin.source.name} from ${marketplaceName(plugin.source.marketplace)}${plugin.source.commit ? ` at ${plugin.source.commit.slice(0, 7)}` : ""}` : "Local folder"],
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
          {plugin.updateAvailable ? <UpdateButton plugin={plugin} /> : null}
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
  const plugin = usePlugins((state) => (typeof view === "object" && "plugin" in view ? state.plugins.find((entry) => entry.id === view.plugin) ?? null : null));
  const entry = usePlugins((state) => (typeof view === "object" && "entry" in view ? state.catalog.find((item) => item.key === view.entry) ?? null : null));
  return (
    <div className="flex h-full min-w-0 flex-1">
      <aside aria-label="Plugins sidebar" className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}><PluginsSidebar /></aside>
      <main className="min-w-0 flex-1 bg-background" data-testid="plugins-page">
        <div className="app-drag h-[var(--titlebar-height)] shrink-0" />
        <ScrollArea className="h-[calc(100%-var(--titlebar-height))]">
          {view === "file-types" ? <FileTypesPage /> : plugin ? <DetailPage plugin={plugin} /> : entry ? <EntryPage entry={entry} /> : <BrowsePage />}
        </ScrollArea>
      </main>
    </div>
  );
}
