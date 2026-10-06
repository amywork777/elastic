/**
 * How the browser tab behaves toward sites, kept as pure rules so they can be held by tests
 * (`tests/unit/main/browser-policy.test.ts`); `service.ts` applies them.
 */

/**
 * One storage for every chat's browser tabs: a login to claude.ai, chatgpt.com or Google made in
 * one chat is there in all of them. (Each chat used to have its own and every chat signed in
 * again.) Deleting a chat no longer clears it; Settings › General › Clear browser data does.
 */
export const SHARED_BROWSER_PARTITION = "persist:browser-shared";

/**
 * Chromium's own user agent, without the `Electron/…` and app tokens Electron adds. Google refuses
 * to sign in "this browser or app" when it sees Electron, and other sites treat it as a bot.
 */
export function chromeUserAgent(electronUserAgent: string): string {
  return electronUserAgent
    .split(" ")
    .filter((token) => !/^Electron\//.test(token) && !/^elastic\//i.test(token))
    .join(" ");
}

/** Copy buttons and full-screen video. Never the camera, microphone, location or reading the clipboard. */
const ALLOWED = new Set(["clipboard-sanitized-write", "fullscreen"]);

export function allowsBrowserPermission(permission: string): boolean {
  return ALLOWED.has(permission);
}

/**
 * A `window.open` with a size (`disposition: "new-window"`) is a sign-in pop-up: it gets a real
 * window in the same storage, so the provider can hand the result back to the page that opened it.
 * A link to a new tab keeps loading in the tab itself, as it did. Only http(s) ever opens.
 */
export function popupWindow(details: { url: string; disposition: string; features: string }): { width: number; height: number } | null {
  if (details.disposition !== "new-window") return null;
  let protocol: string;
  try {
    protocol = new URL(details.url).protocol;
  } catch {
    return null;
  }
  if (protocol !== "https:" && protocol !== "http:") return null;
  const size = (name: string, fallback: number) => {
    const value = Number(new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*(\\d+)`).exec(details.features)?.[1]);
    return Number.isFinite(value) && value >= 200 && value <= 2000 ? value : fallback;
  };
  return { width: size("width", 520), height: size("height", 680) };
}
