/**
 * "Tell me when a chat needs me", the part only main can do. The renderer
 * decides when a turn's end or a question is news (`src/renderer/state/turn-alerts.ts`,
 * which also plays the sound and draws the in-app toast); main posts the system
 * banner, because the app page is refused the web Notification permission
 * (`src/main/app-permissions.ts`), and sets the dock's count, which is the
 * application's and not a page's. A click on the banner brings the window
 * forward and comes back as `notifications.clicked`, so the renderer opens the
 * chat the way a sidebar row does.
 */
import { z } from "zod";

import { defineIpc, invoke } from "./define";

export const notificationsContract = defineIpc({
  notifications: {
    /** `shown` is false where the platform has no notification centre. */
    show: invoke(
      z.object({
        sessionId: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
        body: z.string().max(500),
      }).strict(),
      z.object({ shown: z.boolean() }),
    ),
    /**
     * The chats that need the person, as the dock's count (macOS; Linux's Unity
     * launcher takes it too). Zero clears it.
     */
    badge: invoke(z.object({ count: z.number().int().min(0).max(9999) }).strict(), z.void()),
  },
});

export const notificationsEvents = {
  /** The person clicked the banner `show` posted for this chat. */
  "notifications.clicked": z.object({ sessionId: z.string() }),
} as const;
