/// <reference lib="dom" />
/**
 * A half-typed prompt survives a quit: the first launch types into a chat's composer and quits
 * through `app.quit()` straight away (every `before-quit` teardown runs, the database closes); the
 * second, on the same user data, opens the chat with the text still in the box and nothing sent
 * (`persistDrafts` and `restoreDrafts` in `src/renderer/state/composer.ts`).
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
  root = scratch("draft-restart");
  project = scratch("draft-restart-project");
  record = path.join(root, "agent.jsonl");
  fs.writeFileSync(path.join(project, "README.md"), "# Draft restart\n");
});

test.afterAll(() => {
  for (const dir of [root, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const prompts = () => fs.existsSync(record)
  ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string }).filter((frame) => frame.kind === "prompt")
  : [];

test("a draft typed into a chat is back in its box after a quit and a relaunch", async () => {
  const start = () => launch({ userData: path.join(root, "profile"), env: { FAKE_AGENT_RECORD: record } });

  const first = await start();
  let title: string;
  try {
    ({ title } = await selectFixtureSession(first.app, first.page, project));
    const input = first.page.locator("[data-composer-input]");
    await input.click();
    await first.page.keyboard.type("half typed");
    await first.page.keyboard.press("Shift+Enter");
    await first.page.keyboard.type("second line, last keys");
    await expect(input).toContainText("second line, last keys");
    // Quit straight away: the last keystrokes before Quit are the ones a delayed save loses.
  } finally {
    await first.app.close();
  }

  const second = await start();
  try {
    const sidebar = second.page.getByTestId("sidebar");
    if (!(await sidebar.isVisible())) await second.page.getByRole("button", { name: "Toggle sidebar" }).click();
    await sidebar.getByRole("button", { name: title, exact: true }).click();
    const input = second.page.locator("[data-composer-input]");
    await expect(input).toContainText("half typed");
    await expect(input).toContainText("second line, last keys");
    expect(prompts()).toEqual([]);
  } finally {
    await second.app.close();
  }
});
