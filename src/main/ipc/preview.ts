import type { IpcHandlers } from "../../shared/ipc/define";
import type { previewContract } from "../../shared/ipc/preview";
import { previewServer } from "../preview/server";
import { rootOf } from "./explorer";

export const previewHandlers = {
  preview: {
    url: async ({ projectId, root, path }) => ({ url: await previewServer.urlFor(rootOf(projectId, root), path) }),
  },
} satisfies IpcHandlers<typeof previewContract>;
