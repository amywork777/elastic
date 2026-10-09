import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sound = vi.hoisted(() => ({ play: vi.fn(async () => {}) }));
vi.mock("@renderer/features/settings/sound", () => ({ playNotificationSound: sound.play }));
const sonner = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});
vi.mock("sonner", () => ({ toast: sonner.toast }));

import { alertFor, badgeCount, deliveryFor, needsYou, trackTurnAlerts } from "@renderer/state/turn-alerts";
import { useSessions } from "@renderer/state/sessions";
import { useSettings } from "@renderer/state/settings";
import { useUi } from "@renderer/state/ui";
import { defaultSettings, type Session } from "@shared/types";

/**
 * Settings › General › Notifications had a card and no caller: nothing posted a
 * notification or played the sound when a turn ended, and the dock never said
 * a chat was waiting. These hold what does.
 */

const row = (overrides: Partial<Session> & { id: string }): Session => ({
  projectId: "p1",
  title: "Fix the build",
  titleSource: "prompt",
  agentId: "claude-code",
  cwd: "/repo",
  gitMode: "none",
  createdAt: 0,
  updatedAt: 0,
  status: "idle",
  acpSessionId: "acp",
  changedFiles: 0,
  insertions: 0,
  deletions: 0,
  archived: false,
  pinned: false,
  sessionHead: null,
  turnHead: null,
  lastViewedAt: null,
  statusOverride: null,
  ...overrides,
});

describe("what counts", () => {
  it("names a turn's end, its failure and a question, and nothing else", () => {
    expect(alertFor("running", row({ id: "a", status: "idle" }))).toBe("finished");
    expect(alertFor("waiting", row({ id: "a", status: "idle" }))).toBe("finished");
    expect(alertFor("running", row({ id: "a", status: "error" }))).toBe("failed");
    expect(alertFor("running", row({ id: "a", status: "waiting" }))).toBe("waiting");
    // A create or a reconnect settling, a disconnect, the first sight of a chat, an archived chat.
    expect(alertFor("connecting", row({ id: "a", status: "idle" }))).toBeNull();
    expect(alertFor("running", row({ id: "a", status: "closed" }))).toBeNull();
    expect(alertFor("idle", row({ id: "a", status: "closed" }))).toBeNull();
    expect(alertFor(undefined, row({ id: "a", status: "idle" }))).toBeNull();
    expect(alertFor("running", row({ id: "a", status: "idle", archived: true }))).toBeNull();
    expect(alertFor("idle", row({ id: "a", status: "idle" }))).toBeNull();
    expect(alertFor("idle", row({ id: "a", status: "running" }))).toBeNull();
  });

  it("stays quiet about the chat in front of a focused window, and banners only from the background", () => {
    const settings = defaultSettings();
    expect(deliveryFor(settings, { focused: true, onScreen: true })).toEqual({ sound: false, toast: false, banner: false });
    expect(deliveryFor(settings, { focused: true, onScreen: false })).toEqual({ sound: false, toast: true, banner: false });
    expect(deliveryFor(settings, { focused: false, onScreen: true })).toEqual({ sound: true, toast: true, banner: true });
    expect(deliveryFor({ ...settings, notificationSoundTiming: "always" }, { focused: true, onScreen: true }).sound).toBe(true);
    expect(deliveryFor({ ...settings, notificationOsBanners: false }, { focused: false, onScreen: false }).banner).toBe(false);
    expect(deliveryFor({ ...settings, notificationSound: false }, { focused: false, onScreen: false }).sound).toBe(false);
    expect(deliveryFor({ ...settings, notificationsEnabled: false }, { focused: false, onScreen: false })).toEqual({
      sound: false,
      toast: false,
      banner: false,
    });
  });

  it("counts a chat that waits on the person or finished unseen, as Recents' dot reads unseen", () => {
    expect(needsYou(row({ id: "a", status: "waiting" }))).toBe(true);
    // Unread: activity after the last view.
    expect(needsYou(row({ id: "a", status: "idle", updatedAt: 20, lastViewedAt: 10 }))).toBe(true);
    expect(needsYou(row({ id: "a", status: "error", updatedAt: 20, lastViewedAt: 10 }))).toBe(true);
    // Evicted after it finished: still unseen.
    expect(needsYou(row({ id: "a", status: "closed", updatedAt: 20, lastViewedAt: 10 }))).toBe(true);
    // Seen, never seen since Recents arrived (reads as read), still working, archived.
    expect(needsYou(row({ id: "a", status: "idle", updatedAt: 10, lastViewedAt: 20 }))).toBe(false);
    expect(needsYou(row({ id: "a", status: "idle", updatedAt: 20, lastViewedAt: null }))).toBe(false);
    expect(needsYou(row({ id: "a", status: "running", updatedAt: 20, lastViewedAt: 10 }))).toBe(false);
    expect(needsYou(row({ id: "a", status: "connecting", acpSessionId: null, updatedAt: 20, lastViewedAt: 10 }))).toBe(false);
    expect(needsYou(row({ id: "a", status: "waiting", archived: true }))).toBe(false);
  });

  it("puts nothing on the dock while notifications are off", () => {
    const sessions = [row({ id: "a", status: "waiting" }), row({ id: "b", updatedAt: 20, lastViewedAt: 10 }), row({ id: "c" })];
    expect(badgeCount(sessions, defaultSettings())).toBe(2);
    expect(badgeCount(sessions, { notificationsEnabled: false })).toBe(0);
    expect(badgeCount(sessions, null)).toBe(0);
  });
});

const bridge = window.workbench as unknown as Record<string, unknown>;
const saved = { on: bridge.on, notifications: bridge.notifications };
let stop = () => {};
let clicked: ((payload: { sessionId: string }) => void) | null = null;
const show = () => (bridge.notifications as { show: ReturnType<typeof vi.fn> }).show;
const badge = () => (bridge.notifications as { badge: ReturnType<typeof vi.fn> }).badge;

beforeEach(() => {
  useSettings.setState({ settings: defaultSettings(), ready: true });
  useUi.setState({ route: "app", surface: { kind: "home" } });
  clicked = null;
  bridge.on = vi.fn((channel: string, listener: (payload: { sessionId: string }) => void) => {
    if (channel === "notifications.clicked") clicked = listener;
    return () => {};
  });
  bridge.notifications = { show: vi.fn(async () => ({ shown: true })), badge: vi.fn(async () => undefined) };
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});

afterEach(() => {
  stop();
  Object.assign(bridge, saved);
  vi.restoreAllMocks();
  sound.play.mockClear();
  sonner.toast.mockClear();
  sonner.toast.error.mockClear();
});

describe("tracking", () => {
  it("rings, toasts and banners a background chat whose turn ends, and not the list it started from", () => {
    useSessions.setState({ sessions: [row({ id: "a", status: "running" })], activeId: null, split: null });
    stop = trackTurnAlerts();
    expect(sound.play).not.toHaveBeenCalled();

    useSessions.setState({ sessions: [row({ id: "a", status: "idle" })] });
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sonner.toast).toHaveBeenCalledWith("Finished · Fix the build", expect.objectContaining({ action: expect.anything() }));
    expect(show()).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "a", title: "Finished · Fix the build" }));

    // Nothing new: the same status again is not a second notification.
    useSessions.setState({ sessions: [row({ id: "a", status: "idle", updatedAt: 5 })] });
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("skips the toast for the chat on screen in a focused window, and toasts it once Settings covers it", () => {
    vi.mocked(document.hasFocus).mockReturnValue(true);
    useSessions.setState({ sessions: [row({ id: "a", status: "running" })], activeId: "a", split: null });
    stop = trackTurnAlerts();
    useSessions.setState({ sessions: [row({ id: "a", status: "waiting" })] });
    expect(sonner.toast).not.toHaveBeenCalled();
    expect(sound.play).not.toHaveBeenCalled();
    expect(show()).not.toHaveBeenCalled();

    useUi.setState({ route: "settings" });
    useSessions.setState({ sessions: [row({ id: "a", status: "running" })] });
    useSessions.setState({ sessions: [row({ id: "a", status: "error" })] });
    expect(sonner.toast.error).toHaveBeenCalledWith("Stopped with an error · Fix the build", expect.anything());
    // Focused: no banner, and the default timing keeps the sound for the background.
    expect(show()).not.toHaveBeenCalled();
    expect(sound.play).not.toHaveBeenCalled();
  });

  it("chimes once for two chats that end together", () => {
    useSessions.setState({ sessions: [row({ id: "a", status: "running" }), row({ id: "b", status: "running" })], activeId: null, split: null });
    stop = trackTurnAlerts();
    useSessions.setState({ sessions: [row({ id: "a", status: "idle" }), row({ id: "b", status: "waiting" })] });
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sonner.toast).toHaveBeenCalledTimes(2);
    expect(show()).toHaveBeenCalledTimes(2);
  });

  it("says nothing at all while notifications are off", () => {
    useSettings.setState({ settings: { ...defaultSettings(), notificationsEnabled: false } });
    useSessions.setState({ sessions: [row({ id: "a", status: "running" })], activeId: null, split: null });
    stop = trackTurnAlerts();
    useSessions.setState({ sessions: [row({ id: "a", status: "idle" })] });
    expect(sound.play).not.toHaveBeenCalled();
    expect(sonner.toast).not.toHaveBeenCalled();
    expect(show()).not.toHaveBeenCalled();
  });

  it("opens the chat a banner click names", () => {
    useSessions.setState({ sessions: [row({ id: "a" }), row({ id: "b" })], activeId: "a", split: null });
    useUi.setState({ route: "settings", surface: { kind: "plugins", view: "browse" } });
    stop = trackTurnAlerts();
    clicked?.({ sessionId: "b" });
    expect(useSessions.getState().activeId).toBe("b");
    expect(useUi.getState().route).toBe("app");
    expect(useUi.getState().surface.kind).toBe("home");
  });

  it("keeps the dock's count with the index and the setting, sending it only when it moves", () => {
    useSessions.setState({ sessions: [row({ id: "a", status: "running", updatedAt: 20, lastViewedAt: 10 })], activeId: null, split: null });
    stop = trackTurnAlerts();
    // The first count goes out even at zero, clearing a badge a crashed run left.
    expect(badge()).toHaveBeenLastCalledWith({ count: 0 });

    useSessions.setState({ sessions: [row({ id: "a", status: "waiting", updatedAt: 30, lastViewedAt: 10 })] });
    expect(badge()).toHaveBeenLastCalledWith({ count: 1 });
    // Answered: working again, so not counted.
    useSessions.setState({ sessions: [row({ id: "a", status: "running", updatedAt: 40, lastViewedAt: 10 })] });
    expect(badge()).toHaveBeenLastCalledWith({ count: 0 });
    // Finished unseen, then seen.
    useSessions.setState({ sessions: [row({ id: "a", status: "idle", updatedAt: 50, lastViewedAt: 10 })] });
    expect(badge()).toHaveBeenLastCalledWith({ count: 1 });
    const calls = badge().mock.calls.length;
    useSessions.setState({ sessions: [row({ id: "a", status: "idle", updatedAt: 50, lastViewedAt: 10, title: "Renamed" })] });
    expect(badge().mock.calls.length).toBe(calls);

    useSettings.setState({ settings: { ...defaultSettings(), notificationsEnabled: false } });
    expect(badge()).toHaveBeenLastCalledWith({ count: 0 });
    useSettings.setState({ settings: defaultSettings() });
    expect(badge()).toHaveBeenLastCalledWith({ count: 1 });

    useSessions.setState({ sessions: [row({ id: "a", status: "idle", updatedAt: 50, lastViewedAt: 60 })] });
    expect(badge()).toHaveBeenLastCalledWith({ count: 0 });
  });
});
