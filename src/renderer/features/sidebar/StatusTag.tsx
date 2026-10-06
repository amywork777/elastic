import { cn } from "cn";

import { STATUS_TAG_LABELS, type StatusTag as Tag } from "@renderer/lib/sidebar";

/**
 * A Recents row's tag (`lib/sidebar.ts`, `statusTag`). Neutral but where it asks something of
 * the person: waiting amber, review blue, failed red. A tag set by hand ends in a dot; the row's
 * hidden status text says so in words.
 */
export function StatusTag({ tag, manual }: { tag: Tag; manual: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full px-1.5 text-[10.5px] leading-4 whitespace-nowrap",
        tag === "waiting" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tag === "review" && "bg-info/15 text-info",
        tag === "failed" && "bg-destructive/15 text-destructive",
        tag === "working" && "bg-sidebar-accent text-foreground",
        tag === "done" && "bg-sidebar-accent text-muted-foreground",
      )}
      data-tag={tag}
    >
      {STATUS_TAG_LABELS[tag]}
      {manual ? " ·" : ""}
    </span>
  );
}
