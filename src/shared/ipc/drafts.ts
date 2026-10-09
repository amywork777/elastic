/**
 * `drafts.*`: what each composer holds unsent, kept on disk so a half-typed prompt outlives a
 * quit or an update's restart (`src/renderer/state/composer.ts`, `persistDrafts`). Keyed as the
 * composer keys its drafts: a chat's session id, or a new-session key for a project. What is kept
 * is what can be put back as it was: the typed text (references are tokens in it), its chips'
 * labels, the workspace a CAD reference pinned it to, and the notes added from the viewer with
 * what they are about. Attachments and a note's sketch are renderer-only `File`s and are not kept.
 */
import { z } from "zod";

import { defineIpc, invoke } from "./define";

const KeySchema = z.string().min(1).max(4096);

/**
 * What a note is about, as the viewer handed it over (`PromptReference` in `@workbench/core`).
 * Loose past its two named parts: the renderer wrote it and is the one that reads it back, and the
 * shape belongs to the core package, not to this contract.
 */
const PersistedReferenceSchema = z.looseObject({
  resource: z.record(z.string(), z.unknown()),
  target: z.record(z.string(), z.unknown()),
  label: z.string().max(4096).optional(),
});

export const PersistedDraftSchema = z.object({
  text: z.string().max(1_000_000),
  /** Each reference token's label, for its chip. */
  labels: z.record(z.string().max(4096), z.string().max(4096)).optional(),
  /** The workspace a new draft with a CAD reference runs in. */
  root: z.string().max(4096).optional(),
  annotations: z.array(z.object({
    id: z.string().min(1).max(200),
    references: z.array(PersistedReferenceSchema).max(100),
    text: z.string().max(100_000),
  })).max(200).optional(),
});
export type PersistedDraft = z.infer<typeof PersistedDraftSchema>;

export const draftsContract = defineIpc({
  drafts: {
    /** Every composer's draft as it was last saved, by draft key. */
    list: invoke(z.void(), z.record(z.string(), PersistedDraftSchema)),
    /** Replace one draft; null deletes it (sent, cleared, or its chat deleted). */
    set: invoke(z.object({ key: KeySchema, draft: PersistedDraftSchema.nullable() }).strict(), z.void()),
  },
});
