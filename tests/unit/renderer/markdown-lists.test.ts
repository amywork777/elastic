import { describe, expect, it } from "vitest";

import { separateLists } from "@renderer/lib/markdown-lists";

/**
 * An agent often writes a list straight under a bold label ("**Farm content**\n4. Cornucopia").
 * Markdown reads a list numbered other than 1 there as more of the paragraph, so the items ran
 * together on the label's line. A blank line before such a list makes it a list.
 */
describe("separateLists", () => {
  it("starts a list that follows a line of text, numbered or bulleted", () => {
    expect(separateLists("**Farm content**\n4. Cornucopia\n5. Flowers")).toBe("**Farm content**\n\n4. Cornucopia\n5. Flowers");
    expect(separateLists("**Tips**\n- Start a new save")).toBe("**Tips**\n\n- Start a new save");
  });

  it("leaves a list that already has its blank line, and items that follow items", () => {
    const text = "Intro\n\n1. One\n2. Two\n- nested?";
    expect(separateLists(text)).toBe(text);
  });

  it("does not touch code blocks", () => {
    const text = "```\nfoo\n1. not a list\n```";
    expect(separateLists(text)).toBe(text);
  });

  it("leaves indented continuation and a lone number inside prose alone", () => {
    expect(separateLists("- item\n  2. nested")).toBe("- item\n  2. nested");
    expect(separateLists("We shipped in 2026. Then more.")).toBe("We shipped in 2026. Then more.");
  });
});
