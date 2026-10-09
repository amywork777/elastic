/// <reference lib="dom" />
/**
 * Ctrl+R in the composer searches the chat's earlier prompts (`composer/PromptSearch.tsx`): typing
 * filters, the arrows move, Enter puts the pick in the box, Escape closes and hands focus back.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

test("Ctrl+R finds an earlier prompt and puts it in the box", async () => {
  const root = scratch("prompt-search");
  const project = scratch("prompt-search-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Search\n");
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

    const search = page.getByRole("combobox", { name: "Search earlier prompts" });
    const options = page.getByRole("listbox", { name: "Earlier prompts" }).getByRole("option");

    // Escape closes and gives the box back as it was.
    await page.keyboard.type("half typed");
    await page.keyboard.press("Control+r");
    await expect(search).toBeFocused();
    await expect(options).toHaveText(["second prompt", "first prompt"]);
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveText("half typed");

    // Typing filters; Enter puts the match in the box.
    await page.keyboard.press("Control+r");
    await page.keyboard.type("fir");
    await expect(options).toHaveText(["first prompt"]);
    await page.keyboard.press("Enter");
    await expect(search).toHaveCount(0);
    await expect(input).toHaveText("first prompt");
    await expect(input).toBeFocused();

    // The arrows move through the list, newest first.
    await page.keyboard.press("Control+r");
    await expect(search).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(input).toHaveText("second prompt");
  } finally {
    await app.close();
    for (const dir of [root, project]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
