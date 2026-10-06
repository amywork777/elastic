/**
 * `queues.*`: the prompts queued behind a chat's turn, kept on disk so quitting does not spend
 * them (`src/renderer/state/composer.ts`, `persistQueues`). What is kept is what can be sent: the
 * typed text for the queue's row and the prompt's blocks. The draft a queued prompt came from
 * (its files, its notes) lives only in the renderer, so a restored prompt cannot be taken back
 * into the box as it was, only sent or removed.
 */
import { z } from "zod";

import { PromptBlockSchema } from "../acp/types";
import { defineIpc, invoke } from "./define";

export const PersistedQueuedPromptSchema = z.object({
  id: z.string().min(1).max(200),
  text: z.string().max(1_000_000),
  content: z.array(PromptBlockSchema).min(1).max(500),
});
export type PersistedQueuedPrompt = z.infer<typeof PersistedQueuedPromptSchema>;

/** A queue past this is not a queue anybody typed; it is refused rather than kept. */
export const MAX_PERSISTED_QUEUE = 100;

export const queuesContract = defineIpc({
  queues: {
    /** Every chat's queue as it was last saved. */
    list: invoke(z.void(), z.record(z.string(), z.array(PersistedQueuedPromptSchema))),
    /** Replace one chat's saved queue; an empty one is deleted. */
    set: invoke(
      z.object({ sessionId: z.string().min(1).max(200), queue: z.array(PersistedQueuedPromptSchema).max(MAX_PERSISTED_QUEUE) }).strict(),
      z.void(),
    ),
  },
});
