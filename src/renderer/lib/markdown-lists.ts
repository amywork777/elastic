/** A list item at the start of a line: `-`, `*`, `+` or `N.`/`N)`, then a space. */
const ITEM = /^(?:[-*+]|\d{1,9}[.)])\s/;
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * A blank line in front of a list that starts right under a line of text. An agent often writes
 * "**Farm content**\n4. Cornucopia": Markdown reads a list numbered other than 1 there as more of
 * the paragraph, so its items ran together on the label's line. Only a line starting at the left
 * edge counts (an indented one is a nested item or a continuation); code blocks are left as they are.
 */
export function separateLists(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const previous = out.at(-1);
    if (!fenced && ITEM.test(line) && previous !== undefined && previous.trim() !== "" && !ITEM.test(previous) && !/^\s/.test(previous)) {
      out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}
