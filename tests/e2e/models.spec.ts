/// <reference lib="dom" />
/**
 * Settings › Models & keys in the built app, against the fake agent: a provider
 * added on the page (its key never coming back to the renderer), a chat started
 * on it (the adapter gets `providers/set` before `session/new`, and the model in
 * its environment), and "Continue with …" from that chat to another provider (a
 * linked chat whose first prompt is the folded handoff).
 *
 * `ELASTIC_MODELS_REAL=1` adds one real chat: Claude Code through a local
 * Ollama (`ELASTIC_MODELS_OLLAMA_MODEL`, default qwen2.5:0.5b; it must support tools), which needs no key.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { WorkbenchApi } from "../../src/shared/ipc";

import { chooseDirectory, launch, scratch } from "./launch";

declare const window: { workbench: WorkbenchApi };

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;
let record: string;
let projectId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = scratch("models");
  project = scratch("models-project");
  record = path.join(userData, "agent.jsonl");
  fs.writeFileSync(path.join(project, "README.md"), "# Models\n");
  ({ app, page } = await launch({ userData: path.join(userData, "profile"), env: { FAKE_AGENT_RECORD: record } }));
  projectId = (await chooseDirectory(app, project)).id;
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

const frames = () => fs.existsSync(record)
  ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; pid: number; params: Record<string, unknown> })
  : [];

test("a provider added on the page powers an agent, and its key never comes back", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Models & keys" }).click();
  await expect(page.getByText("Nothing added yet")).toBeVisible();

  const add = (title: string) => page.locator("div").filter({ hasText: new RegExp(`^${title}`) }).getByRole("button", { name: "Add" }).first();
  await add("OpenRouter").click();
  await page.getByLabel("Key").fill("sk-or-e2e-secret");
  await page.getByLabel("Default model (optional)").fill("openai/gpt-x");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Powers Claude Code\. Default model: openai\/gpt-x\./)).toBeVisible();

  // An Ollama that is not there: Test says so rather than failing quietly.
  await add("Ollama").click();
  await page.getByLabel("Server").fill("http://127.0.0.1:9");
  await page.getByLabel("Default model (optional)").fill("qwen-local");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Could not reach it/)).toBeVisible({ timeout: 15_000 });

  const listed = await page.evaluate(() => window.workbench.providers.list());
  expect(listed.map((provider) => [provider.id, provider.hasKey])).toEqual([["openrouter", true], ["ollama", false]]);
  expect(JSON.stringify(listed)).not.toContain("sk-or-e2e-secret");
  await page.getByRole("button", { name: "Back to app" }).click();
});

test("a chat on a provider sends providers/set before session/new, with the model in the adapter's environment", async () => {
  const session = await page.evaluate((id) => window.workbench.sessions.create({ projectId: id, agentId: "claude-code", gitMode: "none", provider: { id: "openrouter", model: "openai/gpt-x" } }), projectId);
  expect(session.provider).toEqual({ id: "openrouter", model: "openai/gpt-x" });
  // Other adapters write here too (the model probe's session/new, say): this chat's is the one in
  // the process that was given the provider.
  const set = frames().find((frame) => frame.kind === "providers/set")!;
  expect(set, "providers/set was sent").toBeTruthy();
  const created = frames().find((frame) => frame.kind === "session/new" && frame.pid === set.pid)!;
  expect(created, "session/new in the same adapter").toBeTruthy();
  expect(frames().indexOf(set)).toBeLessThan(frames().findIndex((frame) => frame.kind === "session/new" && frame.pid === set.pid));
  expect(set.params).toMatchObject({ providerId: "main", apiType: "anthropic", baseUrl: "https://openrouter.ai/api", headers: ["Authorization"], authorized: true });
  expect((created.params.route as Record<string, unknown>).ANTHROPIC_MODEL).toBe("openai/gpt-x");
  expect(fs.readFileSync(record, "utf8")).not.toContain("sk-or-e2e-secret");

  await page.locator(`[data-session-row="${session.id}"]`).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "openai/gpt-x · OpenRouter" })).toBeVisible({ timeout: 15_000 });
});

test("Continue with another provider starts a linked chat that picks up from a folded handoff", async () => {
  await page.getByRole("button", { name: "openai/gpt-x · OpenRouter" }).click();
  await page.getByRole("menuitemradio", { name: "qwen-local" }).click();
  const bar = page.locator("[data-continue-with]");
  await expect(bar).toContainText("Continue with qwen-local · Ollama?");
  await bar.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("[data-linked-chats]")).toContainText("Continued from");
  await expect(page.locator("[data-handoff]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Picked up from the earlier chat" })).toBeVisible();
  const prompts = frames().filter((frame) => frame.kind === "prompt");
  expect(JSON.stringify(prompts.at(-1)?.params)).toContain("elastic:handoff");
  const rows = await page.evaluate((id) => window.workbench.sessions.list({ projectId: id }), projectId);
  const continued = rows.find((row) => row.provider?.id === "ollama")!;
  const original = rows.find((row) => row.provider?.id === "openrouter")!;
  expect(continued.links).toEqual({ from: original.id });
  expect(original.links).toEqual({ to: continued.id });
});

test("a real chat through Claude Code and a local Ollama (opt-in)", async () => {
  test.skip(process.env.ELASTIC_MODELS_REAL !== "1", "set ELASTIC_MODELS_REAL=1 with Claude Code installed and Ollama running");
  test.setTimeout(600_000);
  const model = process.env.ELASTIC_MODELS_OLLAMA_MODEL ?? "qwen2.5:0.5b";
  const real = await launch({ userData: path.join(userData, "real"), env: { WORKBENCH_FAKE_AGENT: undefined } });
  try {
    const realProject = (await chooseDirectory(real.app, project)).id;
    await real.page.evaluate((name) => window.workbench.providers.save({ kind: "ollama", defaultModel: name }), model);
    const tested = await real.page.evaluate(() => window.workbench.providers.test({ id: "ollama" }));
    expect(tested.ok, tested.message).toBe(true);
    const session = await real.page.evaluate(({ id, name }) => window.workbench.sessions.create({ projectId: id, agentId: "claude-code", gitMode: "none", provider: { id: "ollama", model: name } }), { id: realProject, name: model });
    const { stopReason } = await real.page.evaluate((id) => window.workbench.sessions.prompt({ id, content: [{ type: "text", text: "Reply with the single word pong and nothing else. Do not use any tools." }] }), session.id);
    expect(stopReason).toBe("end_turn");
    const state = await real.page.evaluate((id) => window.workbench.sessions.state({ id }), session.id);
    const reply = state?.state.turns.filter((turn) => turn.role === "agent").flatMap((turn) => turn.parts).filter((part) => part.type === "text") ?? [];
    // The turn was answered, and by the local model: a small one need not follow the instruction,
    // so what proves the route is that Ollama itself has the model loaded.
    expect(reply.length).toBeGreaterThan(0);
    const loaded = await (await fetch("http://127.0.0.1:11434/api/ps")).json() as { models: Array<{ name: string }> };
    expect(loaded.models.map((entry) => entry.name)).toContain(model);
  } finally {
    await real.app.close();
  }
});
