/**
 * Settings › General › Notifications (`src/renderer/state/turn-alerts.ts`): a chat whose turn
 * finishes while another is on screen toasts with Open and counts on the dock until it is seen.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeAll(async () => {
  const userData = scratch("notifications");
  project = scratch("notifications-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Notifications\n");
  ({ app, page } = await launch({ userData }));
  // A test window never takes the OS focus; a focused window is the one a chat counts as seen in.
  await page.evaluate(() => { document.hasFocus = () => true; });
  await chooseDirectory(app, project);
});
test.afterAll(async () => {
  await app?.close();
});

const idle = () => expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
const badge = () => app.evaluate(({ app: electron }) => electron.getBadgeCount());

async function send(text: string) {
  const composer = page.locator("[data-session-view] .ProseMirror, [data-new-session] .ProseMirror").first();
  await composer.click();
  await composer.fill(text);
  await page.keyboard.press("Enter");
}

test("a background chat that finishes toasts with Open and counts on the dock until it is opened", async () => {
  await expect(page.locator("[data-new-session] [data-composer-row] [data-chip=model]")).toBeVisible({ timeout: 30_000 });
  await send("first chat");
  await idle();
  // The index's row settles after the transcript does, and main writes the turn's change counts
  // (stamping the row) a beat after that. Leaving before then leaves the finish unseen — Recents'
  // dot, and the very thing the dock counts — so the first chat stays on screen until it is seen.
  const firstRow = page.locator("[data-sidebar-recents] [data-session-row]").first();
  await expect(firstRow).toHaveAttribute("data-status-tag", "done", { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  await expect(firstRow).not.toHaveAttribute("data-unread", "");
  await page.locator("[data-sidebar-link=New]").click();
  await expect(page.locator("[data-new-session]")).toBeVisible();
  await send("second chat");
  await idle();
  const first = await page.evaluate(async () =>
    (await window.workbench.sessions.list({})).sort((a, b) => a.createdAt - b.createdAt)[0]!.id);
  // The chat on screen in a focused window finished without a toast.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect.poll(badge).toBe(0);

  // The first chat works in the background while the second is open.
  await page.evaluate((id) => window.workbench.sessions.prompt({ id, content: [{ type: "text", text: "again" }] }), first);
  const toast = page.locator("[data-sonner-toast]", { hasText: "Finished · " });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect.poll(badge).toBe(1);

  await toast.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(`[data-session-view="${first}"]`)).toBeVisible({ timeout: 10_000 });
  // Opened in a focused window: seen, and off the dock.
  await expect.poll(badge, { timeout: 10_000 }).toBe(0);
});
