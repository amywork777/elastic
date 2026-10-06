/**
 * Copy under an agent's reply: which text it takes (`replyMarkdown`), the
 * formatted copy beside the markdown (`markdownToHtml`), and the button.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@workbench/ui/primitives/tooltip";
import { CopyReplyButton, replyMarkdown } from "@renderer/features/session/CopyReply";
import { markdownToHtml } from "@renderer/lib/markdown-html";
import type { Turn } from "@shared/acp/types";

type Parts = Turn["parts"];
const text = (value: string) => ({ type: "text", text: value }) as Parts[number];
const tool = { type: "tool_call", toolCallId: "t1", title: "Read file", kind: "read", status: "completed" } as unknown as Parts[number];
const thought = { type: "thought", text: "thinking it over" } as unknown as Parts[number];

describe("replyMarkdown", () => {
  it("takes the answer after the last tool call, not the narration before it", () => {
    expect(replyMarkdown([text("Let me look."), tool, thought, text("It is **fixed**."), text("Run the tests.")])).toBe(
      "It is **fixed**.\n\nRun the tests.",
    );
  });

  it("takes all the text of a turn that ended on a tool call, and none of a turn with no text", () => {
    expect(replyMarkdown([text("First."), tool, text("Second."), tool])).toBe("First.\n\nSecond.");
    expect(replyMarkdown([tool, thought])).toBe("");
  });
});

describe("markdownToHtml", () => {
  it("keeps the structure a message needs", () => {
    expect(markdownToHtml("# Title\n\nSome *em* and **strong** and `code`.")).toBe(
      "<h1>Title</h1><p>Some <em>em</em> and <strong>strong</strong> and <code>code</code>.</p>",
    );
    expect(markdownToHtml("- one\n- two\n\n3. three\n4. four")).toBe(
      '<ul><li>one</li><li>two</li></ul><ol start="3"><li>three</li><li>four</li></ol>',
    );
    expect(markdownToHtml("- [x] done\n- [ ] not yet")).toBe("<ul><li>[x] done</li><li>[ ] not yet</li></ul>");
    expect(markdownToHtml("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    expect(markdownToHtml("~~gone~~")).toBe("<p><del>gone</del></p>");
  });

  it("escapes every text, and runs or fetches nothing", () => {
    expect(markdownToHtml("```html\n<script>alert(1)</script>\n```")).toBe(
      "<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>",
    );
    expect(markdownToHtml("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(markdownToHtml("[site](https://example.com/?a=1&b=2)")).toBe(
      '<p><a href="https://example.com/?a=1&amp;b=2">site</a></p>',
    );
    expect(markdownToHtml("[run](javascript:alert(1))")).toBe("<p>run</p>");
    expect(markdownToHtml("![chart](https://example.com/c.png)")).toBe('<p><a href="https://example.com/c.png">chart</a></p>');
  });
});

describe("the button", () => {
  const write = vi.fn(async (_items: ClipboardItem[]) => {});
  const writeText = vi.fn(async (_text: string) => {});

  afterEach(() => {
    write.mockReset();
    writeText.mockReset();
  });

  it("writes the reply as HTML and as markdown, then says Copied", async () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, writeText } });
    render(
      <TooltipProvider>
        <CopyReplyButton latest markdown="It is **fixed**." />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));
    const item = write.mock.calls[0]![0][0] as unknown as FakeClipboardItem;
    expect(await item.items["text/html"]!.text()).toBe("<p>It is <strong>fixed</strong>.</p>");
    expect(await item.items["text/plain"]!.text()).toBe("It is **fixed**.");
    vi.unstubAllGlobals();
  });

  it("falls back to plain text when the rich write is refused", async () => {
    write.mockRejectedValueOnce(new Error("refused"));
    vi.stubGlobal("ClipboardItem", class {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, writeText } });
    render(
      <TooltipProvider>
        <CopyReplyButton latest={false} markdown="plain" />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Copy reply" });
    // An older reply's button waits for hover or focus.
    expect(button.className).toContain("focus-visible:opacity-100");
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("plain"));
    vi.unstubAllGlobals();
  });
});
