import { usePlugins } from "@renderer/plugins/store";
import { useSessions } from "./sessions";
import { useSettings } from "./settings";
import { useUi } from "./ui";
import type { PluginRecord } from "@shared/plugins";
import type { Session, Settings, Surface } from "@shared/types";

/**
 * A relaunch opens where the person was, as Codex does: the session last open
 * and the rail's page last shown, both kept in settings (`lastSessionId`,
 * `lastSurface`). A session archived or deleted since is not reopened, and a
 * plugin page whose plugin is off, removed or no longer offers the tool falls
 * back to home. The tabs themselves come back with their session's strip.
 */

/** The page to reopen, or home when the plugin page it named is not there any more. */
export function surfaceToRestore(saved: Surface | null, plugins: readonly PluginRecord[]): Surface {
  if (!saved || saved.kind !== "app") return saved ?? { kind: "home" };
  const plugin = plugins.find((entry) => entry.id === saved.pluginId);
  const tool = plugin?.enabled ? plugin.tools.find((entry) => entry.id === saved.toolId) : undefined;
  return tool ? saved : { kind: "home" };
}

/** The session to reopen: the one last open, if it is still listed and not archived. */
export function sessionToRestore(saved: string | null, sessions: readonly Session[]): string | null {
  if (!saved) return null;
  return sessions.some((session) => session.id === saved && !session.archived) ? saved : null;
}

/** Reopen where the person was. Called once, after settings, sessions and plugins have loaded. */
export function restoreWhereYouWere(): void {
  const settings = useSettings.getState().settings;
  if (!settings) return;
  const sessions = useSessions.getState();
  if (!sessions.activeId) {
    const id = sessionToRestore(settings.lastSessionId, sessions.sessions);
    if (id) sessions.select(id);
  }
  useUi.getState().setSurface(surfaceToRestore(settings.lastSurface, usePlugins.getState().plugins));
}

/** Keep `lastSessionId` and `lastSurface` current from here on. Returns the unsubscribe. */
export function trackWhereYouWere(): () => void {
  const save = (patch: Partial<Settings>) => void useSettings.getState().patch(patch).catch(() => {});
  const unsessions = useSessions.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId && state.activeId) save({ lastSessionId: state.activeId });
  });
  const unsurface = useUi.subscribe((state, previous) => {
    if (state.surface !== previous.surface) save({ lastSurface: state.surface });
  });
  return () => { unsessions(); unsurface(); };
}
