/// <reference lib="dom" />
/**
 * Send now on a queued prompt. The fake agent does not steer, so the running turn is stopped and
 * the forced prompt goes out first, then the rest of the queue in order.
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
  userData = scratch("send-now");
  project = scratch("send-now-project");
  record = path.join(userData, "agent.jsonl");
  fs.writeFileSync(path.join(project, "README.md"), "# Send now\n");
  ({ app, page } = await launch({ userData: path.join(userData, "profile"), env: { FAKE_AGENT_RECORD: record } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const frames = () => fs.existsSync(record)
  ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; params: Record<string, unknown> })
  : [];
const prompts = () => frames().filter((frame) => frame.kind === "prompt").map((frame) => JSON.stringify(frame.params));

test("Send now stops the running turn and sends the forced prompt, then the rest", async () => {
  await selectFixtureSession(app, page, project);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await page.keyboard.type("slow turn");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "running");
  await page.keyboard.type("queued one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("queued two");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Send now: queued two" }).click();
  await expect.poll(() => frames().some((frame) => frame.kind === "cancel"), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => prompts().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  const order = prompts().map((text) => (text.includes("queued two") ? "two" : text.includes("queued one") ? "one" : "slow"));
  expect(order).toEqual(["slow", "two", "one"]);
});
