import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAcp } from "@renderer/state/acp";
import { subscribeToMain } from "@renderer/state/bridge";
import { useComposer } from "@renderer/state/composer";
import type { PromptBlock } from "@shared/acp/types";
import { initialSessionState } from "@shared/acp/types";

/**
 * Main as the queue sees it: `sessions.prompt` is a reply that arrives when the turn is over,
 * and the turn's events arrive on `session.update` — `prompt/end` BEFORE that reply.
 */
const SESSION = "s1";
type Handler = (payload: unknown) => void;
let handlers: Record<string, Handler>;
let replies: { text: string; resolve: () => void; reject: (error: Error) => void }[];
let detach: () => void;
const bridge = window.workbench as unknown as Record<string, unknown>;
const saved = { on: bridge.on, sessions: bridge.sessions };

const block = (text: string): PromptBlock[] => [{ type: "text", text }];
const emit = (event: Record<string, unknown>) =>
  handlers["session.update"]!({ sessionId: SESSION, event: { at: Date.now(), ...event } });
const start = (text: string) => emit({ type: "prompt/start", turnId: text, content: block(text) });
const end = () => emit({ type: "prompt/end", stopReason: "end_turn", usage: null });
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
/** What main has been handed and not yet answered: more than one is two turns at once. */
const inFlight = () => replies.map(reply => reply.text);

beforeEach(() => {
  handlers = {};
  replies = [];
  bridge.on = vi.fn((channel: string, handler: Handler) => { handlers[channel] = handler; return () => {}; });
  bridge.sessions = {
    ...(saved.sessions as object),
    prompt: vi.fn(({ content }: { content: PromptBlock[] }) => new Promise((resolve, reject) => {
      const text = content[0]?.type === "text" ? content[0].text : "";
      const reply = {
        text,
        resolve: () => { replies = replies.filter(item => item !== reply); resolve({ stopReason: "end_turn" }); },
        reject: (error: Error) => { replies = replies.filter(item => item !== reply); reject(error); },
      };
      replies.push(reply);
    })),
  };
  useAcp.setState({ sessions: { [SESSION]: initialSessionState(SESSION, "claude") }, reconnecting: {} });
  useComposer.setState({ queues: {}, sending: {}, paused: {}, drafts: {}, annotations: {}, referenceLabels: {}, draftRoots: {}, editingQueued: {} });
  detach = subscribeToMain();
});

afterEach(() => {
  detach();
  bridge.on = saved.on;
  bridge.sessions = saved.sessions;
});

const texts = () => useComposer.getState().queues[SESSION]?.map(item => item.text);

it("edits a queued prompt in place: same position, new text in what is sent, chips and images kept", async () => {
  const composer = useComposer.getState();
  void composer.submit(SESSION, "first", block("first"));
  start("first");
  const image: PromptBlock = { type: "image", data: "AAAA", mimeType: "image/png", uri: null };
  void composer.submit(SESSION, "make it red @part.step#o1", [{ type: "text", text: "make it red @part.step#o1" }, image],
    { text: "make it red @part.step#o1", annotations: [], labels: { "@part.step#o1": "Face" } });
  void composer.submit(SESSION, "third", block("third"));
  await settle();
  const id = useComposer.getState().queues[SESSION]![0]!.id;
  useComposer.getState().updateQueued(SESSION, id, "make it blue @part.step#o1");
  expect(texts()).toEqual(["make it blue @part.step#o1", "third"]);
  const edited = useComposer.getState().queues[SESSION]![0]!;
  expect(edited.content).toEqual([{ type: "text", text: "make it blue @part.step#o1" }, image]);
  expect(edited.draft?.text).toBe("make it blue @part.step#o1");
  expect(edited.draft?.labels).toEqual({ "@part.step#o1": "Face" });

  end(); await settle(); replies[0]!.resolve(); await settle();
  expect(inFlight()).toEqual(["make it blue @part.step#o1"]);
});

it("holds a queued prompt that is being edited: the turn ending does not send it stale, saving sends the edit", async () => {
  const composer = useComposer.getState();
  void composer.submit(SESSION, "first", block("first"));
  start("first");
  void composer.submit(SESSION, "draft one", block("draft one"));
  await settle();
  const id = useComposer.getState().queues[SESSION]![0]!.id;
  useComposer.getState().beginEditQueued(SESSION, id);
  end(); await settle(); replies[0]!.resolve(); await settle();
  expect(inFlight(), "nothing goes out while it is open for editing").toEqual([]);
  useComposer.getState().updateQueued(SESSION, id, "draft two");
  useComposer.getState().endEditQueued(SESSION);
  await settle();
  expect(inFlight()).toEqual(["draft two"]);
  expect(useComposer.getState().queues[SESSION]).toEqual([]);
});

it("cancelling an edit leaves the prompt as it was and lets the queue go on", async () => {
  const composer = useComposer.getState();
  void composer.submit(SESSION, "first", block("first"));
  start("first");
  void composer.submit(SESSION, "keep me", block("keep me"));
  await settle();
  const id = useComposer.getState().queues[SESSION]![0]!.id;
  useComposer.getState().beginEditQueued(SESSION, id);
  end(); await settle(); replies[0]!.resolve(); await settle();
  useComposer.getState().endEditQueued(SESSION);
  await settle();
  expect(inFlight()).toEqual(["keep me"]);
});

it("an empty edit is not a save, and a prompt moves within the queue", async () => {
  const composer = useComposer.getState();
  void composer.submit(SESSION, "first", block("first"));
  start("first");
  for (const text of ["a", "b", "c"]) void composer.submit(SESSION, text, block(text));
  await settle();
  const [a, , c] = useComposer.getState().queues[SESSION]!;
  useComposer.getState().updateQueued(SESSION, a!.id, "   ");
  expect(texts()).toEqual(["a", "b", "c"]);
  useComposer.getState().moveQueued(SESSION, c!.id, 0);
  expect(texts()).toEqual(["c", "a", "b"]);
  useComposer.getState().moveQueued(SESSION, c!.id, 2);
  expect(texts()).toEqual(["a", "b", "c"]);
});

it("Send now steers into the running turn when the agent takes it, leaving the rest queued", async () => {
  (bridge.sessions as Record<string, unknown>).steer = vi.fn(async () => ({ outcome: "injected" }));
  const composer = useComposer.getState();
  void composer.submit(SESSION, "first", block("first"));
  start("first");
  void composer.submit(SESSION, "second", block("second"));
  void composer.submit(SESSION, "third", block("third"));
  await settle();
  const third = useComposer.getState().queues[SESSION]![1]!.id;
  expect(await useComposer.getState().sendNow(SESSION, third)).toBe("steered");
  expect((bridge.sessions as { steer: ReturnType<typeof vi.fn> }).steer).toHaveBeenCalledWith({ id: SESSION, content: block("third") });
  expect(texts()).toEqual(["second"]);
});

it("Send now without steering stops the turn and sends it first, the rest after in order", async () => {
  const cancel = vi.fn(async () => undefined);
  (bridge.sessions as Record<string, unknown>).steer = vi.fn(async () => ({ outcome: "unsupported" }));
  (bridge.sessions as Record<string, unknown>).cancel = cancel;
  const composer = useComposer.getState();
  void composer.submit(SESSION, "first", block("first"));
  start("first");
  void composer.submit(SESSION, "second", block("second"));
  void composer.submit(SESSION, "third", block("third"));
  await settle();
  const third = useComposer.getState().queues[SESSION]![1]!.id;
  expect(await useComposer.getState().sendNow(SESSION, third)).toBe("next");
  expect(cancel).toHaveBeenCalledWith({ id: SESSION });
  expect(texts()).toEqual(["third", "second"]);
  emit({ type: "prompt/end", stopReason: "cancelled", usage: null }); await settle(); replies[0]!.resolve(); await settle();
  expect(inFlight()).toEqual(["third"]);
});
