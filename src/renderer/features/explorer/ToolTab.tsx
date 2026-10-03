import { useCallback } from "react";

import { McpAppFrame } from "@renderer/plugins/McpAppFrame";
import { PluginStarting } from "@renderer/plugins/PluginStarting";
import { useToolCalls } from "@renderer/plugins/calls";
import { usePlugins } from "@renderer/plugins/store";
import { safeToRepeat } from "@shared/plugins";
import type { ExplorerRoot, Project } from "@shared/types";

/**
 * A plugin tool's view as a tab (an MCP App with a `thread` entrypoint).
 *
 * Opened by the person, the tab calls the tool with no arguments and shows the
 * result; opened by an agent's call, it shows that call. After a relaunch it
 * calls the tool again with the arguments of the call it last showed
 * (`lastArguments`, kept in the tab), so a CAD tab comes back on its model;
 * only for a tool that is safe to repeat (`safeToRepeat`): one that might
 * change something opens empty and says why. A plugin that has
 * since been turned off, removed or that no longer lists the tool says so here
 * rather than leaving an empty tab.
 */
export function ToolTab({ sessionId, project, root, tabId, pluginId, toolId, title, lastArguments }: {
  sessionId: string; project: Project; root: ExplorerRoot; tabId: string; pluginId: string; toolId: string; title: string;
  lastArguments?: Record<string, unknown> | undefined;
}) {
  const plugin = usePlugins((state) => state.plugins.find((entry) => entry.id === pluginId) ?? null);
  const ready = usePlugins((state) => state.ready);
  const tool = plugin?.enabled ? plugin.tools.find((entry) => entry.id === toolId) ?? null : null;
  const listing = plugin?.enabled && plugin.servers.some((server) => server.status === "starting" || server.status === "idle");
  const pending = useToolCalls((state) => state.byTab[tabId] ?? null);
  const scope = { sessionId, projectId: project.id, root };
  const repeat = Boolean(lastArguments && tool && safeToRepeat(tool));
  const call = useCallback(async () => {
    if (pending) return pending.call;
    if (!tool) return null;
    const args = repeat && lastArguments ? lastArguments : {};
    const result = await window.workbench.plugins.request({ pluginId, server: tool.server, method: "tools/call", params: { name: tool.tool, arguments: args }, scope: { sessionId, projectId: project.id, root } });
    return { arguments: args, result };
  }, [pending, tool, repeat, lastArguments, pluginId, sessionId, project.id, root]);

  if (!tool) {
    if (!ready || listing) return <PluginStarting name={plugin?.displayName ?? pluginId} />;
    const why = !plugin ? `${title} came from the plugin "${pluginId}", which is not installed any more.`
      : !plugin.enabled ? `${plugin.displayName} is turned off. Turn it on in Plugins to use ${title}.`
        : `${plugin.displayName} no longer offers ${title}.`;
    return <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-xs">{why}</div>;
  }
  const skipped = !pending && lastArguments && !repeat;
  const frame = (
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
  if (!skipped) return frame;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 border-b px-3 py-1.5 text-muted-foreground text-xs" role="status">
        Reopened without its last view: {tool.title} may change things, so it wasn't run again.
      </p>
      <div className="min-h-0 flex-1">{frame}</div>
    </div>
  );
}
