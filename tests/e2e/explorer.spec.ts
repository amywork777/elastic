import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import type { WorkbenchApi } from "../../src/shared/ipc";
import { chooseDirectory, launch, mod, newTab as newTabIn, repoRoot, scratch, settleTerminal, shoot as shootInto } from "./launch";
import { selectFixtureSession } from "./session-fixture";

/**
 * The explorer's host side, on one app: what main reads, writes, watches and
 * runs for each kind of tab.
 *
 * The main project is the checkout the suite is running from — a real tree
 * with a `.gitignore`, `node_modules`, LFS pointers and a hundred thousand
 * files — because that is where the interesting failures are. Anything that
 * writes gets a scratch directory of its own.
 *
 * The file viewer's own chrome — the breadcrumb and the panel toggles — is
 * `packages/ui`'s and tested there.
 * The review is `git.spec.ts`.
 */

declare const window: {
  DataTransfer: new () => { items: { add(file: File): void } };
  DragEvent: new (type: string, init: Record<string, unknown>) => unknown;
  ClipboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
  workbench: WorkbenchApi;
};

const MARKDOWN = "AGENTS.md";
const IMAGE = "build/icon.png";
const STEP = "tests/fixtures/sample.step";

let app: ElectronApplication;
let page: Page;
let userData: string;
let docsDir: string;
let allFilesDir: string;
let browserDir: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = scratch("explorer");
  // Copies of this repository's README and AGENTS: raw HTML, badge images, GFM tables and
  // hard-wrapped prose to save and diff, which is not something to do to the checkout.
  docsDir = scratch("docs");
  for (const name of ["README.md", "AGENTS.md"]) fs.copyFileSync(path.join(repoRoot, name), path.join(docsDir, name));
  allFilesDir = scratch("all-files");
  fs.mkdirSync(path.join(allFilesDir, "STEP"));
  fs.mkdirSync(path.join(allFilesDir, "node_modules"));
  fs.writeFileSync(path.join(allFilesDir, "node_modules", "existing.txt"), "test-owned dependency");
  fs.writeFileSync(path.join(allFilesDir, ".gitignore"), "/STEP/**\n!/STEP/**/\n*.unsupported\nnode_modules/\n");
  fs.writeFileSync(path.join(allFilesDir, ".DS_Store"), "test-owned metadata");
  fs.writeFileSync(path.join(allFilesDir, "output.unsupported"), Buffer.from([0, 1, 2]));
  fs.copyFileSync(path.join(repoRoot, STEP), path.join(allFilesDir, "STEP", "tom.step"));
  browserDir = scratch("browser");
  ({ app, page } = await launch({ userData }));
  await page.evaluate(() => window.workbench.settings.set({ theme: "dark" }));
  await switchProject(repoRoot);
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, docsDir, allFilesDir, browserDir]) fs.rmSync(dir, { recursive: true, force: true });
});

test("opens a markdown file as a preview, then as source", async () => {
  await newTab("File");
  await shownBody().getByLabel("Filter files").fill(MARKDOWN);
  await page.getByRole("option", { name: MARKDOWN, exact: false }).first().click();
  // Rendered: the heading is an H1, not a line beginning with `#`.
  await expect(page.getByRole("heading", { level: 1, name: "AGENTS.md" })).toBeVisible();
  await shoot("file-markdown-preview.png");
  await page.getByRole("button", { name: "View source" }).click();
  // Monaco, showing the raw text — the `#` the preview ate.
  await expect(page.locator(".view-lines").first()).toContainText("# AGENTS.md");
  await shoot("file-markdown-source.png");
  // Taking the tree back closes the source: back to the preview.
  await page.getByTestId("tree-toggle").click();
  await expect(page.getByRole("heading", { level: 1, name: "AGENTS.md" })).toBeVisible();
});

test("expands three levels of the tree, and keeps them across the remount a new tab is", async () => {
  await newTab("File");
  const folder = (relative: string) => shownBody().locator(`[role="treeitem"][data-path="${relative}"]`);
  // Each level is a lazy `explorer.list`, and each used to be a click that shut the tree
  // instead of opening it once a file was open under any of them.
  await folder("src").click();
  await folder("src/main").click();
  await folder("src/main/integrations").click();
  await expect(folder("src/main/integrations/browser")).toBeVisible();
  await folder("src/main/integrations/pdf").click();
  await shownBody().locator(`[role="treeitem"][data-path="src/main/integrations/pdf/module.mjs"]`).click();
  await expect(page.getByRole("tab", { name: /module\.mjs/ })).toBeVisible();
  await expect(folder("src/main/integrations/pdf")).toBeVisible();
  await folder("src/main").click();
  await expect(folder("src/main/integrations")).toHaveCount(0);
  await folder("src/main").click();
  await expect(folder("src/main/integrations/pdf")).toBeVisible();
  await shoot("file-tree-deep.png");
});

test("copies a relative and an absolute path from a row's context menu", async () => {
  const row = shownBody().locator(`[role="treeitem"][data-path="src/main/integrations/pdf/module.mjs"]`);
  await openContextMenu(row);
  // A file menu has no Copy reference: the paths say it, and a reference inside a file is the
  // viewer's to copy.
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Copy reference" })).toHaveCount(0);
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Move to Trash" })).toBeVisible();
  await pick("Copy relative path");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("src/main/integrations/pdf/module.mjs");
  await openContextMenu(row);
  await pick("Copy path");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(fs.realpathSync(path.join(repoRoot, "src/main/integrations/pdf/module.mjs")));
  // The close button is the tab's sibling, out of the accessibility tree (Delete is its keyboard twin).
  await page.locator('[data-tab-strip] button[aria-label="Close module.mjs"]').click();
});

test("opens an image with its dimensions, and reveals it in the tree", async () => {
  await newTab("File");
  await openFromTree(IMAGE);
  await expect(page.locator(`img[alt="icon.png"]`)).toBeVisible();
  // The footer reports the real pixels.
  await expect(page.getByText(/\d+ × \d+ · /)).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "icon.png" })).toHaveAttribute("aria-selected", "true");
  await shoot("file-image.png");
});

test("runs a command in a terminal tab, and replays its scrollback exactly once on reattach", async () => {
  await newTab("Terminal");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  // The window's first terminal, asked for from the `+` menu, takes the keyboard even though
  // its code (xterm) is a chunk of its own that may land after the focus request settled.
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  // A login shell reads the person's profile before it prompts; typing before then is echoed
  // twice. And the command and its output differ, or the echo alone would pass.
  await settleTerminal(page);
  await page.locator(".xterm-helper-textarea").click();
  await page.keyboard.type("echo elastic-$((6 * 7))");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("elastic-42", { timeout: 20_000 });
  await shoot("terminal.png");
  const seen = occurrences(await page.locator(".xterm-rows").innerText(), "elastic-42");
  // Switching away unmounts the xterm and the pty keeps running; coming back writes the
  // buffered scrollback and subscribes to the live stream, and `terminal.data`'s sequence
  // number is what stops the two overlapping.
  await page.getByRole("tab").first().click();
  await expect(page.locator(".xterm-screen")).toHaveCount(0);
  await page.getByRole("tab", { name: /Terminal/ }).click();
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await settleTerminal(page);
  expect(occurrences(await page.locator(".xterm-rows").innerText(), "elastic-42")).toBe(seen);
});

test("persists the strip across a reload", async () => {
  const before = await page.getByRole("tab").count();
  expect(before).toBeGreaterThan(1);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // A reload starts on the new-session screen; the strip is the owning session's.
  await switchProject(repoRoot);
  await expect(page.getByRole("tab")).toHaveCount(before);
});

test("edits a markdown file in place and saves only the lines it changed", async () => {
  await switchProject(docsDir);
  await newTab("File");
  await shownBody().getByLabel("Filter files").fill("AGENTS.md");
  await page.getByRole("option", { name: "AGENTS.md", exact: false }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "AGENTS.md" })).toBeVisible();
  // Scoped to the explorer: the composer is a ProseMirror editor as well.
  await page.getByTestId("explorer").locator(".ProseMirror p").first().click();
  await page.keyboard.type("Edited in the app. ");
  await expect(page.getByLabel("Unsaved changes")).toBeVisible();
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByLabel("Unsaved changes")).toHaveCount(0);
  // The edited paragraph is re-printed; every other line of the document is exactly the line it was.
  const before = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
  const after = fs.readFileSync(path.join(docsDir, "AGENTS.md"), "utf8");
  expect(after.replace(/\s+/g, " ")).toContain("Edited in the app.");
  const editedBlock = before.split("\n\n")[1]!;
  const untouched = before.split("\n").filter((line) => line.trim() !== "" && !editedBlock.includes(line));
  expect(untouched.length).toBeGreaterThan(100);
  for (const line of untouched) expect(after, `a line nobody edited was rewritten: ${line}`).toContain(line);
});

test("makes a folder from the tree's menu, renames it, and moves it to the trash", async () => {
  const tree = page.getByTestId("explorer").getByRole("tree");
  const folder = (name: string) => shownBody().locator(`[role="treeitem"][data-path="${name}"]`);
  await shownBody().getByLabel("Filter files").fill("");
  await expect(folder("README.md")).toBeVisible();
  // The empty space under the rows is the root: New folder, typed in place.
  await openContextMenu(tree, { x: 40, y: 200 });
  await pick("New folder");
  await expect(page.getByLabel("New folder name")).toBeFocused();
  await page.getByLabel("New folder name").fill("parts");
  await page.keyboard.press("Enter");
  await expect(folder("parts")).toBeVisible();
  expect(fs.statSync(path.join(docsDir, "parts")).isDirectory()).toBe(true);
  await openContextMenu(folder("parts"));
  await pick("Rename");
  await expect(page.getByLabel("Rename parts")).toBeFocused();
  await page.getByLabel("Rename parts").fill("assemblies");
  await page.keyboard.press("Enter");
  await expect(folder("assemblies")).toBeVisible();
  expect(fs.existsSync(path.join(docsDir, "parts"))).toBe(false);
  // A file inside it, from the folder's own menu, opens once it is made.
  await openContextMenu(folder("assemblies"));
  await pick("New file");
  await page.getByLabel("New file name").fill("notes.md");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: /notes\.md/ })).toBeVisible();
  expect(fs.readFileSync(path.join(docsDir, "assemblies", "notes.md"), "utf8")).toBe("");
  // F2 renames the focused row (a click focuses it), and Escape leaves it alone.
  await folder("assemblies/notes.md").click();
  await expect(folder("assemblies/notes.md")).toBeFocused();
  await page.keyboard.press("F2");
  await expect(page.getByLabel("Rename notes.md")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Rename notes.md")).toHaveCount(0);
  // Move to Trash: no dialog, the row goes, and so does the tab that showed the file.
  await openContextMenu(folder("assemblies"));
  await pick("Move to Trash");
  await expect(folder("assemblies")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /notes\.md/ })).toHaveCount(0);
  await expect.poll(() => fs.existsSync(path.join(docsDir, "assemblies"))).toBe(false);
});

test("lists every file, refreshes ignored folders and opens unknown types as Not supported", async () => {
  await switchProject(allFilesDir);
  await newTab("File");
  const entry = (file: string) => shownBody().locator(`[role="treeitem"][data-path="${file}"]`);
  await expect(entry(".DS_Store")).toBeVisible();
  await expect(entry("output.unsupported")).toBeVisible();
  await entry("STEP").click();
  await expect(entry("STEP/tom.step")).toBeVisible();
  // Both recursive output watching and direct dependency-directory watching refresh rows.
  fs.copyFileSync(path.join(repoRoot, STEP), path.join(allFilesDir, "STEP", "new.step"));
  await expect(entry("STEP/new.step")).toBeVisible();
  await entry("node_modules").click();
  await expect(entry("node_modules/existing.txt")).toBeVisible();
  fs.writeFileSync(path.join(allFilesDir, "node_modules", "new.unsupported"), Buffer.from([0, 3, 4]));
  await expect(entry("node_modules/new.unsupported")).toBeVisible();
  fs.unlinkSync(path.join(allFilesDir, "node_modules", "new.unsupported"));
  await expect(entry("node_modules/new.unsupported")).toHaveCount(0);
  await shownBody().getByLabel("Filter files").fill("output.unsupported");
  await page.getByRole("option", { name: "output.unsupported", exact: false }).click();
  await expect(page.getByText("Not supported", { exact: true })).toBeVisible();
});

/**
 * A browser tab is a native page main owns. The explorer and the app tools reach the same
 * one through IPC; it survives tab and session switches, belongs to its session alone, puts a
 * screenshot and a selection in the prompt, and is gone when its tab closes.
 */
test("a browser tab's native page is shared by the explorer and the app tools, per session", async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><title>Persistent browser</title><label>Name <input id="name"></label><p>Native page fixture</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    const project = await chooseDirectory(app, browserDir);
    const [sessionA, sessionB] = await page.evaluate(async (projectId) => [
      (await window.workbench.sessions.create({ projectId, agentId: "claude-code", gitMode: "checkout" })).id,
      (await window.workbench.sessions.create({ projectId, agentId: "claude-code", gitMode: "checkout" })).id,
    ], project.id);
    await page.locator(`[data-session-row="${sessionA}"]`).click();
    await expect(page.locator("[data-explorer-ready=true]")).toBeVisible();
    await page.getByRole("button", { name: "Toggle explorer" }).click();
    await newTab("Browser");
    await page.getByRole("textbox", { name: "Address" }).fill(origin);
    await page.getByRole("textbox", { name: "Address" }).press("Enter");
    const tabId = (await page.locator("[data-browser-target]").getAttribute("data-browser-target"))!;
    const scope = { sessionId: sessionA!, projectId: project.id, root: null, tabId };
    const metadata = () => page.evaluate((target) => window.workbench.browser.metadata(target), scope);
    await expect.poll(async () => (await metadata()).url).toBe(origin);
    await expect.poll(async () => (await metadata()).visible).toBe(true);
    const nativeId = await app.evaluate(async ({ webContents }, url) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
      await target.executeJavaScript("document.getElementById('name').focus()");
      return target.id;
    }, origin);
    await page.evaluate((target) => window.workbench.browser.input({ ...target, input: { action: "type", text: "Still here" } }), scope);
    const fieldValue = () => app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("document.getElementById('name').value"), nativeId);
    await expect.poll(fieldValue).toBe("Still here");
    // Hidden behind another tab, and kept.
    await newTab("File");
    await expect.poll(async () => (await metadata()).visible).toBe(false);
    await page.getByRole("tab", { name: /127\.0\.0\.1/ }).click();
    await expect.poll(fieldValue).toBe("Still here");
    // Another session in the same directory sees none of it.
    await page.locator(`[data-session-row="${sessionB}"]`).click();
    await expect(page.getByRole("tab", { name: /127\.0\.0\.1/ })).toHaveCount(0);
    await expect.poll(async () => (await metadata()).visible).toBe(false);
    await expect(page.evaluate((target) => window.workbench.browser.metadata(target), { ...scope, sessionId: sessionB! })).rejects.toThrow();
    await page.locator(`[data-session-row="${sessionA}"]`).click();
    await expect(page.locator(`[data-browser-target="${tabId}"]`)).toBeVisible();
    await expect.poll(fieldValue).toBe("Still here");

    // A screenshot and a selection of the page go to the prompt; nothing is sent.
    const composer = page.getByPlaceholder("Do anything", { exact: true });
    await composer.fill("Keep this draft");
    await page.getByRole("button", { name: "Add page screenshot to prompt" }).click();
    const image = page.locator('[data-composer] img[alt="browser-page.png"]').first();
    await expect.poll(() => image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(200);
    await app.evaluate(async ({ webContents }, id) => {
      await webContents.fromId(id)!.executeJavaScript("{const r=document.createRange();r.selectNodeContents(document.querySelector('p'));const s=window.getSelection();s.removeAllRanges();s.addRange(r);}");
    }, nativeId);
    await page.getByRole("button", { name: "Add selected text to prompt" }).click();
    await expect(page.locator("[data-composer]").getByText("browser-selection.txt")).toBeVisible();
    await expect(composer).toContainText("Keep this draft");
    await expect(page.locator("[data-turn][data-role=user]")).toHaveCount(0);
    await shoot("browser-app-shell.png");
    // Closing the tab ends the native page.
    // Delete on the tab: its close button is a sibling out of the accessibility tree.
    await page.getByRole("tab", { name: /127\.0\.0\.1/ }).focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => app.evaluate(({ webContents }, id) => !!webContents.fromId(id), nativeId)).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Select the fixture's session for `directory` (made on first use) and open its explorer. */
async function switchProject(directory: string) {
  const session = await selectFixtureSession(app, page, directory);
  if (!(await page.getByTestId("explorer").isVisible())) {
    await page.getByRole("button", { name: "Toggle explorer" }).click();
  }
  await expect(page.getByTestId("explorer")).toBeVisible();
  return session;
}

/** Open a path through the tree's filter — the way a person would. */
async function openFromTree(target: string) {
  const filter = shownBody().getByLabel("Filter files");
  await filter.fill(target);
  await page.getByRole("option", { name: target, exact: false }).first().click();
  await expect(page.getByRole("tablist", { name: "Explorer tabs" }).locator('[role="tab"][aria-selected="true"]')).toHaveAttribute("data-tab-path", target);
  if (await filter.isVisible()) await filter.fill("");
}

/**
 * macOS opens a context menu on right-button down, and during its entry animation a clamped
 * popup can overlap the pointer: Radix reads a release over an item as drag-selection
 * (including Move to Trash). Let the popup's animations finish before the release.
 */
async function openContextMenu(target: Locator, position?: { x: number; y: number }) {
  if (process.platform !== "darwin") {
    await target.click({ button: "right", ...(position ? { position } : {}) });
  } else {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + (position?.x ?? box.width / 2), box.y + (position?.y ?? box.height / 2));
    await page.mouse.down({ button: "right" });
    try {
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await menu.evaluate((node) => Promise.all(node.getAnimations({ subtree: true })
        .map((animation: { finished: Promise<unknown> }) => animation.finished.catch(() => {}))));
    } finally {
      await page.mouse.up({ button: "right" });
    }
  }
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Pick an item from the open menu, and wait for the menu to be gone (its exit animation included). */
async function pick(item: string) {
  await page.getByRole("menu").getByRole("menuitem", { name: item }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The explorer pane, not the window: the rest of the window belongs to other specs. */
async function shoot(name: string) {
  await shootInto(page.getByTestId("explorer"), name, test.info());
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The tab body on screen: recently used tabs stay mounted behind it (`KEEP_ALIVE`), hidden and inert. */
function shownBody() {
  return page.locator("#explorer-tabpanel [data-tab-body]:not([inert])");
}

/** `+` is a menu of the tab kinds; a closing Radix menu can swallow the next click, so wait it out. */
async function newTab(label: "File" | "Browser" | "Terminal") {
  await newTabIn(page, label);
  if (label === "File") await expect(page.getByText("No file open", { exact: true })).toBeVisible();
}
