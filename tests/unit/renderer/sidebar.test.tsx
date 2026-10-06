import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "@workbench/ui/primitives/tooltip";
import { Sidebar } from "@renderer/features/sidebar/Sidebar";
import { RECENTS_LIMIT, SESSION_GLYPH_LABELS, folderGroupLabel, isUnread, listedSessions, recentsSections, sessionGlyphFor, sidebarSections, statusTag } from "@renderer/lib/sidebar";
import { runUiCommand } from "@renderer/state/bridge";
import { useExplorer } from "@renderer/state/explorer";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import { useSettings } from "@renderer/state/settings";
import { useUi } from "@renderer/state/ui";
import {
  SidebarSettingsSchema,
  defaultSettings,
  type Project,
  type Session,
  type Settings,
  type SessionStatus,
  type SidebarSettings,
} from "@shared/types";

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

const project = (id: string, name = id): Project => ({
  id,
  name,
  path: `/tmp/${id}`,
  createdAt: 0,
});

const session = (overrides: Partial<Session> & { id: string; title: string }): Session => ({
  projectId: "p1",
  titleSource: "prompt",
  agentId: "codex",
  cwd: "/repo",
  gitMode: "none",
  createdAt: 0,
  updatedAt: 0,
  status: "idle",
  acpSessionId: "acp",
  changedFiles: 0,
  insertions: 0,
  deletions: 0,
  archived: false,
  pinned: false,
  sessionHead: null,
  turnHead: null, lastViewedAt: null, statusOverride: null,
  ...overrides,
});

/** Folders unless a test asks for Recents: most tests here are about the folder sections. */
const filters = (overrides: Partial<SidebarSettings> = {}): SidebarSettings =>
  SidebarSettingsSchema.parse({ groupBy: "project", ...overrides });

/* -------------------------------------------------------------------------- */
/* The selector                                                                */
/* -------------------------------------------------------------------------- */

describe("sidebarSections", () => {
  const projects = [project("p1", "elastic"), project("p2", "tom-cad")];

  it("puts one section per project, in the project list's own order", () => {
    const sections = sidebarSections({
      projects,
      filters: filters(),
      sessions: [
        session({ id: "a", title: "Alpha" }),
        session({ id: "b", title: "Beta", projectId: "p2" }),
      ],
    });
    expect(sections.map((section) => [section.kind, section.name])).toEqual([
      ["project", "elastic"],
      ["project", "tom-cad"],
    ]);
    expect(sections[0]!.sessions.map((row) => row.id)).toEqual(["a"]);
    expect(sections[1]!.sessions.map((row) => row.id)).toEqual(["b"]);
  });

  it("lifts a pinned thread into Pinned and leaves it out of its project", () => {
    const sections = sidebarSections({
      projects,
      filters: filters(),
      sessions: [
        session({ id: "a", title: "Alpha", pinned: true }),
        session({ id: "b", title: "Beta" }),
      ],
    });
    expect(sections[0]!.kind).toBe("pinned");
    expect(sections[0]!.sessions.map((row) => row.id)).toEqual(["a"]);
    // Not in both places: a pinned row that stayed under its project would
    // just be a duplicate of itself.
    const inProject = sections.find((s) => s.id === "p1")!.sessions.map((row) => row.id);
    expect(inProject).toEqual(["b"]);
  });

  it("has no Pinned section when nothing is pinned", () => {
    const sections = sidebarSections({
      projects,
      filters: filters(),
      sessions: [session({ id: "a", title: "Alpha" })],
    });
    expect(sections.some((s) => s.kind === "pinned")).toBe(false);
  });

  it("filters by status", () => {
    const sessions = [
      session({ id: "live", title: "Live" }),
      session({ id: "old", title: "Old", archived: true }),
    ];
    const ids = (status: SidebarSettings["status"]) =>
      sidebarSections({ projects, filters: filters({ status }), sessions })
        .flatMap((section) => section.sessions)
        .map((row) => row.id);
    expect(ids("active")).toEqual(["live"]);
    expect(ids("archived")).toEqual(["old"]);
    expect(ids("all").sort()).toEqual(["live", "old"]);
  });

  it("filters by environment, with both local git modes counting as local", () => {
    const sessions = [
      session({ id: "none", title: "Plain", gitMode: "none" }),
      session({ id: "checkout", title: "Checkout", gitMode: "checkout" }),
      session({ id: "tree", title: "Tree", gitMode: "worktree" }),
    ];
    const ids = (environment: SidebarSettings["environment"]) =>
      sidebarSections({ projects, filters: filters({ environment }), sessions })
        .flatMap((section) => section.sessions)
        .map((row) => row.id)
        .sort();
    expect(ids("all")).toEqual(["checkout", "none", "tree"]);
    expect(ids("local")).toEqual(["checkout", "none"]);
    expect(ids("worktree")).toEqual(["tree"]);
  });

  it("collapses the projects into one list when the grouping says none", () => {
    const sections = sidebarSections({
      projects,
      filters: filters({ groupBy: "none" }),
      sessions: [
        session({ id: "a", title: "Alpha", updatedAt: 1 }),
        session({ id: "b", title: "Beta", projectId: "p2", updatedAt: 2 }),
      ],
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe("all");
    expect(sections[0]!.project).toBeNull();
    expect(sections[0]!.sessions.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("sorts inside every section, Pinned included", () => {
    const sessions = [
      session({ id: "a", title: "Zulu", createdAt: 3, updatedAt: 1 }),
      session({ id: "b", title: "Alpha", createdAt: 1, updatedAt: 3 }),
      session({ id: "c", title: "Mike", createdAt: 2, updatedAt: 2, pinned: true }),
      session({ id: "d", title: "Bravo", createdAt: 4, updatedAt: 0, pinned: true }),
    ];
    const order = (sortBy: SidebarSettings["sortBy"], id: string) =>
      sidebarSections({ projects, filters: filters({ sortBy }), sessions })
        .find((section) => section.id === id)!
        .sessions.map((row) => row.id);
    expect(order("activity", "p1")).toEqual(["b", "a"]);
    expect(order("created", "p1")).toEqual(["a", "b"]);
    expect(order("name", "p1")).toEqual(["b", "a"]);
    expect(order("activity", "pinned")).toEqual(["c", "d"]);
    expect(order("name", "pinned")).toEqual(["d", "c"]);
  });

  it("never shows a group without matching unpinned sessions, including old settings", () => {
    const sessions = [session({ id: "a", title: "Alpha" })];
    expect(sidebarSections({ projects, filters: SidebarSettingsSchema.parse({ showEmptyGroups: true }), sessions })
      .map(section => section.id)).toEqual(["p1"]);
    expect(sidebarSections({ projects, filters: filters(), sessions: [{ ...sessions[0]!, pinned: true }] })
      .map(section => section.id)).toEqual(["pinned"]);
    expect(sidebarSections({ projects, filters: filters(), sessions: [{ ...sessions[0]!, archived: true }] }))
      .toEqual([]);
  });

  it("puts pinned folders first, in the order they were pinned, and keeps one with nothing to show", () => {
    const three = [project("p1", "elastic"), project("p2", "tom-cad"), project("p3", "notes")];
    const sections = sidebarSections({
      projects: three,
      filters: filters({ pinnedProjects: ["p3", "p2", "gone"] }),
      sessions: [
        session({ id: "a", title: "Alpha" }),
        session({ id: "b", title: "Beta", projectId: "p2" }),
        // Its only session is archived, so the folder is listed only because it is pinned.
        session({ id: "c", title: "Gamma", projectId: "p3", archived: true }),
      ],
    });
    expect(sections.map((section) => [section.id, section.pinned, section.sessions.length])).toEqual([
      ["p3", true, 0],
      ["p2", true, 1],
      ["p1", false, 1],
    ]);
    // A pin for a folder no session names any more is ignored, not drawn.
    expect(sections.some((section) => section.id === "gone")).toBe(false);
  });

  it("labels pinned folders apart from the rest, only when there are both", () => {
    const three = [project("p1", "a"), project("p2", "b"), project("p3", "c")];
    const sessions = [
      session({ id: "pin", title: "Pinned chat", pinned: true }),
      session({ id: "a", title: "A" }),
      session({ id: "b", title: "B", projectId: "p2" }),
      session({ id: "c", title: "C", projectId: "p3" }),
    ];
    const labels = (pinnedProjects: string[]) => {
      const sections = sidebarSections({ projects: three, sessions, filters: filters({ pinnedProjects }) });
      return sections.map((section, index) => [section.id, folderGroupLabel(sections, index)]);
    };
    // The pinned chats' section is not a folder and gets no label.
    expect(labels(["p3", "p2"])).toEqual([["pinned", null], ["p3", "Pinned folders"], ["p2", null], ["p1", "Folders"]]);
    expect(labels([])).toEqual([["pinned", null], ["p1", null], ["p2", null], ["p3", null]]);
    expect(labels(["p1", "p2", "p3"]).every(([, label]) => label === null)).toBe(true);
  });

  it("lets hiding beat pinning", () => {
    const sections = sidebarSections({
      projects,
      filters: filters({ pinnedProjects: ["p2"] }),
      hidden: ["p2"],
      sessions: [session({ id: "a", title: "Alpha" }), session({ id: "b", title: "Beta", projectId: "p2" })],
    });
    expect(sections.map((section) => section.id)).toEqual(["p1"]);
  });

  it("leaves a hidden folder out of the groups and the flat list, keeps its pinned rows, and archives nothing", () => {
    const sessions = [
      session({ id: "a", title: "Alpha" }),
      session({ id: "b", title: "Beta", projectId: "p2" }),
      session({ id: "c", title: "Pinned one", pinned: true }),
    ];
    const hidden = ["p1"];
    expect(sidebarSections({ projects, filters: filters(), sessions, hidden }).map((section) => section.id)).toEqual(["pinned", "p2"]);
    const flat = sidebarSections({ projects, filters: filters({ groupBy: "none" }), sessions, hidden });
    expect(flat.find((section) => section.id === "all")?.sessions.map((row) => row.id)).toEqual(["b"]);
    expect(sessions.every((row) => !row.archived)).toBe(true);
  });

});

/* -------------------------------------------------------------------------- */
/* The state glyph                                                             */
/* -------------------------------------------------------------------------- */

describe("listedSessions and Mod+1..9", () => {
  const projects = [project("p1", "elastic"), project("p2", "tom-cad")];
  const sessions = [
    session({ id: "pin", title: "Pinned one", projectId: "p2", pinned: true }),
    session({ id: "a", title: "Alpha" }),
    session({ id: "b", title: "Beta", projectId: "p2" }),
    session({ id: "c", title: "Gamma", projectId: "p2" }),
  ];

  it("counts the rows as drawn: Pinned first, then each folder, a collapsed folder's rows skipped", () => {
    const sections = sidebarSections({ projects, sessions, filters: filters({ sortBy: "name" }) });
    expect(listedSessions(sections, []).map((row) => row.id)).toEqual(["pin", "a", "b", "c"]);
    expect(listedSessions(sections, ["p1"]).map((row) => row.id)).toEqual(["pin", "b", "c"]);
  });

  it("opens the nth row, 9 the last, and leaves Settings and a plugin's page for it", () => {
    useProjects.setState({ projects, ready: true, activeId: "p1", draft: null });
    useSessions.setState({ sessions, ready: true, activeId: "a" });
    useSettings.setState({
      settings: { ...defaultSettings(), sidebar: filters({ sortBy: "name", collapsedProjects: ["p1"] }) },
      ready: true,
    });
    useUi.setState({ route: "settings", surface: { kind: "plugins", view: "browse" } });

    runUiCommand({ command: "select-session", index: 2 });
    expect(useSessions.getState().activeId).toBe("b");
    expect(useProjects.getState().activeId).toBe("p2");
    expect(useUi.getState().route).toBe("app");
    expect(useUi.getState().surface).toEqual({ kind: "home" });

    runUiCommand({ command: "select-session", index: 9 });
    expect(useSessions.getState().activeId).toBe("c");

    // A number past the last row is not the last row: nothing moves.
    runUiCommand({ command: "select-session", index: 5 });
    expect(useSessions.getState().activeId).toBe("c");
  });
});

describe("sessionGlyphFor", () => {
  it("maps every status a session row can have", () => {
    const expected: Record<SessionStatus, string> = {
      idle: "idle",
      // An adapter that is not running is nothing for the person to do:
      // the next prompt reconnects it.
      closed: "idle",
      running: "running",
      waiting: "waiting",
      error: "error",
      connecting: "connecting",
    };
    for (const [status, glyph] of Object.entries(expected)) {
      expect(sessionGlyphFor(status as SessionStatus), status).toBe(glyph);
    }
  });

  it("labels each glyph, so the mark is not the only way to read it", () => {
    expect(SESSION_GLYPH_LABELS.waiting).toBe("Waiting for you");
    expect(Object.values(SESSION_GLYPH_LABELS).every((label) => label.length > 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

describe("Sidebar", () => {
  beforeEach(() => {
    useProjects.setState({ projects: [], ready: true, activeId: null, draft: null });
    useSessions.setState({ sessions: [], ready: true, activeId: null });
    useSettings.setState({ settings: { ...defaultSettings(), sidebar: filters() }, ready: true });
    useUi.setState({
      route: "app",
      settingsSection: "general",
      commandPaletteOpen: false,
      commandPaletteQuery: "",
    });
  });

  const withProject = () => {
    useProjects.setState({
      projects: [project("p1", "elastic")],
      ready: true,
      activeId: "p1",
    });
  };

  /**
   * The chooser is `Open folder…` on the project chip's menu, and with no
   * projects it is the main area's button — the panel says it is empty and
   * does not repeat that button.
   */
  it("says it is empty when there are no projects, without a second chooser", () => {
    wrap(<Sidebar />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open folder…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add project" })).not.toBeInTheDocument();

    withProject();
    wrap(<Sidebar />);
    expect(screen.queryByRole("button", { name: "Add project" })).not.toBeInTheDocument();
  });

  it("says the filters hide everything, and clears them, instead of offering a folder", async () => {
    const user = userEvent.setup();
    useProjects.setState({ projects: [project("p1", "elastic")], ready: true, activeId: "p1", draft: null });
    useSessions.setState({ sessions: [session({ id: "s1", title: "Bracket" })], ready: true, activeId: null });
    useSettings.setState({ settings: { ...defaultSettings(), sidebar: filters({ status: "archived" }) }, ready: true });
    vi.mocked(window.workbench.settings.set).mockImplementationOnce(async (patch) => ({ ...useSettings.getState().settings!, ...(patch as Partial<Settings>) }));
    wrap(<Sidebar />);

    expect(screen.getByText("No sessions match these filters")).toBeInTheDocument();
    expect(screen.queryByText("No sessions yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open folder…" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(useSettings.getState().settings?.sidebar).toMatchObject({ status: "active", environment: "all" });
    expect(screen.getByText("Bracket")).toBeInTheDocument();
  });

  it("shows a just-picked folder as a pending group, not as no sessions", () => {
    const draft = project("d1", "gearbox");
    useProjects.setState({ projects: [], ready: true, activeId: "d1", draft });
    wrap(<Sidebar />);

    expect(screen.getByText("gearbox · new session")).toBeInTheDocument();
    expect(screen.queryByText("No sessions yet")).toBeNull();
  });

  it("starts a thread from `New`, not from `New session`", () => {
    wrap(<Sidebar />);
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New session" })).not.toBeInTheDocument();
  });

  it("does not show an empty directory group", () => {
    withProject();
    wrap(<Sidebar />);
    expect(screen.queryByRole("button", { name: "elastic", expanded: true })).not.toBeInTheDocument();
    // What shows instead is the panel's own empty card, not a group's.
    expect(screen.getByText("No sessions yet").closest("[data-sidebar-empty]")).not.toBeNull();
  });

  it("lists a project's threads flat, newest first, and hides archived ones", () => {
    withProject();
    useSessions.setState({
      sessions: [
        session({ id: "s1", title: "Session 1", updatedAt: 1 }),
        session({ id: "s2", title: "Session 2", updatedAt: 2 }),
        session({ id: "gone", title: "Archived one", archived: true, updatedAt: 100 }),
      ],
      ready: true,
      activeId: "s2",
    });
    wrap(<Sidebar />);
    expect(screen.getAllByText(/^Session \d$/).map((node) => node.textContent)).toEqual([
      "Session 2",
      "Session 1",
    ]);
    expect(screen.queryByText("Archived one")).not.toBeInTheDocument();
  });

  it("draws the state glyph and git's, so neither hides the other", () => {
    withProject();
    useSessions.setState({
      sessions: [
        session({ id: "a", title: "Busy", status: "running" }),
        session({ id: "b", title: "Asked", status: "waiting" }),
        session({ id: "c", title: "Broken", status: "error" }),
        session({ id: "d", title: "Tree", gitMode: "worktree", branch: "elastic/x" }),
        session({ id: "e", title: "Branch", gitMode: "checkout", branch: "main" }),
      ],
      ready: true,
      activeId: null,
    });
    wrap(<Sidebar />);
    // The glyph is drawn only; its word is the title button's description.
    expect(screen.getByRole("button", { name: "Busy" })).toHaveAccessibleDescription("Working");
    expect(screen.getByRole("button", { name: "Asked" })).toHaveAccessibleDescription("Waiting for you");
    expect(screen.getByRole("button", { name: "Broken" })).toHaveAccessibleDescription("Failed");
    expect(screen.getByLabelText(/^Worktree/)).toBeInTheDocument();
    expect(screen.getByLabelText("main")).toBeInTheDocument();
  });

  it("marks a waiting thread as needing the person, not as a warning", () => {
    withProject();
    useSessions.setState({
      sessions: [session({ id: "b", title: "Asked", status: "waiting" })],
      ready: true,
      activeId: null,
    });
    wrap(<Sidebar />);
    const glyph = document.querySelector('[data-session-glyph="waiting"] svg')!;
    expect(glyph.getAttribute("class")).toContain("text-info");
    expect(glyph.getAttribute("class")).not.toContain("warning");
  });

  it("marks the session on screen with aria-current, and only it", () => {
    withProject();
    useSessions.setState({ sessions: [session({ id: "s1", title: "One" }), session({ id: "s2", title: "Two" })], ready: true, activeId: "s2" });
    wrap(<Sidebar />);
    expect(screen.getByRole("button", { name: "Two" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "One" })).not.toHaveAttribute("aria-current");
  });

  it("rings the row for keyboard focus, not the title button inside it", () => {
    withProject();
    useSessions.setState({ sessions: [session({ id: "s1", title: "One" })], ready: true, activeId: null });
    wrap(<Sidebar />);
    const row = document.querySelector('[data-session-row="s1"]')!;
    const title = screen.getByRole("button", { name: "One" });
    expect(row.getAttribute("class")).toContain("has-[[data-session-row-title]:focus-visible]:ring-2");
    expect(title.getAttribute("class")).not.toContain("ring");
    expect(title.getAttribute("class")).toContain("focus-visible:outline-none");
  });

  it("shows what a thread changed and opens that thread's review from it", async () => {
    const user = userEvent.setup();
    withProject();
    useSessions.setState({
      sessions: [
        session({ id: "s1", title: "Changed", changedFiles: 2, insertions: 9, deletions: 1 }),
        session({ id: "s2", title: "Untouched" }),
      ],
      ready: true,
      activeId: "s2",
    });
    const open = vi.fn(() => null);
    // The strip is still s2's: nothing may open in it.
    useExplorer.setState({ sessionId: "s2", ready: true, tabs: [], open } as never);
    wrap(<Sidebar />);
    const pill = screen.getByRole("button", { name: /Review changes: 2 files changed/ });
    expect(pill).toHaveTextContent("+9−1");
    // The row counts what the agent reported; Review counts git. The name says so.
    expect(pill).toHaveAccessibleName(/Edits the agent reported this session; Review shows the working tree/);
    expect(pill).not.toHaveAttribute("title");
    expect(document.querySelectorAll("[data-session-changes]")).toHaveLength(1);

    await user.click(pill);
    expect(useSessions.getState().activeId).toBe("s1");
    expect(open).not.toHaveBeenCalled();
    // The bridge binds the explorer to the selected session; then it opens.
    useExplorer.setState({ sessionId: "s1", ready: true } as never);
    expect(open).toHaveBeenCalledWith("review", { scope: "session" });
  });

  it("drops a pending review when the selection moves on before the explorer binds", async () => {
    const user = userEvent.setup();
    withProject();
    useSessions.setState({
      sessions: [
        session({ id: "a", title: "Alpha", changedFiles: 1, insertions: 2, deletions: 0 }),
        session({ id: "b", title: "Beta" }),
      ],
      ready: true,
      activeId: "b",
    });
    const open = vi.fn(() => null);
    useExplorer.setState({ sessionId: "b", ready: true, tabs: [], open } as never);
    wrap(<Sidebar />);
    // A's badge, then row B, then row A — all before A's explorer binds.
    await user.click(screen.getByRole("button", { name: /Review changes/ }));
    await user.click(screen.getByRole("button", { name: "Beta" }));
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    useExplorer.setState({ sessionId: "a", ready: true } as never);
    expect(open).not.toHaveBeenCalled();
  });

  it("brings an open review forward instead of opening a second one", async () => {
    const user = userEvent.setup();
    withProject();
    useSessions.setState({
      sessions: [session({ id: "s1", title: "Changed", changedFiles: 1, insertions: 3, deletions: 0 })],
      ready: true,
      activeId: "s1",
    });
    const open = vi.fn(() => null);
    const setActive = vi.fn();
    const update = vi.fn();
    const show = vi.fn();
    useExplorer.setState({
      sessionId: "s1",
      ready: true,
      tabs: [{ id: "r1", kind: "review", scope: "all" }],
      open,
      setActive,
      update,
      show,
    } as never);
    wrap(<Sidebar />);
    const pill = screen.getByRole("button", { name: /Review changes/ });
    // A zero side is not drawn: no red `−0`.
    expect(pill).toHaveTextContent(/^\+3$/);
    await user.click(pill);
    expect(open).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("r1", { scope: "session" });
    expect(setActive).toHaveBeenCalledWith("r1");
  });

  it("collapses a project into its header and writes it to the settings", async () => {
    const user = userEvent.setup();
    const set = vi.fn(async (patch: Record<string, unknown>) => ({
      ...defaultSettings(),
      ...patch,
    }));
    (window.workbench.settings as unknown as Record<string, unknown>).set = set;
    withProject();
    useSessions.setState({
      sessions: [session({ id: "s1", title: "Session 1" })],
      ready: true,
      activeId: null,
    });
    wrap(<Sidebar />);
    // No chevron: the folder glyph is open while the section is, and the row itself toggles.
    expect(document.querySelector("[data-sidebar-section-header] .lucide-chevron-right")).toBeNull();
    expect(document.querySelector("[data-folder-glyph]")).toHaveAttribute("data-folder-glyph", "open");
    await user.click(screen.getByRole("button", { name: "elastic", expanded: true }));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ sidebar: expect.objectContaining({ collapsedProjects: ["p1"] }) }),
    );
    expect(document.querySelector("[data-folder-glyph]")).toHaveAttribute("data-folder-glyph", "shut");
    // Optimistic, so the row is gone before the round trip lands.
    expect(screen.queryByText("Session 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "elastic", expanded: false })).toBeInTheDocument();
  });

  it("pins a folder from its menu: it moves to the top, marked, and Unpin folder undoes it", async () => {
    const user = userEvent.setup();
    const set = vi.fn(async (patch: Record<string, unknown>) => ({ ...defaultSettings(), ...patch }));
    (window.workbench.settings as unknown as Record<string, unknown>).set = set;
    useProjects.setState({ projects: [project("p1", "elastic"), project("p2", "tom-cad")], ready: true, activeId: "p1" });
    useSessions.setState({
      sessions: [session({ id: "s1", title: "One" }), session({ id: "s2", title: "Two", projectId: "p2" })],
      ready: true,
      activeId: null,
    });
    wrap(<Sidebar />);
    const order = () =>
      [...document.querySelectorAll<HTMLElement>("[data-sidebar-section]")].map((section) => section.dataset.sidebarSection);
    expect(order()).toEqual(["p1", "p2"]);

    await user.click(screen.getByRole("button", { name: "More for tom-cad" }));
    await user.click(screen.getByRole("menuitem", { name: "Pin folder" }));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ sidebar: expect.objectContaining({ pinnedProjects: ["p2"] }) }),
    );
    expect(order()).toEqual(["p2", "p1"]);
    expect(document.querySelector('[data-sidebar-section="p2"] [data-folder-pin]')).not.toBeNull();
    // The name is the folder's alone: pinning is a mark, not a word in it.
    expect(screen.getByRole("button", { name: /^tom-cad/, expanded: true })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More for tom-cad" }));
    await user.click(screen.getByRole("menuitem", { name: "Unpin folder" }));
    expect(order()).toEqual(["p1", "p2"]);
  });

  it("lists a pinned folder whose chats are all archived, with a way to start one", () => {
    withProject();
    useSettings.setState({ settings: { ...defaultSettings(), sidebar: filters({ pinnedProjects: ["p1"] }) }, ready: true });
    useSessions.setState({ sessions: [session({ id: "s1", title: "Old", archived: true })], ready: true, activeId: null });
    wrap(<Sidebar />);
    expect(screen.getByText("No chats")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New session in elastic" })).toBeInTheDocument();
    // A row is on screen, so the panel does not also say it is empty.
    expect(screen.queryByText("No sessions yet")).not.toBeInTheDocument();
  });

  it("pins from the row's menu, and the row moves to Pinned", async () => {
    const user = userEvent.setup();
    const setPinned = vi.fn(async () => undefined);
    (window.workbench.sessions as unknown as Record<string, unknown>).setPinned = setPinned;
    withProject();
    useSessions.setState({
      sessions: [session({ id: "s1", title: "Keeper" })],
      ready: true,
      activeId: null,
    });
    const view = wrap(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "Keeper actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(setPinned).toHaveBeenCalledWith({ id: "s1", pinned: true });

    // The index is what moves the row — `sessions.changed` in the app, and
    // the store's own list here.
    useSessions.setState({ sessions: [session({ id: "s1", title: "Keeper", pinned: true })] });
    view.rerender(
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>,
    );
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getAllByText("Keeper")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "elastic", expanded: true })).not.toBeInTheDocument();
  });

  /**
   * Search and the filters act on the whole list, so they are the panel's
   * header and not each project's. A project header carries `+` and nothing
   * else: the glyph that opened the palette with one project's name typed is
   * gone, and so is the per-header copy of a menu whose settings were always
   * global.
   */
  it("keeps search and the filters in the panel's header, not on a project's", async () => {
    const user = userEvent.setup();
    withProject();
    wrap(<Sidebar />);

    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search elastic" })).not.toBeInTheDocument();
    // One filter menu in the panel, whatever the projects are.
    expect(screen.getAllByRole("button", { name: "Filters" })).toHaveLength(1);

    // And it is the global menu: the settings, with no `Project…` submenu.
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("menuitem", { name: /^Status/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Project…" })).not.toBeInTheDocument();
  });

  it("opens the palette from the panel's search glyph, with nothing typed", async () => {
    const user = userEvent.setup();
    withProject();
    wrap(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(useUi.getState().commandPaletteOpen).toBe(true);
    expect(useUi.getState().commandPaletteQuery).toBe("");
  });

  it("starts a thread in the project the `+` belongs to", async () => {
    const user = userEvent.setup();
    useProjects.setState({
      projects: [project("p1", "elastic"), project("p2", "tom-cad")],
      ready: true,
      activeId: "p1",
    });
    useSessions.setState({
      sessions: [session({ id: "s1", title: "Keeper" }), session({ id: "s2", title: "Other", projectId: "p2" })],
      ready: true,
      activeId: "s1",
    });
    wrap(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "New session in tom-cad" }));
    expect(useProjects.getState().activeId).toBe("p2");
    expect(useSessions.getState().activeId).toBeNull();
  });
});

describe("Running now and the Agents panel", () => {
  beforeEach(() => {
    useProjects.setState({ projects: [project("p1", "elastic")], ready: true, activeId: "p1", draft: null });
    useSettings.setState({ settings: { ...defaultSettings(), sidebar: filters({ collapsedProjects: ["p1"] }) }, ready: true });
  });

  it("lists the working chats above the folders, even a collapsed folder's, and opens one on click", async () => {
    const user = userEvent.setup();
    useSessions.setState({
      sessions: [
        session({ id: "a", title: "Quiet", status: "idle" }),
        session({ id: "b", title: "Busy", status: "running", updatedAt: 2 }),
        session({ id: "c", title: "Asking", status: "waiting", updatedAt: 1 }),
        session({ id: "d", title: "Shelved", status: "running", archived: true }),
      ],
      ready: true,
      activeId: null,
    });
    const view = wrap(<Sidebar />);
    const rows = [...view.container.querySelectorAll("[data-running-session]")].map((row) => row.getAttribute("data-running-session"));
    expect(rows).toEqual(["b", "c"]);
    await user.click(screen.getByRole("button", { name: /Busy/ }));
    expect(useSessions.getState().activeId).toBe("b");
  });

  it("draws no Running group when nothing is running", () => {
    useSessions.setState({ sessions: [session({ id: "a", title: "Quiet" })], ready: true, activeId: null });
    const view = wrap(<Sidebar />);
    expect(view.container.querySelector("[data-sidebar-running]")).toBeNull();
  });

  it("opens the panel with every agent process, Stop for a turn going and Close for an idle chat", async () => {
    const user = userEvent.setup();
    useSessions.setState({
      sessions: [session({ id: "b", title: "Busy", status: "running" }), session({ id: "q", title: "Quiet" })],
      ready: true,
      activeId: null,
    });
    vi.mocked(window.workbench.sessions.activity).mockResolvedValue({
      keepAlive: 4,
      processes: [
        { kind: "session", sessionId: "b", agentId: "codex", cwd: "/repo", status: "running", pid: 10, memoryBytes: 300 * 1024 ** 2 },
        { kind: "session", sessionId: "q", agentId: "codex", cwd: "/repo", status: "idle", pid: 11, memoryBytes: 200 * 1024 ** 2 },
        { kind: "spare", sessionId: null, agentId: "codex", cwd: "/repo", status: "idle", pid: 12, memoryBytes: null },
      ],
    });
    wrap(<Sidebar />);
    await user.click(screen.getByRole("button", { name: /Agents running/ }));
    expect(await screen.findByText("3 processes · 500 MB")).toBeInTheDocument();
    expect(screen.getByText("Spare codex")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });
});

describe("recents", () => {
  const projects = [project("p1", "elastic"), project("p2", "vizcom")];
  const at = (minutes: number) => 1_000_000 + minutes * 60_000;

  it("tags a chat from what is happening, and a hand-set tag only once it is finished", () => {
    expect(statusTag(session({ id: "a", title: "A", status: "running" })).tag).toBe("working");
    expect(statusTag(session({ id: "a", title: "A", status: "waiting" })).tag).toBe("waiting");
    expect(statusTag(session({ id: "a", title: "A", status: "error" })).tag).toBe("failed");
    expect(statusTag(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(1), changedFiles: 2 })).tag).toBe("review");
    expect(statusTag(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(9), changedFiles: 2 })).tag).toBe("done");
    expect(statusTag(session({ id: "a", title: "A", status: "running", statusOverride: "done" }))).toEqual({ tag: "working", manual: false });
    expect(statusTag(session({ id: "a", title: "A", statusOverride: "review" }))).toEqual({ tag: "review", manual: true });
  });

  it("reads a never-viewed chat as read, and activity after the last view as unread", () => {
    expect(isUnread(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: null }))).toBe(false);
    expect(isUnread(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(1) }))).toBe(true);
    expect(isUnread(session({ id: "a", title: "A", updatedAt: at(5), lastViewedAt: at(6) }))).toBe(false);
  });

  it("orders pinned, then live chats, then by activity, Done last, and cuts at ten", () => {
    const rows = [
      session({ id: "pin", title: "Pinned", pinned: true, updatedAt: at(1) }),
      session({ id: "run", title: "Running", status: "running", updatedAt: at(2) }),
      session({ id: "done-new", title: "Done new", updatedAt: at(50), lastViewedAt: at(51) }),
      session({ id: "review", title: "Review", updatedAt: at(30), lastViewedAt: at(1), changedFiles: 1 }),
      ...Array.from({ length: 10 }, (_, index) => session({ id: `old${index}`, title: `Old ${index}`, updatedAt: at(3 + index), lastViewedAt: at(1), changedFiles: 1 })),
      session({ id: "archived", title: "Archived", archived: true, updatedAt: at(99) }),
    ];
    const sections = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), expanded: false });
    expect(sections[0]!.sessions.map((row) => row.id)).toEqual(["pin"]);
    const recents = sections.find((section) => section.kind === "recents")!;
    expect(recents.sessions.map((row) => row.id).slice(0, 3)).toEqual(["run", "review", "old9"]);
    expect(recents.sessions).toHaveLength(RECENTS_LIMIT);
    expect(recents.more).toBe(3);
    const all = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), expanded: true });
    const expandedIds = all.find((section) => section.kind === "recents")!.sessions.map((row) => row.id);
    expect(expandedIds.at(-1)).toBe("done-new");
    expect(expandedIds).not.toContain("archived");
    expect(expandedIds).not.toContain("pin");
  });

  it("applies hidden folders and the Environment filter to Recents", () => {
    const rows = [session({ id: "a", title: "A", projectId: "p1" }), session({ id: "b", title: "B", projectId: "p2", gitMode: "worktree" })];
    const hidden = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), hidden: ["p2"], expanded: true });
    expect(hidden.find((s) => s.kind === "recents")!.sessions.map((r) => r.id)).toEqual(["a"]);
    const local = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents", environment: "local" }), expanded: true });
    expect(local.find((s) => s.kind === "recents")!.sessions.map((r) => r.id)).toEqual(["a"]);
  });

  it("numbers Mod+1..9 by the rows on screen, folded Folders left out", () => {
    const rows = Array.from({ length: 12 }, (_, index) => session({ id: `s${index}`, title: `S${index}`, updatedAt: at(index) }));
    const sections = recentsSections({ sessions: rows, projects, filters: filters({ groupBy: "recents" }), expanded: false });
    const listed = listedSessions(sections, [], { foldersCollapsed: true });
    expect(listed).toHaveLength(RECENTS_LIMIT);
    expect(listed[0]!.id).toBe("s11");
  });
});
