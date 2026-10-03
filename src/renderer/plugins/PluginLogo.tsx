import { cn } from "@renderer/lib/utils";
import type { PluginRecord } from "@shared/plugins";

/**
 * Flat pastel tiles for plugins that ship no logo (taste's scrapbook pastels), picked by name
 * so a plugin keeps its colour everywhere. The letter is plum ink, readable on every one.
 */
const TILES = ["#ffd1e1", "#a8e6cf", "#fff3b0", "#c8a2f0", "#b8d4f0", "#ffd4a8"];

function tileFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TILES[hash % TILES.length]!;
}

/** A plugin's logo from its manifest, or its initial on a tile in its brand colour (or a pastel). */
export function PluginLogo({ plugin, className }: { plugin: Pick<PluginRecord, "logo" | "brandColor" | "displayName">; className?: string }) {
  if (plugin.logo) {
    return <img alt="" className={cn("size-5 shrink-0 rounded-md bg-white object-contain p-[3px] ring-1 ring-border", className)} src={plugin.logo} />;
  }
  const initial = (plugin.displayName.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-md font-semibold text-[#3a2a47] leading-none ring-1 ring-black/5", className)}
      style={{ backgroundColor: plugin.brandColor ?? tileFor(plugin.displayName), color: plugin.brandColor ? "white" : undefined, containerType: "size" }}
    >
      <span style={{ fontSize: "50cqh" }}>{initial}</span>
    </span>
  );
}
