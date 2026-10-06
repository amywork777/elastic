import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistQueues, restoreQueues, useComposer } from "@renderer/state/composer";
import { useSessions } from "@renderer/state/sessions";
import type { Session } from "@shared/types";

/** Prompts queued behind a turn survive a quit: saved as they change, back paused at launch. */
const row = (id: string): Session => ({
  id, projectId: "p1", titleSource: "prompt", agentId: "claude-code", cwd: "/repo", gitMode: "none", title: id,
  createdAt: 0, updatedAt: 0, status: "idle", acpSessionId: "acp", changedFiles: 0, insertions: 0, deletions: 0,
  archived: false, pinned: false, sessionHead: null, turnHead: null,
});
const prompt = (id: string, text: string) => ({ id, text, content: [{ type: "text" as const, text }] });

beforeEach(() => {
  useSessions.setState({ sessions: [row("s1"), row("s2")], ready: true, activeId: null });
  useComposer.setState({ queues: {}, paused: {} });
  vi.mocked(window.workbench.queues.set).mockClear();
});
afterEach(() => vi.useRealTimers());

describe("queued prompts across a quit", () => {
  it("restores a saved queue paused, for a chat that is still listed only", async () => {
    vi.mocked(window.workbench.queues.list).mockResolvedValueOnce({
      s1: [prompt("q1", "first"), prompt("q2", "second")],
      gone: [prompt("q3", "orphan")],
    });
    await restoreQueues();
    const state = useComposer.getState();
    expect(state.queues.s1?.map((item) => item.text)).toEqual(["first", "second"]);
    expect(state.paused.s1).toBe(true);
    expect(state.queues.gone).toBeUndefined();
  });

  it("leaves a queue typed since launch alone", async () => {
    useComposer.setState({ queues: { s1: [prompt("new", "typed now")] } });
    vi.mocked(window.workbench.queues.list).mockResolvedValueOnce({ s1: [prompt("old", "from before")] });
    await restoreQueues();
    expect(useComposer.getState().queues.s1?.map((item) => item.text)).toEqual(["typed now"]);
    expect(useComposer.getState().paused.s1).toBeUndefined();
  });

  it("saves a changed queue once it settles, without the draft, and an emptied one as empty", async () => {
    vi.useFakeTimers();
    const stop = persistQueues();
    const file = new File(["x"], "x.png");
    useComposer.setState({ queues: { s1: [{ ...prompt("q1", "one"), draft: { text: "one", annotations: [], files: [file] } }] } });
    useComposer.setState({ queues: { s1: [prompt("q1", "one"), prompt("q2", "two")] } });
    expect(window.workbench.queues.set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(window.workbench.queues.set).toHaveBeenCalledTimes(1);
    expect(window.workbench.queues.set).toHaveBeenLastCalledWith({ sessionId: "s1", queue: [prompt("q1", "one"), prompt("q2", "two")] });

    useComposer.setState({ queues: { s1: [] } });
    stop(); // pending saves are written on the way out
    expect(window.workbench.queues.set).toHaveBeenLastCalledWith({ sessionId: "s1", queue: [] });
  });
});
