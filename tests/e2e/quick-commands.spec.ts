/**
 * Quick commands beside the chat, in the built app, with the fake agent standing in for Claude
 * Code (it forks, resumes and answers `/usage`, `/context` and a side question the way
 * claude-agent-acp does): the answer is a card over the composer, never a turn, never queued,
 * and never a new chat.
 */
import fs from "node:fs";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.beforeAll(async () => {
  userData = scratch("quick-commands");
  project = scratch("quick-commands-project");
  ({ app, page } = await launch({ userData, env: { WORKBENCH_E2E_INSTALLED_AGENTS: "claude-code,codex" } }));
  await chooseDirectory(app, project);
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const card = () => page.locator("[data-aside]");

test("/usage on the new-session screen answers in a card and starts no chat", async () => {
  const composer = page.getByPlaceholder("Ask for anything…", { exact: true });
  await composer.fill("/usa");
  // Offered in the slash list before any chat exists.
  await expect(page.getByRole("option", { name: /usage/ }).first()).toBeVisible();
  await composer.fill("/usage");
  await composer.press("Enter");
  await expect(card()).toHaveAttribute("data-aside", "done", { timeout: 30_000 });
  await expect(card()).toContainText("5-hour limit");
  await expect(composer).toHaveText("");
  // Still the new-session screen: no chat named "/usage".
  await expect(page.locator("[data-session-view]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { workbench: { sessions: { list: (r: object) => Promise<unknown[]> } } }).workbench.sessions.list({}))).toHaveLength(0);

  await card().getByRole("button", { name: "Close" }).click();
  await expect(card()).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test("/btw answers from a fork while a turn runs: not queued, not in the transcript", async () => {
  const composer = page.getByPlaceholder("Ask for anything…", { exact: true });
  await composer.fill("slow: keep working");
  await composer.press("Enter");
  const view = page.locator("[data-session-view]");
  await expect(view).toHaveAttribute("data-session-status", "running", { timeout: 20_000 });

  const box = view.locator(".ProseMirror");
  await box.click();
  await page.keyboard.type("/btw what is this repo?");
  await page.keyboard.press("Enter");
  await expect(card()).toHaveAttribute("data-aside", "done", { timeout: 30_000 });
  // Answered by the fork, in plan mode, while the chat's own turn is still running.
  await expect(card()).toContainText("Side answer, in mode plan: what is this repo?");
  await expect(view).toHaveAttribute("data-session-status", "running");
  await expect(page.getByText(/queued prompt/)).toHaveCount(0);
  await expect(view.locator("[data-role]").filter({ hasText: "Side answer" })).toHaveCount(0);

  // Escape on the card puts it away.
  await card().getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect(card()).toHaveCount(0);

  await box.click();
  await page.keyboard.type("/context");
  await page.keyboard.press("Enter");
  await expect(card()).toContainText("Context usage", { timeout: 30_000 });

  // From the slash list, /btw waits for its question; sent bare, it asks for one and goes nowhere.
  await box.click();
  await page.keyboard.type("/btw");
  await page.keyboard.press("Enter");
  await expect(box).toHaveText("/btw");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Write your question after /btw.")).toBeVisible();
  await expect(box).toHaveText("/btw");
  await expect(page.getByText(/queued prompt/)).toHaveCount(0);
});
