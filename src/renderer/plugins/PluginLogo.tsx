import { FileText, GitPullRequest, Globe, SquareTerminal, type LucideIcon } from "lucide-react";

import { cn } from "@renderer/lib/utils";
import type { PluginRecord } from "@shared/plugins";

/**
 * elastic's own bundled plugins draw with the app's line icons, in the text colour, like Home
 * and Plugins on the rail: their logos are line drawings, and a line drawing on a white tile reads
 * as a white blot in the dark themes.
 */
const BUNDLED_ICONS: Record<string, LucideIcon> = {
  "elastic-code-review": GitPullRequest,
  "elastic-browser": Globe,
  "elastic-terminals": SquareTerminal,
  "elastic-documents": FileText,
  "elastic-pdf": FileText,
};

/** Sizes where a logo sits on a tile (the store's cards and detail page) rather than inline. */
const TILED = /\bsize-(9|10|11|12|14|16)\b/;

/** A plugin's logo from its manifest, or its initial on a tile in its brand colour (or a neutral one). */
export function PluginLogo({ plugin, className }: { plugin: Pick<PluginRecord, "logo" | "brandColor" | "displayName"> & { id?: string }; className?: string }) {
  const Icon = plugin.id ? BUNDLED_ICONS[plugin.id] : undefined;
  if (Icon) {
    const tiled = TILED.test(className ?? "");
    return tiled ? (
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted text-foreground ring-1 ring-border", className)}>
        <Icon className="size-1/2" strokeWidth={1.75} />
      </span>
    ) : (
      <Icon aria-hidden className={cn("size-5 shrink-0", className)} strokeWidth={1.75} />
    );
  }
  if (plugin.logo) {
    return <img alt="" className={cn("size-5 shrink-0 rounded-md bg-white object-contain p-[3px] ring-1 ring-border", className)} src={plugin.logo} />;
  }
  const initial = (plugin.displayName.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground leading-none ring-1 ring-border", className)}
      style={{ backgroundColor: plugin.brandColor ?? undefined, color: plugin.brandColor ? "white" : undefined, containerType: "size" }}
    >
      <span style={{ fontSize: "50cqh" }}>{initial}</span>
    </span>
  );
}
