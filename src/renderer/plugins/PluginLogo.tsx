import { cn } from "@renderer/lib/utils";
import type { PluginRecord } from "@shared/plugins";

/** A plugin's logo from its manifest, or its initial on a tile in its brand colour (or a neutral one). */
export function PluginLogo({ plugin, className }: { plugin: Pick<PluginRecord, "logo" | "brandColor" | "displayName">; className?: string }) {
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
