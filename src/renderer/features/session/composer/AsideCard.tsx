import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import LoadingIcon from "@workbench/ui/loading-icon";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { defaultRemarkPlugins } from "streamdown";

import { MessageResponse } from "@renderer/components/ai-elements/message";
import { Button } from "@renderer/components/ui/button";
import { useAsides, type Aside } from "@renderer/state/asides";
import { useSettings } from "@renderer/state/settings";

import { TRANSCRIPT_COMPONENTS, TRANSCRIPT_REHYPE_PLUGINS } from "../links/components";

import { separateLists } from "@renderer/lib/markdown-lists";

const REMARK_PLUGINS = Object.values(defaultRemarkPlugins);

const RUNNING: Record<Aside["command"], string> = {
  usage: "Checking your usage…",
  context: "Reading this chat's context…",
  btw: "Thinking on the side…",
};

/**
 * A quick command's answer, over the composer (`quick-commands.ts`): the command or the side
 * question, a wait while it runs, then the agent's markdown, drawn with the transcript's own
 * links and images. Not part of the chat: close it with its X or Escape and it is gone.
 */
export function AsideCard({ scope, onClosed }: { scope: string; onClosed: () => void }) {
  const aside = useAsides((state) => state.asides[scope]);
  const dismiss = useAsides((state) => state.dismiss);
  const reduceMotion = useSettings((state) => state.settings?.reduceMotion ?? false);
  const card = useRef<HTMLElement | null>(null);

  // An answer arriving is read out; the card does not take focus from the box.
  const announced = aside?.status === "done" ? "Answer ready" : "";
  useEffect(() => {
    if (aside?.status === "done") card.current?.scrollTo({ top: 0 });
  }, [aside?.status]);

  if (!aside) return null;
  const close = () => {
    dismiss(scope);
    onClosed();
  };
  const title = aside.command === "btw" ? "btw" : `/${aside.command}`;
  return (
    <section
      aria-label={aside.command === "btw" ? "Side question" : `${title} result`}
      className="mb-2 max-h-[45vh] overflow-y-auto rounded-xl border bg-muted/40 px-3.5 py-2.5 text-[13px]"
      data-aside={aside.status}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      ref={card}
    >
      <header className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground">
          <span className="font-medium text-foreground">{title}</span>
          {aside.question ? <span className="break-words [overflow-wrap:anywhere]"> · {aside.question}</span> : null}
        </p>
        <TooltipHint content="Close">
          <Button aria-label="Close" className="-mt-0.5 -mr-1.5 size-6 text-muted-foreground" onClick={close} size="icon-xs" variant="ghost">
            <X className="size-3.5" />
          </Button>
        </TooltipHint>
      </header>
      {aside.status === "running" ? (
        <p className="mt-1 flex items-center gap-1.5 text-muted-foreground" role="status">
          <LoadingIcon active reducedMotion={reduceMotion} size={18} />
          {RUNNING[aside.command]}
        </p>
      ) : aside.status === "error" ? (
        <p className="mt-1 text-destructive" role="alert">
          {aside.error}
        </p>
      ) : (
        // Headings at the card's own scale: its title already names the command.
        <div className="prose-transcript mt-1 min-w-0 [overflow-wrap:anywhere] leading-6 [&_h1]:text-[14px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_:is(h1,h2,h3)]:mt-2 [&_:is(h1,h2,h3)]:mb-1 [&_:is(h1,h2,h3):first-child]:mt-0">
          <MessageResponse components={TRANSCRIPT_COMPONENTS} rehypePlugins={TRANSCRIPT_REHYPE_PLUGINS} remarkPlugins={REMARK_PLUGINS}>
            {separateLists(aside.markdown)}
          </MessageResponse>
        </div>
      )}
      <span aria-live="polite" className="sr-only" role="status">
        {announced}
      </span>
    </section>
  );
}
