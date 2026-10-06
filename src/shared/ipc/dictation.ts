/**
 * The composer's microphone: the renderer records, main pipes the samples to
 * the on-device helper (`src/main/dictation`), and what it hears comes back as
 * `dictation.update` events.
 *
 * One dictation at a time, named by the id `start` returns; a push, finish or
 * cancel for any other id is ignored, so a late chunk from a dictation that
 * has already ended does nothing.
 */
import { z } from "zod";

import { defineIpc, invoke } from "./define";

/** 16 kHz mono 16-bit: a second of audio is 32 000 bytes, and a chunk is a fraction of one. */
export const DICTATION_SAMPLE_RATE = 16_000;
export const MAX_DICTATION_CHUNK_BYTES = 64 * 1024;

const id = z.string().uuid();

export const DictationAvailabilitySchema = z.object({
  available: z.boolean(),
  /** Why not: off macOS, before macOS 26, or a build without the helper. */
  reason: z.enum(["platform", "os", "missing"]).optional(),
});
export type DictationAvailability = z.infer<typeof DictationAvailabilitySchema>;

export const dictationContract = defineIpc({
  dictation: {
    available: invoke(z.void(), DictationAvailabilitySchema),
    start: invoke(z.void(), z.object({ id })),
    /** Raw little-endian 16-bit samples at `DICTATION_SAMPLE_RATE`, base64. */
    push: invoke(
      z.object({
        id,
        pcm: z.string().max(Math.ceil(MAX_DICTATION_CHUNK_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/),
      }).strict(),
      z.void(),
    ),
    /** The audio is over: the helper settles what it heard, then sends `done`. */
    finish: invoke(z.object({ id }).strict(), z.void()),
    /** Drop it: no `done`, and nothing more for this id. */
    cancel: invoke(z.object({ id }).strict(), z.void()),
  },
});

export const dictationEvents = {
  "dictation.update": z.object({
    id,
    /**
     * `preparing` while the language's model installs (the first dictation only), `listening`
     * once audio is wanted, `done` with the settled text, `error` with a sentence for a person.
     */
    state: z.enum(["preparing", "listening", "done", "error"]),
    /** Everything heard so far. */
    text: z.string(),
    error: z.string().optional(),
  }),
} as const;
