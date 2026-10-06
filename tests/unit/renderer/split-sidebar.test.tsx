/** Two chats side by side, from the sidebar and the keyboard: open beside, both rows current. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
});

import { TooltipProvider } from "@workbench/ui/primitives/tooltip";
import { useSplitShortcuts } from "@renderer/app/Shell";
import { SessionRow } from "@renderer/features/sidebar/SessionRow";
import { useSessions } from "@renderer/state/sessions";
import type { Session } from "@shared/types";

const session = (id: string) => ({
  id, projectId: "p", title: `Chat ${id}`, titleSource: "prompt", agentId: "codex", cwd: "/repo", gitMode: "none", createdAt: 0, updatedAt: 0,
  status: "idle", acpSessionId: "acp", changedFiles: 0, insertions: 0, deletions: 0, archived: false, pinned: false, sessionHead: null, turnHead: null,
}) as Session;

beforeEach(() => useSessions.setState({ sessions: [session("a"), session("b"), session("c")], activeId: "a", split: null }));
afterEach(cleanup);

const rows = (selected: string | null, onSelect = vi.fn()) =>
  render(
    <TooltipProvider>
      {["a", "b", "c"].map((id) => (
        <SessionRow key={id} onSelect={() => onSelect(id)} selected={id === selected} session={session(id)} showBranch={false} />
      ))}
    </TooltipProvider>,
  );
const title = (id: string) => screen.getByRole("button", { name: `Chat ${id}` });

it("opens a chat beside the current one on Cmd-click, and not as a plain select", () => {
  const onSelect = vi.fn();
  rows("a", onSelect);
  fireEvent.click(title("b"), { metaKey: true });
  expect(onSelect).not.toHaveBeenCalled();
  expect(useSessions.getState().split).toEqual({ left: "a", right: "b", focus: "right" });
});

it("offers Open beside in the row's menu", async () => {
  rows("a");
  fireEvent.contextMenu(title("c"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Open beside" }));
  expect(useSessions.getState().split).toEqual({ left: "a", right: "c", focus: "right" });
});

it("marks both chats on screen as current, the focused one as the page", () => {
  useSessions.setState({ activeId: "b", split: { left: "a", right: "b", focus: "right" } });
  rows("b");
  expect(title("b")).toHaveAttribute("aria-current", "page");
  expect(title("a")).toHaveAttribute("aria-current", "true");
  expect(title("c")).not.toHaveAttribute("aria-current");
});

it("moves focus between sides with Cmd-backslash and Cmd-Option-arrows", () => {
  const Probe = () => { useSplitShortcuts(); return null; };
  render(<Probe />);
  useSessions.setState({ activeId: "b", split: { left: "a", right: "b", focus: "right" } });
  fireEvent.keyDown(window, { key: "\\", metaKey: true });
  expect(useSessions.getState().split?.focus).toBe("left");
  expect(useSessions.getState().activeId).toBe("a");
  fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true, altKey: true });
  expect(useSessions.getState().split?.focus).toBe("right");
  fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true, altKey: true });
  expect(useSessions.getState().split?.focus).toBe("left");
});
