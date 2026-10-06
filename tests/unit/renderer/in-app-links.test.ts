import { describe, expect, it } from "vitest";

import { opensInApp } from "@renderer/lib/in-app-links";

/** Which links in a reply open in elastic's own browser tab rather than the system browser. */
describe("opensInApp", () => {
  it("keeps what an agent just built, and Claude's and ChatGPT's pages, in the app", () => {
    for (const href of [
      "http://localhost:5173/", "http://127.0.0.1:8080/x", "http://0.0.0.0:3000", "http://[::1]:4000/", "http://app.localhost:3000/",
      "https://claude.ai/public/artifacts/abc", "https://claude.ai/chat/1", "https://chatgpt.com/c/123", "https://chat.openai.com/share/x",
    ]) expect(opensInApp(href), href).toBe(true);
  });

  it("sends the rest of the web to the system browser", () => {
    for (const href of ["https://github.com/x", "https://notclaude.ai/", "https://claude.ai.evil.com/", "mailto:a@b.c", "not a url", "file:///etc/hosts"]) {
      expect(opensInApp(href), href).toBe(false);
    }
  });
});
