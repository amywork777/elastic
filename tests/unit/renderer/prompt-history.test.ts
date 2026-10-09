import { describe, expect, it } from "vitest";

import { sentPrompts, stepHistory, type HistoryCursor } from "@renderer/features/session/composer/prompt-history";
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
});
