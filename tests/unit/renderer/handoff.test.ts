import { describe, expect, it } from "vitest";

import { HANDOFF_MARK, buildHandoff, isHandoff } from "@renderer/lib/handoff";
import { initialSessionState, type SessionState, type Turn } from "@shared/acp/types";

const turn = (role: Turn["role"], text: string, extra: Turn["parts"] = []): Turn => ({ id: `${role}-${text.slice(0, 5)}`, role, parts: [{ type: "text", text }, ...extra], startedAt: 0, endedAt: 1, stopReason: null });

function state(turns: Turn[], plan: SessionState["plan"] = null): SessionState {
  return { ...initialSessionState("s1", "claude-code"), turns, plan };
}

describe("the handoff to a continued chat", () => {
  it("carries the conversation, the files changed, an open plan and the last message", () => {
    const edit = { type: "tool_call" as const, id: "t1", kind: "edit" as const, title: "Edit", name: null, status: "completed" as const, input: null, output: null, content: [{ type: "diff" as const, path: "src/a.ts", oldText: "a", newText: "b" }], locations: [], stream: "", children: [] };
    const text = buildHandoff(state([turn("user", "Make it blue"), turn("agent", "Done, it is blue.", [edit]), turn("user", "Now add a test")], [
      { content: "Write the test", priority: "high", status: "pending" },
      { content: "Make it blue", priority: "high", status: "completed" },
    ]), { title: "Blue button", agentName: "Claude Code" });
    expect(isHandoff(text)).toBe(true);
    expect(text).toContain('continues "Blue button", which ran on Claude Code');
    expect(text).toContain("Person: Make it blue\n\nClaude Code: Done, it is blue.");
    expect(text).toContain("## Files changed\n- src/a.ts");
    expect(text).toContain("- [ ] Write the test");
    expect(text).toContain("## The last message\nNow add a test");
  });

  it("drops the oldest messages to fit, keeps the newest, and leaves out an earlier handoff", () => {
    const long = "x".repeat(9_000);
    const text = buildHandoff(state([turn("user", `${HANDOFF_MARK} older`), turn("user", `first ${long}`), turn("agent", `second ${long}`), turn("user", `third ${long}`), turn("agent", "newest")]), { title: "t", agentName: "Codex" });
    expect(text).toContain("(The first 1 messages are left out.)");
    expect(text).not.toContain("first x");
    expect(text).toContain("Codex: newest");
    expect(text.split(HANDOFF_MARK)).toHaveLength(2);
  });
});
