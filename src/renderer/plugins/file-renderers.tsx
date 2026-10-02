import { defineFileRenderer, type FileRendererProps, type RendererRegistration } from "@workbench/ui/file-viewer";
import { useCallback, useEffect } from "react";

import { Button } from "@renderer/components/ui/button";
import { useProjects } from "@renderer/state/projects";
import type { ExplorerRoot } from "@shared/types";

import { McpAppFrame } from "./McpAppFrame";
import { activeHandler, claimedExtensions, usePlugins, type FileHandlerChoice } from "./store";
import { PluginLogo } from "./PluginLogo";

/** Over every built-in renderer (Markdown and images are 100): a plugin's handler wins unless the person chose Built-in. */
export const PLUGIN_RENDERER_PRIORITY = 200;

type Where = { projectId: string; root: ExplorerRoot; tabId: string; sessionId?: string | null };
type Data = { handler: string; pluginId: string; toolId: string } & Where;

/**
 * The file renderers enabled plugins contribute: one per extension a plugin
 * claims (a tool with a `file` entrypoint), drawn by the plugin's MCP App.
 * Read when a file tab composes its renderers, which it does again whenever
 * the plugins change (`usePlugins` revision).
 */
export function pluginRenderers(where: Where): RendererRegistration[] {
  const state = usePlugins.getState();
  return claimedExtensions(state).flatMap((extension) => {
    const chosen = activeHandler(extension, state);
    if (!chosen) return [];
    return [defineFileRenderer<Data>({
      id: `plugin:${chosen.handler}:${extension}`,
      priority: PLUGIN_RENDERER_PRIORITY,
      matches: (file) => file.extension.replace(/^\./, "").toLowerCase() === extension,
      prepare: async () => ({ data: { handler: chosen.handler, pluginId: chosen.plugin.id, toolId: chosen.tool.id, ...where } }),
      load: async () => ({ default: PluginFileView }),
    })];
  });
}

function PluginFileView({ data, file, onReady }: FileRendererProps<Data>) {
  const plugin = usePlugins((state) => state.plugins.find((entry) => entry.id === data.pluginId) ?? null);
  const tool = plugin?.tools.find((entry) => entry.id === data.toolId) ?? null;
  const projectPath = useProjects((state) => state.projects.find((project) => project.id === data.projectId)?.path ?? null);
  const allowed = usePlugins((state) => projectPath !== null && (state.fileConsent[projectPath]?.includes(data.pluginId) ?? false));
  useEffect(() => onReady(true), [onReady]);
  const scope = { sessionId: data.sessionId ?? null, projectId: data.projectId, root: data.root };
  const call = useCallback(async () => {
    const opened = await window.workbench.plugins.openFile({ pluginId: data.pluginId, toolId: data.toolId, path: file.path, scope });
    return { arguments: opened.arguments, result: opened.result };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope is data's
  }, [data.pluginId, data.toolId, data.projectId, data.root, data.sessionId, file.path]);
  if (!plugin || !tool) return null;
  if (!allowed) return <FileConsent choice={{ handler: data.handler, plugin, tool }} file={file.path} projectId={data.projectId} />;
  return <McpAppFrame call={call} placement="file" pluginId={plugin.id} pluginName={plugin.displayName} resourceUri={tool.resourceUri} scope={scope} server={tool.server} tool={tool.tool} />;
}

/**
 * "Allow <plugin> to open this file?", once per plugin and project: a plugin
 * never reads a file of a project the person did not say it could.
 */
function FileConsent({ choice, file, projectId }: { choice: FileHandlerChoice; file: string; projectId: string }) {
  const { plugin } = choice;
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <PluginLogo className="size-10" plugin={plugin} />
      <div className="space-y-1">
        <div className="font-medium text-sm">Allow {plugin.displayName} to open this file?</div>
        <div className="text-muted-foreground text-xs">{file}</div>
        <div className="max-w-sm text-muted-foreground text-xs">
          {plugin.displayName} will be able to read files in this project when you open them with it. You can switch back to Built-in from the Open with menu.
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void window.workbench.plugins.setFileHandler({ extension, handler: "builtin" })} size="sm" variant="secondary">No, use Built-in</Button>
        <Button onClick={() => void window.workbench.plugins.allowFiles({ projectId, pluginId: plugin.id })} size="sm">Yes, open file</Button>
      </div>
    </div>
  );
}
