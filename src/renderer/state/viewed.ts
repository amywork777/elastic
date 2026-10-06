import { isUnread } from "@renderer/lib/sidebar";

import { sessionsOnScreen, useSessions } from "./sessions";
import { useUi } from "./ui";

/**
 * The open chat counts as seen while the window has focus: when it is opened, when the window
 * comes back to the front with it open, and when something happens in it while it is on screen.
 * A chat that changed while elastic was in the background stays unread until then (the Recents
 * unread dot, `lib/sidebar.ts`). Returns the unsubscribe.
 */
export function trackViewed(): () => void {
  /** The chat opened and not yet marked: opening is a view even when nothing is new in it. */
  let opened: string | null = null;
  const check = () => {
    const state = useSessions.getState();
    // On screen means the chat pane is showing: a plugin's page or the plugin store covers it.
    if (!document.hasFocus() || useUi.getState().surface.kind !== "home") return;
    // Both chats when two are side by side.
    for (const id of sessionsOnScreen(state)) {
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) continue;
      if (opened === id || session.lastViewedAt === null || isUnread(session)) {
        if (opened === id) opened = null;
        void state.markViewed(id).catch(() => {});
      }
    }
  };
  const unsubscribe = useSessions.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId) opened = state.activeId;
    if (state.activeId !== previous.activeId || state.sessions !== previous.sessions || state.split !== previous.split) check();
  });
  const unsurface = useUi.subscribe((state, previous) => {
    if (state.surface !== previous.surface) check();
  });
  window.addEventListener("focus", check);
  return () => {
    unsubscribe();
    unsurface();
    window.removeEventListener("focus", check);
  };
}
