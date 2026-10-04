import { describe, expect, it } from "vitest";

import { applyMention, mentionQuery } from "@renderer/features/session/composer/mentions";

describe("the @ list's query and pick", () => {
  it("opens on a trailing @word only", () => {
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("fix @src/ap")).toBe("src/ap");
    expect(mentionQuery("mail a@b")).toBeNull();
    expect(mentionQuery("@src/app.ts done")).toBeNull();
    expect(mentionQuery("plain words")).toBeNull();
  });

  it("puts the picked path in place of the query, quoting one with spaces", () => {
    expect(applyMention("fix @src/ap", "src/app.ts")).toBe("fix @src/app.ts ");
    expect(applyMention("@", "README.md")).toBe("@README.md ");
    expect(applyMention("see @my", "my notes/plan.md")).toBe('see "my notes/plan.md" ');
    expect(applyMention("no mention", "a.ts")).toBe("no mention");
  });
});
