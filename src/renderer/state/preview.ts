import { useExplorer } from "./explorer";

/**
 * The live preview (`src/main/preview/server.ts`): HTML an agent writes, rendered in the chat's
 * browser tab from a private loopback address, so its relative CSS, scripts and modules load and
 * the agent can drive the page. The tab reloads after the project's files change.
 */

/** `http://127.0.0.1:<port>/<32-hex token>/<path>`: the preview server's address shape. */
const PREVIEW = /^http:\/\/127\.0\.0\.1:\d+\/([0-9a-f]{32})(?:\/(.*))?$/;

export function isPreviewUrl(url: string | null | undefined): boolean {
  return !!url && PREVIEW.test(url);
}

/** The project-relative file a preview address shows, for View source. */
export function previewSourcePath(url: string): string | null {
  const match = PREVIEW.exec(url.split(/[?#]/)[0] ?? url);
  if (!match?.[2]) return null;
  try {
    return match[2].split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** Open `path` (relative to `root`, null for the project) rendered; false when no chat's strip is bound. */
export async function openPreview(path: string, root: string | null): Promise<boolean> {
  const { projectId } = useExplorer.getState();
  if (!projectId) return false;
  const { url } = await window.workbench.preview.url({ projectId, root, path });
  const explorer = useExplorer.getState();
  const showing = explorer.tabs.find((tab) => tab.kind === "browser" && tab.url === url);
  if (showing) {
    explorer.setActive(showing.id);
    return true;
  }
  return explorer.open("browser", root ? { url, root } : { url }) !== null;
}

/** How long the files stay quiet before the previews reload: an agent's edit is several writes. */
const RELOAD_AFTER_MS = 250;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** A project's files changed: its preview tabs reload once the burst is over. */
export function previewFilesChanged(projectId: string): void {
  const existing = pending.get(projectId);
  if (existing) clearTimeout(existing);
  pending.set(projectId, setTimeout(() => {
    pending.delete(projectId);
    for (const tab of useExplorer.getState().tabs) {
      if (tab.kind !== "browser" || tab.projectId !== projectId || !isPreviewUrl(tab.url)) continue;
      void window.workbench.browser
        .navigate({ sessionId: tab.sessionId, projectId: tab.projectId, root: tab.root ?? null, tabId: tab.id, direction: "reload" })
        .catch(() => {});
    }
  }, RELOAD_AFTER_MS));
}
