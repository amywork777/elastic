/**
 * Any model, any plugin: one real Claude turn and one real Codex turn, each
 * asked to show a STEP file with text-to-cad's CAD plugin, in the built app.
 *
 * Opt-in, because it spends two real agent turns and needs a prepared CAD
 * plugin: set ELASTIC_AGENT_TURNS=1 and ELASTIC_MATRIX_DIR to the folder
 * `docs/research/plugin-matrix.md` describes (its `cad/` plugin and
 * `models/part.step`). CI sets neither and skips the file.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import type { WorkbenchApi } from "../../src/shared/ipc";
import { launch, scratch } from "./launch";

declare global { interface Window { workbench: WorkbenchApi } }

const matrix = process.env.ELASTIC_MATRIX_DIR ?? "";
const shots = path.resolve("docs/research/plugin-matrix");
let app: ElectronApplication;
let page: Page;
let userData: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_AGENT_TURNS || !fs.existsSync(path.join(matrix, "cad")), "set ELASTIC_AGENT_TURNS=1 and ELASTIC_MATRIX_DIR with a prepared cad plugin");

type Workbench = {
  sessions: {
    create(request: object): Promise<{ id: string }>;
    prompt(request: object): Promise<unknown>;
    state(request: object): Promise<unknown>;
  };
};
const workbench = (target: Page) => target as unknown as { evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> };

test.beforeAll(async () => {
  userData = scratch("agent-plugins");
  // The real adapters, not the suite's fake agent.
  ({ app, page } = await launch({ userData, env: { WORKBENCH_FAKE_AGENT: undefined } }));
  await page.evaluate((folder) => window.workbench.plugins.installFolder({ path: folder }), path.join(matrix, "cad"));
  await expect.poll(async () => {
    const snapshot = await page.evaluate(() => window.workbench.plugins.list());
    return snapshot.plugins.find((plugin) => plugin.id === "text-to-cad")?.servers[0]?.status;
  }, { timeout: 300_000, intervals: [2000] }).toBe("ready");
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

for (const agentId of ["claude-code", "codex"] as const) {
  test(`${agentId}: one real turn shows a STEP file with the CAD plugin`, async () => {
    test.setTimeout(420_000);
    const project = scratch(`agent-${agentId}`);
    fs.copyFileSync(path.join(matrix, "models", "part.step"), path.join(project, "part.step"));
    const chosen = await app.evaluate((_electron, dir) => (globalThis as unknown as { __workbenchE2E: { choose(d: string): { id: string } } }).__workbenchE2E.choose(dir), project);
    const session = await workbench(page).evaluate(({ projectId, agent }) => (window as never as { workbench: Workbench }).workbench.sessions.create({ projectId, agentId: agent, gitMode: "none" }), { projectId: chosen.id, agent: agentId });
    // Approve any permission card the turn raises (a tool call, never a file edit: the prompt asks for none).
    const approve = setInterval(() => { void page.getByRole("button", { name: /^(Allow|Allow once|Yes)/ }).first().click({ timeout: 500 }).catch(() => {}); }, 1000);
    const prompt = "This is an automated test of the CAD MCP server. Do not edit, create or commit any file and run no shell commands. "
      + "Show part.step in the CAD viewer with the CAD server's tools (cad_show, or cad_open when cad_show reports no open viewer), then reply with only the word done.";
    const answer = await workbench(page).evaluate(({ id, text }) => (window as never as { workbench: Workbench }).workbench.sessions.prompt({ id, content: [{ type: "text", text }] }), { id: session.id, text: prompt })
      .finally(() => clearInterval(approve));
    const state = await workbench(page).evaluate((id) => (window as never as { workbench: Workbench }).workbench.sessions.state({ id }), session.id);
    // The tool calls the turn made: every `tool_call` part, by its name or title and status.
    const calls: Array<{ title: string; status: string }> = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "tool_call") calls.push({ title: `${String(record.name ?? "")} ${String(record.title ?? "")}`.trim(), status: String(record.status ?? "") });
      Object.values(record).forEach(walk);
    };
    walk(state);
    const cad = calls.filter((call) => /cad_(show|open)|CAD/i.test(call.title));
    console.info(`[agents] ${agentId}: answer=${JSON.stringify(answer)} calls=${JSON.stringify(calls).slice(0, 600)}`);
    await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Sessions" }).click();
    await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(8_000);
    await page.screenshot({ path: path.join(shots, `agent-turn-${agentId}.png`), animations: "disabled" });
    expect(cad.some((call) => call.status === "completed"), JSON.stringify(calls)).toBe(true);
    fs.rmSync(project, { recursive: true, force: true });
  });
}
