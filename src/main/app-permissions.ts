/**
 * What the app's own page may ask Chromium for: the clipboard, which the
 * terminal pastes from and the sidebar's Copy path writes to, and the
 * microphone, for the composer's dictation (`src/main/dictation`). Nothing
 * else — not the camera, not notifications, not the screen — because Electron
 * grants every request a session has no handler for.
 *
 * The microphone is the app page's alone: audio only, from the top frame, at
 * the app's own URL. Plugin views are frames in this same session
 * (`mcp-app://`), and a plugin does not get to listen. Browser tabs are in
 * partitions of their own that refuse everything (`src/main/browser/service.ts`).
 */
const ALWAYS: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

/**
 * Reading the clipboard is the app page's: the terminal pastes from it. A frame that says it is
 * somewhere else (a plugin's `mcp-app:` view) is refused, so a plugin cannot read what the person
 * copied without them pasting it. A request that names no URL is answered as before, yes: the
 * app page's own paste must not break on a detail Electron left out.
 */
function allowsClipboardRead(requestingUrl: string | undefined, devServer: string | undefined): boolean {
  return !requestingUrl || isAppPage(requestingUrl, devServer);
}

/** The app page: the built renderer from disk, or the dev server's. */
export function isAppPage(url: string, devServer: string | undefined): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    return devServer !== undefined && parsed.origin === new URL(devServer).origin;
  } catch {
    return false;
  }
}

export function allowsRequest(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: readonly string[] } | undefined,
  devServer: string | undefined,
): boolean {
  if (ALWAYS.has(permission)) return true;
  if (permission === "clipboard-read") return allowsClipboardRead(details?.requestingUrl, devServer);
  if (permission !== "media" || !details) return false;
  const types = details.mediaTypes ?? [];
  return (
    details.isMainFrame === true &&
    types.length > 0 &&
    types.every((type) => type === "audio") &&
    isAppPage(details.requestingUrl ?? "", devServer)
  );
}

export function allowsCheck(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean; mediaType?: string } | undefined,
  devServer: string | undefined,
): boolean {
  if (ALWAYS.has(permission)) return true;
  if (permission === "clipboard-read") return allowsClipboardRead(details?.requestingUrl, devServer);
  if (!details) return false;
  return (
    permission === "media" &&
    details.mediaType === "audio" &&
    details.isMainFrame === true &&
    isAppPage(details.requestingUrl ?? "", devServer)
  );
}

export function restrictAppPermissions(session: Electron.Session, devServer: string | undefined): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowsRequest(permission, details as Parameters<typeof allowsRequest>[1], devServer)),
  );
  session.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    allowsCheck(permission, details, devServer),
  );
}
