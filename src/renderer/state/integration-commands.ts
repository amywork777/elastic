/** Authenticated integration commands. Background reads never change project or focus. */
import { selectRenderer } from "@workbench/ui/file-viewer";
import { createDesktopRenderers } from "@renderer/features/explorer/renderers";
import type { IntegrationCommand } from "@shared/ipc/integrations";
import type { ExplorerTab } from "@shared/types";
import { readSessionStrip, tabTitle, openSessionTab, closeSessionTab, selectSessionTab, revealSessionPath } from "./explorer";
import { useProjects } from "./projects";
import { useSessions } from "./sessions";
import { hasDirtyDocument, performDocumentCommand, performPdfCommand } from "./live-documents";
import { pluginTool } from "@renderer/plugins/store";
import { useToolCalls } from "@renderer/plugins/calls";

async function rendererIdForPath(projectId: string, root: string | null, path: string, tabId: string) {
  const composition = createDesktopRenderers(projectId, root, tabId);
  try {
    const metadata = await window.workbench.explorer.stat({ projectId, ...(root ? { root } : {}), path });
    return selectRenderer(composition.renderers, { ...metadata, mediaType: metadata.fileKind }).id;
  } catch { return null; } // Deleted or unavailable resources have no current renderer.
  finally { composition.dispose(); }
}

const slashed = (directory: string) => directory.replace(/\\/g, "/").replace(/\/$/, "");

function inScope(tab: ExplorerTab, command: IntegrationCommand) {
  if (tab.sessionId !== command.sessionId || tab.projectId !== command.projectId) return false;
  if ("root" in tab) return tab.root === (command.root ?? null);
  // Main's real path and the session's recorded spelling name one directory;
  // a tab carries whichever it was opened with.
  const roots = command.rootDirectory ? [command.rootDirectory, ...(command.rootAliases ?? [])].map(slashed) : [];
  if (tab.kind === "terminal") {
    const cwd = tab.cwd ?? useProjects.getState().projects.find(project => project.id === tab.projectId)?.path;
    if (!cwd) return false;
    return roots.some(root => slashed(cwd) === root || slashed(cwd).startsWith(`${root}/`));
  }
  // Review tabs lack root identity; do not reveal a different worktree's review.
  if (tab.kind !== "review") return false;
  const session = useSessions.getState().sessions.find(candidate => candidate.id === tab.sessionId);
  const project = useProjects.getState().projects.find(candidate => candidate.id === command.projectId);
  if (!session) return false;
  return roots.length > 0 ? roots.includes(slashed(session.cwd)) : session.cwd === project?.path;
}

async function scopedTabs(command: IntegrationCommand, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!useProjects.getState().projects.some(project => project.id === command.projectId)) throw new Error("that project is no longer open in text-to-cad");
  const session = useSessions.getState().sessions.find(session => session.id === command.sessionId && session.projectId === command.projectId && !session.archived);
  if (!session) throw new Error("This session is no longer active.");
  const strip = await readSessionStrip(command.sessionId);
  signal?.throwIfAborted();
  return { tabs: strip.tabs.filter(tab => inScope(tab, command)), activeId: strip.activeId };
}
async function scopedTab(command: IntegrationCommand, signal?: AbortSignal) {
  const strip = await scopedTabs(command, signal);
  signal?.throwIfAborted();
  const tab = strip.tabs.find(tab => tab.id === (command.tabId ?? strip.activeId));
  if (!tab) throw new Error("that tab is closed or belongs to another workspace");
  return tab;
}

export async function performIntegrationCommand(command: IntegrationCommand, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const owner = useSessions.getState().sessions.find(session => session.id === command.sessionId && session.projectId === command.projectId && !session.archived);
  if (!owner) throw new Error("This session is no longer active.");
  const scope = { projectId: command.projectId, root: command.root ?? null };
  const params: Record<string, unknown> = { ...command.params, ...(command.tabId ? { tabId: command.tabId } : {}) };
  if (command.kind.startsWith("document-")) {
    const tab = await scopedTab(command, signal);
    signal?.throwIfAborted();
    if (tab.kind !== "file" || !tab.path) throw new Error("This is not a document tab.");
    return performDocumentCommand(command.kind, { ...params, tabId: tab.id }, { ...scope, path: tab.path });
  }
  if (command.kind.startsWith("pdf-")) {
    const tab = await scopedTab(command, signal);
    signal?.throwIfAborted();
    if (tab.kind !== "file" || !tab.path) throw new Error("This is not a PDF tab.");
    return performPdfCommand(command.kind, { ...params, tabId: tab.id }, { ...scope, path: tab.path });
  }
  switch (command.kind) {
    case "open-file": {
      if (!command.path) throw new Error("open-file needs a path");
      const tab = await openSessionTab(command.sessionId, command.projectId, scope.root, "file", { path: command.path }, signal);
      if (!tab) throw new Error("the explorer could not open a tab");
      return { opened: command.path, root: scope.root, tabId: tab.id, renderer: await rendererIdForPath(command.projectId, scope.root, command.path, tab.id) };
    }
    case "reveal": {
      if (!command.path) throw new Error("reveal needs a path");
      await revealSessionPath(command.sessionId, command.projectId, scope.root, command.path, command.directory ?? false, signal);
      return { revealed: command.path, root: scope.root };
    }
    case "open-url": {
      if (!command.url) throw new Error("open-url needs a URL");
      const tab = await openSessionTab(command.sessionId, command.projectId, scope.root, "browser", { url: command.url, root: scope.root }, signal);
      if (!tab) throw new Error("the explorer could not open a browser tab");
      return { opened: command.url, tabId: tab.id, root: scope.root };
    }
    case "open-tool": {
      const pluginId = String(params.pluginId ?? ""), toolId = String(params.toolId ?? "");
      const tool = pluginTool(pluginId, toolId);
      if (!tool) throw new Error(`no enabled plugin contributes the tool "${pluginId}/${toolId}"`);
      const tab = await openSessionTab(command.sessionId, command.projectId, scope.root, "tool", { root: scope.root, pluginId, toolId, title: tool.title }, signal);
      if (!tab) throw new Error("the explorer could not open the tool");
      // An agent's call to the tool, relayed by main: the tab shows that call.
      const call = params.call as { arguments?: Record<string, unknown>; result?: unknown } | undefined;
      if (call) useToolCalls.getState().show(tab.id, { arguments: call.arguments ?? {}, result: call.result });
      return { tabId: tab.id, title: tabTitle(tab), root: scope.root };
    }
    case "list-tabs": {
      const { tabs, activeId } = await scopedTabs(command, signal);
      signal?.throwIfAborted();
      return { active: tabs.some(tab => tab.id === activeId) ? activeId : null,
        tabs: await Promise.all(tabs.map(async tab => ({ ...tab, title: tabTitle(tab), ...(tab.kind === "file" ? { renderer: tab.path ? await rendererIdForPath(tab.projectId, tab.root, tab.path, tab.id) : null } : {}) }))) };
    }
    case "tab-resource": return scopedTab(command, signal);
    case "show-tab": {
      const tab = await scopedTab(command, signal);
      signal?.throwIfAborted();
      await selectSessionTab(command.sessionId, tab.id, signal, tab);
      return { tabId: tab.id, shown: true };
    }
    case "close-tab": {
      const tab = await scopedTab(command, signal);
      signal?.throwIfAborted();
      if (hasDirtyDocument(tab.id)) throw new Error("Save or explicitly discard the document before closing its tab.");
      // Close only this session’s strip; another session stays selected.
      await closeSessionTab(command.sessionId, tab.id, signal, tab);
      return { tabId: tab.id, closed: true };
    }
    case "terminal-open": {
      const tab = await openSessionTab(command.sessionId, command.projectId, scope.root, "terminal", { cwd: String(params.cwd ?? command.rootDirectory), ptyId: String(params.ptyId), agent: true }, signal);
      if (!tab) throw new Error("the explorer could not open a terminal tab");
      return { tabId: tab.id, ptyId: params.ptyId, cwd: params.cwd };
    }
  }
}
