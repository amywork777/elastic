import { toast } from "sonner";

import { focusComposerOf } from "@renderer/app/pane-focus";
import { playNotificationSound } from "@renderer/features/settings/sound";
import { isUnread, statusTag } from "@renderer/lib/sidebar";
import type { Session, SessionStatus, Settings } from "@shared/types";

import { useAcp } from "./acp";
import { leaveWelcome } from "./onboarding";
import { sessionsOnScreen, useSessions } from "./sessions";
import { useSettings } from "./settings";
import { useUi } from "./ui";

/**
 * Settings › General › Notifications: a chat whose turn finished, failed or
 * stopped to ask the person something says so — a sound, a toast with Open,
 * and a system banner while the window is in the background — and the dock
 * counts the chats that need them.
 *
 * Read off the session index (`sessions.changed`), which main keeps for every
 * chat, open or not, so a chat in the background is heard from as much as the
 * one on screen. Only a change seen happen counts: the first list after launch
 * is the starting point, not a batch of news. The badge is different: it is a
 * count of what is true now, so a chat left waiting or unread by the last
 * launch is counted from the first list.
 */
export type TurnAlertKind = "finished" | "failed" | "waiting";

/**
 * What a status change says, or null when it says nothing worth a notification.
 * A permission request and an agent's question both arrive as `waiting`
 * (`createElicitation` in `src/main/acp/client.ts` goes through the permission
 * path), so one kind covers both.
 */
export function alertFor(previous: SessionStatus | undefined, session: Session): TurnAlertKind | null {
  if (previous === undefined || previous === session.status || session.archived) return null;
  if (session.status === "waiting") return "waiting";
  // A turn ended. `connecting` → `idle` is a create or a reconnect, and `closed` is a disconnect
  // or the keep-alive's eviction: main's own housekeeping, which never stamps a chat as activity
  // either (`isActivity` in `src/main/acp/sessions.ts`).
  if (previous !== "running" && previous !== "waiting") return null;
  if (session.status === "idle") return "finished";
  if (session.status === "error") return "failed";
  return null;
}

type DeliverySettings = Pick<Settings, "notificationsEnabled" | "notificationSound" | "notificationSoundTiming" | "notificationOsBanners">;

/**
 * How an alert reaches the person, given where they are looking. `focused` is
 * the window's focus; `onScreen` is the chat being one the chat pane shows (both
 * sides when split) with nothing covering it — Settings, the plugin store or a
 * plugin's page.
 */
export function deliveryFor(
  settings: DeliverySettings,
  where: { focused: boolean; onScreen: boolean },
): { sound: boolean; toast: boolean; banner: boolean } {
  if (!settings.notificationsEnabled) return { sound: false, toast: false, banner: false };
  return {
    sound: settings.notificationSound && (!where.focused || settings.notificationSoundTiming === "always"),
    // The chat in front of a focused window already shows what happened.
    toast: !(where.focused && where.onScreen),
    banner: !where.focused && settings.notificationOsBanners,
  };
}

/**
 * A chat that needs the person: one waiting on a permission or a question, or
 * one whose finished turn they have not seen. Unread is Recents' own notion
 * (`isUnread`, the dot and bold title, kept by `state/viewed.ts`), not a second
 * one; a chat still working is left out, because its activity stamps it unread
 * long before there is anything to look at. An archived chat is out of sight
 * and out of the count.
 */
export function needsYou(session: Session): boolean {
  if (session.archived) return false;
  const { tag } = statusTag(session);
  if (tag === "waiting") return true;
  return tag !== "working" && isUnread(session);
}

/** The dock's count: nothing while notifications are off. */
export function badgeCount(sessions: readonly Session[], settings: Pick<Settings, "notificationsEnabled"> | null): number {
  if (!settings?.notificationsEnabled) return 0;
  return sessions.filter(needsYou).length;
}

const HEADLINES: Record<TurnAlertKind, string> = {
  finished: "Finished",
  failed: "Stopped with an error",
  waiting: "Waiting on you",
};

/** One line, cut with an ellipsis at `max` characters. */
function line(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The last thing the agent said in this chat, one line, when the renderer holds
 * it. A chat in the background whose transcript was never loaded here has none,
 * and the body says the plain fact instead.
 */
function lastReply(sessionId: string): string {
  const turns = useAcp.getState().sessions[sessionId]?.turns ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role !== "agent") continue;
    for (let part = turn.parts.length - 1; part >= 0; part -= 1) {
      const candidate = turn.parts[part]!;
      if (candidate.type === "text" && candidate.text.trim()) return line(candidate.text, 140);
    }
    return "";
  }
  return "";
}

function bodyFor(kind: TurnAlertKind, sessionId: string): string {
  if (kind === "waiting") return "The agent is asking for permission or an answer.";
  if (kind === "failed") return "The turn ended with an error.";
  return lastReply(sessionId) || "The turn is done.";
}

/**
 * A chat opened from a notification lands where a sidebar row would take it:
 * Settings, the welcome and a plugin's page step aside, as they do for the
 * menu's chat digits (`select-session` in `state/bridge.ts`).
 */
export function openChatFromAlert(sessionId: string): void {
  const session = useSessions.getState().sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.archived) return;
  const ui = useUi.getState();
  ui.closeSettings();
  leaveWelcome();
  ui.setSurface({ kind: "home" });
  useSessions.getState().select(sessionId);
  focusComposerOf(sessionId);
}

/** The chat is in front of the person: the chat pane shows it and nothing covers the pane. */
function isOnScreen(sessionId: string): boolean {
  const ui = useUi.getState();
  return ui.route === "app" && ui.surface.kind === "home" && sessionsOnScreen(useSessions.getState()).includes(sessionId);
}

function deliver(alerts: readonly { kind: TurnAlertKind; session: Session }[]): void {
  const settings = useSettings.getState().settings;
  if (!settings || alerts.length === 0) return;
  const focused = document.hasFocus();
  let rang = false;
  for (const { kind, session } of alerts) {
    const how = deliveryFor(settings, { focused, onScreen: isOnScreen(session.id) });
    // The title is the chat's own words; the contract takes 200 characters of it.
    const title = line(`${HEADLINES[kind]} · ${session.title || "Chat"}`, 200);
    const body = bodyFor(kind, session.id);
    // Two chats that finish in the same index change are one chime, not a chord.
    if (how.sound && !rang) {
      rang = true;
      void playNotificationSound(settings.notificationSoundFile).catch(() => {});
    }
    if (how.toast) {
      const options = {
        // One toast per chat: a newer alert for it replaces the older one.
        id: `turn-alert-${session.id}`,
        description: body,
        action: { label: "Open", onClick: () => openChatFromAlert(session.id) },
        // A question waits for the person; a finished turn is news that can pass.
        ...(kind === "waiting" ? { duration: 15_000 } : {}),
      };
      if (kind === "failed") toast.error(title, options);
      else toast(title, options);
    }
    if (how.banner) {
      void window.workbench.notifications.show({ sessionId: session.id, title, body: body.slice(0, 500) }).catch(() => {});
    }
  }
}

/** Start listening: alerts, the dock's count and banner clicks. Returns the unsubscribe. */
export function trackTurnAlerts(): () => void {
  const known = new Map<string, SessionStatus>();
  const seen = (sessions: readonly Session[]) => {
    known.clear();
    for (const session of sessions) known.set(session.id, session.status);
  };
  seen(useSessions.getState().sessions);

  // Sent only when it moves; -1 so the first count goes out even when it is 0, clearing whatever
  // a crashed run left on the dock.
  let badged = -1;
  const badge = () => {
    const count = badgeCount(useSessions.getState().sessions, useSettings.getState().settings);
    if (count === badged) return;
    badged = count;
    void window.workbench.notifications.badge({ count }).catch(() => {});
  };
  badge();

  const unsubscribe = useSessions.subscribe((state, previous) => {
    if (state.sessions === previous.sessions) return;
    const alerts = state.sessions.flatMap((session) => {
      const kind = alertFor(known.get(session.id), session);
      return kind ? [{ kind, session }] : [];
    });
    seen(state.sessions);
    deliver(alerts);
    badge();
  });
  // Turning notifications off clears the dock, and on brings the count back.
  const unsettled = useSettings.subscribe((state, previous) => {
    if (state.settings?.notificationsEnabled !== previous.settings?.notificationsEnabled) badge();
  });
  const unclicked = window.workbench.on("notifications.clicked", ({ sessionId }) => openChatFromAlert(sessionId));
  return () => {
    unsubscribe();
    unsettled();
    unclicked();
  };
}
