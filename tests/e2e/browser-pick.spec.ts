/**
 * Click-to-prompt (`docs/browser.md`, "Pick an element"): the crosshair turns pick mode on, a click
 * on an element adds a chip with its image and code, the page's own handler does not run, the
 * page cannot forge a pick, and Esc ends the mode.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, newTab, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;
let server: http.Server;
let origin: string;

test.beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    // The page tries to answer for the picker itself, in its own world: it must not be heard.
    response.end(`<title>Shop</title><body style="margin:40px"><button id="buy" style="width:120px;height:40px" onclick="document.title='clicked'">Buy</button>
      <script>window.__elasticPicker = { next: () => Promise.resolve({ selector: "#forged" }), stop() {} }; console.log("#forged");</script></body>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const project = scratch("pick-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Pick\n");
  ({ app, page } = await launch({ userData: scratch("pick") }));
  const { id } = await chooseDirectory(app, project);
  const session = await page.evaluate((projectId) => window.workbench.sessions.create({ projectId, agentId: "claude-code", gitMode: "none" }), id);
  await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click();
});
test.afterAll(async () => {
  await app?.close();
  server?.close();
});

/** The shop page's contents, from main. */
const shop = () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((wc) => wc.getURL() === url)?.id ?? null, origin);
const inShop = <T>(fn: string) => app.evaluate(async ({ webContents }, [url, code]) => {
  const wc = webContents.getAllWebContents().find((contents) => contents.getURL() === url);
  return wc ? wc.executeJavaScript(code as string, true) : null;
}, [origin, fn]) as Promise<T>;

test("a picked element becomes a chip, the page's handler does not run, and Esc ends picking", async () => {
  if (!(await page.getByTestId("explorer").isVisible())) await page.getByRole("button", { name: "Toggle explorer" }).click();
  await newTab(page, "Browser");
  await page.getByRole("textbox", { name: "Address" }).fill(origin);
  await page.getByRole("textbox", { name: "Address" }).press("Enter");
  await expect.poll(shop, { timeout: 15_000 }).not.toBeNull();
  await expect.poll(() => inShop<string>("document.title")).toBe("Shop");

  await page.locator("[data-pick-element]").click();
  await expect(page.locator("[data-pick-element]")).toHaveAttribute("aria-pressed", "true");
  const box = await inShop<{ x: number; y: number }>(`(() => { const r = document.getElementById("buy").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await app.evaluate(({ webContents }, [url, x, y]) => {
    const wc = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    wc.sendInputEvent({ type: "mouseMove", x: x as number, y: y as number });
    wc.sendInputEvent({ type: "mouseDown", x: x as number, y: y as number, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x: x as number, y: y as number, button: "left", clickCount: 1 });
  }, [origin, box.x, box.y]);

  const composer = page.locator("[data-session-view] .ProseMirror").first();
  // The chip's words: where it is and its code (the box draws `#buy` as a reference token).
  await expect(composer).toContainText("Element <button>", { timeout: 15_000 });
  await expect(composer).toContainText('id="buy"');
  await expect(composer).not.toContainText("#forged");
  expect(await inShop<string>("document.title")).toBe("Shop");

  await app.evaluate(({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  }, origin);
  await expect(page.locator("[data-pick-element]")).toHaveAttribute("aria-pressed", "false", { timeout: 10_000 });
});
