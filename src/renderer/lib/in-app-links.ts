/** Hosts whose pages open in elastic's browser tab from a reply (⌘-click still opens the system browser). */
const IN_APP_HOSTS = ["claude.ai", "chatgpt.com", "chat.openai.com"];
const LOCAL = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/;

/**
 * A link in a reply that belongs in the app: what an agent just started on this machine
 * (localhost, a loopback address, a `*.localhost` name), where looking at it beside the chat is
 * the point and the agent can drive the same tab; and Claude's and ChatGPT's own pages, which keep
 * their login in the browser tab. The rest of the web goes to the system browser.
 */
export function opensInApp(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL.test(host) || host.endsWith(".localhost")) return true;
  return IN_APP_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
