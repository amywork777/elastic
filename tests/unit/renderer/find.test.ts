// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { countIn, domMatches, drawnParts, findMatches, plainText, searchableText } from "@renderer/features/session/find";
import { HANDOFF_MARK } from "@renderer/lib/handoff";
import type { Part, Turn } from "@shared/acp/types";

const text = (value: string): Part => ({ type: "text", text: value });
const thought: Part = { type: "thought", text: "thinking about the blue button" };
const turn = (id: string, role: Turn["role"], parts: Part[], endedAt: number | null = 2): Turn => ({ id, role, parts, startedAt: 1, endedAt, stopReason: null });

describe("what find searches in a turn that is not mounted", () => {
  it("is a prompt's text, and nothing of a handoff", () => {
    expect(searchableText(turn("u", "user", [text("make the button blue")]), true)).toBe("make the button blue");
    expect(searchableText(turn("h", "user", [text(`${HANDOFF_MARK}\nblue`)]), true)).toBe("");
  });

  it("is only the answer of a reply whose work is folded, and all of the latest", () => {
    const reply = turn("a", "agent", [text("Looking for blue. "), thought, text("Done: the button is **blue**.")]);
    expect(drawnParts(reply, true)).toEqual({ parts: [reply.parts[2]], folded: true });
    expect(searchableText(reply, true)).toBe("Done: the button is blue.");
    expect(searchableText(reply, false)).toContain("Looking for blue.");
    // Still streaming: nothing is folded yet.
    expect(drawnParts({ ...reply, endedAt: null }, true).folded).toBe(false);
  });

  it("takes markdown's punctuation out, keeping a link's words and snake_case", () => {
    expect(plainText("## Heading\n- a [link](https://x.y) and `code_name` in *it*")).toBe("Heading\na link and code_name in it");
  });

  it("counts case-insensitively, without overlaps", () => {
    expect(countIn("Blue blue BLUE", "blue")).toBe(3);
    expect(countIn("aaaa", "aa")).toBe(2);
    expect(countIn("anything", "")).toBe(0);
  });
});

describe("every match in the chat", () => {
  const turns = [
    turn("u1", "user", [text("blue one")]),
    turn("a1", "agent", [text("blue two, blue three")]),
    turn("u2", "user", [text("no match")]),
    turn("a2", "agent", [text("BLUE four")]),
  ];

  it("is in reading order, a mounted turn counted by its DOM and the rest by their data", () => {
    const matches = findMatches(turns, "blue", new Map([["a2", 0], ["u2", 0]]));
    expect(matches.map((match) => `${match.turnId}#${match.nth}`)).toEqual(["u1#0", "a1#0", "a1#1"]);
    expect(findMatches(turns, "blue", new Map()).at(-1)).toEqual({ turnId: "a2", index: 3, nth: 0 });
    expect(findMatches(turns, "", new Map())).toEqual([]);
  });
});

describe("the matches painted in a mounted turn", () => {
  it("are ranges over the turn's words, one even where a word is split across elements", () => {
    document.body.innerHTML = `
      <div data-turn="a1">
        <div data-part="text"><p>The <strong>bl</strong>ue button and a blue icon</p></div>
        <button>blue (a control, not prose)</button>
      </div>`;
    const ranges = domMatches(document.querySelector("[data-turn]")!, "Blue");
    expect(ranges.map((range) => range.toString())).toEqual(["blue", "blue"]);
    expect(ranges[0]!.startContainer.textContent).toBe("bl");
    expect(ranges[0]!.endContainer.textContent).toBe("ue button and a blue icon");
  });
});
