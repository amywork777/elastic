import { Puzzle } from "lucide-react";

import { cn } from "@renderer/lib/utils";
import type { PluginRecord } from "@shared/plugins";

/** A plugin's logo from its manifest, or a puzzle piece in its brand colour. */
export function PluginLogo({ plugin, className }: { plugin: Pick<PluginRecord, "logo" | "brandColor" | "displayName">; className?: string }) {
  if (plugin.logo) return <img alt="" className={cn("size-5 shrink-0 rounded-md object-contain", className)} src={plugin.logo} />;
  return (
    <span
      aria-hidden
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}
      style={plugin.brandColor ? { backgroundColor: plugin.brandColor, color: "white" } : undefined}
    >
      <Puzzle className="size-[60%]" />
    </span>
  );
}
