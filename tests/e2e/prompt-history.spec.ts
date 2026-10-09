/// <reference lib="dom" />
/**
 * Up in the composer recalls the chat's earlier prompts, newest first; Down walks back and puts
 * the draft that was there before the walk back in the box (`composer/prompt-history.ts`).
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

test("Up recalls earlier prompts and Down puts the draft back", async () => {
  const root = scratch("prompt-history");
  const project = scratch("prompt-history-project");
  fs.writeFileSync(path.join(project, "README.md"), "# History\n");
  const { app, page } = await launch({ userData: path.join(root, "profile") });
  try {
    await selectFixtureSession(app, page, project);
    const input = page.locator("[data-composer-input]");
    const view = page.locator("[data-session-view]");
    await input.click();
    for (const prompt of ["first prompt", "second prompt"]) {
      await page.keyboard.type(prompt);
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: prompt })).toBeVisible();
      await expect(view).toHaveAttribute("data-session-status", "idle", { timeout: 30_000 });
    }
    await page.keyboard.type("half typed");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveText("second prompt");
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveText("first prompt");
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveText("second prompt");
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveText("half typed");
  } finally {
    await app.close();
    for (const dir of [root, project]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
