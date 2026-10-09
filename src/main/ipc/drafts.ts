import type { IpcHandlers } from "../../shared/ipc/define";
import type { draftsContract } from "../../shared/ipc/drafts";
import { composerDrafts } from "../db/repositories";

export const draftsHandlers = {
  drafts: {
    list: () => composerDrafts.list(),
    set: ({ key, draft }) => composerDrafts.set(key, draft),
  },
} satisfies IpcHandlers<typeof draftsContract>;
