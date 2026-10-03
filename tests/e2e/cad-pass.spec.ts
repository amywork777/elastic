/**
 * The CAD plugin as a new person meets it, end to end, against the real
 * text-to-cad from its GitHub marketplace and real Claude turns: install,
 * the agent opens a STEP in the CAD tab, the reply's file link opens it with
 * CAD, a Quick Edit sent from the full-window CAD page lands in the chat
 * (and takes the person there), the agent captures the view, and a relaunch
 * comes back on the chat and its CAD tab with the model in it.
 *
 * Opt-in (network, a cadgen download, a few real turns): ELASTIC_CAD_PASS=1,
 * with ELASTIC_CAD_PASS_STEP pointing at a STEP file. Screenshots land in
 * docs/research/plugin-matrix/cad-pass-*.png.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { WorkbenchApi } from "../../src/shared/ipc";
import { chooseDirectory, launch, scratch } from "./launch";

declare global { interface Window { workbench: WorkbenchApi } }

const step = process.env.ELASTIC_CAD_PASS_STEP ?? "";
const out = path.resolve("docs/research/plugin-matrix");
const env = { WORKBENCH_FAKE_AGENT: undefined, WORKBENCH_NO_DEFAULT_MARKETPLACES: undefined };
let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_CAD_PASS || !fs.existsSync(step), "set ELASTIC_CAD_PASS=1 and ELASTIC_CAD_PASS_STEP (network, real agent turns)");

type Snapshot = Awaited<ReturnType<WorkbenchApi["plugins"]["list"]>>;
type Sessions = { create(request: object): Promise<{ id: string }>; prompt(request: object): Promise<unknown> };
const snapshot = (): Promise<Snapshot> => page.evaluate(() => window.workbench.plugins.list());
const rail = () => page.getByRole("navigation", { name: "Rail" });
const cadFrame = () => page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first().contentFrame();
const shoot = async (name: string) => {
  await page.waitForTimeout(1_500);
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `cad-pass-${name}.png`), animations: "disabled" });
};

async function serverReady(id: string, timeout: number) {
  await expect.poll(async () => (await snapshot()).plugins.find((plugin) => plugin.id === id)?.servers[0]?.status, { timeout, intervals: [3000] }).toBe("ready");
}

async function modelRenders() {
  const cad = cadFrame();
  await cad.getByRole("button", { name: "No thanks" }).click({ timeout: 20_000 }).catch(() => {});
  await expect(cad.getByText("Reading model")).toHaveCount(0, { timeout: 300_000 });
  await expect(cad.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
}

async function turn(sessionId: string, text: string) {
  const log = page.getByRole("log").first();
  await page.evaluate(({ id, text }) => (window.workbench.sessions as unknown as Sessions).prompt({ id, content: [{ type: "text", text }] }), { id: sessionId, text });
  // The turn has ended when the prompt is in the transcript, a reply follows it, and the
  // transcript has stopped changing (no "Stop" in the composer) for a few seconds.
  let last = "";
  await expect.poll(async () => {
    const now = await log.innerText();
    const settled = now === last && now.includes(text.slice(0, 40)) && !now.trimEnd().endsWith(text.trimEnd())
      && !(await page.getByRole("button", { name: /^Stop/ }).isVisible().catch(() => false));
    last = now;
    return settled;
  }, { timeout: 240_000, intervals: [4000] }).toBe(true);
}

test.beforeAll(async () => {
  userData = scratch("cad-pass");
  project = scratch("cad-pass-project");
  fs.copyFileSync(step, path.join(project, "bracket.step"));
  ({ app, page } = await launch({ userData, env }));
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("text-to-cad end to end, as a new person meets it", async () => {
  test.setTimeout(2_400_000);
  // Install from the store's text-to-cad entry.
  await expect.poll(async () => (await snapshot()).catalog.some((item) => item.name === "text-to-cad"), { timeout: 240_000, intervals: [2000] }).toBe(true);
  const entry = (await snapshot()).catalog.find((item) => item.name === "text-to-cad")!;
  const source = entry.sources[0]!;
  const record = await page.evaluate(({ marketplace, name }) => window.workbench.plugins.installFromMarketplace({ marketplace, name }), { marketplace: source.marketplace, name: source.name });
  await serverReady(record.id, 900_000);

  // The agent opens the model in the chat's CAD tab.
  const chosen = await chooseDirectory(app, project);
  const session = await page.evaluate(({ projectId }) => (window.workbench.sessions as unknown as Sessions).create({ projectId, agentId: "claude-code", gitMode: "none" }), { projectId: chosen.id });
  await rail().getByRole("button", { name: "Sessions" }).click();
  await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click();
  await turn(session.id, "Show bracket.step in the CAD viewer with cad_open. Don't edit files or run shell commands. Reply in one short sentence that names the file bracket.step.");
  await modelRenders();
  await shoot("1-agent-opens-tab");

  // The reply's file link opens the STEP with CAD, the handler for it.
  const link = page.getByRole("log").getByRole("button", { name: "bracket.step", exact: true }).first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  // The first file text-to-cad opens in a project asks once (remembered per project).
  await page.getByRole("button", { name: "Yes, open file" }).click({ timeout: 15_000 }).catch(() => {});
  await expect(page.locator('[data-plugin-frame^="text-to-cad/"]').first()).toBeVisible({ timeout: 60_000 });
  await modelRenders();
  await shoot("2-chat-link-opens-cad");

  // On the full-window CAD page, a Quick Edit goes to the chat and takes the person there.
  await rail().getByRole("button", { name: "text-to-cad" }).click();
  await expect(page.getByTestId("plugin-app")).toBeVisible({ timeout: 30_000 });
  const home = cadFrame();
  await home.getByText("bracket.step").first().click({ timeout: 60_000 });
  await modelRenders();
  await home.getByRole("button", { name: "Draw", exact: true }).click();
  await home.locator("[data-cad-drawing-overlay] canvas.excalidraw__canvas.interactive").waitFor({ timeout: 30_000 });
  const box = (await home.locator("[data-cad-drawing-overlay]").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  const quickEdit = home.getByRole("region", { name: "Quick Edit", exact: true });
  await quickEdit.getByRole("textbox", { name: "Describe your changes", exact: true }).fill("Round the top edges a little.");
  await quickEdit.locator('[data-quick-edit-action="queue"]').click();
  await expect(page.getByTestId("plugin-app")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("[data-composer-app-context]")).toHaveCount(1, { timeout: 30_000 });
  await shoot("3-rail-quick-edit-lands-in-chat");
  await page.locator("[data-composer-app-context] button").first().click().catch(() => {});

  // The agent captures what the open viewer shows.
  await turn(session.id, "Call cad_screenshot on the open CAD viewer and say in one sentence what it shows. If it fails, quote the error verbatim.");
  await expect(page.locator("main")).not.toContainText("No CAD viewer");
  await shoot("4-agent-screenshot");

  // A relaunch comes back on the chat, its CAD tab and the model in it.
  await app.close();
  ({ app, page } = await launch({ userData, env }));
  await expect(page.locator(`[data-session-row="${session.id}"][aria-current="page"], [data-session-row="${session.id}"] [aria-current="page"]`).first()).toBeVisible({ timeout: 60_000 });
  await serverReady(record.id, 300_000);
  await modelRenders();
  await shoot("5-relaunch");
});
