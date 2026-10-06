/**
 * Two chats side by side (`docs/design.md`, "Two chats side by side"): Cmd-click a second chat,
 * both run, the explorer follows the focused side, the divider's place is kept, and closing a
 * side leaves the other.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, dragSeparator, launch, mod, newTab, scratch, setContentSize } from "./launch";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const project = scratch("split-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Split\n");
  ({ app, page } = await launch({ userData: scratch("split") }));
  await page.evaluate(() => { document.hasFocus = () => true; });
  await chooseDirectory(app, project);
  await setContentSize(app, page, 1900, 900);
});
test.afterAll(async () => {
  await app?.close();
});

async function send(scope: string, text: string) {
  const composer = page.locator(`${scope} .ProseMirror`).first();
  await composer.click();
  await composer.fill(text);
  await page.keyboard.press("Enter");
}
const side = (name: "left" | "right") => page.locator(`[data-split-side="${name}"]`);

test("two chats side by side: both run, the explorer follows focus, the divider stays put, a side closes", async () => {
  await send("[data-new-session]", "first chat");
  const first = page.locator("[data-session-view]");
  await expect(first).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
  const a = (await first.getAttribute("data-session-view"))!;
  await page.keyboard.press(`${mod}+n`);
  await send("[data-new-session]", "second chat");
  await expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
  const b = (await page.locator("[data-session-view]").getAttribute("data-session-view"))!;
  expect(b).not.toBe(a);

  // Cmd-click the first chat: it opens beside the second, focused.
  await page.locator(`[data-session-row="${a}"] [data-session-row-title]`).first().click({ modifiers: [mod === "Meta" ? "Meta" : "Control"] });
  await expect(page.locator("[data-split-side]")).toHaveCount(2);
  await expect(side("left").locator(`[data-session-view="${b}"]`)).toBeVisible();
  await expect(side("right").locator(`[data-session-view="${a}"]`)).toBeVisible();
  await expect(side("right")).toHaveAttribute("data-split-focused", "");

  // A message in each side: both turns run and both end idle with their replies.
  await send(`[data-split-side="left"]`, "left again");
  await send(`[data-split-side="right"]`, "right again");
  for (const name of ["left", "right"] as const) {
    await expect(side(name).locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
  }
  await expect(side("left")).toContainText("left again");
  await expect(side("right")).toContainText("right again");
  await expect(side("left")).not.toContainText("right again");

  // The divider moves, and its place is kept in the settings.
  await dragSeparator(page, page.locator("[data-split-divider]"), -150);
  await expect.poll(async () => (await page.evaluate(() => window.workbench.settings.get())).layout.splitRatio).toBeLessThan(0.45);

  // The explorer is the focused chat's: a tab opened for the right one goes when focus moves left.
  await page.getByRole("button", { name: "Toggle explorer" }).first().click();
  await newTab(page, "Browser");
  const browserTabs = page.getByTestId("explorer").getByRole("tab", { name: /new tab|browser/i });
  await expect(browserTabs).toHaveCount(1);
  await side("left").locator(".ProseMirror").first().click();
  await expect(side("left")).toHaveAttribute("data-split-focused", "");
  await expect(browserTabs).toHaveCount(0);
  await side("right").locator(".ProseMirror").first().click();
  await expect(browserTabs).toHaveCount(1);

  // Close the right side: the left chat has the pane alone.
  await side("right").getByRole("button", { name: "Close this side" }).click();
  await expect(page.locator("[data-split-side]")).toHaveCount(0);
  await expect(page.locator(`[data-session-view="${b}"]`)).toBeVisible();
  await expect(page.locator(`[data-session-view="${a}"]`)).toHaveCount(0);
});
