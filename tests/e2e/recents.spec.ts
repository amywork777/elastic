/**
 * Recents (`docs/superpowers/specs/2026-10-05-recents-sidebar-design.md`): a chat whose agent
 * changes files while another chat is open comes back unread and tagged Needs review, and reads
 * Done once the person opens it.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeAll(async () => {
  const userData = scratch("recents");
  project = scratch("recents-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Recents\n");
  ({ app, page } = await launch({ userData }));
  // A test window never takes the OS focus, and a chat only counts as seen while the window has it.
  await page.evaluate(() => { document.hasFocus = () => true; });
  await chooseDirectory(app, project);
});
test.afterAll(async () => {
  await app?.close();
});

const idle = () => expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
const row = (id: string) => page.locator(`[data-sidebar-recents] [data-session-row="${id}"]`);

async function send(text: string) {
  const composer = page.locator("[data-session-view] .ProseMirror, [data-new-session] .ProseMirror").first();
  await composer.click();
  await composer.fill(text);
  await page.keyboard.press("Enter");
}

test("a chat that finishes while another is open is unread and needs review, and reads Done once opened", async () => {
  await expect(page.locator("[data-new-session] [data-composer-row] [data-chip=model]")).toBeVisible({ timeout: 30_000 });
  // The fake agent writes the absolute path after `write` and reports the diff.
  await send(`write ${path.join(project, "notes.md")}`);
  await idle();
  await page.locator("[data-sidebar-link=New]").click();
  await expect(page.locator("[data-new-session]")).toBeVisible();
  await send("hello");
  await idle();
  const first = await page.evaluate(async () =>
    (await window.workbench.sessions.list({})).sort((a, b) => a.createdAt - b.createdAt)[0]!.id);

  // The first chat works in the background while the second is open.
  await page.evaluate(({ id, file }) => window.workbench.sessions.prompt({ id, content: [{ type: "text", text: `write ${file}` }] }),
    { id: first, file: path.join(project, "more.md") });
  await expect(row(first)).toHaveAttribute("data-status-tag", "review", { timeout: 20_000 });
  await expect(row(first)).toHaveAttribute("data-unread", "");

  await row(first).locator("[data-session-row-title]").click();
  await expect(row(first)).toHaveAttribute("data-status-tag", "done", { timeout: 10_000 });
  await expect(row(first)).not.toHaveAttribute("data-unread", "");
});
