/**
 * `mcp-app://`: where an MCP App's HTML is served from.
 *
 * The window's own Content-Security-Policy forbids inline script, and an
 * `srcdoc` or `blob:` frame inherits it, so an app (one inline-bundled HTML
 * file, as MCP Apps ship) would not run. Served from its own scheme instead,
 * the frame is a document of its own with the policy MCP Apps describes: no
 * network unless the resource's `_meta.ui.csp` names domains, scripts and
 * styles inline or from its `resourceDomains`.
 *
 * Every staged document is its own origin, `mcp-app://<random id>`: never the
 * app's (a file or the dev server) and never another frame's. The renderer's
 * `<iframe>` keeps `allow-same-origin` so that origin is real rather than
 * opaque, as an MCP Apps host's sandbox origin is (and as Codex hosts them):
 * module workers, `blob:` workers and storage need one, and text-to-cad's CAD
 * page starts its model workers that way. Same-origin with itself only: the
 * app's document, `window.workbench` (the preload runs in the main frame
 * alone) and every other app stay out of reach, the frame cannot navigate the
 * top window (no `allow-top-navigation`) or itself to another origin
 * (`guardAppFrames`), and its storage is cleared with it. It talks to the host
 * by `postMessage` alone.
 *
 * The renderer stages a document (`plugins.stageApp`) and gets a one-off URL;
 * the document and its origin's storage are dropped when its frame is torn
 * down (`plugins.releaseApp`) and never outlive the app.
 */
import { randomBytes } from "node:crypto";

import { protocol, session, type WebContents } from "electron";

export const APP_SCHEME = "mcp-app";

type Staged = { html: string; csp: string };
const staged = new Map<string, Staged>();
const MAX_STAGED = 64;

/** Before `app.ready`: the scheme is a standard, secure one, so the frame is a real document. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** Once ready. */
export function serveAppScheme(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const id = new URL(request.url).hostname;
    const document = staged.get(id);
    if (!document) return new Response("This view was closed. Reopen it.", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(document.html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": document.csp, "cache-control": "no-store" } });
  });
}

const DOMAIN = /^(https?:\/\/|wss?:\/\/)?[A-Za-z0-9*.-]+(:\d+|:\*)?(\/[^\s;,'"]*)?$/;

/** Scheme sources an app may name too: a page that builds workers and models from `blob:`/`data:` URLs fetches them (text-to-cad's CAD page). */
const SCHEMES = new Set(["data:", "blob:"]);

function domains(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string" && (SCHEMES.has(entry) || DOMAIN.test(entry))) : [];
}

/** The policy for one app, from its resource's `_meta.ui.csp` (MCP Apps: `connectDomains`, `resourceDomains`, `frameDomains`). */
export function appPolicy(csp: unknown): string {
  const declared = (csp && typeof csp === "object" ? csp : {}) as Record<string, unknown>;
  const connect = domains(declared.connectDomains);
  const resources = domains(declared.resourceDomains);
  const frames = domains(declared.frameDomains);
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  return [
    "default-src 'none'",
    `script-src ${join("'unsafe-inline'", "'wasm-unsafe-eval'", "blob:", ...resources)}`,
    `style-src ${join("'unsafe-inline'", ...resources)}`,
    `img-src ${join("data:", "blob:", ...resources)}`,
    `font-src ${join("data:", ...resources)}`,
    `media-src ${join("data:", "blob:", ...resources)}`,
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
    `frame-src ${frames.length > 0 ? frames.join(" ") : "'none'"}`,
    "worker-src blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function stageApp(html: string, csp: unknown): string {
  const id = randomBytes(12).toString("hex");
  staged.set(id, { html, csp: appPolicy(csp) });
  // A renderer that never releases (a crash, a reload) cannot grow this without bound.
  while (staged.size > MAX_STAGED) staged.delete(staged.keys().next().value!);
  return `${APP_SCHEME}://${id}/index.html`;
}

export function releaseApp(url: string): void {
  let id: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APP_SCHEME}:`) return;
    id = parsed.hostname;
  } catch { return; /* not one of ours */ }
  staged.delete(id);
  void session.defaultSession.clearStorageData({ origin: `${APP_SCHEME}://${id}` }).catch(() => {});
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` ? `${APP_SCHEME}://${parsed.hostname}` : null;
  } catch { return null; }
}

/**
 * Whether a frame showing `from` may go to `to`. An app's frame stays on its own
 * origin (its pages, its reloads); it never becomes the app's document, another
 * app's or the web. Frames that are not apps are not this rule's business.
 */
export function frameNavigationAllowed(from: string | undefined, to: string): boolean {
  const own = originOf(from);
  if (own === null) return true;
  return originOf(to) === own;
}

/** The window's half of the rule: every sub-frame navigation goes through `frameNavigationAllowed`. */
export function guardAppFrames(contents: WebContents): void {
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    if (!frameNavigationAllowed(event.frame?.url, event.url)) event.preventDefault();
  });
}
