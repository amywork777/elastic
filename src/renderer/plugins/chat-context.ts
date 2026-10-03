import { appContextBlocks, appContextPromptBlocks, appContextSummary, useComposer } from "@renderer/state/composer";
import { useSessions } from "@renderer/state/sessions";

/**
 * How an MCP App reaches the chat it sits beside, the two MCP Apps host requests a view can make:
 *
 * - `ui/update-model-context`: what goes with the person's next message. Each update replaces the
 *   frame's last one (the spec's replace semantics; text-to-cad's Quick Edit resends its whole
 *   queue every time). It shows in the composer as a chip and joins the prompt when it is sent.
 * - `ui/message`: the person's message, now. It goes through the composer's queue like a typed
 *   prompt, so it waits behind a running turn.
 *
 * The chat is the frame's own session; a frame with none (a rail page) reaches the selected one.
 * When the frame's entry leaves the composer (the message went, or the person took the chip out),
 * `watch` calls back, and the frame tells its view the context is empty
 * (`openai/modelContext: null`, the key text-to-cad and Codex use), so the view starts again.
 */
export type ChatContext = {
  updateModelContext: (params: { content?: readonly unknown[] }) => Promise<Record<string, never>>;
  message: (params: { role?: string; content?: readonly unknown[] }) => Promise<Record<string, never>>;
  /** Calls `onCleared` each time this frame's queued entry leaves the composer. */
  watch: (onCleared: () => void) => () => void;
};

export const NO_CHAT = "Open a chat first: this view adds to the chat it is beside.";

export function createChatContext({ frameId, source, sessionId }: { frameId: string; source: string; sessionId: string | null }): ChatContext {
  const chat = () => {
    const id = sessionId ?? useSessions.getState().activeId;
    if (!id) throw new Error(NO_CHAT);
    return id;
  };
  /** The session this frame's entry was queued in, while it is there. */
  let queuedIn: string | null = null;
  return {
    updateModelContext: async ({ content }) => {
      const key = chat();
      const blocks = appContextBlocks(content);
      if (queuedIn && queuedIn !== key) useComposer.getState().removeAppContext(queuedIn, frameId);
      useComposer.getState().setAppContext(key, { frameId, source, blocks });
      queuedIn = blocks.length ? key : null;
      return {};
    },
    message: async ({ content }) => {
      const key = chat();
      const blocks = appContextBlocks(content);
      if (blocks.length === 0) throw new Error("The message has no text or image to send.");
      const entry = { frameId, source, blocks };
      void useComposer.getState().submit(key, appContextSummary([entry]) || source, appContextPromptBlocks([entry]));
      return {};
    },
    watch: (onCleared) => useComposer.subscribe((state) => {
      if (!queuedIn) return;
      const held = (state.appContexts[queuedIn] ?? []).some((entry) => entry.frameId === frameId);
      if (held) return;
      queuedIn = null;
      onCleared();
    }),
  };
}
