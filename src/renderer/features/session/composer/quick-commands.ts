/**
 * Quick commands: `/usage`, `/context` and `/btw`, answered beside the chat in a card over the
 * composer (`AsideCard`) rather than sent into it. They never queue behind a running turn and
 * never become a turn. Claude Code's terminal does the same with these three; over ACP the
 * agent would only see them as messages, and `/btw` not at all (`SessionManager.aside`).
 */
import type { AvailableCommand } from "@shared/acp/types";
import type { QuickCommandName } from "@renderer/state/asides";

export const QUICK_COMMANDS: readonly (AvailableCommand & { name: QuickCommandName })[] = [
  { name: "usage", description: "Your plan's usage limits, shown beside the chat", hint: null },
  { name: "context", description: "What fills this chat's context window, shown beside it", hint: null },
  { name: "btw", description: "Ask a side question; the answer is shown, not kept", hint: "question" },
];

/** The slash list: the quick commands this composer offers first, then the agent's, without repeats. */
export function withQuickCommands(agent: readonly AvailableCommand[], offered: readonly QuickCommandName[]): AvailableCommand[] {
  const quick = QUICK_COMMANDS.filter((command) => offered.includes(command.name));
  const names = new Set<string>(quick.map((command) => command.name));
  return [...quick, ...agent.filter((command) => !names.has(command.name))];
}

export type ParsedQuickCommand =
  | { command: QuickCommandName; question?: string }
  | { command: "btw"; missing: "question" };

/** A box that holds exactly one offered quick command, with `/btw`'s question after it. */
export function parseQuickCommand(text: string, offered: readonly QuickCommandName[]): ParsedQuickCommand | null {
  const match = /^\/(usage|context|btw)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const command = match[1] as QuickCommandName;
  if (!offered.includes(command)) return null;
  const rest = match[2]?.trim() ?? "";
  if (command === "btw") return rest ? { command, question: rest } : { command, missing: "question" };
  // `/usage now` is not the command: it goes to the agent as typed.
  return rest ? null : { command };
}
