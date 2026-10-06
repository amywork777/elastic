import { z } from "zod";
import { BrowserTargetSchema, BrowserInputSchema } from "../browser";
import { invoke } from "./define";
const Scope = z.object({ sessionId: z.string().min(1), projectId: z.string().min(1), root: z.string().nullable().optional() });
const At = Scope.extend({ tabId: z.string().min(1) });
export const browserIpc = {
  browser: {
    ensure: invoke(At.extend({ url: z.string().nullable().optional() }), BrowserTargetSchema),
    // `logs: false` is the poll with the console closed: up to 100 lines of
    // 1000 characters every 500 ms is not worth sending to a hidden panel.
    metadata: invoke(At.extend({ logs: z.boolean().optional() }), BrowserTargetSchema),
    navigate: invoke(At.extend({ url: z.string().optional(), direction: z.enum(["back", "forward", "reload", "stop"]).optional() }), BrowserTargetSchema),
    input: invoke(At.extend({ input: BrowserInputSchema }), BrowserTargetSchema),
    present: invoke(At.extend({ lease: z.string().min(1), bounds: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }).nullable() }), z.void()),
    close: invoke(At, z.void()),
    clearConsole: invoke(At, z.void()),
    capture: invoke(At.extend({ url: z.string().url(), generation: z.number().int().nonnegative(), kind: z.enum(["selection", "screenshot"]) }), z.object({ base64: z.string(), mimeType: z.string(), url: z.string(), generation: z.number() })),
    /** The person takes the page from the agent (its input is refused), or hands it back. */
    takeOver: invoke(At.extend({ takenOver: z.boolean() }), z.object({ takenOver: z.boolean() })),
    /** Click-to-prompt: start or stop picking elements in the page; picks arrive as `browser.picked`. */
    pick: invoke(At.extend({ active: z.boolean() }), z.object({ active: z.boolean() })),
    /** Sign out of every site in the browser tab: its shared cookies, storage and cache (Settings › General). */
    clearData: invoke(z.void(), z.void()),
  },
};

export const browserEvents = {
  /** An agent is driving this page (its CDP input, at most twice a second per page). */
  "browser.activity": z.object({ sessionId: z.string(), tabId: z.string() }),
  /** An element the person picked: its cropped image (base64 PNG), trimmed HTML and selector. */
  "browser.picked": z.object({
    sessionId: z.string(), tabId: z.string(), url: z.string(), title: z.string(), generation: z.number(),
    image: z.string(), html: z.string(), selector: z.string(), tag: z.string(),
    size: z.object({ width: z.number(), height: z.number() }),
  }),
  /** Pick mode started or ended in a page (Esc, the button, or the page navigating). */
  "browser.picking": z.object({ sessionId: z.string(), tabId: z.string(), active: z.boolean() }),
} as const;
