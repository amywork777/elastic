/**
 * A relaunch opens where the person was: a fresh profile, text-to-cad installed from its
 * GitHub marketplace, one real Claude turn that opens a STEP file in the CAD tab, then the
 * app quits and starts again on the same profile. The same chat is selected, its CAD tab is
 * back, and the tab calls cad_open again with the arguments it kept, so the model renders.
 *
 * Opt-in (network, one real agent turn, a cadgen download): ELASTIC_RESTORE=1, with
 * ELASTIC_RESTORE_STEP pointing at a STEP file. The shot lands in
 * docs/research/plugin-matrix/restore-after-relaunch.png.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { WorkbenchApi } from "../../src/shared/ipc";
import { chooseDirectory, launch, scratch } from "./launch";

declare global { interface Window { workbench: WorkbenchApi } }

const step = process.env.ELASTIC_RESTORE_STEP ?? "";
const shot = path.resolve("docs/research/plugin-matrix/restore-after-relaunch.png");
let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_RESTORE || !fs.existsSync(step), "set ELASTIC_RESTORE=1 and ELASTIC_RESTORE_STEP (network, a real agent turn)");

type Snapshot = Awaited<ReturnType<WorkbenchApi["plugins"]["list"]>>;
type Sessions = { create(request: object): Promise<{ id: string }>; prompt(request: object): Promise<unknown> };
const snapshot = (): Promise<Snapshot> => page.evaluate(() => window.workbench.plugins.list());
const rail = () => page.getByRole("navigation", { name: "Rail" });
const env = { WORKBENCH_FAKE_AGENT: undefined, WORKBENCH_NO_DEFAULT_MARKETPLACES: undefined };

/** The plugin's server is ready; one that failed fails the test with the server's own reason. */
async function serverReady(id: string, timeout: number) {
  await expect.poll(async () => {
    const server = (await snapshot()).plugins.find((plugin) => plugin.id === id)?.servers[0];
    if (server?.status === "failed") throw new Error(`${id} failed to start: ${JSON.stringify(server)}`);
    return server?.status;
  }, { timeout, intervals: [3000] }).toBe("ready");
}

async function modelRenders() {
  const cad = page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first().contentFrame();
  await cad.getByRole("button", { name: "No thanks" }).click({ timeout: 30_000 }).catch(() => {});
  await expect(cad.getByText("Reading model")).toHaveCount(0, { timeout: 300_000 });
  await expect(cad.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async () => {
  userData = scratch("restore");
  project = scratch("restore-project");
  fs.copyFileSync(step, path.join(project, "bracket.step"));
  ({ app, page } = await launch({ userData, env }));
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("a relaunch reopens the chat, its CAD tab, and the model in it", async () => {
  test.setTimeout(1_800_000);
  await expect.poll(async () => (await snapshot()).catalog.some((item) => item.name === "text-to-cad"), { timeout: 240_000, intervals: [2000] }).toBe(true);
  const entry = (await snapshot()).catalog.find((item) => item.name === "text-to-cad")!;
  const source = entry.sources[0]!;
  const record = await page.evaluate(({ marketplace, name }) => window.workbench.plugins.installFromMarketplace({ marketplace, name }), { marketplace: source.marketplace, name: source.name });
  await serverReady(record.id, 900_000);

  const chosen = await chooseDirectory(app, project);
  const session = await page.evaluate(({ projectId }) => (window.workbench.sessions as unknown as Sessions).create({ projectId, agentId: "claude-code", gitMode: "none" }), { projectId: chosen.id });
  await rail().getByRole("button", { name: "Sessions" }).click();
  await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click();
  await page.evaluate(({ id }) => (window.workbench.sessions as unknown as Sessions).prompt({ id, content: [{ type: "text", text: "Show bracket.step in the CAD viewer with the CAD tools (cad_show, or cad_open if no viewer is open). Don't edit files or run shell commands. Reply in one short sentence." }] }), { id: session.id });
  await modelRenders();

  // Quit and start again on the same profile.
  await app.close();
  ({ app, page } = await launch({ userData, env }));

  await expect(page.locator(`[data-session-row="${session.id}"][aria-current="page"], [data-session-row="${session.id}"] [aria-current="page"]`).first()).toBeVisible({ timeout: 60_000 });
  await serverReady(record.id, 300_000);
  await modelRenders();
  await page.waitForTimeout(3_000);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
});
