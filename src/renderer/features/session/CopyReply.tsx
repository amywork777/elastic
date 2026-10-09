import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@renderer/components/ui/button";
import { markdownToHtml } from "@renderer/lib/markdown-html";
import type { Turn } from "@shared/acp/types";

/**
 * What Copy takes from an agent's turn: its answer, the text after the last
 * tool call, thought or plan, which is what "Worked for …" leaves open. A turn
 * that ended on a tool call has no such tail, so it gives all its text.
 * Never the tool calls, the thinking or an error row.
 */
export function replyMarkdown(parts: Turn["parts"]): string {
  const texts = (from: Turn["parts"]) =>
    from.flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []));
  let answer = parts.length;
  while (answer > 0 && (parts[answer - 1]!.type === "text" || parts[answer - 1]!.type === "error")) answer -= 1;
  const tail = texts(parts.slice(answer));
  return (tail.length > 0 ? tail : texts(parts)).join("\n\n");
}

/**
 * The reply as formatted text and as markdown, in one clipboard write: a
 * paste into Slack, Docs or an email takes the formatting, a paste into a
 * terminal or a code editor takes the markdown. The web clipboard is the
 * page's, under the permission main grants it (`clipboard-sanitized-write`);
 * plain text alone is the fallback.
 */
export async function copyReply(markdown: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([markdownToHtml(markdown)], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(markdown);
  }
}

/**
 * Copy, under an agent's reply. The latest reply shows it; an older one on
 * hover or focus, so a long chat is not a column of buttons. A check says it
 * worked, for a moment, and a screen reader hears "Copied".
 */
export function CopyReplyButton({ markdown, latest, children }: { markdown: string; latest: boolean; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const copy = () => {
    void copyReply(markdown).then(
      () => {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Could not copy the reply."),
    );
  };
  return (
    <div className="not-prose mt-0.5 flex items-center px-0.5" data-reply-actions>
      <TooltipHint content={copied ? "Copied" : "Copy reply"}>
        <Button
          aria-label="Copy reply"
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground",
            !latest && "opacity-0 group-hover/turn:opacity-100 focus-visible:opacity-100",
          )}
          data-copy-reply
          onClick={copy}
          size="icon-sm"
          variant="ghost"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </TooltipHint>
      <span aria-live="polite" className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
      {/* What sits beside Copy: the reply's time (`SentAt` in `Transcript.tsx`). */}
      {children}
    </div>
  );
}
