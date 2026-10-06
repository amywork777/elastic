/** Two chats side by side: the session pane draws both, a divider, and moves focus by click. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@renderer/features/session/NewSession", () => ({ NewSession: () => <div data-new-session /> }));
vi.mock("@renderer/features/session/SessionView", async () => {
  const { SessionHeader } = await import("@renderer/features/session/SessionHeader");
  return {
    SessionView: ({ session }: { session: { id: string; title: string } }) => (
      <div data-session-view={session.id}>
        <SessionHeader session={session as never} title={session.title} />
        <textarea aria-label={`composer ${session.id}`} />
      </div>
    ),
  };
});

import { SessionPane } from "@renderer/features/session/SessionPane";
import { useProjects } from "@renderer/state/projects";
import { useSessions } from "@renderer/state/sessions";

const row = (id: string) => ({ id, projectId: "p", title: `Chat ${id}`, cwd: "/p", archived: false, status: "idle" });
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  useProjects.setState({ projects: [{ id: "p", name: "p", path: "/p" }] as never, activeId: "p" });
  useSessions.setState({ sessions: [row("a"), row("b")] as never, activeId: "b", split: { left: "a", right: "b", focus: "right" } });
});
afterEach(cleanup);

const side = (name: "left" | "right") => document.querySelector<HTMLElement>(`[data-split-side="${name}"]`)!;

it("draws each side's chat, the focused one marked", () => {
  render(<SessionPane />);
  expect(side("left").querySelector('[data-session-view="a"]')).not.toBeNull();
  expect(side("right").querySelector('[data-session-view="b"]')).not.toBeNull();
  expect(side("right")).toHaveAttribute("data-split-focused");
  expect(side("left")).not.toHaveAttribute("data-split-focused");
  expect(document.querySelector('[data-split-divider][role="separator"]')).not.toBeNull();
});

it("moves focus to the side clicked into", () => {
  render(<SessionPane />);
  fireEvent.pointerDown(screen.getByRole("textbox", { name: "composer a" }));
  expect(useSessions.getState().split?.focus).toBe("left");
  expect(useSessions.getState().activeId).toBe("a");
});

it("closes a side from its header, leaving the other", () => {
  render(<SessionPane />);
  const close = side("right").querySelector<HTMLElement>('[aria-label="Close this side"]')!;
  fireEvent.click(close);
  expect(useSessions.getState().split).toBeNull();
  expect(useSessions.getState().activeId).toBe("a");
});

it("shows the new-chat screen in a side with no chat", () => {
  useSessions.setState({ activeId: null, split: { left: "a", right: null, focus: "right" } });
  render(<SessionPane />);
  expect(side("right").querySelector("[data-new-session]")).not.toBeNull();
});

it("shows only the focused side in a narrow window, and both again when it widens", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
  render(<SessionPane />);
  expect(document.querySelectorAll("[data-split-side]")).toHaveLength(0);
  expect(document.querySelector('[data-session-view="b"]')).not.toBeNull();
  expect(document.querySelector('[data-session-view="a"]')).toBeNull();
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
    window.dispatchEvent(new Event("resize"));
  });
  expect(document.querySelectorAll("[data-split-side]")).toHaveLength(2);
});

it("moves the divider by keyboard, within a quarter and three quarters", () => {
  render(<SessionPane />);
  const divider = document.querySelector<HTMLElement>("[data-split-divider]")!;
  expect(divider).toHaveAttribute("aria-valuenow", "50");
  for (let i = 0; i < 20; i++) fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(divider).toHaveAttribute("aria-valuenow", "25");
});

it("lets only the focused side's composer take the keyboard as it mounts", async () => {
  const { useTakesFocus, SplitSideContext } = await import("@renderer/features/session/split-side");
  const seen: Record<string, boolean> = {};
  const Probe = ({ name }: { name: string }) => { seen[name] = useTakesFocus(); return null; };
  render(
    <>
      <Probe name="alone" />
      <SplitSideContext.Provider value="left"><Probe name="left" /></SplitSideContext.Provider>
      <SplitSideContext.Provider value="right"><Probe name="right" /></SplitSideContext.Provider>
    </>,
  );
  expect(seen).toEqual({ alone: true, left: false, right: true });
});

it("shows only the focused side when the pane itself is too narrow for two (the explorer open in a wide window)", () => {
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.hasAttribute("data-session-pane") ? 600 : 0, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
  });
  render(<SessionPane />);
  expect(document.querySelectorAll("[data-split-side]")).toHaveLength(0);
  expect(document.querySelector('[data-session-view="b"]')).not.toBeNull();
  spy.mockRestore();
});
