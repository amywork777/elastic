import type { Part, SessionState } from "@shared/acp/types";

/**
 * "Continue with …": the first prompt of the chat a session continues in, so
 * the new agent picks up where the old one left off. It starts with
 * `HANDOFF_MARK` (the transcript draws it as a folded "Picked up from …" row,
 * not as a wall of text the person typed), then the conversation so far
 * (trimmed from the front, newest kept), the files the agent changed, the plan
 * if one is open, and the person's last message.
 */
export const HANDOFF_MARK = "<!-- elastic:handoff -->";
const BUDGET = 24_000;

function textOf(parts: Part[]): string {
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : part.type === "subagent" ? [textOf(part.parts)] : [])).join("").trim();
}

function changedFiles(state: SessionState): string[] {
  const files = new Set<string>();
  const visit = (parts: Part[]) => {
    for (const part of parts) {
      if (part.type === "tool_call") {
        for (const content of part.content) if (content.type === "diff") files.add(content.path);
        if (part.kind === "edit" || part.kind === "delete" || part.kind === "move") for (const location of part.locations) files.add(location.path);
        visit(part.children);
      } else if (part.type === "subagent") {
        visit(part.parts);
      }
    }
  };
  for (const turn of state.turns) visit(turn.parts);
  return [...files];
}

export function buildHandoff(state: SessionState, from: { title: string; agentName: string }): string {
  const turns = state.turns
    .map((turn) => ({ role: turn.role, text: textOf(turn.parts) }))
    .filter((turn) => turn.text.length > 0 && !turn.text.startsWith(HANDOFF_MARK));
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user")?.text ?? null;
  const lines = turns.map((turn) => `${turn.role === "user" ? "Person" : from.agentName}: ${turn.text}`);
  // Newest kept: drop from the front until the conversation fits.
  let kept = lines;
  let dropped = 0;
  while (kept.join("\n\n").length > BUDGET && kept.length > 1) {
    kept = kept.slice(1);
    dropped += 1;
  }
  let conversation = kept.join("\n\n");
  if (conversation.length > BUDGET) conversation = `…${conversation.slice(-BUDGET)}`;
  const files = changedFiles(state);
  const plan = state.plan && state.plan.some((entry) => entry.status !== "completed") ? state.plan : null;
  return [
    HANDOFF_MARK,
    `This chat continues "${from.title}", which ran on ${from.agentName}. Pick up from where it left off. Here is what happened there.`,
    "",
    "## Conversation",
    dropped > 0 ? `(The first ${dropped} messages are left out.)\n\n${conversation}` : conversation || "(No messages yet.)",
    ...(files.length > 0 ? ["", "## Files changed", ...files.map((file) => `- ${file}`)] : []),
    ...(plan ? ["", "## Open plan", ...plan.map((entry) => `- [${entry.status === "completed" ? "x" : " "}] ${entry.content}`)] : []),
    ...(lastUser ? ["", "## The last message", lastUser] : []),
    "",
    "Say in one short sentence that you have the context, then wait for the next message.",
  ].join("\n");
}

/** The chat a handoff came from, read back off its first line for the transcript's folded row. */
export function isHandoff(text: string): boolean {
  return text.startsWith(HANDOFF_MARK);
}
