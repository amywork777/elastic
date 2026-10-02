/**
 * Real third-party plugins in the built app (docs/research/plugin-matrix.md).
 *
 * Set ELASTIC_MATRIX_DIR to a folder holding prepared plugin folders (see that
 * doc for how each was prepared); a case whose folder is missing is skipped,
 * so CI, which has none, skips the whole file. Sign-ins stop at the provider's
 * login page: `shell.openExternal` is replaced so no browser opens, and the
 * authorization URL is fetched to check it is a real login.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { launch, newTab, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

declare const window: {
  workbench: {
    plugins: {
      installFolder(request: { path: string }): Promise<unknown>;
      list(): Promise<{ plugins: unknown[] }>;
      signIn(request: { id: string; server: string }): Promise<unknown>;
      setFileHandler(request: { extension: string; handler: string | null }): Promise<unknown>;
    };
  };
};

const matrix = process.env.ELASTIC_MATRIX_DIR ?? "";
const shots = path.resolve("docs/research/plugin-matrix");
const has = (name: string) => Boolean(matrix) && fs.existsSync(path.join(matrix, name));

type Server = { name: string; transport: string; status: string; error: string | null; toolNames: string[] };
type Record = { id: string; error: string | null; skills: string[]; servers: Server[]; tools: Array<{ id: string; entrypoints: Array<{ type: string }> }> };

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });
test.skip(!matrix || !fs.existsSync(matrix), "ELASTIC_MATRIX_DIR names no prepared plugins");

test.beforeAll(async () => {
  userData = scratch("matrix");
  project = scratch("matrix-project");
  const step = path.join(matrix, "models", "part.step");
  if (fs.existsSync(step)) fs.copyFileSync(step, path.join(project, "part.step"));
  // The agent test needs the real Claude adapter, not the suite's fake agent.
  ({ app, page } = await launch({ userData, env: process.env.ELASTIC_MATRIX_AGENT ? { WORKBENCH_FAKE_AGENT: undefined } : {} }));
  if (process.env.ELASTIC_MATRIX_CONSOLE) page.on("console", (message) => console.info(`[console:${message.type()}] ${message.text().slice(0, 400)}`));
  // Sign-ins in this suite never reach a browser: record the URL instead.
  await app.evaluate(({ shell }) => {
    (globalThis as { opened?: string[] }).opened = [];
    shell.openExternal = async (url: string) => { (globalThis as unknown as { opened: string[] }).opened.push(url); };
  });
  fs.mkdirSync(shots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function shoot(name: string) {
  await page.screenshot({ path: path.join(shots, name), animations: "disabled" });
}

async function list(): Promise<Record[]> {
  return page.evaluate(() => window.workbench.plugins.list()).then((snapshot) => snapshot.plugins as Record[]);
}

async function installed(folder: string, timeout = 240_000): Promise<Record> {
  const { id } = await page.evaluate((p) => window.workbench.plugins.installFolder({ path: p }), path.join(matrix, folder)) as Record;
  let found: Record | undefined;
  await expect.poll(async () => {
    found = (await list()).find((plugin) => plugin.id === id);
    return found?.servers.every((server) => ["ready", "failed", "signin"].includes(server.status)) ? "settled" : "waiting";
  }, { timeout, intervals: [1000] }).toBe("settled");
  console.info(`[matrix] ${folder}: ${JSON.stringify({
    skills: found!.skills.length,
    servers: found!.servers.map((server) => ({ name: server.name, transport: server.transport, status: server.status, error: server.error?.slice(0, 200), tools: server.toolNames.length })),
    views: found!.tools.map((tool) => `${tool.id}:${tool.entrypoints.map((entry) => entry.type).join("+")}`),
  })}`);
  return found!;
}

async function openPlugin(name: string) {
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Plugins" }).click();
  await page.getByRole("complementary", { name: "Plugins sidebar" }).getByRole("button", { name }).click();
}

/** Start a sign-in, read the URL the app would open, and check it lands on a login page. */
async function signInReachesLogin(id: string, server: string): Promise<string> {
  page.evaluate((request) => window.workbench.plugins.signIn(request).catch(() => {}), { id, server }).catch(() => {});
  let url = "";
  await expect.poll(async () => {
    url = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1) ?? "");
    return url;
  }, { timeout: 60_000 }).not.toBe("");
  const response = await fetch(url, { redirect: "follow" });
  console.info(`[matrix] ${id} sign-in: ${new URL(url).origin}${new URL(url).pathname} -> ${response.status} ${response.url.slice(0, 120)}`);
  expect(response.status).toBeLessThan(500);
  return url;
}

test("CAD (text-to-cad + PR #509): tab surfaces, the rail page, a thread tab and a STEP file", async () => {
  test.skip(!has("cad"), "no cad plugin prepared");
  test.setTimeout(420_000);
  const cad = await installed("cad");
  expect(cad.servers[0]!.status).toBe("ready");
  expect(cad.tools.map((tool) => tool.id)).toEqual(expect.arrayContaining(["cad/cad_home", "cad/cad_tab", "cad/cad_file"]));
  await openPlugin("text-to-cad");
  await shoot("cad-plugin-page.png");

  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "CAD" }).click();
  const surface = page.getByTestId("plugin-app");
  await expect(surface).toBeVisible();
  await page.waitForTimeout(8_000);
  await shoot("cad-rail-page.png");

  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Sessions" }).click();
  await selectFixtureSession(app, page, project);
  if (!(await page.getByTestId("explorer").isVisible())) await page.getByRole("button", { name: "Toggle explorer" }).click();
  await newTab(page, "File");
  await page.locator('[role="treeitem"][data-path="part.step"]').click();
  const explorer = page.getByTestId("explorer");
  await expect(explorer.getByText(/Allow .* to open this file\?/)).toBeVisible();
  await explorer.getByRole("button", { name: "Yes, open file" }).click();
  await expect(page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(20_000);
  await shoot("cad-step-file.png");
  const cadFrame = page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first().contentFrame();
  await cadFrame.getByText("Details").click({ timeout: 2_000 }).catch(() => {});
  const frameText = await cadFrame.locator("body").innerText().catch(() => "");
  console.info(`[matrix] cad file view: ${frameText.replace(/\s+/g, " ").slice(0, 2000)}`);
});

test("linear: a remote server that needs OAuth shows Sign in, and the sign-in reaches its login page", async () => {
  test.skip(!has("linear"), "no linear plugin prepared");
  test.setTimeout(180_000);
  const record = await installed("linear");
  expect(record.servers[0]!.status).toBe("signin");
  await openPlugin(record.id);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await shoot("linear-sign-in.png");
  await signInReachesLogin("linear", "linear");
});

test("figma: shows Sign in, and says its server only lets approved apps register", async () => {
  test.skip(!has("figma"), "no figma plugin prepared");
  test.setTimeout(180_000);
  const record = await installed("figma");
  expect(record.servers[0]!.status).toBe("signin");
  await openPlugin(record.id);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/only lets approved apps sign in/)).toBeVisible({ timeout: 60_000 });
  await shoot("figma-sign-in.png");
});

for (const folder of ["playwright", "shell", "codex-browser", "codex-chrome", "codex-latex", "codex-visualize", "codex-code-review"]) {
  test(`${folder} installs`, async () => {
    test.skip(!has(folder), `no ${folder} plugin prepared`);
    test.setTimeout(300_000);
    const record = await installed(folder);
    expect(record.error).toBeNull();
  });
}

test("a browser plugin's tool runs (Playwright MCP: navigate, snapshot)", async () => {
  test.skip(!has("playwright"), "no playwright plugin prepared");
  test.setTimeout(180_000);
  const call = (name: string, args: object) => page.evaluate(({ name, args }) => (window as never as { workbench: { plugins: { request(r: object): Promise<unknown> } } })
    .workbench.plugins.request({ pluginId: "playwright", server: "browser", method: "tools/call", params: { name, arguments: args }, scope: { sessionId: null, projectId: null } }), { name, args }) as Promise<{ content: Array<{ text?: string }> }>;
  const result = await call("browser_navigate", { url: "https://example.com" });
  const text = result.content.map((part) => part.text ?? "").join("\n");
  console.info(`[matrix] playwright navigate: ${text.slice(0, 200).replace(/\n/g, " ")}`);
  expect(text).toContain("Example Domain");
});

test("a shell plugin's tool runs", async () => {
  test.skip(!has("shell"), "no shell plugin prepared");
  const result = await page.evaluate(() => (window as never as { workbench: { plugins: { request(r: object): Promise<unknown> } } })
    .workbench.plugins.request({ pluginId: "shell", server: "shell", method: "tools/call", params: { name: "shell_execute", arguments: { command: ["uname", "-s"] } }, scope: { sessionId: null, projectId: null } })) as { content: Array<{ text?: string }> };
  const text = result.content.map((part) => part.text ?? "").join("\n");
  console.info(`[matrix] shell uname: ${text.slice(0, 200).replace(/\n/g, " ")}`);
  expect(text).toMatch(/Darwin|Linux/);
});

test("one real Claude turn calls a plugin tool through the agent proxy", async () => {
  test.skip(!process.env.ELASTIC_MATRIX_AGENT, "set ELASTIC_MATRIX_AGENT=1 to spend one real Claude turn");
  test.setTimeout(300_000);
  await page.evaluate((p) => window.workbench.plugins.installFolder({ path: p }), path.resolve("resources/plugins/plugins/csv-table"));
  const turnProject = scratch("matrix-agent");
  const chosen = await app.evaluate((_electron, dir) => (globalThis as unknown as { __workbenchE2E: { choose(d: string): { id: string } } }).__workbenchE2E.choose(dir), turnProject);
  const session = await page.evaluate((projectId) => (window as never as { workbench: { sessions: { create(r: object): Promise<{ id: string }> } } }).workbench.sessions.create({ projectId, agentId: "claude-code", gitMode: "none" }), chosen.id);
  // Approve any permission card the turn raises.
  const approve = setInterval(() => { void page.getByRole("button", { name: /^(Allow|Allow once|Yes)/ }).first().click({ timeout: 500 }).catch(() => {}); }, 1000);
  const prompt = "Use the show_table tool from the tables MCP server with csv set to \"city,people\\nOslo,709000\\nBergen,291000\" and then reply with only the number of rows it reports.";
  const answer = await page.evaluate(({ id, text }) => (window as never as { workbench: { sessions: { prompt(r: object): Promise<unknown> } } }).workbench.sessions.prompt({ id, content: [{ type: "text", text }] }), { id: session.id, text: prompt }).finally(() => clearInterval(approve));
  const state = await page.evaluate((id) => (window as never as { workbench: { sessions: { state(r: object): Promise<unknown> } } }).workbench.sessions.state({ id }), session.id);
  const text = JSON.stringify(state);
  // A tool call the agent made, not the prompt's own words: the call's title or name outside the prompt text.
  const calls = text.split(prompt.replace(/"/g, "\\\"")).join("");
  console.info(`[matrix] agent turn: ${JSON.stringify(answer)} toolCall=${/show_table/.test(calls)} said2=${/\b2\b/.test(calls)} state=${calls.slice(0, 1500)}`);
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Sessions" }).click();
  await shoot("agent-turn.png");
  expect(calls).toContain("show_table");
  fs.rmSync(turnProject, { recursive: true, force: true });
});

test("the Plugins page with everything installed", async () => {
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Plugins" }).click();
  await shoot("plugins-installed.png");
});
