import { isUnread } from "@renderer/lib/sidebar";

import { useSessions } from "./sessions";
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
    const { activeId, sessions, markViewed } = useSessions.getState();
    // On screen means the chat pane is showing: a plugin's page or the plugin store covers it.
    if (!activeId || !document.hasFocus() || useUi.getState().surface.kind !== "home") return;
    const session = sessions.find((candidate) => candidate.id === activeId);
    if (!session) return;
    if (opened === activeId || session.lastViewedAt === null || isUnread(session)) {
      opened = null;
      void markViewed(activeId).catch(() => {});
    }
  };
  const unsubscribe = useSessions.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId) opened = state.activeId;
    if (state.activeId !== previous.activeId || state.sessions !== previous.sessions) check();
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
