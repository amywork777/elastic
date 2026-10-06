import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageOccluded, useBrowser } from "@renderer/state/browser";
import { useExplorer } from "@renderer/state/explorer";
import { useSessions } from "@renderer/state/sessions";
import type { BrowserTarget } from "@shared/browser";

const binding = { sessionId: "browser-session", projectId: "browser-project", root: null, tabId: "browser-tab" };
const target: BrowserTarget = { ...binding, root: "/browser-project", generation: 0, title: "Form", url: "https://example.com/", loading: false, canGoBack: false, canGoForward: false, visible: false, logs: [] };
let element: HTMLDivElement;
let cleanups: (() => void)[];

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useBrowser.setState({ targets: {}, errors: {}, consoles: {} });
  useExplorer.setState({ sessionId: "browser-session", projectId: binding.projectId, root: null, tabs: [{ sessionId: "browser-session", id: binding.tabId, projectId: binding.projectId, kind: "browser", root: null, url: target.url, order: 0 }], activeId: binding.tabId, ready: true });
  useSessions.setState({ activeId: "browser-session" });
  vi.mocked(window.workbench.browser.ensure).mockResolvedValue(target);
  vi.mocked(window.workbench.browser.metadata).mockResolvedValue(target);
  element = document.createElement("div");
  element.getBoundingClientRect = () => ({ x: 700, y: 70, width: 600, height: 500, left: 700, top: 70, right: 1300, bottom: 570, toJSON() {} });
  document.body.append(element);
  cleanups = [];
});
afterEach(() => {
  cleanups.forEach(clean => clean());
  element.remove();
  vi.clearAllTimers(); vi.useRealTimers();
});
const mount = () => { const cleanup = useBrowser.getState().mount(binding, target.url, element); cleanups.push(cleanup); return cleanup; };

// These exercise the UI/native lifetime seam, not Chromium's implementation.
describe("browser presentation lifetime", () => {
  it("hides on unmount and reacquires the same page identity without a navigation or close", async () => {
    const release = mount();
    await vi.advanceTimersByTimeAsync(1);
    const first = vi.mocked(window.workbench.browser.present).mock.calls[0]![0];
    expect(first).toMatchObject({ ...binding, bounds: { x: 700, y: 70, width: 600, height: 500 } });
    release();
    expect(window.workbench.browser.present).toHaveBeenLastCalledWith({ ...binding, lease: first.lease, bounds: null });
    mount();
    await vi.advanceTimersByTimeAsync(1);
    const latest = vi.mocked(window.workbench.browser.present).mock.calls.at(-1)![0];
    expect(latest.lease).not.toBe(first.lease);
    expect(latest.tabId).toBe(first.tabId);
    expect(window.workbench.browser.navigate).not.toHaveBeenCalled();
    expect(window.workbench.browser.close).not.toHaveBeenCalled();
  });
  it("never presents an old project after its asynchronous page creation finishes", async () => {
    let finish!: (target: BrowserTarget) => void;
    vi.mocked(window.workbench.browser.ensure).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const release = mount();
    release();
    useExplorer.setState({ sessionId: "browser-session", projectId: "another-project", tabs: [] });
    finish(target);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(window.workbench.browser.present).mock.calls.every(([request]) => request.bounds === null)).toBe(true);
    expect(useExplorer.getState().tabs).toEqual([]);
  });
  it("hides the page the moment its tab or its chat stops being selected, before anything renders", async () => {
    mount();
    await vi.advanceTimersByTimeAsync(1);
    const present = vi.mocked(window.workbench.browser.present);
    expect(present.mock.calls.at(-1)![0].bounds).not.toBeNull();
    // Another tab: hidden in the same tick as the store write, no frame or timer between.
    useExplorer.setState({ activeId: "another-tab" });
    expect(present.mock.calls.at(-1)![0].bounds).toBeNull();
    const calls = present.mock.calls.length;
    // Not shown again by the next layout pass while it is not selected.
    await vi.advanceTimersByTimeAsync(600);
    expect(present.mock.calls.slice(calls).every(([request]) => request.bounds === null)).toBe(true);
    // Selected again: back on the next frame.
    useExplorer.setState({ activeId: binding.tabId });
    await vi.advanceTimersByTimeAsync(20);
    expect(present.mock.calls.at(-1)![0].bounds).not.toBeNull();
    // Another chat in the sidebar: hidden at once too.
    useSessions.setState({ activeId: "another-session" });
    expect(present.mock.calls.at(-1)![0].bounds).toBeNull();
  });

  it("hides on the press of another tab or chat, and shows again when the press selects nothing", async () => {
    mount();
    await vi.advanceTimersByTimeAsync(1);
    const present = vi.mocked(window.workbench.browser.present);
    const other = document.createElement("div");
    other.dataset.tab = "another-tab";
    const own = document.createElement("div");
    own.dataset.tab = binding.tabId;
    const chat = document.createElement("button");
    chat.dataset.sessionRow = "another-session";
    document.body.append(other, own, chat);
    const press = (target: Element, type = "pointerdown") => target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    try {
      // Its own tab: nothing to hide.
      press(own);
      expect(present.mock.calls.at(-1)![0].bounds).not.toBeNull();
      // Another tab, on the press: hidden before any click.
      press(other);
      expect(present.mock.calls.at(-1)![0].bounds).toBeNull();
      // Let go with the selection unchanged (a drag that went nowhere): back on the next frame.
      press(other, "pointerup");
      await vi.advanceTimersByTimeAsync(20);
      expect(present.mock.calls.at(-1)![0].bounds).not.toBeNull();
      // Another chat in the sidebar, on the press too.
      press(chat);
      expect(present.mock.calls.at(-1)![0].bounds).toBeNull();
    } finally {
      other.remove(); own.remove(); chat.remove();
    }
  });

  it("hides native content while a dialog overlays it and restores afterward", async () => {
    mount(); await vi.advanceTimersByTimeAsync(1);
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.append(dialog);
    await vi.advanceTimersByTimeAsync(20);
    expect(vi.mocked(window.workbench.browser.present).mock.calls.at(-1)![0].bounds).toBeNull();
    dialog.remove(); await vi.advanceTimersByTimeAsync(20);
    expect(vi.mocked(window.workbench.browser.present).mock.calls.at(-1)![0].bounds).not.toBeNull();
  });
  it("closing a browser strip tab destroys the owned native target", () => {
    useExplorer.getState().close(binding.tabId);
    expect(window.workbench.browser.close).toHaveBeenCalledWith(binding);
  });
});

describe("browser chrome cost", () => {
  it("coalesces a burst of DOM mutations into one measurement per animation frame", async () => {
    mount(); await vi.advanceTimersByTimeAsync(1);
    const measure = vi.spyOn(element, "getBoundingClientRect");
    const query = vi.spyOn(document, "querySelector");
    // A streamed transcript: many mutations, each delivered in its own
    // microtask, all inside one frame.
    for (let token = 0; token < 50; token += 1) { document.body.append(document.createElement("span")); await Promise.resolve(); }
    await vi.advanceTimersByTimeAsync(20);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(1);
    expect(query.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it("polls without console lines unless the console is open", async () => {
    mount(); await vi.advanceTimersByTimeAsync(501);
    expect(window.workbench.browser.metadata).toHaveBeenLastCalledWith({ ...binding, logs: false });
    useBrowser.getState().setConsoleOpen(binding.tabId, true);
    await vi.advanceTimersByTimeAsync(1);
    expect(window.workbench.browser.metadata).toHaveBeenLastCalledWith({ ...binding, logs: true });
  });
  it("keeps the console lines it has when a poll carries none", async () => {
    vi.mocked(window.workbench.browser.ensure).mockResolvedValue({ ...target, logs: [{ level: "error", message: "boom" }], errors: 1 });
    vi.mocked(window.workbench.browser.metadata).mockResolvedValue({ ...target, logs: [], errors: 1 });
    mount(); await vi.advanceTimersByTimeAsync(501);
    expect(useBrowser.getState().targets[binding.tabId]).toMatchObject({ logs: [{ level: "error", message: "boom" }], errors: 1 });
  });
  it("does not publish a new state when a poll changed nothing", async () => {
    mount(); await vi.advanceTimersByTimeAsync(1);
    const changes = vi.fn();
    const unsubscribe = useBrowser.subscribe(changes);
    await vi.advanceTimersByTimeAsync(2_000);
    unsubscribe();
    expect(window.workbench.browser.metadata).toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
  });
  it("stops polling once the workspace refuses the tab, and resumes after a navigation or wake", async () => {
    vi.mocked(window.workbench.browser.metadata).mockRejectedValue(new Error("Error invoking remote method 'elastic:browser.metadata': IpcError: This session's workspace is missing."));
    mount(); await vi.advanceTimersByTimeAsync(3_000);
    expect(window.workbench.browser.metadata).toHaveBeenCalledTimes(1);
    expect(useBrowser.getState().errors[binding.tabId]).toContain("This session's workspace is missing.");
    vi.mocked(window.workbench.browser.metadata).mockResolvedValue(target);
    vi.mocked(window.workbench.browser.navigate).mockResolvedValue(target);
    await useBrowser.getState().navigate(binding, { direction: "reload" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.mocked(window.workbench.browser.metadata).mock.calls.length).toBeGreaterThan(2);
    expect(useBrowser.getState().errors[binding.tabId]).toBeUndefined();
  });
  it.each(["This browser tab is not available in this session's workspace.", "that project is no longer open"])("stops polling a tab main refuses with %s", async (refusal) => {
    vi.mocked(window.workbench.browser.metadata).mockRejectedValue(new Error(`Error invoking remote method 'elastic:browser.metadata': IpcError: ${refusal}`));
    mount(); await vi.advanceTimersByTimeAsync(3_000);
    expect(window.workbench.browser.metadata).toHaveBeenCalledTimes(1);
  });
  it("does not publish a new state when the same failure repeats", async () => {
    vi.mocked(window.workbench.browser.metadata).mockRejectedValue(new Error("transient"));
    mount(); await vi.advanceTimersByTimeAsync(501);
    const changes = vi.fn();
    const unsubscribe = useBrowser.subscribe(changes);
    await vi.advanceTimersByTimeAsync(2_000);
    unsubscribe();
    expect(vi.mocked(window.workbench.browser.metadata).mock.calls.length).toBeGreaterThan(2);
    expect(changes).not.toHaveBeenCalled();
  });
  it("keeps polling through a failure that is not a refusal", async () => {
    vi.mocked(window.workbench.browser.metadata).mockRejectedValueOnce(new Error("transient")).mockResolvedValue(target);
    mount(); await vi.advanceTimersByTimeAsync(1_600);
    expect(vi.mocked(window.workbench.browser.metadata).mock.calls.length).toBeGreaterThan(1);
    expect(useBrowser.getState().errors[binding.tabId]).toBeUndefined();
  });
  it("opening the console wakes a refused tab's poll", async () => {
    vi.mocked(window.workbench.browser.metadata).mockRejectedValueOnce(new Error("This session is no longer active.")).mockResolvedValue(target);
    mount(); await vi.advanceTimersByTimeAsync(2_000);
    expect(window.workbench.browser.metadata).toHaveBeenCalledTimes(1);
    useBrowser.getState().setConsoleOpen(binding.tabId, true);
    await vi.advanceTimersByTimeAsync(1);
    expect(window.workbench.browser.metadata).toHaveBeenLastCalledWith({ ...binding, logs: true });
  });
});

describe("what hides the page", () => {
  const view = { left: 700, top: 70, right: 1300, bottom: 570 };
  const overlay = (html: string, box: { left: number; top: number; width: number; height: number }) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const element = wrapper.firstElementChild!;
    element.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON() {} });
    return element;
  };

  it("never steps aside for a tooltip, even one over the page", () => {
    const hint = overlay('<div data-radix-popper-content-wrapper><div data-slot="tooltip-content">Console<span role="tooltip">Console</span></div></div>', { left: 1200, top: 40, width: 80, height: 40 });
    expect(pageOccluded([hint], view)).toBe(false);
  });

  it("steps aside for any dialog, and for a menu only where it overlaps the page", () => {
    expect(pageOccluded([overlay('<div role="dialog"></div>', { left: 100, top: 100, width: 300, height: 200 })], view)).toBe(true);
    const over = overlay('<div role="menu"></div>', { left: 900, top: 60, width: 200, height: 160 });
    const elsewhere = overlay('<div role="menu"></div>', { left: 100, top: 60, width: 200, height: 160 });
    expect(pageOccluded([over], view)).toBe(true);
    expect(pageOccluded([elsewhere], view)).toBe(false);
  });
});
