/**
 * The system banner a chat's alert posts, and the dock's count: main holds a
 * banner until it is clicked or closed (Electron drops an unreferenced one and
 * its click with it), a click brings the window forward and names the chat back
 * to the page that asked, and the count goes to `app.setBadgeCount`.
 */
import type { EventEmitter } from "node:events";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const created: Array<{ options: unknown; shown: boolean; emitter: EventEmitter }> = [];
  const window = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return {
    created,
    window,
    supported: { value: true },
    setBadgeCount: vi.fn(() => true),
  };
});

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Notification extends Emitter {
    static isSupported = () => electron.supported.value;
    constructor(options: unknown) {
      super();
      electron.created.push({ options, shown: false, emitter: this });
    }
    show() {
      const entry = electron.created.find((candidate) => candidate.emitter === this);
      if (entry) entry.shown = true;
    }
  }
  return {
    Notification,
    BrowserWindow: { fromWebContents: () => electron.window },
    app: { setBadgeCount: electron.setBadgeCount },
    ipcMain: { handle: vi.fn() },
  };
});

import { notificationsHandlers } from "@main/ipc/notifications";

afterEach(() => {
  vi.unstubAllEnvs();
});

const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() };
const ctx = { event: {}, sender } as never;

beforeEach(() => {
  // Whatever shell runs the suite, these posts are from a window that is shown.
  vi.stubEnv("WORKBENCH_E2E_HIDDEN", "0");
  electron.created.length = 0;
  electron.supported.value = true;
  sender.send.mockClear();
  sender.isDestroyed.mockReturnValue(false);
  for (const fn of Object.values(electron.window)) fn.mockClear();
});

it("posts a silent banner, and a click restores the window and names the chat back", () => {
  const answer = notificationsHandlers.notifications.show({ sessionId: "s1", title: "Finished · Fix", body: "Done." }, ctx);
  expect(answer).toEqual({ shown: true });
  expect(electron.created).toHaveLength(1);
  expect(electron.created[0]!.options).toEqual({ title: "Finished · Fix", body: "Done.", silent: true });
  expect(electron.created[0]!.shown).toBe(true);

  electron.created[0]!.emitter.emit("click");
  expect(electron.window.restore).toHaveBeenCalled();
  expect(electron.window.focus).toHaveBeenCalled();
  expect(sender.send).toHaveBeenCalledWith(expect.stringContaining("notifications.clicked"), { sessionId: "s1" });
});

it("does nothing on a click once the page that asked is gone", () => {
  notificationsHandlers.notifications.show({ sessionId: "s1", title: "Finished", body: "" }, ctx);
  sender.isDestroyed.mockReturnValue(true);
  electron.created[0]!.emitter.emit("click");
  expect(electron.window.focus).not.toHaveBeenCalled();
  expect(sender.send).not.toHaveBeenCalled();
});

it("says so where the platform has no notification centre", () => {
  electron.supported.value = false;
  expect(notificationsHandlers.notifications.show({ sessionId: "s1", title: "Finished", body: "" }, ctx)).toEqual({ shown: false });
  expect(electron.created).toHaveLength(0);
});

it("posts nothing from a window the e2e suite never shows", () => {
  vi.stubEnv("WORKBENCH_E2E_HIDDEN", "1");
  expect(notificationsHandlers.notifications.show({ sessionId: "s1", title: "Finished", body: "" }, ctx)).toEqual({ shown: false });
  expect(electron.created).toHaveLength(0);
});

it("sets the dock's count, zero clearing it", () => {
  notificationsHandlers.notifications.badge({ count: 3 });
  notificationsHandlers.notifications.badge({ count: 0 });
  expect(electron.setBadgeCount.mock.calls).toEqual([[3], [0]]);
});
