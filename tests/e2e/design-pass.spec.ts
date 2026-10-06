/**
 * A screenshot walk for design review: every main screen of the built app, on a fresh profile
 * with the fake agent, in light and dark and in the Graphite and High contrast colour themes.
 * It asserts little; it is for looking. Opt-in: ELASTIC_DESIGN_PASS=1, shots land in
 * ELASTIC_DESIGN_PASS_OUT (default `docs/research/design-pass/shots`).
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chooseDirectory, launch, scratch } from "./launch";

declare const window: { workbench: { settings: { set(patch: Record<string, unknown>): Promise<unknown> } } };

const out = path.resolve(process.env.ELASTIC_DESIGN_PASS_OUT ?? "docs/research/design-pass/shots");
let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;
let ghConfig: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_DESIGN_PASS, "set ELASTIC_DESIGN_PASS=1 to take the design-review screenshots");

const LOOKS = [
  { name: "light", theme: "light", colorTheme: "default" },
  { name: "dark", theme: "dark", colorTheme: "default" },
  { name: "graphite-dark", theme: "dark", colorTheme: "graphite" },
  { name: "contrast-light", theme: "light", colorTheme: "contrast" },
] as const;

async function look(value: (typeof LOOKS)[number]) {
  await page.evaluate((patch) => window.workbench.settings.set(patch), { theme: value.theme, colorTheme: value.colorTheme });
  await page.waitForTimeout(250);
}

async function shoot(name: string) {
  for (const value of LOOKS) {
    await look(value);
    await page.screenshot({ path: path.join(out, `${name}--${value.name}.png`), animations: "disabled" });
  }
  await look(LOOKS[0]);
}

test.beforeAll(async () => {
  fs.mkdirSync(out, { recursive: true });
  userData = scratch("design");
  project = scratch("design-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Bracket\n\nA small mounting bracket.\n\n- Two holes\n- 3 mm wall\n");
  fs.writeFileSync(path.join(project, "notes.ts"), "export const width = 40; // mm\nexport function area(height: number) {\n  return width * height;\n}\n");
  fs.writeFileSync(path.join(project, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  ghConfig = scratch("design-gh");
  // No personal data in the shots: gh signed out (Code Review's empty state), a plain shell.
  ({ app, page } = await launch({ userData, env: { WORKBENCH_ONBOARDING: "1", GH_CONFIG_DIR: ghConfig, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, SHELL: "/bin/sh", PS1: "$ " } }));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project, ghConfig]) fs.rmSync(dir, { recursive: true, force: true });
});

test("welcome", async () => {
  await page.waitForTimeout(1500);
  await shoot("01-welcome");
  await page.getByRole("button", { name: /skip/i }).first().click({ timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => window.workbench.settings.set({ onboardingCompleted: true }));
});

test("home and a session", async () => {
  await chooseDirectory(app, project);
  await page.waitForTimeout(800);
  await shoot("02-new-session");
  await page.getByPlaceholder("Ask for anything…", { exact: true }).fill("showcase");
  await page.keyboard.press("Enter");
  const composer = page.getByPlaceholder("Do anything", { exact: true });
  await page.waitForTimeout(4000);
  await shoot("03-session-permission");
  await page.getByRole("button", { name: "Yes", exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shoot("04-session-finished-turn");
  await composer.fill("slow");
  await composer.press("Enter");
  await page.getByPlaceholder("Send another message — it goes next").fill("then summarise").catch(() => {});
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await shoot("05-session-queue");
  await page.getByRole("button", { name: "Stop" }).click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await composer.fill("crash");
  await composer.press("Enter");
  await page.waitForTimeout(2500);
  await shoot("06-session-error");
});

test("explorer tabs", async () => {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  if (!(await page.getByTestId("explorer").isVisible())) {
    await page.getByRole("button", { name: "Toggle explorer" }).click();
  }
  await page.waitForTimeout(600);
  const filter = page.locator("#explorer-tabpanel [data-tab-body]:not([inert])").getByLabel("Filter files");
  if (!(await filter.isVisible().catch(() => false))) {
    await page.keyboard.press(`${mod}+t`);
    await page.waitForTimeout(600);
  }
  const open = async (file: string) => {
    await filter.fill(file);
    await page.getByRole("option", { name: file, exact: false }).first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (await filter.isVisible().catch(() => false)) await filter.fill("");
  };
  await shoot("07-explorer-tree");
  await open("README.md");
  await shoot("08-file-markdown");
  await open("notes.ts");
  await shoot("09-file-code");
  await open("pixel.png");
  await shoot("10-file-image");
  await page.keyboard.press(`${mod}+Shift+r`);
  await page.waitForTimeout(1500);
  await shoot("11-review");
  await page.keyboard.press("Control+`");
  await page.waitForTimeout(1500);
  await shoot("12-terminal");
  await page.keyboard.press(`${mod}+Shift+b`);
  await page.waitForTimeout(1200);
  await shoot("13-browser-empty");
});

test("plugins and settings", async () => {
  await page.getByRole("button", { name: "Plugins" }).first().click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shoot("20-plugins-store");
  await page.getByRole("button", { name: /Code Review/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shoot("21-plugin-detail");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  await page.waitForTimeout(1000);
  await shoot("22-settings-general");
  for (const section of ["Appearance", "Agents", "Shortcuts"]) {
    await page.getByRole("button", { name: section, exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shoot(`23-settings-${section.toLowerCase()}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.waitForTimeout(600);
  await shoot("24-command-palette");
  await page.keyboard.press("Escape");
  expect(true).toBe(true);
});
