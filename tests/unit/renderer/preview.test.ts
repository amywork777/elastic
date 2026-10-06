import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isPreviewUrl, openPreview, previewFilesChanged, previewSourcePath } from "@renderer/state/preview";
import { useExplorer } from "@renderer/state/explorer";

/** The live preview: an agent's HTML rendered in the chat's browser tab, reloaded on every save. */
const URL_A = "http://127.0.0.1:51234/0123456789abcdef0123456789abcdef/site/index.html";

beforeEach(() => {
  vi.useFakeTimers();
  (window.workbench as unknown as { preview: unknown }).preview = { url: vi.fn(async () => ({ url: URL_A })) };
  (window.workbench.browser as unknown as { navigate: unknown }).navigate = vi.fn(async () => ({}));
});
afterEach(() => vi.useRealTimers());

describe("live preview", () => {
  it("tells a preview address from any other page, and reads the file it shows", () => {
    expect(isPreviewUrl(URL_A)).toBe(true);
    expect(isPreviewUrl("http://localhost:5173/")).toBe(false);
    expect(isPreviewUrl("https://claude.ai/x")).toBe(false);
    expect(previewSourcePath(URL_A)).toBe("site/index.html");
    expect(previewSourcePath("http://127.0.0.1:1/0123456789abcdef0123456789abcdef/a%20b.html")).toBe("a b.html");
  });

  it("opens a file's preview in a browser tab, and brings forward one already showing it", async () => {
    const open = vi.fn(() => ({ id: "t1" }));
    const setActive = vi.fn();
    useExplorer.setState({ projectId: "p1", sessionId: "s1", tabs: [], open, setActive } as never);
    expect(await openPreview("site/index.html", null)).toBe(true);
    expect(window.workbench.preview.url).toHaveBeenCalledWith({ projectId: "p1", root: null, path: "site/index.html" });
    expect(open).toHaveBeenCalledWith("browser", { url: URL_A });

    useExplorer.setState({ tabs: [{ id: "t1", kind: "browser", url: URL_A, sessionId: "s1", projectId: "p1", root: null }] } as never);
    open.mockClear();
    await openPreview("site/index.html", null);
    expect(open).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith("t1");
  });

  it("reloads the project's preview tabs once after a burst of saves, and no other page", () => {
    useExplorer.setState({
      tabs: [
        { id: "t1", kind: "browser", url: URL_A, sessionId: "s1", projectId: "p1", root: null },
        { id: "t2", kind: "browser", url: "https://claude.ai/", sessionId: "s1", projectId: "p1", root: null },
        { id: "t3", kind: "browser", url: URL_A, sessionId: "s1", projectId: "p2", root: null },
      ],
    } as never);
    previewFilesChanged("p1");
    previewFilesChanged("p1");
    previewFilesChanged("p1");
    vi.advanceTimersByTime(400);
    expect(window.workbench.browser.navigate).toHaveBeenCalledTimes(1);
    expect(window.workbench.browser.navigate).toHaveBeenCalledWith({ sessionId: "s1", projectId: "p1", root: null, tabId: "t1", direction: "reload" });
  });
});
