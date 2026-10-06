/**
 * The composer's microphone, on the page's side: record, hand 16 kHz samples
 * to main (`window.workbench.dictation`, `src/main/dictation`), and write what
 * the on-device helper hears into the box as it hears it.
 *
 * What was in the box before is kept, and the words go after it. The editor
 * is read-only while the microphone is open, so the transcript and the person
 * never write over each other. Stop settles the last words; Escape (on the
 * button) or leaving the chat drops back to what the box held before, or, for
 * a chat left mid-sentence, keeps what was heard so far.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DICTATION_SAMPLE_RATE } from "@shared/ipc/dictation";

export type DictationPhase = "idle" | "starting" | "preparing" | "listening" | "finishing";

/** The words heard, after what the box already held: one space between, none at the start. */
export function withDictation(before: string, heard: string): string {
  if (!heard) return before;
  if (!before || /\s$/.test(before)) return before + heard;
  return `${before} ${heard}`;
}

/** Bytes as base64, in slices: a spread of a large array into `fromCharCode` overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** The sentence a person gets for a microphone the page could not open. */
export function microphoneRefusal(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "elastic can't use the microphone. Allow it in System Settings › Privacy & Security › Microphone.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  return `The microphone could not be opened${error instanceof Error && error.message ? `: ${error.message}` : "."}`;
}

/**
 * The worklet: Float32 frames in, 100 ms of 16-bit samples out, with the chunk's loudness for the
 * meter. `flush` hands over what is left, so a stop does not cut off the last word. Loaded from a
 * blob URL, which the page's script-src allows.
 */
const WORKLET = `
class ElasticPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reset();
    this.port.onmessage = () => {
      this.port.postMessage({ pcm: this.buffer.slice(0, this.at).buffer, level: this.level(), flushed: true });
      this.reset();
    };
  }
  reset() { this.buffer = new Int16Array(${DICTATION_SAMPLE_RATE / 10}); this.at = 0; this.sum = 0; }
  level() { return this.at ? Math.sqrt(this.sum / this.at) : 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.at++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.sum += sample * sample;
      if (this.at === this.buffer.length) {
        const level = this.level();
        this.port.postMessage({ pcm: this.buffer.buffer, level }, [this.buffer.buffer]);
        this.reset();
      }
    }
    return true;
  }
}
registerProcessor("elastic-pcm", ElasticPcm);
`;

let availability: Promise<boolean> | null = null;
/** Asked once per window: the answer is the build and the OS, neither of which changes. */
function dictationAvailable(): Promise<boolean> {
  availability ??= Promise.resolve()
    .then(() => window.workbench.dictation.available())
    .then((answer) => answer.available)
    .catch(() => false);
  return availability;
}

type Capture = {
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode;
};

type Active = {
  /** Null until main has answered `start`. */
  id: string | null;
  before: string;
  capture: Capture | null;
  /** Pushes in order, so `finish` goes after the last of them. */
  sent: Promise<void>;
  off: (() => void) | null;
  /** Set when it has ended, so a late answer from `start` or the microphone drops its resources. */
  over: boolean;
};

function release(capture: Capture | null) {
  if (!capture) return;
  for (const track of capture.stream.getTracks()) track.stop();
  capture.node.port.onmessage = null;
  capture.node.disconnect();
  void capture.context.close().catch(() => {});
}

export function useDictation({
  text,
  setText,
  onSettled,
  scope,
}: {
  text: string;
  setText: (value: string) => void;
  /** After it ends with words kept: the composer takes the focus back into the box. */
  onSettled: () => void;
  /** The draft the words go into. A change of it ends the dictation, keeping what was heard. */
  scope: string;
}) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [level, setLevel] = useState(0);
  const active = useRef<Active | null>(null);
  const latest = useRef({ text, setText, onSettled });
  useLayoutEffect(() => {
    latest.current = { text, setText, onSettled };
  });

  useEffect(() => {
    let live = true;
    void dictationAvailable().then((answer) => live && setAvailable(answer));
    return () => {
      live = false;
    };
  }, []);

  /** Everything torn down; `keep` decides whether the box keeps the words or goes back to before. */
  const end = useCallback((keep: boolean) => {
    const current = active.current;
    if (!current) return;
    current.over = true;
    active.current = null;
    current.off?.();
    release(current.capture);
    if (!keep) latest.current.setText(current.before);
    setPhase("idle");
    setLevel(0);
    if (keep) latest.current.onSettled();
  }, []);

  const cancel = useCallback(() => {
    const current = active.current;
    if (!current) return;
    if (current.id) void window.workbench.dictation.cancel({ id: current.id }).catch(() => {});
    end(false);
  }, [end]);

  const start = useCallback(async () => {
    if (active.current) return;
    const current: Active = { id: null, before: latest.current.text, capture: null, sent: Promise.resolve(), off: null, over: false };
    active.current = current;
    setPhase("starting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (!current.over) {
        end(false);
        toast.error(microphoneRefusal(error));
      }
      return;
    }
    if (current.over) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    // Listen before asking: the first update can arrive before `start` has answered.
    current.off = window.workbench.on("dictation.update", (update) => {
      if (update.id !== current.id || current.over) return;
      if (update.text) latest.current.setText(withDictation(current.before, update.text));
      if (update.state === "preparing") setPhase("preparing");
      else if (update.state === "listening") setPhase((phase) => (phase === "finishing" ? phase : "listening"));
      else if (update.state === "done") end(true);
      else {
        toast.error(update.error ?? "Dictation stopped.");
        end(true);
      }
    });

    try {
      const { id } = await window.workbench.dictation.start();
      current.id = id;
      if (current.over) {
        void window.workbench.dictation.cancel({ id }).catch(() => {});
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, "elastic-pcm");
      context.createMediaStreamSource(stream).connect(node);
      current.capture = { stream, context, node };
      if (current.over) {
        release(current.capture);
        return;
      }
      node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        setLevel(event.data.level);
        if (event.data.pcm.byteLength === 0) return;
        const pcm = toBase64(new Uint8Array(event.data.pcm));
        current.sent = current.sent.then(() => window.workbench.dictation.push({ id, pcm })).catch(() => {});
      };
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      if (!current.over) {
        if (current.id) void window.workbench.dictation.cancel({ id: current.id }).catch(() => {});
        end(false);
        toast.error(error instanceof Error ? error.message : "Dictation could not start.");
      }
    }
  }, [end]);

  /** Stop listening and let the helper settle the last words; `done` ends it. */
  const stop = useCallback(async () => {
    const current = active.current;
    if (!current || !current.id || !current.capture) {
      cancel();
      return;
    }
    setPhase("finishing");
    setLevel(0);
    const { node, stream } = current.capture;
    // What the worklet still holds, then the microphone off.
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 250);
      const previous = node.port.onmessage;
      node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number; flushed?: boolean }>) => {
        previous?.call(node.port, event);
        if (event.data.flushed) {
          window.clearTimeout(timer);
          resolve();
        }
      };
      node.port.postMessage("flush");
    });
    for (const track of stream.getTracks()) track.stop();
    await current.sent;
    if (!current.over) void window.workbench.dictation.finish({ id: current.id }).catch(() => end(true));
  }, [cancel, end]);

  const toggle = useCallback(() => {
    if (phase === "idle") void start();
    else if (phase === "listening" || phase === "preparing") void stop();
    else if (phase === "starting") cancel();
  }, [phase, start, stop, cancel]);

  // Another chat's box, or the composer gone: what was heard stays where it was written.
  useEffect(() => {
    return () => {
      const current = active.current;
      if (current?.id) void window.workbench.dictation.cancel({ id: current.id }).catch(() => {});
      if (current) {
        current.over = true;
        active.current = null;
        current.off?.();
        release(current.capture);
      }
      setPhase("idle");
      setLevel(0);
    };
  }, [scope]);

  return { available, phase, level, toggle, cancel };
}
