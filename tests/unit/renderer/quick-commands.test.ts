/**
 * Which boxes are quick commands (`features/session/composer/quick-commands.ts`), and how they
 * join the agent's own slash list.
 */
import { describe, expect, it } from "vitest";

import { parseQuickCommand, withQuickCommands } from "@renderer/features/session/composer/quick-commands";

const ALL = ["usage", "context", "btw"] as const;

describe("parseQuickCommand", () => {
  it("reads the three commands, with /btw's question", () => {
    expect(parseQuickCommand("/usage", ALL)).toEqual({ command: "usage" });
    expect(parseQuickCommand("  /context  ", ALL)).toEqual({ command: "context" });
    expect(parseQuickCommand("/btw what does this hook do?", ALL)).toEqual({ command: "btw", question: "what does this hook do?" });
    expect(parseQuickCommand("/btw line one\nline two", ALL)).toEqual({ command: "btw", question: "line one\nline two" });
  });

  it("says /btw needs a question rather than sending it bare", () => {
    expect(parseQuickCommand("/btw", ALL)).toEqual({ command: "btw", missing: "question" });
    expect(parseQuickCommand("/btw   ", ALL)).toEqual({ command: "btw", missing: "question" });
  });

  it("leaves everything else to the agent", () => {
    expect(parseQuickCommand("/usage please", ALL)).toBeNull();
    expect(parseQuickCommand("/usages", ALL)).toBeNull();
    expect(parseQuickCommand("what is /usage", ALL)).toBeNull();
    expect(parseQuickCommand("/compact", ALL)).toBeNull();
    // Only what this composer offers: the new-session screen has no chat to ask about.
    expect(parseQuickCommand("/btw hi", ["usage"])).toBeNull();
    expect(parseQuickCommand("/usage", [])).toBeNull();
  });
});

describe("withQuickCommands", () => {
  it("lists the offered ones first and drops the agent's copy of the same name", () => {
    const agent = [
      { name: "compact", description: "Compact", hint: null },
      { name: "usage", description: "The agent's usage", hint: null },
    ];
    expect(withQuickCommands(agent, ["usage", "btw"]).map((command) => command.name)).toEqual(["usage", "btw", "compact"]);
    expect(withQuickCommands(agent, ["usage"])[0]!.description).toMatch(/beside the chat/);
    expect(withQuickCommands(agent, []).map((command) => command.name)).toEqual(["compact", "usage"]);
  });
});
