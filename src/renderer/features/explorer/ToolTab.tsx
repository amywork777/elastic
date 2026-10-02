import { useCallback } from "react";

import { McpAppFrame } from "@renderer/plugins/McpAppFrame";
import { useToolCalls } from "@renderer/plugins/calls";
import { usePlugins } from "@renderer/plugins/store";
import type { ExplorerRoot, Project } from "@shared/types";

/**
 * A plugin tool's view as a tab (an MCP App with a `thread` entrypoint).
 *
 * Opened by the person, the tab calls the tool with no arguments and shows the
 * result; opened by an agent's call, it shows that call. A plugin that has
 * since been turned off, removed or that no longer lists the tool says so here
 * rather than leaving an empty tab.
 */
export function ToolTab({ sessionId, project, root, tabId, pluginId, toolId, title }: {
  sessionId: string; project: Project; root: ExplorerRoot; tabId: string; pluginId: string; toolId: string; title: string;
}) {
  const plugin = usePlugins((state) => state.plugins.find((entry) => entry.id === pluginId) ?? null);
  const ready = usePlugins((state) => state.ready);
  const tool = plugin?.enabled ? plugin.tools.find((entry) => entry.id === toolId) ?? null : null;
  const listing = plugin?.enabled && plugin.servers.some((server) => server.status === "starting" || server.status === "idle");
  const pending = useToolCalls((state) => state.byTab[tabId] ?? null);
  const scope = { sessionId, projectId: project.id, root };
  const call = useCallback(async () => {
    if (pending) return pending.call;
    if (!tool) return null;
    const result = await window.workbench.plugins.request({ pluginId, server: tool.server, method: "tools/call", params: { name: tool.tool, arguments: {} }, scope: { sessionId, projectId: project.id, root } });
    return { arguments: {}, result };
  }, [pending, tool, pluginId, sessionId, project.id, root]);

  if (!tool) {
    const why = !ready || listing ? `Starting ${plugin?.displayName ?? pluginId}…`
      : !plugin ? `${title} came from the plugin "${pluginId}", which is not installed any more.`
        : !plugin.enabled ? `${plugin.displayName} is turned off. Turn it on in Plugins to use ${title}.`
          : `${plugin.displayName} no longer offers ${title}.`;
    return <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-xs">{why}</div>;
  }
  return (
    <McpAppFrame
      call={call}
      key={pending?.nonce ?? 0}
      placement="tab"
      pluginId={pluginId}
      pluginName={plugin!.displayName}
      resourceUri={tool.resourceUri}
      scope={scope}
      server={tool.server}
      tool={tool.tool}
    />
  );
}
