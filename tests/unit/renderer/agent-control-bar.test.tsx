/**
 * The strip under a browser tab while an agent drives its page (`features/explorer/AgentControlBar`):
 * shown on the agent's activity and gone a few seconds after it, Take over and Hand back through
 * `browser.takeOver`, and Stop as the composer's stop.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AGENT_ACTIVE_MS, AgentControlBar } from "@renderer/features/explorer/AgentControlBar";
import { useAcp } from "@renderer/state/acp";
import { useAgents } from "@renderer/state/agents";
import { useSessions } from "@renderer/state/sessions";

type Listener = (payload: { sessionId: string; tabId: string }) => void;
let listeners: Listener[] = [];
const takeOver = vi.fn(async ({ takenOver }: { takenOver: boolean }) => ({ takenOver }));
const cancel = vi.fn(async () => undefined);
const at = { sessionId: "s1", projectId: "p1", root: null, tabId: "t1" };

beforeEach(() => {
  listeners = [];
  const bench = window.workbench as unknown as Record<string, unknown>;
  bench.on = vi.fn((channel: string, listener: Listener) => {
    if (channel === "browser.activity") listeners.push(listener);
    return () => { listeners = listeners.filter((other) => other !== listener); };
  });
  (bench.browser as Record<string, unknown>).takeOver = takeOver;
  useSessions.setState({ sessions: [{ id: "s1", agentId: "claude-code" } as never], ready: true, activeId: "s1" });
  useAgents.setState({ agents: [{ id: "claude-code", name: "Claude Code" } as never] });
  useAcp.setState({ sessions: { s1: { status: "running" } as never }, cancel });
});

afterEach(() => {
  vi.useRealTimers();
  takeOver.mockClear();
  cancel.mockClear();
});

const act$ = (payload: { sessionId: string; tabId: string }) => act(() => { for (const listener of listeners) listener(payload); });

it("says nothing until the agent acts on this page, and goes a few seconds after it stops", () => {
  vi.useFakeTimers();
  render(<AgentControlBar at={at} />);
  expect(screen.queryByRole("status")).toBeNull();
  // Another tab's, or another chat's, is not this one's.
  act$({ sessionId: "s1", tabId: "other" });
  act$({ sessionId: "s2", tabId: "t1" });
  expect(screen.queryByRole("status")).toBeNull();

  act$({ sessionId: "s1", tabId: "t1" });
  expect(screen.getByRole("status")).toHaveTextContent("Claude Code is using this tab");
  act(() => { vi.advanceTimersByTime(AGENT_ACTIVE_MS + 100); });
  expect(screen.queryByRole("status")).toBeNull();
});

it("takes the page over and hands it back, and Stop ends the agent's turn", async () => {
  render(<AgentControlBar at={at} />);
  act$({ sessionId: "s1", tabId: "t1" });

  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(cancel).toHaveBeenCalledWith("s1");

  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  expect(takeOver).toHaveBeenCalledWith({ ...at, takenOver: true });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You have this tab. Claude Code waits"));

  fireEvent.click(screen.getByRole("button", { name: "Hand back" }));
  expect(takeOver).toHaveBeenLastCalledWith({ ...at, takenOver: false });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Hand back" })).toBeNull());
});
