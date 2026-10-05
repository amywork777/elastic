/**
 * Handlers for the `app.*` branch's updater channels (P8).
 *
 * The counterpart to `src/shared/ipc/app.ts`: one file, spread into the handler
 * tree in `./index.ts`, so the phase that owns the updater owns its IPC too and
 * `index.ts` gains a line rather than a section.
 */
import os from "node:os";

import { app } from "electron";

import { formatDiagnostics, recentErrors } from "../diagnostics";
import { plugins } from "../integrations";
import { providerStore } from "../providers";
import { checkForUpdates, downloadUpdate, installUpdate, updateStatus } from "../updater";
import { detector } from "./agents";

/** Each source answers on its own: one that is not ready leaves its section empty, not the report. */
function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export const appHandlers = {
  updateStatus: () => updateStatus(),
  checkForUpdates: () => checkForUpdates(),
  downloadUpdate: () => downloadUpdate(),
  // Returns before the app is gone: `quitAndInstall` unwinds asynchronously,
  // and the renderer's promise resolving is what tells it the request landed.
  installUpdate: () => installUpdate(),
  diagnostics: () => ({
    text: formatDiagnostics({
      version: app.getVersion(),
      commit: __APP_COMMIT__,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      agents: attempt(() => detector.list(), []).map((agent) => ({ name: agent.name, installed: agent.installed, version: agent.version, auth: agent.auth })),
      plugins: attempt(() => plugins().snapshot().plugins, []).map((plugin) => ({
        name: plugin.displayName,
        enabled: plugin.enabled,
        version: plugin.version,
        error: plugin.error,
        servers: plugin.servers.map((server) => ({ name: server.name, status: server.status, error: server.error })),
      })),
      // Kinds only: a key, a header or a URL with credentials never reaches the report.
      providers: attempt(() => providerStore().list(), []).map((provider) => ({ kind: provider.kind })),
      errors: recentErrors(),
    }),
  }),
};
