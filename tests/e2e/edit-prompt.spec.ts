/// <reference lib="dom" />
/**
 * "Edit" on a past prompt (`features/session/EditPrompt.tsx`): Send starts a new chat linked
 * "Edited from …" whose agent is a fork of this conversation up to the prompt (`session/fork` at
 * the agent message before it), or — when the agent cannot find that message — a fresh session
 * handed a summary; the edited prompt is sent there and the original chat is left as it was.
 * "Also restore files" lists the files first and puts them back to the latest prompt's checkpoint.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

declare const window: Window & { workbench: { sessions: { prompt(request: { id: string; content: { type: "text"; text: string }[] }): Promise<unknown> } } };

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "elastic Tests",
  GIT_AUTHOR_EMAIL: "tests@example.invalid",
  GIT_COMMITTER_NAME: "elastic Tests",
  GIT_COMMITTER_EMAIL: "tests@example.invalid",
};

let app: ElectronApplication;
let page: Page;
let root: string;
let record: string;

test.beforeAll(async () => {
  root = scratch("edit-prompt");
  record = path.join(root, "record.jsonl");
  ({ app, page } = await launch({ userData: path.join(root, "profile"), env: { FAKE_AGENT_RECORD: record } }));
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A git project of its own per test, so each starts with its own chat. */
function project(name: string): string {
  const directory = scratch(`edit-prompt-${name}`);
  fs.writeFileSync(path.join(directory, "README.md"), "# Edit\n");
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", args, { cwd: directory, env: gitEnv, stdio: "ignore" });
  return directory;
}

async function send(id: string, text: string) {
  await page.evaluate(({ id, text }) => window.workbench.sessions.prompt({ id, content: [{ type: "text", text }] }), { id, text });
}

const forks = () =>
  fs.existsSync(record)
    ? fs.readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { kind: string; params: { _meta?: { jetbrains?: { air?: { fork?: { messageId?: string } } } } } }).filter((entry) => entry.kind === "session/fork")
    : [];

/** Open the editor on the prompt that says `text`. */
async function openEdit(text: string) {
  const turn = page.locator("[data-turn][data-role=user]").filter({ hasText: text }).last();
  await turn.hover();
  await turn.locator("[data-edit-prompt]").click();
  const input = page.locator("[data-edit-prompt-input]");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(text);
  return input;
}

test("an edit forks the chat before the prompt, restores its files after listing them, and sends", async () => {
  const directory = project("fork");
  const notes = path.join(directory, "notes.txt");
  const session = await selectFixtureSession(app, page, directory);
  await send(session.id, "first prompt");
  await send(session.id, `write ${notes}`);
  await expect.poll(() => fs.existsSync(notes)).toBe(true);
  await expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle");

  const input = await openEdit(`write ${notes}`);
  await input.fill("second try");
  await page.locator("[data-edit-restore]").check();
  const files = page.locator("[data-edit-restore-files]");
  await expect(files).toContainText("notes.txt");
  await expect(files).toContainText("(deleted)");
  // Nothing changed yet: the list is the question, Send is the answer.
  expect(fs.existsSync(notes)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("edit-prompt.png"), animations: "disabled" });
  await page.locator("[data-edit-send]").click();

  // A new chat, linked, on the fork of the conversation at the reply before the prompt.
  await expect(page.locator("[data-linked-chats]")).toContainText(`Edited from ${session.title}`);
  await expect.poll(() => forks().at(-1)?.params._meta?.jetbrains?.air?.fork?.messageId).toBe("msg-1");
  const view = page.locator("[data-session-view]");
  await expect(view).not.toHaveAttribute("data-session-view", session.id);
  // The fork's history replayed (the fake agent's), then the edited prompt and its reply.
  await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "second try" })).toBeVisible();
  await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "earlier prompt" })).toBeVisible();
  await expect(view).toHaveAttribute("data-session-status", "idle", { timeout: 30_000 });
  await expect(page.locator("[data-handoff]")).toHaveCount(0);
  // The files went back to before the edited prompt.
  expect(fs.existsSync(notes)).toBe(false);

  // The original chat is as it was, and links to the edit.
  await page.locator("[data-linked-chats]").getByRole("button", { name: session.title }).click();
  await expect(page.locator(`[data-session-view="${session.id}"]`)).toBeVisible();
  await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "write" })).toBeVisible();
  await expect(page.locator("[data-linked-chats]")).toContainText("Edited in");
});

test("a fork the agent cannot make falls back to a summary; Escape closes the editor", async () => {
  const directory = project("handoff");
  const session = await selectFixtureSession(app, page, directory);
  await send(session.id, "nofork please");
  await send(session.id, "the next prompt");

  // Escape gives the prompt back, and focus to its Edit.
  await openEdit("the next prompt");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-edit-prompt-card]")).toHaveCount(0);
  const edit = page.locator("[data-turn][data-role=user]").filter({ hasText: "the next prompt" }).locator("[data-edit-prompt]");
  await expect(edit).toBeFocused();
  // An earlier prompt has no checkpoint left: no restore is offered for it.
  await openEdit("nofork please");
  await expect(page.locator("[data-edit-restore]")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const input = await openEdit("the next prompt");
  await input.fill("the edited prompt");
  await page.keyboard.press("Enter");

  await expect(page.locator("[data-linked-chats]")).toContainText(`Edited from ${session.title}`);
  await expect.poll(() => forks().at(-1)?.params._meta?.jetbrains?.air?.fork?.messageId).toMatch(/^nofork-/);
  // A fresh session: the summary of the chat before the prompt, folded, then the edited prompt.
  await expect(page.locator("[data-handoff]")).toBeVisible();
  await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "the edited prompt" })).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-handoff] button").click();
  await expect(page.locator("[data-handoff]")).toContainText("Person: nofork please");
  await expect(page.locator("[data-handoff]")).not.toContainText("the next prompt");
});
