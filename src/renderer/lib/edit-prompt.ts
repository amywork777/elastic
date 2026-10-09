import type { PromptBlock, SessionState, Turn } from "@shared/acp/types";

import { buildHandoff } from "./handoff";

/**
 * "Edit" on a past prompt: what the new chat it starts is given. The edit is
 * not made in this chat — an agent's conversation cannot be rewound in place
 * over ACP — so Send starts a linked chat ("Edited from …",
 * `features/session/EditPrompt.tsx`) whose agent has the conversation up to,
 * not including, the edited prompt, then sends the edited prompt there.
 *
 * The context is, in order of preference:
 *
 * - **a fork**: the agent's own conversation cut at its last message before
 *   the prompt (`Turn.replyId`, `session/fork` with a fork point — both pinned
 *   adapters take one), so the new agent has everything, tool results and all;
 * - **nothing**, for the chat's first prompt: there was nothing before it;
 * - **a handoff** (`lib/handoff.ts`), the summary "Continue with …" sends,
 *   made from the turns before the prompt, when there is no message id to cut
 *   at (an older transcript, an adapter that sends none, a prompt that
 *   followed another prompt) or the agent refused the fork.
 */
export type EditPlan = {
  /** The agent message to fork at, or null for no fork. */
  forkAt: string | null;
  /** Whether anything came before the prompt: a refused fork falls back to a handoff of it. */
  hasContext: boolean;
  /** Whether this is the chat's latest prompt, the one whose files "Also restore" can put back. */
  latest: boolean;
};

export function editPlan(turns: Turn[], index: number): EditPlan {
  const before = turns.slice(0, index);
  const hasContext = before.some((turn) => turn.parts.length > 0);
  const previous = before.at(-1);
  // Only the agent turn right before the prompt: a fork at an earlier one would drop what was said between.
  const forkAt = previous?.role === "agent" && previous.replyId ? previous.replyId : null;
  const latest = turns.findLastIndex((turn) => turn.role === "user") === index;
  return { forkAt, hasContext, latest };
}

/** The handoff a refused fork falls back to: the conversation before the edited prompt. */
export function editHandoff(state: SessionState, index: number, from: { title: string; agentName: string }): string {
  return buildHandoff({ ...state, turns: state.turns.slice(0, index) }, from);
}

/** A prompt's blocks as it was sent, so a Retry or an edit can send them again. */
export function promptBlocks(turn: Turn): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  for (const part of turn.parts) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      blocks.push({ type: "image", data: part.data, mimeType: part.mimeType, uri: null });
    } else if (part.type === "resource_link") {
      blocks.push({ type: "resource_link", uri: part.uri, name: part.name, mimeType: null, title: null });
    } else if (part.type === "resource") {
      blocks.push({ type: "resource", uri: part.uri, text: part.text, mimeType: part.mimeType });
    }
  }
  return blocks;
}

/** The text a prompt's bubble shows, which is what the editor opens on. */
export function promptText(turn: Turn): string {
  return turn.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/** The edited prompt: the new text in place of the old, its images and attached files kept. */
export function editedBlocks(turn: Turn, text: string): PromptBlock[] {
  return [{ type: "text", text }, ...promptBlocks(turn).filter((block) => block.type !== "text")];
}
