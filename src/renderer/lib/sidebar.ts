/**
 * What the sidebar lists, as one pure function of the index and the filter
 * menu — plus the state glyph each row gets.
 *
 * A module rather than logic inside the components, for the same reason
 * `lib/panes.ts` and `lib/git-mode.ts` are: the answer has four inputs
 * (the sessions, the projects, the filters, the collapsed set) and five rules
 * on top of them, and a section that quietly listed a pinned thread twice, or
 * kept an empty project on screen, is a defect
 * nobody can see in a screenshot. Everything here is pure and unit-tested
 * (`tests/unit/renderer/sidebar.test.ts`); the components only draw it.
 */
import type {
  Project,
  Session,
  SessionStatus,
  SidebarSettings,
  SidebarSortBy,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* The sections                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A section of the sidebar. Exactly one of three kinds:
 *
 *   - `pinned`   the `Pinned` section, present only when something is in it;
 *   - `project`  one project's threads, with the project's own header;
 *   - `all`      the one flat list `Group by › None` produces.
 *
 * `project` is set only for the `project` kind, which is what makes the
 * header's `+`, its right-click menu and its collapse a project's business
 * and nothing else's.
 */
export type SidebarSection = {
  /** Stable across renders: the project's id, or the kind for the other two. */
  id: string;
  kind: "pinned" | "project" | "all" | "recents";
  /** The header's text. */
  name: string;
  project: Project | null;
  sessions: Session[];
  /** A pinned folder: listed at the top of the folders, and even with no sessions to show. */
  pinned: boolean;
  /** Recents: how many rows are past the cut (`RECENTS_LIMIT`); 0 when expanded. */
  more?: number;
};

/**
 * The sidebar's list, in the order it is drawn: `Pinned` first when anything
 * is pinned, then the sections the grouping asks for.
 *
 * Six rules, and the tests are named after them:
 *
 *  1. **The filters come first.** `status` and `environment` decide which
 *     sessions exist at all; everything below sees only what survived.
 *  2. **A pinned thread lives in `Pinned` and nowhere else** — Claude Code's
 *     behaviour, and the only one that makes pinning mean anything: a row
 *     that stayed in its project as well would just be a duplicate.
 *  3. **`Group by › Project` keeps the project list's own order**, which is
 *     derived from their sessions. `None` is one list.
 *  4. **`Sort by` orders inside every section**, `Pinned` included.
 *  5. **No empty groups.** Directories only exist through their sessions.
 *     A pinned-only directory has no duplicate, empty header.
 *  6. **A pinned folder leads, and stays.** Pinned folders come first among
 *     the folders, in the order they were pinned, and are listed even when
 *     none of their sessions match — the one exception to rule 5, because
 *     pinning a folder means "keep this one at hand". Hiding beats pinning.
 */
export function sidebarSections(input: {
  sessions: readonly Session[];
  projects: readonly Project[];
  filters: SidebarSettings;
  /** Project ids hidden from the folder groups (`settings.hiddenProjects`). Pinned rows stay. */
  hidden?: readonly string[];
}): SidebarSection[] {
  const { filters } = input;
  const hidden = new Set(input.hidden ?? []);
  const matching = input.sessions.filter(
    (session) => matchesStatus(session, filters) && matchesEnvironment(session, filters),
  );

  const sections: SidebarSection[] = [];

  const pinned = sort(
    matching.filter((session) => session.pinned),
    filters.sortBy,
  );
  if (pinned.length > 0) {
    sections.push({ id: "pinned", kind: "pinned", name: "Pinned", project: null, sessions: pinned, pinned: false });
  }

  // A hidden folder's sessions leave the groups and the flat list; a pinned one was pinned on
  // purpose, and stays in Pinned.
  const loose = matching.filter((session) => !session.pinned && !hidden.has(session.projectId));

  if (filters.groupBy === "none") {
    sections.push({
      id: "all",
      kind: "all",
      name: "Sessions",
      project: null,
      sessions: sort(loose, filters.sortBy),
      pinned: false,
    });
    return sections;
  }

  const pins = filters.pinnedProjects.filter((id) => !hidden.has(id));
  const byId = new Map(input.projects.map((project) => [project.id, project]));
  const ordered = [
    ...pins.flatMap((id) => byId.get(id) ?? []),
    ...input.projects.filter((project) => !pins.includes(project.id)),
  ];
  for (const project of ordered) {
    const sessions = sort(
      loose.filter((session) => session.projectId === project.id),
      filters.sortBy,
    );
    const pinnedFolder = pins.includes(project.id);
    if (sessions.length === 0 && !pinnedFolder) {
      continue;
    }
    sections.push({ id: project.id, kind: "project", name: project.name, project, sessions, pinned: pinnedFolder });
  }

  return sections;
}

/**
 * The rows on screen, top to bottom: every section's sessions but a collapsed
 * project's. Mod+1..9 counts in this order, so the number is the row the
 * person sees.
 */
export function listedSessions(
  sections: readonly SidebarSection[],
  collapsedProjects: readonly string[],
  { foldersCollapsed = false }: { foldersCollapsed?: boolean } = {},
): Session[] {
  // In Recents a chat is listed once, in Recents; the folders below it repeat what is there.
  const recents = sections.some((section) => section.kind === "recents");
  const collapsed = new Set(collapsedProjects);
  return sections.flatMap((section) => {
    if (section.kind !== "project") return section.sessions;
    if (recents && foldersCollapsed) return [];
    return collapsed.has(section.id) ? [] : section.sessions;
  });
}

export type StatusTag = "working" | "waiting" | "review" | "failed" | "done";

export const STATUS_TAG_LABELS: Record<StatusTag, string> = {
  working: "Working",
  waiting: "Waiting on you",
  review: "Needs review",
  failed: "Failed",
  done: "Done",
};

/** How many Recents rows show before **Show N more**. */
export const RECENTS_LIMIT = 10;

/** Activity since the person last saw the chat. A chat never seen since Recents arrived reads as read. */
export function isUnread(session: Session): boolean {
  return session.lastViewedAt !== null && session.updatedAt > session.lastViewedAt;
}

/**
 * A chat's tag: what is happening wins (a turn going, a question, a failure); a finished chat
 * takes the person's own tag if they set one, else Needs review when it changed files they have
 * not seen, else Done.
 */
export function statusTag(session: Session): { tag: StatusTag; manual: boolean } {
  // `connecting` is Working only for a chat that has never answered (being created); a chat that
  // has (`acpSessionId`) is reopening, which is housekeeping: it keeps its tag and its place.
  if (session.status === "running" || (session.status === "connecting" && !session.acpSessionId)) return { tag: "working", manual: false };
  if (session.status === "waiting") return { tag: "waiting", manual: false };
  if (session.status === "error") return { tag: "failed", manual: false };
  if (session.statusOverride) return { tag: session.statusOverride, manual: true };
  return { tag: isUnread(session) && session.changedFiles > 0 ? "review" : "done", manual: false };
}

const LIVE: ReadonlySet<StatusTag> = new Set(["working", "waiting"]);

/**
 * Recents: pinned chats, then every other listed chat, what is live first, the rest by activity
 * and Done after them, cut at `RECENTS_LIMIT` unless expanded; then the folder sections. The
 * filters, hidden folders and the archived rule are `sidebarSections`' own, so a chat Recents
 * leaves out is one the folders leave out too, and a pinned chat is listed once.
 */
export function recentsSections(input: {
  sessions: readonly Session[];
  projects: readonly Project[];
  filters: SidebarSettings;
  hidden?: readonly string[];
  expanded: boolean;
}): SidebarSection[] {
  const byFolder = sidebarSections({
    sessions: input.sessions,
    projects: input.projects,
    filters: { ...input.filters, groupBy: "project" },
    ...(input.hidden ? { hidden: input.hidden } : {}),
  });
  const pinned = byFolder.filter((section) => section.kind === "pinned");
  const folders = byFolder.filter((section) => section.kind === "project");
  const rank = (session: Session) => {
    const { tag } = statusTag(session);
    return LIVE.has(tag) ? 0 : tag === "done" ? 2 : 1;
  };
  const ordered = folders
    .flatMap((section) => section.sessions)
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  const shown = input.expanded ? ordered : ordered.slice(0, RECENTS_LIMIT);
  return [
    ...pinned,
    { id: "recents", kind: "recents", name: "Recents", project: null, sessions: shown, pinned: false, more: ordered.length - shown.length },
    ...folders,
  ];
}

/**
 * Where the folders split in two: "Pinned folders" over the first pinned one, and a hairline
 * with "Folders" over the first of the rest. Only when both kinds are listed; a sidebar with no
 * pinned folder, or only pinned ones, has nothing to tell apart.
 */
export function folderGroupLabel(sections: readonly SidebarSection[], index: number): "Pinned folders" | "Folders" | null {
  const folders = sections.filter((section) => section.kind === "project");
  if (!folders.some((section) => section.pinned) || folders.every((section) => section.pinned)) return null;
  const section = sections[index];
  if (section?.kind !== "project") return null;
  const first = (pinned: boolean) => sections.findIndex((candidate) => candidate.kind === "project" && candidate.pinned === pinned);
  if (section.pinned && index === first(true)) return "Pinned folders";
  if (!section.pinned && index === first(false)) return "Folders";
  return null;
}

function matchesStatus(session: Session, filters: SidebarSettings): boolean {
  switch (filters.status) {
    case "active":
      return !session.archived;
    case "archived":
      return session.archived;
    case "all":
      return true;
  }
}

/**
 * `local` is both git modes that run in the project's own directory: whether
 * that directory happens to be a checkout is a fact about the project, not a
 * third environment (the same argument `GIT_MODE_LABELS` makes).
 */
function matchesEnvironment(session: Session, filters: SidebarSettings): boolean {
  switch (filters.environment) {
    case "all":
      return true;
    case "worktree":
      return session.gitMode === "worktree";
    case "local":
      return session.gitMode !== "worktree";
  }
}

/** A new array, always: the input is a store's own list. */
function sort(sessions: readonly Session[], by: SidebarSortBy): Session[] {
  const rows = [...sessions];
  switch (by) {
    case "activity":
      return rows.sort((a, b) => b.updatedAt - a.updatedAt || compareTitles(a, b));
    case "created":
      return rows.sort((a, b) => b.createdAt - a.createdAt || compareTitles(a, b));
    case "name":
      return rows.sort((a, b) => compareTitles(a, b));
  }
}

/**
 * Titles as a person reads them, and the id as the tiebreak so the order is
 * total: two threads can share a title, and a sort that left them in index
 * order would reshuffle the list every time the index came back over IPC.
 */
function compareTitles(a: Session, b: Session): number {
  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
}

/* -------------------------------------------------------------------------- */
/* The state glyph                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The leading glyph on a session row, from the index's status:
 *
 *   - `idle`        a hollow circle — nothing to say, and the row it is on is
 *                   the common case, so it must be the quietest mark;
 *   - `running`     a filled dot that pulses;
 *   - `waiting`     an accent-coloured ringed dot ("needs you"): the agent
 *                   is blocked on the person, which is the one state a
 *                   sidebar exists to surface — and not a warning, so not
 *                   amber and not a triangle;
 *   - `error`       a red triangle;
 *   - `connecting`  a hollow circle with a spinner ring around it.
 *
 * `closed` is `idle`: an adapter that is not running is not a state the person
 * has to do anything about — the next prompt reconnects it (plan §5).
 */
export type SessionGlyph = "idle" | "running" | "waiting" | "error" | "connecting";

export function sessionGlyphFor(status: SessionStatus): SessionGlyph {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "error":
      return "error";
    case "connecting":
      return "connecting";
    case "idle":
    case "closed":
      return "idle";
  }
}

/** What the glyph's label says, for the tooltip and for the accessible name. */
export const SESSION_GLYPH_LABELS: Record<SessionGlyph, string> = {
  idle: "Idle",
  running: "Working",
  waiting: "Waiting for you",
  error: "Failed",
  connecting: "Connecting",
};
