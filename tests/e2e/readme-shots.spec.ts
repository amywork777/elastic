/**
 * The README's screenshots, from the built app as a new person gets it: a fresh
 * profile, the default marketplaces, text-to-cad installed from its GitHub
 * marketplace, and two real Claude turns: one that shows a STEP file with the
 * CAD plugin, one that reads a public GitHub page with the bundled Browser
 * plugin. Nothing is staged: the transcript, the model and the page are what
 * the turns produced.
 *
 * Opt-in (network, two real agent turns, a cadgen download): ELASTIC_README_SHOTS=1,
 * with ELASTIC_README_STEP pointing at a STEP file to show. Shots land in
 * docs/readme/.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import type { WorkbenchApi } from "../../src/shared/ipc";
import { chooseDirectory, launch, scratch } from "./launch";

declare global { interface Window { workbench: WorkbenchApi } }

const out = path.resolve("docs/readme");
const step = process.env.ELASTIC_README_STEP ?? "";
let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_README_SHOTS || !fs.existsSync(step), "set ELASTIC_README_SHOTS=1 and ELASTIC_README_STEP (network, real agent turns)");

type Snapshot = Awaited<ReturnType<WorkbenchApi["plugins"]["list"]>>;
const snapshot = (): Promise<Snapshot> => page.evaluate(() => window.workbench.plugins.list());
const theme = (value: "light" | "dark") => page.evaluate((next) => window.workbench.settings.set({ theme: next }), value);
const rail = () => page.getByRole("navigation", { name: "Rail" });

/**
 * The browser tab is a native WebContentsView laid over the window, which a page screenshot
 * cannot see. Its own capture is laid into the page at its bounds for the shot, then removed:
 * the pixels are still the page the agent opened.
 */
async function overlayNativeViews(): Promise<number> {
  const views = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return [];
    const found: Array<{ x: number; y: number; width: number; height: number; url: string }> = [];
    for (const view of window.contentView.children) {
      const contents = (view as { webContents?: Electron.WebContents }).webContents;
      const visible = (view as { getVisible?: () => boolean }).getVisible?.() ?? true;
      const bounds = view.getBounds();
      if (!contents || !visible || bounds.width < 40 || bounds.height < 40) continue;
      const image = await contents.capturePage();
      if (image.isEmpty()) continue;
      found.push({ ...bounds, url: image.toDataURL() });
    }
    return found;
  });
  await page.evaluate((list) => {
    for (const view of list) {
      const image = document.createElement("img");
      image.dataset.readmeOverlay = "";
      image.src = view.url;
      Object.assign(image.style, { position: "fixed", left: `${view.x}px`, top: `${view.y}px`, width: `${view.width}px`, height: `${view.height}px`, zIndex: "99999", pointerEvents: "none" });
      document.body.append(image);
    }
  }, views);
  return views.length;
}

async function shootReadme(name: string) {
  await page.waitForTimeout(600);
  await overlayNativeViews();
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: "disabled" });
  await page.evaluate(() => document.querySelectorAll("[data-readme-overlay]").forEach((node) => node.remove()));
}

/** Light and dark of the same screen. */
async function shootBoth(name: string) {
  await theme("light");
  await shootReadme(`${name}`);
  await theme("dark");
  await shootReadme(`${name}-dark`);
  await theme("light");
}

type Sessions = { create(request: object): Promise<{ id: string }>; prompt(request: object): Promise<unknown> };

/** One real Claude turn in the project, approving any tool permission it asks for. */
async function turn(text: string): Promise<string> {
  const chosen = await chooseDirectory(app, project);
  const session = await page.evaluate(({ projectId }) => (window.workbench.sessions as unknown as Sessions).create({ projectId, agentId: "claude-code", gitMode: "none" }), { projectId: chosen.id });
  const approve = setInterval(() => { void page.getByRole("button", { name: /^(Allow|Allow once|Yes)/ }).first().click({ timeout: 500 }).catch(() => {}); }, 1000);
  try {
    await page.evaluate(({ id, prompt }) => (window.workbench.sessions as unknown as Sessions).prompt({ id, content: [{ type: "text", text: prompt }] }), { id: session.id, prompt: text });
  } finally {
    clearInterval(approve);
  }
  await rail().getByRole("button", { name: "Sessions" }).click();
  await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click();
  return session.id;
}

test.beforeAll(async () => {
  fs.mkdirSync(out, { recursive: true });
  userData = scratch("readme");
  project = scratch("readme-project");
  fs.copyFileSync(step, path.join(project, "bracket.step"));
  ({ app, page } = await launch({ userData, env: { WORKBENCH_FAKE_AGENT: undefined, WORKBENCH_NO_DEFAULT_MARKETPLACES: undefined } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

test("the plugin store, every marketplace in one list", async () => {
  test.setTimeout(300_000);
  await rail().getByRole("button", { name: "Plugins" }).click();
  await expect.poll(async () => (await snapshot()).marketplaces.filter((market) => market.kind === "git").map((market) => market.status).join(","),
    { timeout: 240_000, intervals: [2000] }).toMatch(/^(ready|failed)(,(ready|failed))*$/);
  await shootBoth("store");
});

test("text-to-cad from GitHub, and a real turn that shows a STEP file", async () => {
  test.setTimeout(1_200_000);
  const entry = (await snapshot()).catalog.find((item) => item.name === "text-to-cad");
  expect(entry, "text-to-cad in the catalog").toBeTruthy();
  const source = entry!.sources[0]!;
  const record = await page.evaluate(({ marketplace, name }) => window.workbench.plugins.installFromMarketplace({ marketplace, name }), { marketplace: source.marketplace, name: source.name });
  await expect.poll(async () => (await snapshot()).plugins.find((plugin) => plugin.id === record.id)?.servers[0]?.status, { timeout: 900_000, intervals: [3000] }).toBe("ready");
  await turn("Show bracket.step in the CAD viewer with the CAD tools (cad_show, or cad_open if no viewer is open). Don't edit files or run shell commands. Reply in one short sentence once it is open.");
  await page.waitForTimeout(20_000);
  // cadgen's own first-run analytics question, answered the way a person who is just looking would.
  const cad = page.locator('[data-plugin-frame^="text-to-cad/"] iframe').first().contentFrame();
  await cad.getByRole("button", { name: "No thanks" }).click({ timeout: 5_000 }).catch(() => {});
  await shootBoth("cad");
});

test("a real turn that reads GitHub through the bundled Browser plugin", async () => {
  test.setTimeout(600_000);
  await turn("Open https://github.com/trending in elastic's browser tab and tell me the three top trending repositories today, one line each. Don't edit files or run shell commands.");
  await page.waitForTimeout(5_000);
  await shootBoth("browser");
});

test("a new session", async () => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await shootBoth("home");
});
