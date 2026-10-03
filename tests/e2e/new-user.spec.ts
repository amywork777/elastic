/**
 * The first run, as a new person sees it: a fresh profile, the default
 * marketplaces fetched from GitHub (Claude Code's official one, Codex's, and
 * text-to-cad's), the merged Plugins page, and a set of real plugins
 * installed the way Install does and exercised: tools listed, a call where it
 * needs no account, a sign-in taken only as far as the provider's page.
 *
 * Opt-in (network, npm and uv downloads, minutes): ELASTIC_NEW_USER=1, and
 * ELASTIC_MATRIX_DIR for `models/part.step`. Results land in
 * docs/research/plugin-matrix/new-user.json and the screenshots beside it.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import type { WorkbenchApi } from "../../src/shared/ipc";
import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

declare global { interface Window { workbench: WorkbenchApi } }

const shots = path.resolve("docs/research/plugin-matrix");
const matrix = process.env.ELASTIC_MATRIX_DIR ?? "";
let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;
const results: Record<string, unknown> = {};

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_NEW_USER, "set ELASTIC_NEW_USER=1 for the first-run pass (network)");

async function capture(name: string) {
  await page.screenshot({ path: path.join(shots, name), animations: "disabled" });
}

type Snapshot = Awaited<ReturnType<WorkbenchApi["plugins"]["list"]>>;
const snapshot = (): Promise<Snapshot> => page.evaluate(() => window.workbench.plugins.list());

test.beforeAll(async () => {
  userData = scratch("new-user");
  project = scratch("new-user-project");
  const step = path.join(matrix, "models", "part.step");
  if (fs.existsSync(step)) fs.copyFileSync(step, path.join(project, "part.step"));
  ({ app, page } = await launch({ userData, env: { WORKBENCH_NO_DEFAULT_MARKETPLACES: undefined } }));
  // Sign-ins stop at the provider's page: record the URL instead of opening a browser.
  await app.evaluate(({ shell }) => {
    (globalThis as { opened?: string[] }).opened = [];
    shell.openExternal = async (url: string) => { (globalThis as unknown as { opened: string[] }).opened.push(url); };
  });
});

test.afterAll(async () => {
  // Merged into an earlier run's file, so one case can be run again on its own.
  const file = path.join(shots, "new-user.json");
  const earlier = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> : {};
  fs.writeFileSync(file, `${JSON.stringify({ ...earlier, ...results }, null, 2)}\n`);
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

test("the first run fetches the default marketplaces into one list", async () => {
  test.setTimeout(300_000);
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Plugins" }).click();
  await capture("new-user-store-fetching.png");
  await expect.poll(async () => (await snapshot()).marketplaces.filter((market) => market.kind === "git").map((market) => market.status).join(","),
    { timeout: 240_000, intervals: [2000] }).toMatch(/^(ready|failed)(,(ready|failed))*$/);
  const snap = await snapshot();
  const labels: Record<string, number> = {};
  for (const entry of snap.catalog) labels[entry.compat.label] = (labels[entry.compat.label] ?? 0) + 1;
  results.store = {
    marketplaces: snap.marketplaces.map((market) => ({ name: market.displayName, kind: market.kind, status: market.status, error: market.error, plugins: market.plugins.length, commit: market.commit })),
    entries: snap.catalog.length,
    listed: snap.marketplaces.reduce((sum, market) => sum + market.plugins.length, 0),
    merged: snap.catalog.filter((entry) => entry.sources.length > 1).map((entry) => `${entry.name} (${entry.sources.map((source) => source.marketplaceName).join(" + ")})`),
    labels,
  };
  await page.waitForTimeout(500);
  await capture("new-user-store.png");
  await page.getByRole("textbox", { name: "Search plugins" }).fill("linear");
  await capture("new-user-search.png");
  await page.locator('[data-catalog-entry="linear"] button').first().click();
  await capture("new-user-entry.png");
  await page.getByRole("button", { name: "Plugins" }).first().click().catch(() => {});
  expect(snap.catalog.length).toBeGreaterThan(100);
});

async function install(name: string): Promise<{ id: string } | { error: string }> {
  const snap = await snapshot();
  const entry = snap.catalog.find((item) => item.name === name);
  if (!entry) return { error: "not in the catalog" };
  const source = entry.sources[0]!;
  return page.evaluate(({ marketplace, plugin }) => window.workbench.plugins.installFromMarketplace({ marketplace, name: plugin })
    .then((record) => ({ id: record.id }), (error: unknown) => ({ error: String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (IpcError: )?(Error: )?/, "") })),
  { marketplace: source.marketplace, plugin: source.name });
}

async function settled(id: string, timeout = 420_000) {
  let record: Snapshot["plugins"][number] | undefined;
  await expect.poll(async () => {
    record = (await snapshot()).plugins.find((plugin) => plugin.id === id);
    return record && record.servers.every((server) => ["ready", "failed", "signin"].includes(server.status)) ? "settled" : "waiting";
  }, { timeout, intervals: [2000] }).toBe("settled");
  return record!;
}

const call = (pluginId: string, server: string, name: string, args: Record<string, unknown>) =>
  page.evaluate(({ pluginId: id, server: s, name: n, args: a }) => window.workbench.plugins.request({ pluginId: id, server: s, method: "tools/call", params: { name: n, arguments: a }, scope: { sessionId: null, projectId: null } })
    .then((result) => JSON.stringify(result).slice(0, 300), (error: unknown) => `error: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`),
  { pluginId, server, name, args });

const NO_ACCOUNT: Array<{ name: string; probe?: (id: string, server: string, tools: string[]) => Promise<string> }> = [
  { name: "playwright", probe: (id, server) => call(id, server, "browser_navigate", { url: "https://example.com" }).then(async (text) => { await call(id, server, "browser_close", {}); return text; }) },
  { name: "chrome-devtools-mcp" },
  { name: "desktop-commander", probe: (id, server, tools) => tools.includes("list_directory") ? call(id, server, "list_directory", { path: project }) : Promise.resolve("no list_directory tool") },
  { name: "context7", probe: (id, server, tools) => call(id, server, tools.find((tool) => tool.includes("resolve")) ?? "resolve-library-id", { libraryName: "react", query: "react" }) },
  { name: "serena" },
  { name: "frontend-design" },
  { name: "playground" },
  { name: "mcp-apps" },
  { name: "typescript-lsp" },
];

for (const plugin of NO_ACCOUNT) {
  test(`no account: ${plugin.name}`, async () => {
    test.setTimeout(480_000);
    const entry = (await snapshot()).catalog.find((item) => item.name === plugin.name);
    const installed = await install(plugin.name);
    const result: Record<string, unknown> = { label: entry?.compat.label ?? null, detail: entry?.compat.detail ?? null, source: entry?.sources[0]?.marketplaceName ?? null };
    if ("error" in installed) {
      results[plugin.name] = { ...result, installed: false, error: installed.error };
      return;
    }
    const record = await settled(installed.id);
    result.installed = true;
    result.skills = record.skills.length;
    result.servers = record.servers.map((server) => ({ name: server.name, transport: server.transport, status: server.status, tools: server.toolNames.length, error: server.error?.slice(0, 300) ?? null }));
    const ready = record.servers.find((server) => server.status === "ready" && server.transport !== "app");
    if (plugin.probe && ready) result.call = await plugin.probe(record.id, ready.name, ready.toolNames);
    results[plugin.name] = result;
    console.info(`[new-user] ${plugin.name}: ${JSON.stringify(result).slice(0, 600)}`);
  });
}

const SIGN_IN = ["notion", "sentry", "vercel", "supabase", "atlassian", "canva", "miro", "linear", "figma"];

for (const name of SIGN_IN) {
  test(`sign-in: ${name}`, async () => {
    test.setTimeout(300_000);
    const entry = (await snapshot()).catalog.find((item) => item.name === name);
    const installed = await install(name);
    const result: Record<string, unknown> = { label: entry?.compat.label ?? null, source: entry?.sources[0]?.marketplaceName ?? null };
    if ("error" in installed) {
      results[name] = { ...result, installed: false, error: installed.error };
      return;
    }
    const record = await settled(installed.id, 180_000);
    result.installed = true;
    result.skills = record.skills.length;
    result.servers = record.servers.map((server) => ({ name: server.name, transport: server.transport, status: server.status, tools: server.toolNames.length, error: server.error?.slice(0, 300) ?? null }));
    const remote = record.servers.find((server) => server.status === "signin");
    if (remote) {
      await app.evaluate(() => { (globalThis as unknown as { opened: string[] }).opened.length = 0; });
      const signIn = page.evaluate(({ id, server }) => window.workbench.plugins.signIn({ id, server }).then(() => "signed in", (error: unknown) => `error: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`), { id: record.id, server: remote.name });
      const opened = await Promise.race([
        expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1) ?? ""), { timeout: 45_000 }).not.toBe("").then(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1)!)),
        signIn.then((text) => `(no browser) ${text}`),
      ]).catch((error: unknown) => `timeout: ${String(error).slice(0, 120)}`);
      if (opened.startsWith("http")) {
        const response = await fetch(opened, { redirect: "follow" }).catch(() => null);
        result.signIn = { reachesLogin: response ? response.status < 500 : false, page: response ? `${response.status} ${new URL(response.url).host}` : "unreachable", authorize: `${new URL(opened).host}${new URL(opened).pathname}` };
      } else {
        result.signIn = { reachesLogin: false, said: opened };
      }
    }
    results[name] = result;
    console.info(`[new-user] ${name}: ${JSON.stringify(result).slice(0, 600)}`);
  });
}

test("text-to-cad from its GitHub marketplace: the CAD page and a STEP that renders", async () => {
  test.setTimeout(900_000);
  const entry = (await snapshot()).catalog.find((item) => item.name === "text-to-cad");
  const installed = await install("text-to-cad");
  const result: Record<string, unknown> = { label: entry?.compat.label ?? null, sources: entry?.sources.map((source) => source.marketplaceName) ?? [] };
  if ("error" in installed) {
    results["text-to-cad"] = { ...result, installed: false, error: installed.error };
    return;
  }
  const record = await settled(installed.id, 840_000);
  result.installed = true;
  result.version = record.version;
  result.servers = record.servers.map((server) => ({ name: server.name, status: server.status, tools: server.toolNames.length, error: server.error?.slice(0, 300) ?? null }));
  result.views = record.tools.map((tool) => `${tool.tool}:${tool.entrypoints.map((point) => point.type).join("+")}`);
  results["text-to-cad"] = result;
  if (record.servers[0]?.status !== "ready") return;
  const rail = page.getByRole("navigation", { name: "Rail" });
  if (await rail.getByRole("button", { name: "CAD" }).count()) {
    await rail.getByRole("button", { name: "CAD" }).click();
    await page.waitForTimeout(10_000);
    await capture("new-user-cad-rail.png");
  }
  if (fs.existsSync(path.join(project, "part.step"))) {
    await rail.getByRole("button", { name: "Sessions" }).click();
    await selectFixtureSession(app, page, project);
    if (!(await page.getByTestId("explorer").isVisible())) await page.getByRole("button", { name: "Toggle explorer" }).click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: /^File/ }).first().click();
    await page.locator('[role="treeitem"][data-path="part.step"]').click();
    const explorer = page.getByTestId("explorer");
    const ask = explorer.getByText(/Allow .* to open this file\?/);
    if (await ask.isVisible({ timeout: 10_000 }).catch(() => false)) await explorer.getByRole("button", { name: "Yes, open file" }).click();
    await page.waitForTimeout(25_000);
    await capture("new-user-cad-step.png");
    const frame = page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first();
    result.stepView = (await frame.count()) > 0 ? (await frame.contentFrame().locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) : "no plugin view (opened built-in)";
  }
  results["text-to-cad"] = result;
  console.info(`[new-user] text-to-cad: ${JSON.stringify(result).slice(0, 800)}`);
});

test("the Plugins page after the pass", async () => {
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Plugins" }).click();
  await page.getByRole("textbox", { name: "Search plugins" }).fill("").catch(() => {});
  await capture("new-user-installed.png");
});
