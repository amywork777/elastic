import { create } from "zustand";

import type { FrameCall } from "./McpAppFrame";

/**
 * Calls an agent made to a tool with a UI, waiting for (or replacing what is
 * in) that tool's tab. `nonce` remounts the frame, so each call is shown
 * fresh, as an MCP Apps host shows each tool result in its view.
 */
type CallsState = {
  byTab: Record<string, { call: FrameCall; nonce: number }>;
  show: (tabId: string, call: FrameCall) => void;
};

let nonce = 0;

export const useToolCalls = create<CallsState>((set) => ({
  byTab: {},
  show: (tabId, call) => set((state) => ({ byTab: { ...state.byTab, [tabId]: { call, nonce: ++nonce } } })),
}));
