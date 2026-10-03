/**
 * text-to-cad's Quick Edit, end to end, as a person uses it: a fresh profile, text-to-cad
 * installed from its GitHub marketplace, one real Claude turn that opens a STEP file in the
 * CAD tab, then a sketch and a note in the view's Quick Edit, queued. The note reaches the
 * composer as a chip (`ui/update-model-context`), and the next message carries it.
 *
 * Opt-in (network, two real agent turns, a cadgen download): ELASTIC_QUICK_EDIT=1, with
 * ELASTIC_QUICK_EDIT_STEP pointing at a STEP file. The shot lands in
 * docs/research/plugin-matrix/quick-edit.png.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { WorkbenchApi } from "../../src/shared/ipc";
import { chooseDirectory, launch, scratch } from "./launch";

declare global { interface Window { workbench: WorkbenchApi } }

const step = process.env.ELASTIC_QUICK_EDIT_STEP ?? "";
const shot = path.resolve("docs/research/plugin-matrix/quick-edit.png");
const NOTE = "Quick edit check: reply with the single word noted, and change nothing.";
let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_QUICK_EDIT || !fs.existsSync(step), "set ELASTIC_QUICK_EDIT=1 and ELASTIC_QUICK_EDIT_STEP (network, real agent turns)");

type Snapshot = Awaited<ReturnType<WorkbenchApi["plugins"]["list"]>>;
type Sessions = { create(request: object): Promise<{ id: string }>; prompt(request: object): Promise<unknown> };
const snapshot = (): Promise<Snapshot> => page.evaluate(() => window.workbench.plugins.list());
const rail = () => page.getByRole("navigation", { name: "Rail" });

test.beforeAll(async () => {
  userData = scratch("quick-edit");
  project = scratch("quick-edit-project");
  fs.copyFileSync(step, path.join(project, "bracket.step"));
  ({ app, page } = await launch({ userData, env: { WORKBENCH_FAKE_AGENT: undefined, WORKBENCH_NO_DEFAULT_MARKETPLACES: undefined } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test("a Quick Edit in the CAD view joins the next message", async () => {
  test.setTimeout(1_500_000);
  await expect.poll(async () => (await snapshot()).catalog.some((item) => item.name === "text-to-cad"), { timeout: 240_000, intervals: [2000] }).toBe(true);
  const entry = (await snapshot()).catalog.find((item) => item.name === "text-to-cad")!;
  const source = entry.sources[0]!;
  const record = await page.evaluate(({ marketplace, name }) => window.workbench.plugins.installFromMarketplace({ marketplace, name }), { marketplace: source.marketplace, name: source.name });
  await expect.poll(async () => (await snapshot()).plugins.find((plugin) => plugin.id === record.id)?.servers[0]?.status, { timeout: 900_000, intervals: [3000] }).toBe("ready");

  // One real turn opens the model in the CAD tab.
  const chosen = await chooseDirectory(app, project);
  const session = await page.evaluate(({ projectId }) => (window.workbench.sessions as unknown as Sessions).create({ projectId, agentId: "claude-code", gitMode: "none" }), { projectId: chosen.id });
  await rail().getByRole("button", { name: "Sessions" }).click();
  await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click();
  await page.evaluate(({ id }) => (window.workbench.sessions as unknown as Sessions).prompt({ id, content: [{ type: "text", text: "Show bracket.step in the CAD viewer with the CAD tools (cad_show, or cad_open if no viewer is open). Don't edit files or run shell commands. Reply in one short sentence." }] }), { id: session.id });

  const frame = page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first();
  const cad = frame.contentFrame();
  await cad.getByRole("button", { name: "No thanks" }).click({ timeout: 30_000 }).catch(() => {});
  await expect(cad.getByText("Reading model")).toHaveCount(0, { timeout: 300_000 });
  await expect(cad.locator("canvas").first()).toBeVisible({ timeout: 60_000 });

  // A sketch opens Quick Edit; the note is written and queued, as a person does it.
  await cad.getByRole("button", { name: "Draw", exact: true }).click();
  await cad.locator("[data-cad-drawing-overlay] canvas.excalidraw__canvas.interactive").waitFor({ timeout: 30_000 });
  const box = (await cad.locator("[data-cad-drawing-overlay]").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  const quickEdit = cad.getByRole("region", { name: "Quick Edit", exact: true });
  await quickEdit.getByRole("textbox", { name: "Describe your changes", exact: true }).fill(NOTE);
  await quickEdit.locator('[data-quick-edit-action="queue"]').click();

  // It reaches the composer as a chip, with no "Method not found".
  const chip = page.locator("[data-composer-app-context]");
  await expect(chip).toHaveCount(1, { timeout: 30_000 });
  await expect(chip).toContainText("Quick edit");
  await expect(cad.getByText("Method not found")).toHaveCount(0);
  await page.waitForTimeout(800);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await page.screenshot({ path: shot, animations: "disabled" });

  // The next message carries it: the transcript's user message has the note, the chip is gone.
  const editor = page.locator('[data-composer] [contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type("go");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(NOTE, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
});
