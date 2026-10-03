/**
 * The merged plugin store on a fresh profile, against the real default
 * catalogs fetched from GitHub: Linear's card leads with Claude official's
 * listing (it works here; Codex's carries a ChatGPT app elastic skips) while
 * showing the logo, site and publisher Codex's listing has; catalogs' test
 * fixtures and elastic's examples are out of the list; and Add a catalog looks
 * at a repository before adding it.
 *
 * Opt-in (network, about a minute): ELASTIC_STORE=1. Screenshots land in
 * docs/research/design-pass/store-*.png.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import type { WorkbenchApi } from "../../src/shared/ipc";
import { launch, scratch } from "./launch";

declare global { interface Window { workbench: WorkbenchApi } }

const shots = path.resolve("docs/research/design-pass");
let app: ElectronApplication;
let page: Page;
let userData: string;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.ELASTIC_STORE, "set ELASTIC_STORE=1 for the real store (network)");

type Snapshot = Awaited<ReturnType<WorkbenchApi["plugins"]["list"]>>;
const snapshot = (): Promise<Snapshot> => page.evaluate(() => window.workbench.plugins.list());
const capture = (name: string) => page.screenshot({ path: path.join(shots, name), animations: "disabled" });

test.beforeAll(async () => {
  userData = scratch("store");
  ({ app, page } = await launch({ userData, env: { WORKBENCH_NO_DEFAULT_MARKETPLACES: undefined } }));
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

test("the real store leads Linear with the listing that works, and leaves fixtures and examples out", async () => {
  test.setTimeout(300_000);
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Plugins" }).click();
  await expect.poll(async () => (await snapshot()).marketplaces.filter((market) => market.kind === "git").map((market) => market.status).join(","),
    { timeout: 240_000, intervals: [2000] }).toMatch(/^(ready|failed)(,(ready|failed))*$/);
  const snap = await snapshot();
  expect(snap.marketplaces.filter((market) => market.kind === "git").map((market) => market.displayName).sort()).toEqual(["Claude official", "Codex official", "text-to-cad"]);
  expect(snap.catalog.some((entry) => entry.name === "fakechat")).toBe(false);

  const linear = snap.catalog.find((entry) => entry.name === "linear")!;
  expect(linear.sources[0]).toMatchObject({ marketplaceName: "Claude official" });
  expect(linear.compat.level).toBe("signin");
  expect(linear).toMatchObject({ verified: true, homepage: "https://linear.app/" });
  expect(linear.logo).toMatch(/^data:image\//);

  const browse = page.getByTestId("plugins-page");
  await expect(browse.getByText(/work in elastic today/)).toBeVisible();
  // The examples are out of the list until asked for.
  await expect(browse.locator('[data-catalog-entry="csv-table"]')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await capture("store-after.png");

  await browse.getByRole("textbox", { name: "Search plugins" }).fill("linear");
  const row = browse.locator('[data-catalog-entry="linear"]').first();
  await expect(row.getByText("May need sign-in")).toBeVisible();
  await expect(row.locator("[data-trust-line]")).toContainText("Claude official");
  await row.getByRole("button").first().click();
  await expect(browse.getByRole("heading", { name: "Linear", level: 1 })).toBeVisible();
  await expect(browse.getByText("Claude official ·", { exact: false }).first()).toBeVisible();
  await expect(browse.getByText("https://linear.app/")).toBeVisible();
  await expect(browse.getByText("Version")).toBeVisible();
  await expect(browse.getByText("Unavailable")).toHaveCount(0);
  await capture("store-detail-linear-after.png");
});

test("Add a catalog looks at a repository before adding it", async () => {
  test.setTimeout(120_000);
  await page.getByRole("complementary", { name: "Plugins sidebar" }).getByRole("button", { name: "Browse", exact: true }).click();
  const browse = page.getByTestId("plugins-page");
  await browse.getByRole("textbox", { name: "Search plugins" }).fill("");
  await browse.getByTestId("plugin-sources").getByRole("button", { name: "Add a catalog" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Repository" }).fill("openai/plugins");
  await dialog.getByRole("button", { name: "Look" }).click();
  const preview = dialog.getByTestId("catalog-preview");
  await expect(preview).toBeVisible({ timeout: 90_000 });
  await expect(preview).toContainText("Codex official");
  await expect(preview).toContainText("already in your list");
  await capture("store-add-catalog-after.png");
  await page.keyboard.press("Escape");
});
