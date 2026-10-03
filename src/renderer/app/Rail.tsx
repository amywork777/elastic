import { Blocks, House } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@renderer/lib/utils";
import { TooltipHint } from "@workbench/ui/primitives/tooltip";
import { PluginLogo } from "@renderer/plugins/PluginLogo";
import { toolsWithEntry, usePlugins } from "@renderer/plugins/store";
import { useUi, type Surface } from "@renderer/state/ui";

function RailButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <TooltipHint content={label} side="right">
      <button
        aria-current={active ? "page" : undefined}
        aria-label={label}
        className={cn(
          "app-no-drag relative flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </TooltipHint>
  );
}

/**
 * The rail: an app switcher down the window's left edge, as Codex has it.
 * Fixed destinations first (sessions, plugins), then one icon per plugin tool
 * with a `global` entrypoint (its own full-window page). Settings stays where
 * it was: the sidebar's button, the menu and Mod+,. The rail never collapses; the sidebar beside it belongs to whichever
 * item is selected.
 */
export function Rail() {
  const surface = useUi((state) => state.surface);
  const setSurface = useUi((state) => state.setSurface);
  const lastPluginsView = useUi((state) => state.lastPluginsView);
  usePlugins((state) => state.revision);
  const apps = toolsWithEntry("global");
  const is = (kind: Surface["kind"]) => surface.kind === kind;

  return (
    <nav aria-label="Rail" className="flex h-full w-[var(--rail-width)] shrink-0 flex-col items-center gap-1 border-sidebar-border border-r bg-sidebar pb-3" data-rail>
      {/* The traffic lights' strip on macOS, as the sidebar's. */}
      <div className="app-drag h-[var(--titlebar-height)] w-full shrink-0" />
      <RailButton active={is("home")} label="Sessions" onClick={() => setSurface({ kind: "home" })}>
        <House className="size-[18px]" strokeWidth={1.75} />
      </RailButton>
      <RailButton active={is("plugins")} label="Plugins" onClick={() => setSurface({ kind: "plugins", view: lastPluginsView })}>
        <Blocks className="size-[18px]" strokeWidth={1.75} />
      </RailButton>
      {apps.length > 0 ? <div className="my-1 h-px w-6 bg-sidebar-border" /> : null}
      {apps.map(({ plugin, tool }) => (
        <RailButton
          active={surface.kind === "app" && surface.pluginId === plugin.id && surface.toolId === tool.id}
          key={`${plugin.id}/${tool.id}`}
          label={apps.filter((other) => other.plugin.id === plugin.id).length > 1 ? `${plugin.displayName}: ${tool.title}` : plugin.displayName}
          onClick={() => setSurface({ kind: "app", pluginId: plugin.id, toolId: tool.id })}
        >
          <PluginLogo className="size-5" plugin={plugin} />
        </RailButton>
      ))}
    </nav>
  );
}
