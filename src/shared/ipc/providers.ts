/**
 * `providers.*`: Settings › Models & keys. Keys go in and never come back out:
 * a provider crosses this bridge with `hasKey` only (`src/shared/providers.ts`).
 */
import { z } from "zod";

import { invoke } from "./define";
import { ProviderInputSchema, ProviderSchema, ProviderTestSchema } from "../providers";

const id = z.object({ id: z.string().min(1).max(64) }).strict();

export const providersContract = {
  providers: {
    list: invoke(z.void(), z.array(ProviderSchema)),
    save: invoke(ProviderInputSchema, ProviderSchema),
    remove: invoke(id, z.void()),
    /** One cheap real request: a model list, a key check, a local server's tags. */
    test: invoke(id, ProviderTestSchema),
  },
} as const;
