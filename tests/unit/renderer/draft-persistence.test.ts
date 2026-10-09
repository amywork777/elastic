import { beforeEach, describe, expect, it, vi } from "vitest";

import { newSessionKey, persistDrafts, restoreDrafts, useComposer } from "@renderer/state/composer";
import { useSessions } from "@renderer/state/sessions";
import type { Session } from "@shared/types";

/** A half-typed prompt survives a quit: saved as it changes, back in its box at launch. */
const row = (id: string, projectId = "/repo"): Session => ({
  id, projectId, titleSource: "prompt", agentId: "claude-code", cwd: projectId, gitMode: "none", title: id,
  createdAt: 0, updatedAt: 0, status: "idle", acpSessionId: "acp", changedFiles: 0, insertions: 0, deletions: 0,
  archived: false, pinned: false, sessionHead: null, turnHead: null, lastViewedAt: null, statusOverride: null,
});
const reference = { resource: { kind: "workspace-file", workspaceId: "w", path: "part.step" }, target: { kind: "whole-resource" } };
const set = () => vi.mocked(window.workbench.drafts.set);
/** Let the save's microtask run. */
const settle = () => Promise.resolve();

beforeEach(async () => {
  useSessions.setState({ sessions: [row("s1"), row("s2")], ready: true, activeId: null });
  useComposer.setState({ drafts: {}, referenceLabels: {}, draftRoots: {}, annotations: {}, queues: {}, paused: {} });
  // An empty disk, so what one test saved does not stand for the next one's.
  await restoreDrafts();
  set().mockClear();
});

describe("drafts across a quit", () => {
  it("restores text, labels, workspace and notes, for chats and projects that are still listed", async () => {
    vi.mocked(window.workbench.drafts.list).mockResolvedValueOnce({
      s1: { text: "half typed @part.step ", labels: { "@part.step": "Bracket" }, root: "/repo/wt",
        annotations: [{ id: "n1", references: [reference], text: "round this" }] },
      [newSessionKey("/repo")]: { text: "for a new chat" },
      [newSessionKey("/elsewhere")]: { text: "project gone" },
      gone: { text: "chat deleted while shut" },
    });
    await restoreDrafts();
    const state = useComposer.getState();
    expect(state.drafts.s1).toBe("half typed @part.step ");
    expect(state.referenceLabels.s1).toEqual({ "@part.step": "Bracket" });
    expect(state.draftRoots.s1).toBe("/repo/wt");
    expect(state.annotations.s1).toEqual([{ id: "n1", references: [reference], text: "round this" }]);
    expect(state.drafts[newSessionKey("/repo")]).toBe("for a new chat");
    expect(state.drafts.gone).toBeUndefined();
    expect(state.drafts[newSessionKey("/elsewhere")]).toBeUndefined();
    // The ones with nowhere to go are taken off the disk too.
    expect(set()).toHaveBeenCalledWith({ key: "gone", draft: null });
    expect(set()).toHaveBeenCalledWith({ key: newSessionKey("/elsewhere"), draft: null });
  });

  it("leaves a box typed into since launch alone, and saves that instead", async () => {
    useComposer.setState({ drafts: { s1: "typed now" } });
    vi.mocked(window.workbench.drafts.list).mockResolvedValueOnce({ s1: { text: "from before" }, s2: { text: "kept" } });
    await restoreDrafts();
    expect(useComposer.getState().drafts.s1).toBe("typed now");
    expect(useComposer.getState().drafts.s2).toBe("kept");
    set().mockClear();
    const stop = persistDrafts();
    await settle();
    // What the restore read and put back is not written again; the newer box is.
    expect(set().mock.calls).toEqual([[{ key: "s1", draft: { text: "typed now" } }]]);
    stop();
  });

  it("saves each change before the task yields, one write for one edit, and deletes an emptied draft", async () => {
    const stop = persistDrafts();
    useComposer.getState().setDraft("s1", "h");
    useComposer.getState().setDraft("s1", "hi");
    // Not yet: the write waits for the microtask, so the two changes above are one write…
    expect(set()).not.toHaveBeenCalled();
    await settle();
    // …and no timer: it is sent before anything else (a quit) can run.
    expect(set().mock.calls).toEqual([[{ key: "s1", draft: { text: "hi" } }]]);

    set().mockClear();
    const file = new File(["x"], "sketch.png", { type: "image/png" });
    useComposer.setState((state) => ({ annotations: { ...state.annotations, s1: [{ id: "n1", references: [reference as never], text: "here", image: file }] } }));
    await settle();
    // The sketch is a renderer-only File and is left out.
    expect(set()).toHaveBeenLastCalledWith({ key: "s1", draft: { text: "hi", annotations: [{ id: "n1", references: [reference], text: "here" }] } });

    set().mockClear();
    useComposer.getState().takeDraft("s1");
    await settle();
    expect(set().mock.calls).toEqual([[{ key: "s1", draft: null }]]);
    stop();
  });

  it("deletes the stored copy of a chat that is deleted", async () => {
    const stop = persistDrafts();
    useComposer.getState().setDraft("s2", "never sent");
    await settle();
    set().mockClear();
    useSessions.setState({ sessions: [row("s1")] });
    await settle();
    expect(useComposer.getState().drafts.s2).toBeUndefined();
    expect(set().mock.calls).toEqual([[{ key: "s2", draft: null }]]);
    stop();
  });

  it("does not write when nothing kept changed", async () => {
    const stop = persistDrafts();
    useComposer.getState().setDraft("s1", "same");
    await settle();
    set().mockClear();
    // setDraft rebuilds the outer records on every call; the draft itself is the same.
    useComposer.getState().setDraft("s1", "same");
    useComposer.getState().setDraft("s2", "");
    await settle();
    expect(set()).not.toHaveBeenCalled();
    stop();
  });
});
