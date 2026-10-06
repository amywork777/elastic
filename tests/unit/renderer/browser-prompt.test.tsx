import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserTab } from "@renderer/features/explorer/BrowserTab";
import { useBrowser } from "@renderer/state/browser";
import { useComposer } from "@renderer/state/composer";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";
import type { Project, Session } from "@shared/types";
import type { BrowserTarget } from "@shared/browser";

const target: BrowserTarget = { sessionId: "first", tabId: "page", projectId: "project", root: "/project", generation: 1, title: "Example page", url: "https://example.com/", loading: false, visible: true, canGoBack: false, canGoForward: false, logs: [] };
const originalMount = useBrowser.getState().mount;
const originalArrayBuffer = Object.getOwnPropertyDescriptor(Blob.prototype, "arrayBuffer");
beforeEach(() => {
  if (!Blob.prototype.arrayBuffer) Object.defineProperty(Blob.prototype, "arrayBuffer", { configurable: true, value: function(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  } });
  useBrowser.setState({ targets: { page: target }, errors: {}, mount: () => () => {} });
  useProjects.setState({ activeId: "project", projects: [{ id: "project", path: "/project" }] as Project[] });
  useSessions.setState({ activeId: "first", sessions: [{ id: "first", projectId: "project", cwd: "/project" }, { id: "second", projectId: "project", cwd: "/project" }] as Session[] });
  useComposer.setState({ drafts: { first: "Existing draft" }, pendingFiles: {}, acceptedContexts: {}, queues: {}, draftRoots: {}, referenceLabels: {}, focusRequest: null });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  useBrowser.setState({ mount: originalMount });
  if (originalArrayBuffer) Object.defineProperty(Blob.prototype, "arrayBuffer", originalArrayBuffer); else Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
});
it.each(["screenshot", "selection"] as const)("adds browser %s to the original draft without submitting or redirecting after chat switch", async kind => {
  let finish!: (value: { base64: string; mimeType: string; url: string; generation: number }) => void;
  vi.mocked(window.workbench.browser.capture).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<BrowserTab sessionId="first" projectId="project" root={null} tabId="page" url={target.url} />);
  fireEvent.click(screen.getByRole("button", { name: kind === "screenshot" ? "Add page screenshot to prompt" : "Add selected text to prompt" }));
  expect(window.workbench.browser.capture).toHaveBeenCalledWith({ sessionId: "first", projectId: "project", root: null, tabId: "page", url: target.url, generation: 1, kind });
  act(() => useSessions.setState({ activeId: "second" }));
  await act(async () => finish({ base64: kind === "screenshot" ? "iVBORw0KGgo=" : btoa("Selected page text"), mimeType: kind === "screenshot" ? "image/png" : "text/plain", url: target.url, generation: 1 }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Added to prompt"));
  expect(useComposer.getState().drafts.first).toContain("Existing draft");
  expect(useComposer.getState().drafts.first).toContain(target.url);
  expect(useComposer.getState().pendingFiles.first?.[0]?.name).toBe(kind === "screenshot" ? "browser-page.png" : "browser-selection.txt");
  expect(useComposer.getState().pendingFiles.second).toBeUndefined();
  expect(useComposer.getState().drafts.second).toBeUndefined();
  expect(useComposer.getState().queues).toEqual({});
  expect(useComposer.getState().focusRequest).toBeNull();
});

it("picks an element: the crosshair turns pick mode on, each pick becomes a chip with its image and code, and leaving stops it", async () => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  vi.mocked(window.workbench.on).mockImplementation(((channel: string, handler: (payload: unknown) => void) => {
    handlers[channel] = handler;
    return () => { delete handlers[channel]; };
  }) as never);
  const view = render(<BrowserTab sessionId="first" projectId="project" root={null} tabId="page" url={target.url} />);
  const button = screen.getByRole("button", { name: "Pick an element to add to prompt" });
  fireEvent.click(button);
  expect(window.workbench.browser.pick).toHaveBeenCalledWith({ sessionId: "first", projectId: "project", root: null, tabId: "page", active: true });
  act(() => handlers["browser.picking"]?.({ sessionId: "first", tabId: "page", active: true }));
  expect(button).toHaveAttribute("aria-pressed", "true");
  await act(async () => handlers["browser.picked"]?.({
    sessionId: "first", tabId: "page", url: target.url, title: "Example page", generation: 1,
    image: "iVBORw0KGgo=", html: "<button id=\"buy\">Buy</button>", selector: "#buy", tag: "button", size: { width: 80, height: 32 },
  }));
  await waitFor(() => expect(useComposer.getState().pendingFiles.first?.[0]?.name).toBe("browser-element.png"));
  expect(useComposer.getState().drafts.first).toContain("#buy");
  expect(useComposer.getState().drafts.first).toContain("<button id=\"buy\">Buy</button>");
  act(() => handlers["browser.picking"]?.({ sessionId: "first", tabId: "page", active: false }));
  expect(button).toHaveAttribute("aria-pressed", "false");
  vi.mocked(window.workbench.browser.pick).mockClear();
  fireEvent.click(button);
  act(() => handlers["browser.picking"]?.({ sessionId: "first", tabId: "page", active: true }));
  view.unmount();
  expect(window.workbench.browser.pick).toHaveBeenLastCalledWith({ sessionId: "first", projectId: "project", root: null, tabId: "page", active: false });
});
