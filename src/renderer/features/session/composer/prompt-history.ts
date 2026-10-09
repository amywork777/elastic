/**
 * Up and Down in the composer walk the prompts already sent, the way a shell
 * or Claude Code's prompt does: Up from the box's first line (or an empty
 * box) shows the latest prompt, Up again the one before; Down walks back, and
 * Down past the latest puts back what the box held before the walk began.
 * While the box still shows a recalled prompt, Up and Down keep walking; once
 * the person edits it, it is their draft and the arrows move the caret again.
 */
import { isHandoff } from "@renderer/lib/handoff";
import type { Turn } from "@shared/acp/types";

/** Where a walk is: which prompt is shown (0 = latest), what it reads, and the draft it left. */
export type HistoryCursor = { index: number; shown: string; draft: string };

/** The typed text of each prompt a chat sent, newest first, a repeat sent twice in a row once. */
export function sentPrompts(turns: readonly Turn[]): string[] {
  const prompts: string[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role !== "user") continue;
    const text = turn.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
    if (!text || isHandoff(text) || prompts.at(-1) === text) continue;
    prompts.push(text);
  }
  return prompts;
}

/**
 * One step of the walk. Null when the key is not the walk's: nothing to recall, already at the
 * oldest, or Down with no walk under way.
 */
export function stepHistory(
  prompts: readonly string[],
  cursor: HistoryCursor | null,
  current: string,
  direction: "up" | "down",
): { cursor: HistoryCursor | null; text: string } | null {
  if (direction === "up") {
    const index = cursor ? cursor.index + 1 : 0;
    const shown = prompts[index];
    if (shown === undefined) return null;
    return { cursor: { index, shown, draft: cursor?.draft ?? current }, text: shown };
  }
  if (!cursor) return null;
  if (cursor.index === 0) return { cursor: null, text: cursor.draft };
  const index = cursor.index - 1;
  const shown = prompts[index]!;
  return { cursor: { ...cursor, index, shown }, text: shown };
}
