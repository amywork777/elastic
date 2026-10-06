/**
 * A streamed reply reaches the store a frame at a time (`streamed` in `state/bridge.ts`): many
 * chunks are one store write, anything else lands after the chunks before it, and a full snapshot
 * replaces what was waiting.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { subscribeToMain } from "@renderer/state/bridge";
import { useAcp } from "@renderer/state/acp";
import { initialSessionState, type SessionEvent, type SessionState } from "@shared/acp/types";

type Listener = (payload: unknown) => void;
const bridge = window.workbench as unknown as Record<string, unknown>;
const saved = { on: bridge.on, ui: bridge.ui };
let listeners: Record<string, Listener> = {};
let detach = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  listeners = {};
  bridge.on = vi.fn((channel: string, listener: Listener) => {
    listeners[channel] = listener;
    return () => {};
  });
  bridge.ui = { ready: vi.fn(async () => []) };
  detach = subscribeToMain();
  const state: SessionState = { ...initialSessionState("s1", "claude-code"), acpSessionId: "acp", status: "running" };
  useAcp.setState({ sessions: { s1: state } });
});

afterEach(() => {
  detach();
  Object.assign(bridge, saved);
  vi.useRealTimers();
});

const chunk = (text: string): SessionEvent =>
  ({ type: "session/update", acpSessionId: "acp", at: 1, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } }) as SessionEvent;
const send = (event: SessionEvent) => listeners["session.update"]!({ sessionId: "s1", event });
const text = () =>
  (useAcp.getState().sessions.s1?.turns.at(-1)?.parts ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

it("writes a frame's chunks to the store once, in order", () => {
  send({ type: "prompt/start", turnId: "t1", content: [{ type: "text", text: "hi" }], at: 1 } as SessionEvent);
  const writes = vi.fn();
  const unsubscribe = useAcp.subscribe(writes);
  for (const word of ["one ", "two ", "three"]) send(chunk(word));
  // Held until the frame.
  expect(writes).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(text()).toBe("one two three");
  unsubscribe();
});

it("lands a turn's end after the chunks that came before it", () => {
  send({ type: "prompt/start", turnId: "t1", content: [{ type: "text", text: "hi" }], at: 1 } as SessionEvent);
  send(chunk("all of it"));
  send({ type: "prompt/end", stopReason: "end_turn", usage: null, at: 2 } as SessionEvent);
  // No frame needed: the end flushed what was held before applying itself.
  expect(text()).toBe("all of it");
  expect(useAcp.getState().sessions.s1?.status).toBe("idle");
});

it("drops what was waiting when a full snapshot arrives", () => {
  send(chunk("stale"));
  const snapshot: SessionState = { ...initialSessionState("s1", "claude-code"), acpSessionId: "acp", status: "idle" };
  listeners["session.state"]!({ sessionId: "s1", state: snapshot });
  vi.advanceTimersByTime(60);
  expect(useAcp.getState().sessions.s1).toBe(snapshot);
});
