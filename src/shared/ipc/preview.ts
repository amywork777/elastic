/**
 * `preview.*`: the live preview's address for a file in a project (`src/main/preview/server.ts`).
 * The path is relative to the project or one of its worktrees (`root`), as every explorer path is.
 */
import { z } from "zod";

import { defineIpc, invoke } from "./define";

export const previewContract = defineIpc({
  preview: {
    url: invoke(
      z.object({
        projectId: z.string().min(1),
        root: z.string().min(1).nullable().optional(),
        path: z.string().min(1).max(4096).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), "a path inside the project"),
      }).strict(),
      z.object({ url: z.string().url() }),
    ),
  },
});
