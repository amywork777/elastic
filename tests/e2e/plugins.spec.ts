/// <reference lib="dom" />
/**
 * Plugins end to end, in the built app: the examples marketplace on the Plugins page, an
 * install from it, a file of a format the plugin claims opening behind the consent screen and
 * then in the plugin's MCP App (served from `mcp-app://`, in a sandboxed frame, over the MCP
 * Apps bridge), Open with switching back to Built-in, the plugin's rail page, and the tab the
 * session's `+` menu opens.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";

import { launch, newTab, scratch, shoot as shootInto } from "./launch";
import { selectFixtureSession } from "./session-fixture";

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = scratch("plugins");
  project = scratch("plugins-project");
  fs.writeFileSync(path.join(project, "sizes.csv"), "name,size\nbeta.txt,20\nalpha.txt,3\ngamma.txt,100\n");
  ({ app, page } = await launch({ userData }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

async function shoot(name: string) {
  await shootInto(page, name, test.info());
}

/** The table the Tables app drew, inside its frame. */
function tablesFrame(): FrameLocator {
  return page.frameLocator('[data-plugin-frame^="csv-table/tables/"] iframe');
}

test("the examples marketplace is on the Plugins page, and Tables installs from it", async () => {
  const rail = page.getByRole("navigation", { name: "Rail" });
  await rail.getByRole("button", { name: "Plugins" }).click();
  const browse = page.getByTestId("plugins-page");
  await expect(browse.getByRole("heading", { name: "Plugins", level: 1 })).toBeVisible();
  await expect(browse.getByRole("heading", { name: "Examples" })).toBeVisible();
  for (const name of ["csv-table", "filesystem", "memory", "mcp-app-demo"]) {
    await expect(browse.getByRole("button", { name: `Install ${name}` })).toBeVisible();
  }
  await shoot("plugins-browse.png");
  await browse.getByRole("button", { name: "Install csv-table" }).click();
  await expect(browse.getByRole("button", { name: "Install csv-table" })).toHaveCount(0, { timeout: 30_000 });
  // Its page: drawn from the manifest, with the views its server lists.
  await page.getByRole("complementary", { name: "Plugins sidebar" }).getByRole("button", { name: "Tables" }).click();
  await expect(browse.getByRole("heading", { name: "Tables", level: 1 })).toBeVisible();
  await expect(browse.getByText("opens .csv, .tsv · tab")).toBeVisible();
  await expect(browse.getByText("csv-tables", { exact: true })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Tables" })).toBeVisible();
  await shoot("plugins-detail.png");
});

test("a CSV opens behind the consent screen, then in the plugin's view; Open with goes back to Built-in", async () => {
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Sessions" }).click();
  await selectFixtureSession(app, page, project);
  if (!(await page.getByTestId("explorer").isVisible())) await page.getByRole("button", { name: "Toggle explorer" }).click();
  await newTab(page, "File");
  await page.locator('[role="treeitem"][data-path="sizes.csv"]').click();
  const explorer = page.getByTestId("explorer");
  await expect(explorer.getByText("Allow Tables to open this file?")).toBeVisible();
  await explorer.getByRole("button", { name: "Yes, open file" }).click();
  const frame = tablesFrame();
  await expect(frame.getByRole("heading", { name: "sizes.csv" })).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator("tbody tr")).toHaveCount(3);
  // Sorting is the app's own: a click on the column header, inside the frame.
  await frame.getByRole("columnheader", { name: "size" }).click();
  await expect(frame.locator("tbody tr").first()).toContainText("alpha.txt");
  await shoot("plugins-file-view.png");

  await explorer.getByRole("button", { name: "Open with" }).click();
  await page.getByRole("menuitem", { name: "Built-in" }).click();
  await expect(explorer.locator(".monaco-editor").first()).toContainText("beta.txt,20");
  await explorer.getByRole("button", { name: "Open with" }).click();
  await page.getByRole("menuitem", { name: "Tables" }).click();
  // Allowed once for the project: no second consent.
  await expect(tablesFrame().getByRole("heading", { name: "sizes.csv" })).toBeVisible({ timeout: 30_000 });
});

test("the rail page and the session's + menu open the same app", async () => {
  await newTab(page, "Table");
  await expect(page.getByRole("tab", { name: /Table/ }).last()).toBeVisible();
  // Opened by the person, the tool runs with no arguments: the app asks for its input.
  await expect(tablesFrame().getByText("show_table needs `csv` or `path`")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Tables" }).click();
  const surface = page.getByTestId("plugin-app");
  await expect(surface).toBeVisible();
  const home = surface.frameLocator("iframe");
  await expect(home.getByRole("heading", { name: "Tables" })).toBeVisible({ timeout: 30_000 });
  await home.getByRole("textbox").fill("city,people\nOslo,709000\nBergen,291000\n");
  await home.getByRole("button", { name: "Show table" }).click();
  await expect(home.locator("tbody tr")).toHaveCount(2);
  await shoot("plugins-rail-page.png");
});

test("each app frame is an origin of its own: workers start, the app and other frames stay out of reach", async () => {
  // The rail page and the session's Table tab, both open from the test above: two frames of one plugin.
  const apps = page.frames().filter((frame) => frame.url().startsWith("mcp-app://"));
  expect(apps.length).toBeGreaterThanOrEqual(2);
  const [first, second] = apps as [typeof apps[number], typeof apps[number]];
  const probe = (frame: typeof first) =>
    frame.evaluate(async () => {
      let parentReadable = true;
      try { void window.parent.document.title; } catch { parentReadable = false; }
      // `import.meta` parses only in a module worker; a classic one fails to start.
      const source = "self.postMessage(import.meta.url ? 'module' : 'none');";
      const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), { type: "module" });
      const kind = await new Promise<string>((resolve) => {
        worker.onmessage = (event) => resolve(String(event.data));
        worker.onerror = () => resolve("failed");
        setTimeout(() => resolve("timeout"), 5_000);
      });
      worker.terminate();
      return { origin: location.origin, workbench: typeof (window as { workbench?: unknown }).workbench, parentReadable, worker: kind };
    });
  const a = await probe(first);
  const b = await probe(second);
  for (const result of [a, b]) {
    expect(result.origin).toMatch(/^mcp-app:\/\/[0-9a-f]{24}$/);
    expect(result).toMatchObject({ workbench: "undefined", parentReadable: false, worker: "module" });
  }
  expect(a.origin).not.toBe(b.origin);
  await first.evaluate(() => localStorage.setItem("elastic-isolation", "first"));
  expect(await second.evaluate(() => localStorage.getItem("elastic-isolation"))).toBeNull();
  // A frame that tries to leave its origin for the app's page stays where it was.
  const before = first.url();
  await first.evaluate(() => { location.href = "mcp-app://ffffffffffffffffffffffff/index.html"; }).catch(() => {});
  await page.waitForTimeout(500);
  expect(first.url()).toBe(before);
});
