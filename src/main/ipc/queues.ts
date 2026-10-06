import type { IpcHandlers } from "../../shared/ipc/define";
import type { queuesContract } from "../../shared/ipc/queues";
import { queuedPrompts } from "../db/repositories";

export const queuesHandlers = {
  queues: {
    list: () => queuedPrompts.list(),
    set: ({ sessionId, queue }) => queuedPrompts.set(sessionId, queue),
  },
} satisfies IpcHandlers<typeof queuesContract>;
