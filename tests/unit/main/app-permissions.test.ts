/**
 * What the app's own session grants (`src/main/app-permissions.ts`): the
 * clipboard, and the microphone for dictation, to the app page alone — never
 * to a plugin's frame, never video, never anything else.
 */
import { describe, expect, it } from "vitest";

import { allowsCheck, allowsRequest, isAppPage } from "@main/app-permissions";

const APP = "file:///Applications/elastic.app/Contents/Resources/app.asar/out/renderer/index.html";
const DEV = "http://localhost:5173";

describe("the app page", () => {
  it("is the built renderer on disk, or the dev server's origin", () => {
    expect(isAppPage(APP, undefined)).toBe(true);
    expect(isAppPage(`${DEV}/index.html`, DEV)).toBe(true);
    expect(isAppPage(`${DEV}/index.html`, undefined)).toBe(false);
    expect(isAppPage("mcp-app://abc123/index.html", DEV)).toBe(false);
    expect(isAppPage("https://example.com/", DEV)).toBe(false);
    expect(isAppPage("not a url", DEV)).toBe(false);
  });
});

describe("requests", () => {
  it("grants clipboard writes to anyone in the session, and reads to the app page only", () => {
    expect(allowsRequest("clipboard-sanitized-write", {}, undefined)).toBe(true);
    expect(allowsRequest("clipboard-sanitized-write", { requestingUrl: "mcp-app://abc/" }, undefined)).toBe(true);
    expect(allowsRequest("clipboard-read", {}, undefined)).toBe(true);
    expect(allowsRequest("clipboard-read", { requestingUrl: APP }, undefined)).toBe(true);
    // A plugin's view does not read what the person copied.
    expect(allowsRequest("clipboard-read", { requestingUrl: "mcp-app://abc/" }, undefined)).toBe(false);
  });

  it("grants the microphone to the app page's top frame, audio only", () => {
    expect(allowsRequest("media", { requestingUrl: APP, isMainFrame: true, mediaTypes: ["audio"] }, undefined)).toBe(true);
    expect(allowsRequest("media", { requestingUrl: APP, isMainFrame: true, mediaTypes: ["audio", "video"] }, undefined)).toBe(false);
    expect(allowsRequest("media", { requestingUrl: APP, isMainFrame: true, mediaTypes: [] }, undefined)).toBe(false);
    expect(allowsRequest("media", { requestingUrl: APP, isMainFrame: false, mediaTypes: ["audio"] }, undefined)).toBe(false);
    // A plugin's view is a frame in this session: it does not get to listen.
    expect(allowsRequest("media", { requestingUrl: "mcp-app://abc/", isMainFrame: true, mediaTypes: ["audio"] }, undefined)).toBe(false);
  });

  it("refuses everything else", () => {
    for (const permission of ["notifications", "geolocation", "display-capture", "openExternal", "fullscreen"]) {
      expect(allowsRequest(permission, { requestingUrl: APP, isMainFrame: true }, undefined), permission).toBe(false);
    }
  });
});

describe("checks", () => {
  it("answers yes for the app page's microphone and no for its camera or a plugin's", () => {
    expect(allowsCheck("media", { requestingUrl: APP, isMainFrame: true, mediaType: "audio" }, undefined)).toBe(true);
    expect(allowsCheck("media", { requestingUrl: APP, isMainFrame: true, mediaType: "video" }, undefined)).toBe(false);
    expect(allowsCheck("media", { requestingUrl: "mcp-app://abc/", isMainFrame: true, mediaType: "audio" }, undefined)).toBe(false);
    expect(allowsCheck("clipboard-read", {}, undefined)).toBe(true);
    expect(allowsCheck("clipboard-read", { requestingUrl: APP }, undefined)).toBe(true);
    expect(allowsCheck("clipboard-read", { requestingUrl: "mcp-app://abc/" }, undefined)).toBe(false);
    expect(allowsCheck("notifications", { requestingUrl: APP, isMainFrame: true }, undefined)).toBe(false);
  });
});
