import { useCallback } from "react";

import { McpAppFrame } from "@renderer/plugins/McpAppFrame";
import { usePlugins } from "@renderer/plugins/store";
import { useProjects } from "@renderer/state/projects";

/**
 * A plugin's global app (a tool with a `global` entrypoint): the whole
 * window beside the rail, with no sidebar of ours, the way Codex shows CAD and
 * Code Review. It runs in the app's scope (not a session's), rooted at the
 * selected project when there is one.
 */
export function GlobalAppSurface({ pluginId, toolId }: { pluginId: string; toolId: string }) {
  const plugin = usePlugins((state) => state.plugins.find((entry) => entry.id === pluginId) ?? null);
  const tool = plugin?.enabled ? plugin.tools.find((entry) => entry.id === toolId) ?? null : null;
  const projectId = useProjects((state) => state.activeId);
  const call = useCallback(async () => {
    if (!tool) return null;
    const result = await window.workbench.plugins.request({ pluginId, server: tool.server, method: "tools/call", params: { name: tool.tool, arguments: {} }, scope: { sessionId: null, projectId } });
    return { arguments: {}, result };
  }, [tool, pluginId, projectId]);
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background" data-testid="plugin-app">
      <div className="app-drag flex h-[var(--titlebar-height)] shrink-0 items-center px-4 font-medium text-sm">
        {plugin?.displayName ?? pluginId}
      </div>
      <div className="min-h-0 flex-1">
        {tool && plugin ? (
          <McpAppFrame call={call} key={`${pluginId}/${toolId}/${projectId}`} placement="page" pluginId={pluginId} pluginName={plugin.displayName}
            resourceUri={tool.resourceUri} scope={{ sessionId: null, projectId }} server={tool.server} tool={tool.tool} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {plugin ? (plugin.enabled ? "Starting…" : `${plugin.displayName} is turned off.`) : "This plugin is not installed any more."}
          </div>
        )}
      </div>
    </main>
  );
}
