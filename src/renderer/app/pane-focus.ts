import { useSessions } from "@renderer/state/sessions";

/**
 * Where focus belongs in each pane, shared by the shell's F6 cycling and by whatever returns the
 * keyboard to the shell from a route of its own (Settings).
 */

/**
 * Where focus lands in a pane it has not been in yet: the sidebar's current
 * session, the composer, the explorer's strip tab — each pane's one stop
 * worth arriving at — else the pane's first control.
 */
export const PANE_HOMES: Record<"sidebar" | "session" | "explorer", string> = {
  sidebar: "[aria-current=page], [aria-current=true]",
  session: "[data-composer-input][contenteditable=true], [data-composer-input]:not([disabled])",
  explorer: '[role=tab][tabindex="0"]',
};

export const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [contenteditable=true], [tabindex]:not([tabindex="-1"])';

/**
 * Put focus where the session's work is: the composer, else the pane's first control. For a
 * route that just closed (Settings) whose button took its focus with it. The pane mounts in the
 * same commit, but the composer's editor does not (`immediatelyRender: false`), so it is absent
 * on the first try and arrives a frame later. Only the composer is tried first, so the header's
 * buttons are not focused, and announced, on the way to it; the pane's first control is the
 * fallback after that frame, for a session with no composer to land on.
 */
export function focusSessionHome(): void {
  // Two chats side by side: the focused one's view (the active chat), not the first in the pane.
  const pane = () => {
    const root = document.getElementById("session");
    const active = useSessions.getState().activeId;
    return (active ? root?.querySelector<HTMLElement>(`[data-session-view="${CSS.escape(active)}"]`) : null) ?? root;
  };
  const composer = () => pane()?.querySelector<HTMLElement>(PANE_HOMES.session) ?? null;
  const first = composer();
  if (first) {
    first.focus();
    return;
  }
  window.requestAnimationFrame(() => (composer() ?? pane()?.querySelector<HTMLElement>(TABBABLE))?.focus());
}

/**
 * Put the keyboard in this chat's composer once it is on screen: what a click on a chat in the
 * sidebar is for. Without it focus stayed on the sidebar's row, and the first keys typed after a
 * switch went nowhere. The chat's view mounts in a later commit and its editor a frame after that,
 * and a chat that is reconnecting opens its composer when the agent is back, so this looks once a
 * frame for up to `frames`. It gives up as soon as focus has gone anywhere but where it started
 * (or the page): someone who clicked elsewhere meanwhile keeps their focus.
 */
export function focusComposerOf(sessionId: string, frames = 150): void {
  const started = document.activeElement;
  const attempt = (left: number) => {
    const current = document.activeElement;
    if (current !== started && current !== document.body && current !== null) return;
    const view = document.querySelector(`[data-session-view="${CSS.escape(sessionId)}"]`);
    const composer = view?.querySelector<HTMLElement>(PANE_HOMES.session);
    if (composer) {
      composer.focus();
      return;
    }
    if (left > 0) window.requestAnimationFrame(() => attempt(left - 1));
  };
  window.requestAnimationFrame(() => attempt(frames));
}
