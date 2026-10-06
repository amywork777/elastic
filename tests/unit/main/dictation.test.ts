/**
 * The dictation service (`src/main/dictation`) against a stand-in helper:
 * what it says it can do, how the helper's lines become updates, and that
 * every dictation ends exactly once — done, error or a silent cancel.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dictation, FINISH_DEADLINE_MS, type DictationChild, type DictationUpdate } from "@main/dictation";

type FakeChild = DictationChild & {
  stdin: PassThrough;
  stdout: PassThrough;
  written: Buffer[];
  ended: boolean;
  kill: ReturnType<typeof vi.fn>;
  say(line: object | string): void;
  close(): void;
};

function fakeChild(): FakeChild {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = {
    stdin,
    stdout,
    written: [] as Buffer[],
    ended: false,
    kill: vi.fn(),
    once: (event: string, listener: (...args: unknown[]) => void) => events.once(event, listener),
    say: (line: object | string) => stdout.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`),
    close: () => {
      stdout.end();
      // `close` comes after the output is read, as a real child's does.
      setImmediate(() => events.emit("close", 0));
    },
  } as unknown as FakeChild;
  stdin.on("data", (chunk: Buffer) => child.written.push(chunk));
  stdin.on("finish", () => {
    child.ended = true;
  });
  return child;
}

const lines = () => new Promise((resolve) => setImmediate(resolve));

function service(overrides: Partial<ConstructorParameters<typeof Dictation>[0]> = {}) {
  const children: FakeChild[] = [];
  const dictation = new Dictation({
    binary: "/app/out/native/elastic-dictation",
    platform: "darwin",
    darwinMajor: 25,
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    ...overrides,
  });
  const updates: DictationUpdate[] = [];
  return { dictation, children, updates, send: (update: DictationUpdate) => updates.push(update) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("availability", () => {
  it("is macOS 26 with the helper built, and says which of the three is missing", () => {
    expect(service().dictation.available()).toEqual({ available: true });
    expect(service({ platform: "linux" }).dictation.available()).toEqual({ available: false, reason: "platform" });
    expect(service({ darwinMajor: 24 }).dictation.available()).toEqual({ available: false, reason: "os" });
    expect(service({ binary: null }).dictation.available()).toEqual({ available: false, reason: "missing" });
    expect(() => service({ binary: null }).dictation.start(() => {})).toThrow(/not available/);
  });
});

describe("a dictation", () => {
  it("pipes the samples in, reports what was heard, and ends on done", async () => {
    const { dictation, children, updates, send } = service();
    const { id } = dictation.start(send);
    const child = children[0]!;
    dictation.push(id, Buffer.alloc(3200));
    expect(Buffer.concat(child.written)).toHaveLength(3200);

    child.say({ type: "preparing" });
    child.say({ type: "listening", locale: "en_US" });
    child.say({ type: "text", text: "open the" });
    child.say("not json, ignored");
    child.say({ type: "text", text: "open the review tab" });
    await lines();
    dictation.finish(id);
    await lines();
    expect(child.ended).toBe(true);
    child.say({ type: "done", text: "Open the review tab." });
    child.close();
    await lines();
    await lines();

    expect(updates.map((update) => [update.state, update.text])).toEqual([
      ["preparing", ""],
      ["listening", ""],
      ["listening", "open the"],
      ["listening", "open the review tab"],
      ["done", "Open the review tab."],
    ]);
    // Ended: nothing more is pushed, and the helper's exit after `done` is not an error.
    dictation.push(id, Buffer.alloc(2));
    expect(Buffer.concat(child.written)).toHaveLength(3200);
  });

  it("is an error, keeping what was heard, when the helper exits without done", async () => {
    const { dictation, children, updates, send } = service();
    dictation.start(send);
    children[0]!.say({ type: "text", text: "half a sen" });
    children[0]!.close();
    await lines();
    await lines();
    expect(updates.at(-1)).toMatchObject({ state: "error", text: "half a sen", error: "Dictation stopped unexpectedly." });
  });

  it("passes the helper's own error on", async () => {
    const { dictation, children, updates, send } = service();
    dictation.start(send);
    children[0]!.say({ type: "error", code: "locale", message: "Dictation does not support xx_XX yet." });
    await lines();
    expect(updates).toEqual([expect.objectContaining({ state: "error", error: "Dictation does not support xx_XX yet." })]);
  });

  it("kills a helper that does not settle within the deadline after finish, and says so", () => {
    vi.useFakeTimers();
    const { dictation, children, updates, send } = service();
    const { id } = dictation.start(send);
    dictation.finish(id);
    vi.advanceTimersByTime(FINISH_DEADLINE_MS);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGKILL");
    expect(updates.at(-1)).toMatchObject({ state: "error", error: "Dictation took too long to finish." });
  });

  it("cancels silently, and a second start cancels the first", async () => {
    const { dictation, children, updates, send } = service();
    const first = dictation.start(send);
    const second = dictation.start(send);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    children[0]!.say({ type: "text", text: "from the first" });
    children[0]!.close();
    await lines();
    await lines();
    expect(updates).toEqual([]);

    // Calls for the first id are ignored; the second is the live one.
    dictation.push(first.id, Buffer.alloc(4));
    dictation.cancel(first.id);
    expect(children[1]!.kill).not.toHaveBeenCalled();
    dictation.cancel(second.id);
    expect(children[1]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(updates).toEqual([]);
  });

  it("refuses a chunk that is not whole 16-bit samples or is too large", () => {
    const { dictation, send } = service();
    const { id } = dictation.start(send);
    expect(() => dictation.push(id, Buffer.alloc(3))).toThrow(/16-bit/);
    expect(() => dictation.push(id, Buffer.alloc(64 * 1024 + 2))).toThrow(/64 KiB/);
  });
});
