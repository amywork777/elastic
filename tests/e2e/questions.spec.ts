/// <reference lib="dom" />
/**
 * A question from the agent (form elicitation, as Claude Code's AskUserQuestion arrives) is a card
 * in the transcript; picking an option and Submit answers it, and the agent gets the value.
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
  userData = scratch("questions");
  project = scratch("questions-project");
  record = path.join(userData, "agent.jsonl");
  fs.writeFileSync(path.join(project, "README.md"), "# Questions\n");
  ({ app, page } = await launch({ userData: path.join(userData, "profile"), env: { FAKE_AGENT_RECORD: record } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const answers = () => fs.existsSync(record)
  ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; params: unknown }).filter((frame) => frame.kind === "elicitation")
  : [];

test("the agent's question is a card, and its answer reaches the agent", async () => {
  await selectFixtureSession(app, page, project);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await page.keyboard.type("ask-question please");
  await page.keyboard.press("Enter");
  const card = page.locator("[data-question][data-outcome=pending]");
  await expect(card).toContainText("Which database?");
  await expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "waiting");
  const submit = card.getByRole("button", { name: "Submit" });
  await expect(submit).toBeEnabled();
  await card.getByRole("radio", { name: "Postgres" }).click();
  await submit.click();
  await expect(page.locator("[data-question][data-outcome=answered]")).toContainText("Answered: Postgres");
  await expect(page.getByText("you picked Postgres")).toBeVisible();
  expect(answers().at(-1)?.params).toEqual({ action: "accept", content: { question_0: "Postgres" } });
});
