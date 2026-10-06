/**
 * The composer's microphone, on the main side: one helper process per
 * dictation (`native/dictation/main.swift`, built to `out/native` by
 * `scripts/build-dictation.mjs`), fed the renderer's samples on stdin, its
 * JSON lines turned into `dictation.update` events for the window that asked.
 *
 * One at a time. A second `start` cancels the first; a push, finish or cancel
 * naming any id but the current one is ignored. Every dictation ends in
 * exactly one of `done`, `error` or a cancel — a helper that exits without
 * saying either is an error, and a finish the helper does not settle within
 * `FINISH_DEADLINE_MS` is killed and reported, never left listening.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { IpcEventPayload } from "../../shared/ipc";
import type { DictationAvailability } from "../../shared/ipc/dictation";
import { MAX_DICTATION_CHUNK_BYTES } from "../../shared/ipc/dictation";
import { trackChild } from "../children";

export type DictationUpdate = IpcEventPayload<"dictation.update">;

/** How long the helper has to settle the last words after the audio ends. */
export const FINISH_DEADLINE_MS = 10_000;

/** The part of a child process this uses, so a test can stand one in. */
export type DictationChild = {
  stdin: Writable;
  stdout: Readable;
  kill(signal?: NodeJS.Signals): unknown;
  /** After the process exits and its output is read: `exit` can come before the last lines. */
  once(event: "close", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

export type DictationDeps = {
  /** The helper, or null when this build has none. */
  binary: string | null;
  platform: NodeJS.Platform;
  /** `os.release()`'s major version: Darwin 25 is macOS 26. */
  darwinMajor: number;
  spawn: (binary: string) => DictationChild;
};

type Current = {
  id: string;
  child: DictationChild;
  send: (update: DictationUpdate) => void;
  /** What the helper heard last, kept for an error that ends it. */
  text: string;
  ended: boolean;
  deadline: NodeJS.Timeout | null;
};

export class Dictation {
  private current: Current | null = null;

  constructor(private readonly deps: DictationDeps) {}

  available(): DictationAvailability {
    if (this.deps.platform !== "darwin") return { available: false, reason: "platform" };
    if (this.deps.darwinMajor < 25) return { available: false, reason: "os" };
    if (!this.deps.binary) return { available: false, reason: "missing" };
    return { available: true };
  }

  /** Start listening; updates go to `send` until the dictation ends. */
  start(send: (update: DictationUpdate) => void): { id: string } {
    const availability = this.available();
    if (!availability.available || !this.deps.binary) {
      throw new Error("Dictation is not available on this Mac.");
    }
    if (this.current) this.cancel(this.current.id);
    const id = randomUUID();
    const child = this.deps.spawn(this.deps.binary);
    const current: Current = { id, child, send, text: "", ended: false, deadline: null };
    this.current = current;

    // A helper that died takes its stdin with it; the exit below is what reports that.
    child.stdin.on("error", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(current, line));
    child.once("error", (error) => this.end(current, { state: "error", error: `Dictation could not start: ${error.message}` }));
    child.once("close", () => this.end(current, { state: "error", error: "Dictation stopped unexpectedly." }));
    return { id };
  }

  push(id: string, pcm: Buffer): void {
    const current = this.live(id);
    if (!current || current.deadline || pcm.length === 0) return;
    if (pcm.length > MAX_DICTATION_CHUNK_BYTES || pcm.length % 2 !== 0) {
      throw new Error("A dictation chunk is whole 16-bit samples, at most 64 KiB.");
    }
    current.child.stdin.write(pcm);
  }

  finish(id: string): void {
    const current = this.live(id);
    if (!current || current.deadline) return;
    current.child.stdin.end();
    current.deadline = setTimeout(() => {
      this.end(current, { state: "error", error: "Dictation took too long to finish." });
      current.child.kill("SIGKILL");
    }, FINISH_DEADLINE_MS);
  }

  cancel(id: string): void {
    const current = this.live(id);
    if (!current) return;
    this.end(current, null);
    current.child.kill("SIGTERM");
  }

  /** Quit, or the window that started it closing. */
  dispose(): void {
    if (this.current) this.cancel(this.current.id);
  }

  private live(id: string): Current | null {
    return this.current && this.current.id === id && !this.current.ended ? this.current : null;
  }

  private onLine(current: Current, line: string): void {
    let message: { type?: unknown; text?: unknown; message?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    const text = typeof message.text === "string" ? message.text : current.text;
    switch (message.type) {
      case "preparing":
        this.send(current, { state: "preparing", text: current.text });
        break;
      case "listening":
        this.send(current, { state: "listening", text: current.text });
        break;
      case "text":
        current.text = text;
        this.send(current, { state: "listening", text });
        break;
      case "done":
        current.text = text;
        this.end(current, { state: "done" });
        break;
      case "error":
        this.end(current, {
          state: "error",
          error: typeof message.message === "string" ? message.message : "Dictation failed.",
        });
        break;
    }
  }

  private send(current: Current, update: Omit<DictationUpdate, "id">): void {
    if (!current.ended) current.send({ id: current.id, ...update });
  }

  /** The one way a dictation ends; `null` is a cancel, which says nothing. */
  private end(current: Current, last: { state: "done" | "error"; error?: string } | null): void {
    if (current.ended) return;
    if (last) this.send(current, { state: last.state, text: current.text, ...(last.error ? { error: last.error } : {}) });
    current.ended = true;
    if (current.deadline) clearTimeout(current.deadline);
    if (this.current === current) this.current = null;
  }
}

/** Where the build put the helper: beside the archive in a packaged app, `out/native` in a checkout. */
export function dictationBinary(appPath: string): string | null {
  const binary = path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "out", "native", "elastic-dictation");
  return existsSync(binary) ? binary : null;
}

export function createDictation(appPath: string): Dictation {
  return new Dictation({
    binary: dictationBinary(appPath),
    platform: process.platform,
    darwinMajor: Number.parseInt(os.release().split(".")[0] ?? "0", 10),
    spawn: (binary) => trackChild(spawn(binary, [], { stdio: ["pipe", "pipe", "ignore"] }), "service"),
  });
}
