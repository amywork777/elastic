import { referenceText } from "@shared/file-refs";

/**
 * `@` file mentions: the query being typed and what picking a path does to the draft.
 *
 * The list opens while the draft ends in `@` plus a word (`fix @src/ap`), the way Claude Code and
 * Codex open theirs. Picking a path puts `@path ` in its place, which the reference grammar
 * (`./references`, `parseMention`) draws as a chip. A path with whitespace in it cannot be a
 * mention word, so it goes in as the quoted token instead.
 */
const QUERY_RE = /(?:^|\s)@([^\s@"]*)$/;

/** The text after the trailing `@`, or null when the draft does not end in a mention. */
export function mentionQuery(text: string): string | null {
  const match = QUERY_RE.exec(text);
  return match ? (match[1] ?? "") : null;
}

/** The draft with its trailing `@query` replaced by the picked path. */
export function applyMention(text: string, path: string): string {
  const match = QUERY_RE.exec(text);
  if (!match) return text;
  const start = match.index + match[0].lastIndexOf("@");
  const token = /\s/.test(path) ? referenceText({ file: path, selector: "" }) : `@${path}`;
  return `${text.slice(0, start)}${token} `;
}
