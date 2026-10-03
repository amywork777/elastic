import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import { Blocks, X } from "lucide-react";

import type { AppContext } from "@renderer/state/composer";

/** A chip's words: the view's own title for its first block, else its first line. */
export function appContextLabel(entry: AppContext): string {
  const first = entry.blocks[0];
  if (!first) return entry.source;
  if (first.title) return first.title;
  if (first.type === "text") return first.text.split("\n")[0]!.slice(0, 60) || entry.source;
  return `${entry.source} image`;
}

/**
 * What plugin views queued for the next message (`ui/update-model-context`), one chip per view
 * in the box's attachment strip: its title ("Quick edit · a.step"), its images as thumbnails, and
 * a cross that takes it out (the view hears its context is empty). It goes out with the prompt.
 */
export function AppContextChips({ contexts, onRemove }: { contexts: AppContext[]; onRemove: (frameId: string) => void }) {
  if (contexts.length === 0) return null;
  return (
    <>
      {contexts.map((entry) => {
        const label = appContextLabel(entry);
        const text = entry.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
        const images = entry.blocks.filter((block) => block.type === "image");
        return (
          <span
            className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border bg-muted/30 pr-1 pl-2 text-[12px]"
            data-composer-app-context={entry.frameId}
            key={entry.frameId}
          >
            <TooltipHint content={<span className="block max-w-80 whitespace-pre-wrap">{text || label}</span>} side="top">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" tabIndex={0}>
                <Blocks aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
                {images.map((image, index) => (
                  <img
                    alt=""
                    className="size-5 shrink-0 rounded-sm object-cover"
                    key={index}
                    src={`data:${image.mimeType};base64,${image.data}`}
                  />
                ))}
              </span>
            </TooltipHint>
            <button
              aria-label={`Remove ${label}`}
              className="flex size-6 items-center justify-center rounded-md opacity-60 hover:bg-muted hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onRemove(entry.frameId)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </>
  );
}
