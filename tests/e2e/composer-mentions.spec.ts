/// <reference lib="dom" />
/**
 * `@` file mentions in the composer: typing `@` lists the chat's project files, Enter puts the
 * picked path in as a chip, and the prompt the agent receives carries `@path`.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;
let record: string;

test.beforeAll(async () => {
  userData = scratch("mentions");
  project = scratch("mentions-project");
  record = path.join(userData, "agent.jsonl");
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "app.ts"), "export const answer = 42;\n");
  fs.writeFileSync(path.join(project, "README.md"), "# Mentions\n");
  ({ app, page } = await launch({ userData: path.join(userData, "profile"), env: { FAKE_AGENT_RECORD: record } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const prompts = () => fs.existsSync(record)
  ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; params: unknown }).filter((frame) => frame.kind === "prompt")
  : [];

test("@ lists the project's files and the picked one reaches the agent as @path", async () => {
  await selectFixtureSession(app, page, project);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await page.keyboard.type("explain @app");
  const palette = page.locator("[data-mention-palette]");
  await expect(palette.getByRole("option", { name: /app\.ts/ })).toBeVisible();
  if (process.env.ELASTIC_DOC_SHOTS === "1") await page.screenshot({ path: path.resolve("docs/research/design-pass/mentions-after.png") });
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(input.locator('[data-reference-chip][data-mention][data-file="src/app.ts"]')).toBeVisible();

  // Escape closes the list without picking.
  await page.keyboard.type("and @READ");
  await expect(palette.getByRole("option", { name: /README\.md/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect.poll(() => JSON.stringify(prompts().at(-1)?.params ?? null), { timeout: 15_000 }).toContain("@src/app.ts");
});
