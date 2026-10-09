/**
 * The only bridge between the renderer and the rest of the machine.
 *
 * It exposes exactly one object, `window.workbench`, built by walking the IPC
 * contract — so a channel that is not in `src/shared/ipc.ts` cannot be reached
 * from the renderer, and adding one takes no edit here. `ipcRenderer` itself is
 * never handed over.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

import {
  IPC_EVENT_PREFIX,
  IPC_INVOKE_PREFIX,
  ipcContract,
  ipcEvents,
  isInvokeDef,
  type WorkbenchApi,
  type IpcClient,
  type IpcContract,
  type IpcEventChannel,
  type IpcEventPayload,
  type IpcNode,
} from "../shared/ipc";

function buildClient(node: IpcNode, path: string[]): unknown {
  if (isInvokeDef(node)) {
    const channel = `${IPC_INVOKE_PREFIX}${path.join(".")}`;
    return (request: unknown) => ipcRenderer.invoke(channel, request);
  }
  const branch: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    branch[key] = buildClient(child, [...path, key]);
  }
  return Object.freeze(branch);
}

function on<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void,
): () => void {
  if (!(channel in ipcEvents)) {
    throw new Error(`unknown event channel: ${channel}`);
  }
  const wire = `${IPC_EVENT_PREFIX}${channel}`;
  // The IpcRendererEvent is deliberately dropped: it carries a `sender` the
  // renderer has no business holding.
  const forward = (_event: IpcRendererEvent, payload: unknown) =>
    listener(payload as IpcEventPayload<C>);
  ipcRenderer.on(wire, forward);
  return () => {
    ipcRenderer.off(wire, forward);
  };
}

const client = buildClient(ipcContract, []) as IpcClient<IpcContract>;
// Not a channel: the lookup is local to this process, and answers only for a `File` the page
// already holds — one the person dropped or picked.
const pathForFile = (file: File): string => {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return "";
  }
};
const api: WorkbenchApi = Object.freeze({ ...client, on, pathForFile });

contextBridge.exposeInMainWorld("workbench", api);
