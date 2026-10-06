/**
 * The live preview: an agent's HTML opens rendered in the chat's browser tab, with its relative
 * CSS, and reloads by itself when the file changes on disk.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, newTab, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeAll(async () => {
  project = scratch("preview-project");
  fs.mkdirSync(path.join(project, "site"));
  fs.writeFileSync(path.join(project, "site", "index.html"), `<link rel="stylesheet" href="style.css"><title>First</title><h1>Hello</h1>`);
  fs.writeFileSync(path.join(project, "site", "style.css"), "h1 { color: rgb(255, 0, 0); }");
  ({ app, page } = await launch({ userData: scratch("preview") }));
  const { id } = await chooseDirectory(app, project);
  const session = await page.evaluate((projectId) => window.workbench.sessions.create({ projectId, agentId: "claude-code", gitMode: "none" }), id);
  await page.locator(`[data-session-row="${session.id}"] [data-session-row-title]`).first().click();
});
test.afterAll(async () => {
  await app?.close();
});

/** The preview page's title and its h1's colour, read in main from the page itself. */
const previewPage = () => app.evaluate(async ({ webContents }) => {
  const contents = webContents.getAllWebContents().find((wc) => /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\//.test(wc.getURL()));
  if (!contents) return null;
  return contents.executeJavaScript(`({ title: document.title, color: getComputedStyle(document.querySelector("h1")).color })`, true).catch(() => null);
});

test("an HTML file opens rendered with its CSS, and reloads when it changes on disk", async () => {
  if (!(await page.getByTestId("explorer").isVisible())) await page.getByRole("button", { name: "Toggle explorer" }).click();
  await newTab(page, "File");
  await page.locator("#explorer-tabpanel [data-tab-body]:not([inert])").getByLabel("Filter files").fill("index.html");
  await page.getByRole("option", { name: /index\.html/ }).first().click();
  await page.locator("[data-open-preview]").click();
  await expect(page.locator("[data-view-source]")).toBeVisible({ timeout: 15_000 });
  await expect.poll(previewPage, { timeout: 15_000 }).toEqual({ title: "First", color: "rgb(255, 0, 0)" });

  fs.writeFileSync(path.join(project, "site", "index.html"), `<link rel="stylesheet" href="style.css"><title>Second</title><h1>Hello again</h1>`);
  await expect.poll(async () => (await previewPage())?.title, { timeout: 15_000 }).toBe("Second");
});
