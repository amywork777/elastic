import type { WebContents } from "electron";

import type { IpcHandlers } from "../../shared/ipc/define";
import type { dictationContract } from "../../shared/ipc/dictation";
import { appRoot } from "../app-paths";
import { createDictation, type Dictation } from "../dictation";
import { emit, IpcError, type IpcContext } from "./register";

let service: Dictation | null = null;
/** The windows that have been told to cancel a dictation when they go. */
const watched = new WeakSet<WebContents>();

function dictation(): Dictation {
  // `appRoot`, not `app.getAppPath()`: the e2e suite launches `out/main/index.js` directly.
  service ??= createDictation(appRoot());
  return service;
}

/** Quit's teardown: a helper still listening is stopped with the app. */
export function disposeDictation(): void {
  service?.dispose();
}

export const dictationHandlers = {
  dictation: {
    available: () => dictation().available(),
    start: (_request, { sender }) => {
      // A window that closes mid-sentence takes its dictation with it.
      if (!watched.has(sender)) {
        watched.add(sender);
        sender.once("destroyed", () => service?.dispose());
      }
      try {
        return dictation().start((update) => emit([sender], "dictation.update", update));
      } catch (error) {
        throw new IpcError(error instanceof Error ? error.message : String(error));
      }
    },
    push: ({ id, pcm }) => {
      try {
        dictation().push(id, Buffer.from(pcm, "base64"));
      } catch (error) {
        throw new IpcError(error instanceof Error ? error.message : String(error));
      }
    },
    finish: ({ id }) => dictation().finish(id),
    cancel: ({ id }) => dictation().cancel(id),
  },
} satisfies IpcHandlers<typeof dictationContract, IpcContext>;
