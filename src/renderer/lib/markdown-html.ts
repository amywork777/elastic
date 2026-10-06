/**
 * A reply's markdown as plain HTML, for the clipboard: what a Copy button puts
 * beside the markdown so a paste into Slack, Docs or an email keeps the
 * headings, lists, links, code and tables.
 *
 * Its own small printer over remark's tree rather than the transcript's DOM:
 * the DOM is Streamdown's, with highlighted spans in every code block and
 * buttons on every table, and none of that belongs in someone else's message.
 * Every text is escaped, a link keeps only an `http:`, `https:` or `mailto:`
 * target, and an image becomes a link to it — nothing pasted fetches anything.
 */
import type { List, ListItem, Nodes, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function children(node: { children: Nodes[] }): string {
  return node.children.map(print).join("");
}

function listItem(item: ListItem, tight: boolean): string {
  const box = item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "";
  // A tight list's paragraphs are its lines, not paragraphs: no margins between the items.
  const body = item.children
    .map((child) => (tight && child.type === "paragraph" ? children(child) : print(child)))
    .join("");
  return `<li>${escapeHtml(box)}${body}</li>`;
}

function list(node: List): string {
  const tight = node.spread !== true && node.children.every((item) => item.spread !== true);
  const items = node.children.map((item) => listItem(item, tight)).join("");
  if (!node.ordered) return `<ul>${items}</ul>`;
  return node.start !== null && node.start !== undefined && node.start !== 1 ? `<ol start="${node.start}">${items}</ol>` : `<ol>${items}</ol>`;
}

function table(node: Table): string {
  const [head, ...body] = node.children;
  const row = (cells: string[], tag: "th" | "td") => `<tr>${cells.map((cell) => `<${tag}>${cell}</${tag}>`).join("")}</tr>`;
  const cellsOf = (index: number) => node.children[index]!.children.map((cell) => children(cell));
  const thead = head ? `<thead>${row(cellsOf(0), "th")}</thead>` : "";
  const tbody = body.length > 0 ? `<tbody>${body.map((_, index) => row(cellsOf(index + 1), "td")).join("")}</tbody>` : "";
  return `<table>${thead}${tbody}</table>`;
}

function print(node: Nodes): string {
  switch (node.type) {
    case "root":
      return children(node);
    case "paragraph":
      return `<p>${children(node)}</p>`;
    case "heading":
      return `<h${node.depth}>${children(node)}</h${node.depth}>`;
    case "text":
      return escapeHtml(node.value);
    case "emphasis":
      return `<em>${children(node)}</em>`;
    case "strong":
      return `<strong>${children(node)}</strong>`;
    case "delete":
      return `<del>${children(node)}</del>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "code":
      return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
    case "blockquote":
      return `<blockquote>${children(node)}</blockquote>`;
    case "list":
      return list(node);
    case "listItem":
      return listItem(node, false);
    case "link": {
      const href = safeHref(node.url);
      return href ? `<a href="${escapeHtml(href)}">${children(node)}</a>` : children(node);
    }
    case "image": {
      const href = safeHref(node.url);
      const label = escapeHtml(node.alt || node.url);
      return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
    }
    case "break":
      return "<br>";
    case "thematicBreak":
      return "<hr>";
    case "table":
      return table(node);
    // Raw HTML in a reply is shown as the text it is, never run.
    case "html":
      return escapeHtml(node.value);
    default:
      return "children" in node ? children(node as { children: Nodes[] }) : "value" in node ? escapeHtml(String(node.value)) : "";
  }
}

export function markdownToHtml(markdown: string): string {
  return print(parser.parse(markdown) as Nodes);
}
