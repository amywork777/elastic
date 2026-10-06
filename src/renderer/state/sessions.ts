import { useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { listedSessions, recentsSections, sidebarSections, type SidebarSection } from "@renderer/lib/sidebar";
import { errorMessage } from "@shared/ipc/errors";
import type { GitMode, Project, Session, SessionTag } from "@shared/types";

import { useAgents } from "./agents";
import { useProjects } from "./projects";
import { flushSessionTabs, pruneSessionStorage, useExplorer } from "./explorer";
import { DEFAULT_SIDEBAR, useSettings, useSidebarSettings } from "./settings";

/**
 * The session index — id, title, status, cwd, the files-changed counters.
 * Not the transcripts: the agent owns those and `session/load` replays them
 * (plan §5); `state/acp.ts` holds the live state of the ones that are open.
 *
 * `activeId === null` is the new-session state for the active project. Every
 * mutation is an IPC call and the `sessions.changed` event that follows is
 * what updates the list, so a pin or an archive from the header and one from
 * the sidebar's menu land in the same place. A rename is the exception: it
 * writes the new title into the list at once, and rolls it back with a toast
 * if main refuses (unless a `sessions.changed` has written another title
 * meanwhile, which stands).
 *
 * `split` is two chats side by side. `activeId` keeps its meaning (the chat the keyboard and the
 * explorer are about) and while split is always the focused side's, so everything bound to it
 * follows focus. A side is null while it shows the new-chat screen.
 */
export type SplitSide = "left" | "right";
export type SplitState = { left: string | null; right: string | null; focus: SplitSide };
const other = (side: SplitSide): SplitSide => (side === "left" ? "right" : "left");

type SessionsState = {
  sessions: Session[];
  ready: boolean;
  activeId: string | null;
  split: SplitState | null;
  /** The folder of a side on the new-chat screen, kept while the other side has focus (and the
   * active project is that side's): a folder just opened is a draft the projects store forgets. */
  splitProjects: Partial<Record<SplitSide, Project>>;
  /** A chat created from a side's new-chat screen lands in that side, wherever focus is by then. */
  placeInSide: (side: SplitSide, id: string) => void;
  /** Opens `id` beside the current chat (or, already split, in the other side) and focuses it. */
  openBeside: (id: string) => void;
  focusSide: (side: SplitSide) => void;
  /** Closes one side; the other becomes the one chat on screen. */
  closeSide: (side: SplitSide) => void;

  load: () => Promise<void>;
  setActive: (id: string | null) => void;
  /** Select a session and make its project the active one. */
  select: (id: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  /** Move the row into the sidebar's `Pinned` section, or back to its project. */
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  /** The person saw this chat (`state/viewed.ts`); main keeps `updatedAt` as it was. */
  markViewed: (id: string) => Promise<void>;
  /** A Recents tag set by hand, or null for automatic. */
  setTag: (id: string, tag: SessionTag | null) => Promise<void>;
  /** Recents past its first `RECENTS_LIMIT` rows, for this launch. */
  recentsExpanded: boolean;
  setRecentsExpanded: (expanded: boolean) => void;
  remove: (id: string) => Promise<void>;
  /**
   * Main's whole list — `load`, and every `sessions.changed`. Only this
   * list says a session is gone, so only this prunes what one left behind.
   */
  receive: (sessions: Session[]) => void;
  /**
   * One row this renderer just made, ahead of the `sessions.changed` that
   * brings it. Not the list: before `load` has answered, the rows beside it
   * are simply not here yet, and nothing is pruned for their absence.
   */
  adopt: (session: Session) => void;
  /**
   * Start a thread and select it (plan §9).
   *
   * The working directory is main's to decide: this passes the mode, not a
   * path, and main resolves the worktree. `cwd` is the one exception —
   * Settings' `New session in this worktree` names a directory that already
   * exists, and main checks it belongs to the project.
   */
  start: (input: {
    projectId: string;
    agentId?: string;
    gitMode?: GitMode;
    cwd?: string;
    name?: string;
  }, options?: { select?: boolean }) => Promise<Session>;
};

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  ready: false,
  activeId: null,
  split: null,
  splitProjects: {},

  placeInSide: (side, id) => {
    const split = get().split;
    if (!split || split[side] !== null) return;
    set({ split: { ...split, [side]: id }, ...(split.focus === side ? { activeId: id } : {}) });
  },

  openBeside: (id) => {
    const { split, activeId } = get();
    if (!split) {
      if (!activeId) return get().select(id);
      if (activeId === id) return;
      set({ split: { left: activeId, right: id, focus: "right" } });
      return get().focusSide("right");
    }
    const already = split.left === id ? "left" : split.right === id ? "right" : null;
    if (already) return get().focusSide(already);
    const side = other(split.focus);
    set({ split: { ...split, [side]: id } });
    get().focusSide(side);
  },

  focusSide: (side) => {
    const split = get().split;
    if (!split) return;
    const id = split[side];
    const projects = useProjects.getState();
    // Leaving a new-chat screen: remember its folder, which the active project stops being.
    const leaving = split.focus !== side && split[split.focus] === null
      ? projects.projects.find((project) => project.id === projects.activeId) ?? (projects.draft?.id === projects.activeId ? projects.draft : null)
      : null;
    const splitProjects = leaving ? { ...get().splitProjects, [split.focus]: leaving } : get().splitProjects;
    const session = id ? get().sessions.find((candidate) => candidate.id === id) : undefined;
    const kept = id === null ? splitProjects[side] : undefined;
    if (session && projects.activeId !== session.projectId) projects.setActive(session.projectId);
    else if (kept && projects.activeId !== kept.id) {
      if (projects.projects.some((project) => project.id === kept.id)) projects.setActive(kept.id);
      else projects.selectDirectory(kept);
    }
    set({ split: { ...split, focus: side }, activeId: id, splitProjects });
  },

  closeSide: (side) => {
    const split = get().split;
    if (!split) return;
    const keep = other(side);
    get().focusSide(keep);
    set({ split: null });
  },

  load: async () => {
    const sessions = await window.workbench.sessions.list({});
    get().receive(sessions);
  },

  setActive: (activeId) => {
    const split = get().split;
    // A chat already on the other side takes focus there; it is never shown twice (back/forward
    // and the continued-in links come here, not through `select`).
    if (split && activeId !== null && split[other(split.focus)] === activeId) return get().focusSide(other(split.focus));
    set(split ? { activeId, split: { ...split, [split.focus]: activeId } } : { activeId });
  },

  select: (id) => {
    const split = get().split;
    if (split && split[other(split.focus)] === id) return get().focusSide(other(split.focus));
    const session = get().sessions.find((candidate) => candidate.id === id);
    if (session && useProjects.getState().activeId !== session.projectId) {
      useProjects.getState().setActive(session.projectId);
    }
    get().setActive(id);
  },

  rename: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const before = get().sessions.find((session) => session.id === id)?.title;
    // Optimistic: the header's inline edit should not flash the old title
    // back while the round trip completes. `sessions.changed` corrects it.
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title: trimmed } : session,
      ),
    }));
    try {
      await window.workbench.sessions.rename({ id, title: trimmed });
    } catch (error) {
      // Main refused: put the old title back — unless a `sessions.changed` has since
      // written another one, which is main's word and stays.
      if (before !== undefined) {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id && session.title === trimmed ? { ...session, title: before } : session,
          ),
        }));
      }
      toast.error(`Could not rename the thread: ${errorMessage(error)}`);
    }
  },

  archive: async (id, archived) => {
    if (archived) await flushSessionTabs(id);
    await window.workbench.sessions.archive({ id, archived });
    if (archived) dismiss(id);
  },

  setPinned: async (id, pinned) => {
    await window.workbench.sessions.setPinned({ id, pinned });
  },

  markViewed: async (id) => {
    await window.workbench.sessions.markViewed({ id });
  },

  setTag: async (id, tag) => {
    // Optimistic, as rename is: the row says it at once; `sessions.changed` confirms it.
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? { ...session, statusOverride: tag } : session)) }));
    await window.workbench.sessions.setTag({ id, tag });
  },

  recentsExpanded: false,
  setRecentsExpanded: (recentsExpanded) => set({ recentsExpanded }),

  remove: async (id) => {
    await window.workbench.sessions.delete({ id });
    dismiss(id);
  },

  receive: (sessions) => {
    const previous = get();
    const byId = new Map(sessions.map(session => [session.id, session]));
    for (const session of previous.sessions) {
      const current = byId.get(session.id);
      if (!current || (!session.archived && current.archived)) {
        useExplorer.getState().discardSessionResources(session.id, { preserveTabs: Boolean(current?.archived) });
      }
    }
    pruneSessionStorage(new Set(byId.keys()));
    const selected = previous.activeId ? byId.get(previous.activeId) : undefined;
    const alreadyArchived = previous.sessions.find(session => session.id === previous.activeId)?.archived;
    // Archiving the open session dismisses it, but a deliberately opened
    // archived transcript remains readable when some other session changes.
    const activeId = selected && (!selected.archived || alreadyArchived) ? selected.id : null;
    useProjects.getState().derive(sessions);
    if (selected?.archived && activeId) useProjects.getState().setActive(selected.projectId);
    set({ sessions, ready: true, activeId, split: previous.split && { ...previous.split, [previous.split.focus]: activeId } });
    // A side whose chat went (deleted, or archived since it opened) closes; the other stays.
    const before = previous.split;
    if (before) {
      const gone = (id: string | null) => {
        if (!id) return false;
        const current = byId.get(id);
        return !current || (current.archived && !previous.sessions.find((session) => session.id === id)?.archived);
      };
      const side = (["left", "right"] as const).find((candidate) => gone(before[candidate]));
      if (side) {
        const keep = before[other(side)];
        set({ split: { ...before, [other(side)]: keep && !gone(keep) ? keep : null } });
        get().closeSide(side);
      }
    }
  },

  adopt: (session) => {
    const current = get().sessions;
    if (current.some(item => item.id === session.id)) return;
    const sessions = [...current, session];
    useProjects.getState().derive(sessions);
    set({ sessions });
  },

  start: async (input, options) => {
    const agentId = input.agentId ?? defaultAgentId();
    if (!agentId) {
      throw new Error("no agent is installed; add one from Settings › Agents");
    }
    const session = await window.workbench.sessions.create({
      projectId: input.projectId,
      agentId,
      ...(input.gitMode ? { gitMode: input.gitMode } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.name ? { name: input.name } : {}),
    });
    get().adopt(session);
    if (options?.select !== false) get().select(session.id);
    return session;
  },
}));

/**
 * Which agent a session gets when the caller does not say: the one Settings
 * names, and otherwise the first installed one.
 *
 * A default that pointed at an agent the person has since uninstalled would
 * fail at `session/new` with the adapter's own words, so the setting is only
 * honoured while the detector still finds it.
 */
function defaultAgentId(): string | null {
  const installed = useAgents
    .getState()
    .agents.filter((agent) => agent.installed);
  const preferred = useSettings.getState().settings?.defaultAgentId;
  if (preferred && installed.some((agent) => agent.id === preferred)) {
    return preferred;
  }
  return installed[0]?.id ?? null;
}

/**
 * The sidebar's sections — `Pinned`, then whatever the grouping asks for
 * (`lib/sidebar.ts`).
 *
 * `useMemo` over the three stores' own values rather than a zustand selector:
 * the sections are fresh objects on every call, so no equality zustand can
 * apply to the *result* is ever true and a selector re-renders forever (it
 * did). The three inputs, on the other hand, are stable references — a store
 * replaces its list when it changes and not otherwise — so memoising on them
 * recomputes exactly when one of them moves.
 */
const NO_HIDDEN: readonly string[] = [];

export function useSidebarSections(): SidebarSection[] {
  const sessions = useSessions((state) => state.sessions);
  const projects = useProjects((state) => state.projects);
  const filters = useSidebarSettings();
  const hidden = useSettings((state) => state.settings?.hiddenProjects ?? NO_HIDDEN);
  const expanded = useSessions((state) => state.recentsExpanded);
  return useMemo(
    () => filters.groupBy === "recents"
      ? recentsSections({ sessions, projects, filters, hidden, expanded })
      : sidebarSections({ sessions, projects, filters, hidden }),
    [sessions, projects, filters, hidden, expanded],
  );
}

/**
 * The sidebar's `index`th row as it is drawn, 1-based, outside React: what
 * Mod+1..9 opens. 9 is the last row, the way a browser's ⌘9 is its last tab.
 */
export function listedSessionAt(index: number): Session | null {
  const sidebar = useSettings.getState().settings?.sidebar ?? DEFAULT_SIDEBAR;
  const input = {
    sessions: useSessions.getState().sessions,
    projects: useProjects.getState().projects,
    filters: sidebar,
    hidden: useSettings.getState().settings?.hiddenProjects ?? NO_HIDDEN,
  };
  const rows = listedSessions(
    sidebar.groupBy === "recents"
      ? recentsSections({ ...input, expanded: useSessions.getState().recentsExpanded })
      : sidebarSections(input),
    sidebar.collapsedProjects,
    { foldersCollapsed: sidebar.foldersCollapsed, recentsCollapsed: sidebar.recentsCollapsed },
  );
  return (index === 9 ? rows.at(-1) : rows[index - 1]) ?? null;
}

/** A chat archived or deleted from here: its side closes when split, else the new-chat screen shows. */
function dismiss(id: string) {
  const { split, activeId } = useSessions.getState();
  const side = split ? (split.left === id ? "left" : split.right === id ? "right" : null) : null;
  if (side) useSessions.getState().closeSide(side);
  else if (activeId === id) useSessions.getState().setActive(null);
}

/** The chats on screen: both sides when split (a side on the new-chat screen has none), else the active one. */
export function sessionsOnScreen(state: { split: SplitState | null; activeId: string | null }): string[] {
  const ids = state.split ? [state.split.left, state.split.right] : [state.activeId];
  return ids.filter((id): id is string => Boolean(id));
}

/** The active session's index row, or null in the new-session state. */
export function useActiveSession(): Session | null {
  return useSessions(
    (state) =>
      state.sessions.find((session) => session.id === state.activeId) ?? null,
  );
}
