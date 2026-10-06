/**
 * No text is cut off. An element that hides its overflow (`truncate`, `overflow-hidden`) clips
 * whatever ink falls outside its box, and with a line height under about 1.2 times the font size
 * the bottoms of g, p and y fall outside: "Xhigh" lost the tail of its g in the effort chip.
 * Checked in the real renderer, on the screens a person spends their time in.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const project = scratch("clip-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Clip\n");
  ({ app, page } = await launch({ userData: scratch("clip"), env: { WORKBENCH_E2E_INSTALLED_AGENTS: "claude-code,codex" } }));
  await chooseDirectory(app, project);
});
test.afterAll(async () => {
  await app?.close();
});

async function clipped(): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(element);
      if (style.overflowY !== "hidden" && style.overflowY !== "clip" && style.overflow !== "hidden") continue;
      if (!element.offsetParent || element.closest("[aria-hidden=true], .sr-only, svg")) continue;
      // Its own text, not a container's: a clipping box that holds a whole layout is not a label.
      const text = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join("").trim();
      if (!/[gjpqy,]/.test(text)) continue;
      const size = parseFloat(style.fontSize);
      const line = style.lineHeight === "normal" ? size * 1.2 : parseFloat(style.lineHeight);
      if (line < size * 1.2 - 0.5) found.push(`${element.tagName.toLowerCase()} "${text.slice(0, 24)}" ${size}px/${line}px ${element.className.toString().slice(0, 60)}`);
    }
    return found;
  });
}

test("no label clips the bottom of its letters, on the new-chat screen and in a chat", async () => {
  await expect(page.locator("[data-new-session] [data-composer-row] [data-chip=model]")).toBeVisible({ timeout: 30_000 });
  expect(await clipped(), "new-chat screen").toEqual([]);
  const composer = page.locator("[data-new-session] .ProseMirror").first();
  await composer.click();
  await composer.fill("hello there, a quick question");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });
  expect(await clipped(), "chat").toEqual([]);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await expect(page.locator("[data-settings-header]").first()).toBeVisible({ timeout: 10_000 });
  expect(await clipped(), "settings").toEqual([]);
});
