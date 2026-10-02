/**
 * `mcp-app://`: where an MCP App's HTML is served from.
 *
 * The window's own Content-Security-Policy forbids inline script, and an
 * `srcdoc` or `blob:` frame inherits it, so an app (one inline-bundled HTML
 * file, as MCP Apps ship) would not run. Served from its own scheme instead,
 * the frame is a document of its own with the policy MCP Apps describes: no
 * network unless the resource's `_meta.ui.csp` names domains, scripts and
 * styles inline or from its `resourceDomains`. The renderer's `<iframe>` is
 * sandboxed without `allow-same-origin` on top, so the app has an opaque origin
 * and talks to the host by `postMessage` alone.
 *
 * The renderer stages a document (`plugins.stageApp`) and gets a one-off URL;
 * the document is dropped when its frame is torn down (`plugins.releaseApp`)
 * and never outlives the app.
 */
import { randomBytes } from "node:crypto";

import { protocol } from "electron";

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
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${APP_SCHEME}:`) staged.delete(parsed.hostname);
  } catch { /* not one of ours */ }
}
