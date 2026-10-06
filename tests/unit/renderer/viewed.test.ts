import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackViewed } from "@renderer/state/viewed";
import { useSessions } from "@renderer/state/sessions";
import { useUi } from "@renderer/state/ui";
import type { Session } from "@shared/types";

/** The open chat counts as seen while the window has focus (the Recents unread dot). */
const row = (overrides: Partial<Session>): Session => ({
  id: "s1", projectId: "p1", titleSource: "prompt", agentId: "claude-code", cwd: "/repo", gitMode: "none", title: "S1",
  createdAt: 0, updatedAt: 10, status: "idle", acpSessionId: "acp", changedFiles: 0, insertions: 0, deletions: 0,
  archived: false, pinned: false, sessionHead: null, turnHead: null, lastViewedAt: 5, statusOverride: null, ...overrides,
});

let focused = true;
let stop: () => void;
beforeEach(() => {
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.mocked(window.workbench.sessions.markViewed).mockClear();
  useSessions.setState({ sessions: [row({})], ready: true, activeId: null });
  useUi.setState({ surface: { kind: "home" } });
  stop = trackViewed();
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe("marking the open chat viewed", () => {
  it("marks it when opened with the window focused", () => {
    useSessions.setState({ activeId: "s1" });
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "s1" });
  });

  it("leaves it unread while the window is in the background, and marks it on focus", () => {
    focused = false;
    useSessions.setState({ activeId: "s1" });
    useSessions.setState({ sessions: [row({ updatedAt: 20 })] });
    expect(window.workbench.sessions.markViewed).not.toHaveBeenCalled();
    focused = true;
    window.dispatchEvent(new Event("focus"));
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "s1" });
  });

  it("marks it again when something happens in it while it is open", () => {
    useSessions.setState({ activeId: "s1", sessions: [row({ lastViewedAt: 10 })] });
    vi.mocked(window.workbench.sessions.markViewed).mockClear();
    useSessions.setState({ sessions: [row({ updatedAt: 30, lastViewedAt: 10 })] });
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledTimes(1);
  });

  it("does not mark a chat that is not open", () => {
    useSessions.setState({ sessions: [row({ updatedAt: 30, lastViewedAt: 10 })] });
    expect(window.workbench.sessions.markViewed).not.toHaveBeenCalled();
  });

  it("does not count a chat as seen while another page covers it, and does on coming back", () => {
    useSessions.setState({ activeId: "s1", sessions: [row({ lastViewedAt: 10 })] });
    vi.mocked(window.workbench.sessions.markViewed).mockClear();
    useUi.setState({ surface: { kind: "plugins", view: "browse" } });
    useSessions.setState({ sessions: [row({ updatedAt: 30, lastViewedAt: 10 })] });
    expect(window.workbench.sessions.markViewed).not.toHaveBeenCalled();
    useUi.setState({ surface: { kind: "home" } });
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "s1" });
  });
});

describe("two chats side by side", () => {
  it("marks both viewed when the window comes back with them on screen", () => {
    useSessions.setState({ sessions: [row({ id: "a" }), row({ id: "b" })], activeId: "b", split: { left: "a", right: "b", focus: "right" } });
    vi.mocked(window.workbench.sessions.markViewed).mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "a" });
    expect(window.workbench.sessions.markViewed).toHaveBeenCalledWith({ id: "b" });
    useSessions.setState({ split: null });
  });
});
