import { describe, expect, it } from "vitest";

import { searchPrompts, sentPrompts, stepHistory, type HistoryCursor } from "@renderer/features/session/composer/prompt-history";
import type { Turn } from "@shared/acp/types";

const user = (id: string, text: string): Turn => ({ id, role: "user", parts: [{ type: "text", text }], startedAt: 0, endedAt: 0, stopReason: null });
const agent = (id: string): Turn => ({ id, role: "agent", parts: [{ type: "text", text: "reply" }], startedAt: 0, endedAt: 1, stopReason: "end_turn" });

describe("prompt history", () => {
  it("lists a chat's prompts newest first, without replies, blanks or a repeat sent twice running", () => {
    const turns = [user("1", "first"), agent("a"), user("2", "second"), agent("b"), user("3", "second"), user("4", "  ")];
    expect(sentPrompts(turns)).toEqual(["second", "first"]);
  });

  it("walks up to the oldest, down again, and puts the draft back past the latest", () => {
    const prompts = ["latest", "older"];
    let cursor: HistoryCursor | null = null;
    let text = "half typed";
    const step = (direction: "up" | "down") => {
      const next = stepHistory(prompts, cursor, text, direction);
      if (next) ({ cursor, text } = next);
      return next;
    };
    expect(step("down")).toBeNull();
    step("up");
    expect(text).toBe("latest");
    step("up");
    expect(text).toBe("older");
    expect(step("up"), "no older prompt").toBeNull();
    expect(text).toBe("older");
    step("down");
    expect(text).toBe("latest");
    step("down");
    expect(text).toBe("half typed");
    expect(cursor).toBeNull();
  });

  it("has nothing to recall in a chat that sent nothing", () => {
    expect(stepHistory([], null, "", "up")).toBeNull();
  });

  it("searches newest first: the query in a row before its letters apart, each prompt once", () => {
    const prompts = ["fix the build", "write the readme", "fix the tests", "fix the build", "find intent"];
    expect(searchPrompts(prompts, "")).toEqual(["fix the build", "write the readme", "fix the tests", "find intent"]);
    expect(searchPrompts(prompts, "fix")).toEqual(["fix the build", "fix the tests"]);
    expect(searchPrompts(prompts, "FIX THE T")[0]).toBe("fix the tests");
    expect(searchPrompts(prompts, "the")).toEqual(["fix the build", "write the readme", "fix the tests"]);
    // "fnt" is in no prompt as typed; its letters are in order, apart, in this one.
    expect(searchPrompts(prompts, "fnt")).toContain("find intent");
    expect(searchPrompts(prompts, "zzz")).toEqual([]);
    expect(searchPrompts(prompts, "", 2)).toEqual(["fix the build", "write the readme"]);
  });
});
