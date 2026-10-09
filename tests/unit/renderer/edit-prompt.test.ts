import { describe, expect, it } from "vitest";

import { editHandoff, editPlan, editedBlocks } from "@renderer/lib/edit-prompt";
import { initialSessionState, type Part, type Turn } from "@shared/acp/types";
import { reduce } from "@shared/acp/reduce";

const text = (value: string): Part => ({ type: "text", text: value });
const user = (id: string, value: string, extra: Part[] = []): Turn => ({ id, role: "user", parts: [text(value), ...extra], startedAt: 1, endedAt: 1, stopReason: null });
const agent = (id: string, value: string, replyId?: string): Turn => ({ id, role: "agent", parts: [text(value)], startedAt: 1, endedAt: 2, stopReason: "end_turn", ...(replyId ? { replyId } : {}) });

describe("what an edit of a past prompt starts from", () => {
  const turns = [user("u1", "make it blue"), agent("a1", "blue now", "msg-1"), user("u2", "add a test"), agent("a2", "tested")];

  it("forks at the reply right before the prompt, and says which prompt is the latest", () => {
    expect(editPlan(turns, 2)).toEqual({ forkAt: "msg-1", hasContext: true, latest: true });
  });

  it("starts empty for the first prompt", () => {
    expect(editPlan(turns, 0)).toEqual({ forkAt: null, hasContext: false, latest: false });
  });

  it("has no fork point when the reply before carried no id, or a prompt came right before", () => {
    expect(editPlan([user("u1", "a"), agent("a1", "b"), user("u2", "c")], 2).forkAt).toBeNull();
    // A message sent while the agent worked: forking at the reply before it would drop it.
    expect(editPlan([user("u1", "a"), agent("a1", "b", "msg-1"), user("u2", "c"), user("u3", "d")], 3)).toEqual({ forkAt: null, hasContext: true, latest: true });
  });

  it("hands a refused fork a summary of the turns before the prompt only", () => {
    const handoff = editHandoff({ ...initialSessionState("s", "claude-code"), turns }, 2, { title: "Blue", agentName: "Claude Code" });
    expect(handoff).toContain("Person: make it blue");
    expect(handoff).not.toContain("add a test");
  });

  it("sends the new text with the prompt's images and files kept", () => {
    const image: Part = { type: "image", data: "AAAA", mimeType: "image/png" } as Part;
    expect(editedBlocks(user("u", "old", [image]), "new")).toEqual([{ type: "text", text: "new" }, { type: "image", data: "AAAA", mimeType: "image/png", uri: null }]);
  });
});

describe("the reply id an edit forks at", () => {
  it("is the latest message id the root agent stamped on the turn, never a subagent's", () => {
    let state = reduce(initialSessionState("s", "claude-code"), { type: "session/connected", acpSessionId: "acp", modes: null, configOptions: null, loading: false, at: 0 });
    state = reduce(state, { type: "prompt/start", turnId: "t1", content: [{ type: "text", text: "hi" }], at: 1 });
    const chunk = (messageId: string, meta?: object) =>
      reduce(state, { type: "session/update", acpSessionId: "acp", update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text: "x" }, ...(meta ? { _meta: meta } : {}) }, at: 2 } as never);
    state = chunk("msg-1");
    state = chunk("msg-2");
    state = chunk("sub-1", { claudeCode: { parentToolUseId: "task" } });
    expect(state.turns.at(-1)?.replyId).toBe("msg-2");
  });
});
