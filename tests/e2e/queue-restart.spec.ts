/// <reference lib="dom" />
/**
 * Prompts queued behind a running turn survive a quit: the first launch queues two behind a slow
 * turn and quits through `app.quit()` (every `before-quit` teardown runs); the second, on the same
 * user data, opens the chat with both still queued, paused, and sends neither until Resume.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

let root: string;
let project: string;
let record: string;

test.beforeAll(() => {
  root = scratch("queue-restart");
  project = scratch("queue-restart-project");
  record = path.join(root, "agent.jsonl");
  fs.writeFileSync(path.join(project, "README.md"), "# Queue restart\n");
});

test.afterAll(() => {
  for (const dir of [root, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const prompts = () => fs.existsSync(record)
  ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; params: unknown })
    .filter((frame) => frame.kind === "prompt").map((frame) => JSON.stringify(frame.params))
  : [];

test("a queue typed behind a running turn is there, paused, after a quit and a relaunch", async () => {
  const start = () => launch({ userData: path.join(root, "profile"), env: { FAKE_AGENT_RECORD: record } });

  const first = await start();
  let title: string;
  try {
    ({ title } = await selectFixtureSession(first.app, first.page, project));
    await first.page.locator("[data-composer-input]").click();
    await first.page.keyboard.type("slow turn");
    await first.page.keyboard.press("Enter");
    await expect(first.page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "running");
    await first.page.keyboard.type("queued one");
    await first.page.keyboard.press("Enter");
    await first.page.keyboard.type("queued two");
    await first.page.keyboard.press("Enter");
    await expect(first.page.getByRole("button", { name: "Send now: queued two" })).toBeVisible();
    // Quit straight away: a prompt queued just before Quit is the one a delayed save lost.
  } finally {
    await first.app.close();
  }

  const second = await start();
  try {
    const sidebar = second.page.getByTestId("sidebar");
    if (!(await sidebar.isVisible())) await second.page.getByRole("button", { name: "Toggle sidebar" }).click();
    await sidebar.getByRole("button", { name: title, exact: true }).click();
    await expect(second.page.getByRole("button", { name: "Send now: queued one" })).toBeVisible();
    await expect(second.page.getByRole("button", { name: "Send now: queued two" })).toBeVisible();
    await expect(second.page.getByText("Paused after a restart")).toBeVisible();
    expect(prompts().filter((text) => text.includes("queued"))).toEqual([]);

    await second.page.getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => prompts().filter((text) => text.includes("queued")).length, { timeout: 30_000 }).toBe(2);
  } finally {
    await second.app.close();
  }
});
