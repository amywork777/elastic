/// <reference lib="dom" />
/**
 * The command palette's rows for what elastic is about (models, plugins, themes), and where focus
 * starts: in the composer, on launch and on a new chat.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { WorkbenchApi } from "../../src/shared/ipc";

import { launch, mod, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

declare const window: { workbench: WorkbenchApi };

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = scratch("palette");
  project = scratch("palette-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Palette\n");
  ({ app, page } = await launch({ userData: path.join(userData, "profile"), env: { WORKBENCH_E2E_INSTALLED_AGENTS: "claude-code,codex" } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const palette = async (query: string) => {
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole("combobox", { name: "Search sessions, projects and commands" }).fill(query);
  await page.keyboard.press("Enter");
};

const composerFocused = () => page.evaluate(() => Boolean(document.activeElement?.closest("[data-composer-input]")));

test("focus starts in the composer on launch", async () => {
  // A relaunch onto a profile with a chat, as a person reopening the app: it comes back on that chat.
  await selectFixtureSession(app, page, project);
  await app.close();
  ({ app, page } = await launch({ userData: path.join(userData, "profile"), env: { WORKBENCH_E2E_INSTALLED_AGENTS: "claude-code,codex" } }));
  await expect.poll(composerFocused, { timeout: 15_000 }).toBe(true);
});

test("focus starts in the composer on a new chat", async () => {
  await selectFixtureSession(app, page, project);
  await palette("new session");
  await expect.poll(composerFocused, { timeout: 10_000 }).toBe(true);
});

test("themes, Plugins and Add a model are palette rows", async () => {
  await palette("dark mode");
  await expect.poll(() => page.evaluate(async () => (await window.workbench.settings.get()).theme)).toBe("dark");
  await palette("graphite");
  await expect.poll(() => page.evaluate(async () => (await window.workbench.settings.get()).colorTheme)).toBe("graphite");
  await palette("match system");

  await palette("install a plugin");
  await expect(page.getByRole("heading", { name: "Plugins", level: 1 })).toBeVisible();

  await palette("add a model");
  await expect(page.getByRole("heading", { name: "Models & keys" })).toBeVisible();
  // A shell row leaves Settings.
  await palette("new session");
});

test("the palette's model, plugin and theme rows (doc shot, opt-in)", async () => {
  test.skip(process.env.ELASTIC_DOC_SHOTS !== "1", "set ELASTIC_DOC_SHOTS=1 for the screenshot");
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole("combobox", { name: "Search sessions, projects and commands" }).fill("model");
  await page.screenshot({ path: path.resolve("docs/research/design-pass/palette-after.png") });
  await page.keyboard.press("Escape");
});

test("Switch model opens the composer's model menu", async () => {
  await selectFixtureSession(app, page, project);
  await palette("switch model");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
});
