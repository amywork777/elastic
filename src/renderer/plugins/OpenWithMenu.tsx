import { Check, ChevronDown, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";

import { PluginLogo } from "./PluginLogo";
import { activeHandler, handlersFor, usePlugins } from "./store";

/**
 * "Open ▾" above a file whose extension a plugin claims: Built-in, or each
 * plugin that opens it. Choosing sets the handler for the extension (Settings
 * › Plugins shows the same choice). Nothing is drawn for a file no plugin
 * claims.
 */
export function OpenWithMenu({ path }: { path: string | null }) {
  const extension = path?.split("/").pop()?.split(".").slice(1).pop()?.toLowerCase() ?? "";
  // Re-render on any plugin change; the helpers read the store's state.
  usePlugins((state) => state.revision);
  const handlers = extension ? handlersFor(extension) : [];
  if (handlers.length === 0) return null;
  const active = activeHandler(extension);
  const choose = (handler: string) => {
    void window.workbench.plugins.setFileHandler({ extension, handler }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Open with" className="h-6 gap-1 px-1.5 text-xs" size="sm" variant="ghost">
          {active ? <PluginLogo className="size-3.5" plugin={active.plugin} /> : <FileText className="size-3.5" />}
          {active ? active.plugin.displayName : "Built-in"}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Open .{extension} files with</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => choose("builtin")}>
          <FileText className="size-4" /> Built-in {active === null ? <Check className="ml-auto size-4" /> : null}
        </DropdownMenuItem>
        {handlers.map((entry) => (
          <DropdownMenuItem key={entry.handler} onSelect={() => choose(entry.handler)}>
            <PluginLogo className="size-4" plugin={entry.plugin} />
            {entry.plugin.displayName}{handlers.filter((other) => other.plugin.id === entry.plugin.id).length > 1 ? ` · ${entry.tool.title}` : ""}
            {active?.handler === entry.handler ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
