import { BrowserWindow, Notification, app } from "electron";

import type { IpcHandlers } from "../../shared/ipc/define";
import type { notificationsContract } from "../../shared/ipc/notifications";
import { emit, type IpcContext } from "./register";

/**
 * Banners still on screen. Electron drops a `Notification` that nothing
 * references, and with it the click handler, so each is held until it is
 * clicked or closed.
 */
const live = new Set<Notification>();

export const notificationsHandlers = {
  notifications: {
    show: ({ sessionId, title, body }, { sender }) => {
      // A window the e2e suite never shows (`WORKBENCH_E2E_HIDDEN=1`, docs/design.md, "Windows
      // nobody sees") is never focused, so every turn it runs would put a banner on the screen of
      // whoever is at the machine.
      if (!Notification.isSupported() || process.env.WORKBENCH_E2E_HIDDEN === "1") {
        return { shown: false };
      }
      // The sound is the renderer's (Settings › General › Sound), so the banner is silent.
      const notification = new Notification({ title, body, silent: true });
      live.add(notification);
      notification.once("click", () => {
        live.delete(notification);
        // The window that asked: a click after it closed has nowhere to take the person.
        if (sender.isDestroyed()) return;
        const window = BrowserWindow.fromWebContents(sender);
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
        emit([sender], "notifications.clicked", { sessionId });
      });
      notification.once("close", () => live.delete(notification));
      notification.show();
      return { shown: true };
    },
    badge: ({ count }) => {
      // Zero clears the badge; a platform with no dock count answers false and nothing changes.
      app.setBadgeCount(count);
    },
  },
} satisfies IpcHandlers<typeof notificationsContract, IpcContext>;
