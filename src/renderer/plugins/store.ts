import { create } from "zustand";

import { registerReferenceExtensions } from "@shared/file-refs";
import type { PluginsSnapshot } from "@shared/ipc/plugins";
import { fileExtensionsOf, toolHasEntry, type PluginRecord, type PluginTool } from "@shared/plugins";

/**
 * The installed plugins, as main last pushed them (`plugins.changed`).
 *
 * `revision` goes up with every snapshot: the explorer's file renderers are
 * composed from it, so an install, a toggle or a handler choice re-picks the
 * renderer of every open file.
 */
type PluginsState = PluginsSnapshot & {
  ready: boolean;
  revision: number;
  load: () => Promise<void>;
  receive: (snapshot: PluginsSnapshot) => void;
};

const EMPTY: PluginsSnapshot = { plugins: [], marketplaces: [], catalog: [], fileHandlers: {}, fileConsent: {} };

/**
 * The formats enabled plugins open are the ones the composer and the
 * transcript treat as references (`name.ext#fragment` chips and links):
 * registered with `@shared/file-refs` while their plugin is on.
 */
let releaseReferences: (() => void) | null = null;
function registerReferences(snapshot: PluginsSnapshot): void {
  releaseReferences?.();
  releaseReferences = registerReferenceExtensions(claimedExtensions(snapshot));
}

export const usePlugins = create<PluginsState>((set) => ({
  ...EMPTY,
  ready: false,
  revision: 0,
  load: async () => {
    const snapshot = await window.workbench.plugins.list();
    registerReferences(snapshot);
    set((state) => ({ ...snapshot, ready: true, revision: state.revision + 1 }));
  },
  receive: (snapshot) => {
    registerReferences(snapshot);
    set((state) => ({ ...snapshot, ready: true, revision: state.revision + 1 }));
  },
}));

export function enabledPlugins(state: Pick<PluginsSnapshot, "plugins"> = usePlugins.getState()): PluginRecord[] {
  return state.plugins.filter((plugin) => plugin.enabled && !plugin.error);
}

/** An enabled plugin's tool with a UI, or null. */
export function pluginTool(pluginId: string, toolId: string): PluginTool | null {
  return enabledPlugins().find((plugin) => plugin.id === pluginId)?.tools.find((tool) => tool.id === toolId) ?? null;
}

export function pluginById(pluginId: string): PluginRecord | null {
  return usePlugins.getState().plugins.find((plugin) => plugin.id === pluginId) ?? null;
}

/** Every enabled tool with this entrypoint, with its plugin. */
export function toolsWithEntry(type: "global" | "thread" | "file", state: Pick<PluginsSnapshot, "plugins"> = usePlugins.getState()): Array<{ plugin: PluginRecord; tool: PluginTool }> {
  return enabledPlugins(state).flatMap((plugin) => plugin.tools.filter((tool) => toolHasEntry(tool, type)).map((tool) => ({ plugin, tool })));
}

export type FileHandlerChoice = { handler: string; plugin: PluginRecord; tool: PluginTool };

/** The plugin tools that open an extension (no dot, any case). */
export function handlersFor(extension: string, state: Pick<PluginsSnapshot, "plugins"> = usePlugins.getState()): FileHandlerChoice[] {
  const key = extension.replace(/^\./, "").toLowerCase();
  return toolsWithEntry("file", state)
    .filter(({ tool }) => fileExtensionsOf(tool).includes(key))
    .map(({ plugin, tool }) => ({ handler: `${plugin.id}/${tool.id}`, plugin, tool }));
}

/**
 * Who renders an extension: the person's choice when it still exists, else the
 * first plugin that claims it, else the built-in renderers (null).
 */
export function activeHandler(extension: string, state: Pick<PluginsSnapshot, "plugins" | "fileHandlers"> = usePlugins.getState()): FileHandlerChoice | null {
  const key = extension.replace(/^\./, "").toLowerCase();
  const choice = state.fileHandlers[key];
  if (choice === "builtin") return null;
  const handlers = handlersFor(key, state);
  return handlers.find((entry) => entry.handler === choice) ?? handlers[0] ?? null;
}

/** Every extension some enabled plugin claims, sorted. */
export function claimedExtensions(state: Pick<PluginsSnapshot, "plugins"> = usePlugins.getState()): string[] {
  return [...new Set(toolsWithEntry("file", state).flatMap(({ tool }) => fileExtensionsOf(tool)))].sort();
}
