import { describe, expect, it } from "vitest";

import { SHARED_BROWSER_PARTITION, allowsBrowserPermission, chromeUserAgent, popupWindow } from "@main/browser/policy";

/**
 * The browser tab as sites expect a browser to behave: signed in once for every chat, a plain
 * Chrome user agent (Google refuses sign-in to one naming Electron), copy buttons that copy, and a
 * sign-in pop-up that opens as a window and can report back to its page.
 */
describe("browser tab policy", () => {
  it("is one storage for every chat, so a login carries over", () => {
    expect(SHARED_BROWSER_PARTITION).toBe("persist:browser-shared");
  });

  it("names Chrome, not Electron or the app, in its user agent", () => {
    const electron = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) elastic/0.1.9 Chrome/144.0.7559.236 Electron/40.10.6 Safari/537.36";
    expect(chromeUserAgent(electron)).toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Safari/537.36");
  });

  it("lets a page write to the clipboard and go full screen, and nothing else", () => {
    expect(allowsBrowserPermission("clipboard-sanitized-write")).toBe(true);
    expect(allowsBrowserPermission("fullscreen")).toBe(true);
    for (const refused of ["media", "geolocation", "notifications", "clipboard-read", "display-capture", "openExternal"]) {
      expect(allowsBrowserPermission(refused), refused).toBe(false);
    }
  });

  it("opens a sized pop-up (a sign-in) as a window, and a link to a new tab in the same tab", () => {
    expect(popupWindow({ url: "https://accounts.google.com/o/oauth2", disposition: "new-window", features: "width=500,height=600" })).toEqual({ width: 500, height: 600 });
    expect(popupWindow({ url: "https://example.com", disposition: "foreground-tab", features: "" })).toBeNull();
    expect(popupWindow({ url: "file:///etc/passwd", disposition: "new-window", features: "width=500" })).toBeNull();
  });
});
