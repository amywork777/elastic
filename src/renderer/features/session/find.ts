import type { Part, Turn } from "@shared/acp/types";

import { isHandoff } from "@renderer/lib/handoff";

/**
 * Find in the chat (Mod+F, `FindBar` in `Transcript.tsx`): the words of a
 * transcript, searched in the turn data and painted with the CSS Custom
 * Highlight API, so nothing in the DOM is rewritten to mark a match.
 *
 * Two halves, because only the latest window of turns is mounted
 * (`TRANSCRIPT_WINDOW`). A mounted turn's matches are its DOM's: what the
 * person sees is what is counted and what is painted (`domMatches`). A turn
 * that is not mounted has no DOM, so its matches are counted in its data
 * (`searchableText`), which mirrors what the turn draws — a prompt's bubble,
 * a reply's prose, only the answer of a reply whose work is folded under
 * "Worked for …" — with markdown's punctuation taken out. The two can
 * disagree by a match (a link's URL, a heading's `#`); a turn's DOM count
 * replaces its data count the moment it mounts, which jumping to one of its
 * matches does.
 *
 * Matching is plain text, case-insensitive, and never across two turns.
 */

/** The index of a finished reply's answer: the trailing text (and error) parts. */
export function answerStart(parts: Part[]): number {
  let answer = parts.length;
  while (answer > 0 && (parts[answer - 1]!.type === "text" || parts[answer - 1]!.type === "error")) answer -= 1;
  return answer;
}

/**
 * The parts a turn draws: all of them, or, for a finished turn that is not the
 * latest and did work before its answer, the answer alone — `WorkFold`'s rule,
 * which uses this.
 */
export function drawnParts(turn: Turn, fold: boolean): { parts: Part[]; folded: boolean } {
  const answer = answerStart(turn.parts);
  const work = turn.parts.slice(0, answer);
  const hasWork = work.some((part) => part.type === "tool_call" || part.type === "subagent" || part.type === "thought" || part.type === "plan");
  if (!fold || !hasWork || answer === turn.parts.length || turn.endedAt === null) return { parts: turn.parts, folded: false };
  return { parts: turn.parts.slice(answer), folded: true };
}

/** Markdown's punctuation out of prose, near enough to the words it renders. */
export function plainText(markdown: string): string {
  return (
    markdown
      // Images go, a link keeps its words.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Fences and headings are lines of their own.
      .replace(/^\s*(```|~~~).*$/gm, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      // Emphasis, code and strike marks. A lone `_` stays: snake_case is drawn as typed.
      .replace(/(\*|__|~~|`)/g, "")
  );
}

/** The words a turn shows, for a turn that is not mounted. A handoff is folded, so it shows none. */
export function searchableText(turn: Turn, fold: boolean): string {
  if (turn.role === "user") {
    const text = turn.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    return isHandoff(text) ? "" : text;
  }
  return drawnParts(turn, fold)
    .parts.flatMap((part) => (part.type === "text" ? [plainText(part.text)] : []))
    .join("\n");
}

/** How many times `query` occurs in `text`, case-insensitive, not overlapping. */
export function countIn(text: string, query: string): number {
  const needle = query.toLowerCase();
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/** One match: the turn it is in and which of that turn's matches it is. */
export type FindMatch = { turnId: string; index: number; nth: number };

/**
 * Every match in the chat, in reading order. `mounted` holds the DOM counts of
 * the turns that are mounted; any other turn is counted from its data. A turn
 * is folded as `Transcript` folds it: every finished turn but the latest.
 */
export function findMatches(turns: Turn[], query: string, mounted: ReadonlyMap<string, number>): FindMatch[] {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  turns.forEach((turn, index) => {
    const count = mounted.get(turn.id) ?? countIn(searchableText(turn, index !== turns.length - 1), query);
    for (let nth = 0; nth < count; nth += 1) matches.push({ turnId: turn.id, index, nth });
  });
  return matches;
}

/** Where the regions a turn shows its words in are, under its `[data-turn]` element. */
export const FIND_REGIONS = '[data-find-text], [data-part="text"]';

/**
 * The matches of `query` in one mounted turn, as DOM ranges in reading order.
 * Each region's text nodes are joined first, so a match that runs across an
 * element (a bold word, a streamed word in its own span) is still one match.
 */
export function domMatches(turnElement: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const document = turnElement.ownerDocument;
  for (const region of turnElement.querySelectorAll(FIND_REGIONS)) {
    // A region inside another (a text part inside a subagent's text) is the outer one's.
    const outer = region.parentElement?.closest(FIND_REGIONS);
    if (outer && turnElement.contains(outer)) continue;
    const nodes: { node: Text; start: number }[] = [];
    let text = "";
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node: node as Text, start: text.length });
      text += (node as Text).data;
    }
    const haystack = text.toLowerCase();
    // A lowercase that changes the length (a rare ligature) would misplace every range after it.
    if (haystack.length !== text.length) continue;
    const locate = (offset: number, end: boolean) => {
      // The node holding `offset`; an end offset on a boundary belongs to the node before it.
      let found = nodes[0]!;
      for (const entry of nodes) {
        if (end ? entry.start < offset : entry.start <= offset) found = entry;
        else break;
      }
      return { node: found.node, offset: offset - found.start };
    };
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      const start = locate(at, false);
      const end = locate(at + needle.length, true);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      ranges.push(range);
    }
  }
  return ranges;
}

/**
 * The highlights every open find bar paints, merged: the registry
 * (`CSS.highlights`) is the document's, and two chats side by side can each
 * have a find open. `::highlight(transcript-find)` and
 * `::highlight(transcript-find-current)` are in `styles/globals.css`. A
 * document without the API (the unit tests' jsdom) paints nothing and finds
 * all the same.
 */
const painted = new Map<string, { all: Range[]; current: Range | null }>();

export function paintMatches(owner: string, all: Range[], current: Range | null): void {
  if (all.length === 0 && !current) painted.delete(owner);
  else painted.set(owner, { all, current });
  const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  if (!registry || typeof Highlight === "undefined") return;
  const every = [...painted.values()];
  registry.set("transcript-find", new Highlight(...every.flatMap((entry) => entry.all)));
  registry.set("transcript-find-current", new Highlight(...every.flatMap((entry) => (entry.current ? [entry.current] : []))));
}
