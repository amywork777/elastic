/**
 * The browser tab behaves as sites expect of a browser (`src/main/browser/policy.ts`): a plain
 * Chrome user agent (Google refuses sign-in to one naming Electron), one storage across chats
 * (a login carries over), and a sign-in pop-up that opens as a real window in that storage.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { chooseDirectory, launch, scratch } from "./launch";

let app: ElectronApplication;
let page: Page;
let server: http.Server;
let origin: string;
let projectId: string;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/login") {
      response.setHeader("set-cookie", "signed=in; Path=/; Max-Age=3600");
      response.end("<title>logged in</title>");
      return;
    }
    if (request.url === "/popup") {
      response.end(`<title>${"popup"}</title><script>document.title = "popup " + document.cookie;</script>`);
      return;
    }
    response.end(`<title>x</title><script>document.title = navigator.userAgent;</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const project = scratch("sites-project");
  fs.writeFileSync(path.join(project, "README.md"), "# Sites\n");
  ({ app, page } = await launch({ userData: scratch("sites") }));
  projectId = (await chooseDirectory(app, project)).id;
});
test.afterAll(async () => {
  await app?.close();
  server?.close();
});

const open = (sessionId: string, tabId: string, url: string) =>
  page.evaluate((args) => window.workbench.browser.ensure(args), { sessionId, projectId, tabId, url });
const title = (sessionId: string, tabId: string) =>
  page.evaluate((args) => window.workbench.browser.metadata(args).then((target) => target.title), { sessionId, projectId, tabId, logs: false });

test("a page sees Chrome, a login in one chat is there in another, and a sized pop-up opens a window", async () => {
  const [chatA, chatB] = await page.evaluate(async (id) => [
    (await window.workbench.sessions.create({ projectId: id, agentId: "claude-code", gitMode: "none" })).id,
    (await window.workbench.sessions.create({ projectId: id, agentId: "claude-code", gitMode: "none" })).id,
  ], projectId);
  await open(chatA, "t1", `${origin}/`);
  await expect.poll(() => title(chatA, "t1")).toContain("Chrome/");
  expect(await title(chatA, "t1")).not.toContain("Electron");

  await open(chatA, "t2", `${origin}/login`);
  await expect.poll(() => title(chatA, "t2")).toBe("logged in");

  const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await open(chatB, "t3", `${origin}/`);
  const popupTitle = await app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url + "/");
    await page!.executeJavaScript(`window.open(${JSON.stringify(url + "/popup")}, "signin", "width=480,height=640"); void 0`, true);
    for (let i = 0; i < 50; i += 1) {
      const popup = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith("/popup"));
      const t = popup?.getTitle();
      if (t && t.startsWith("popup")) return t;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }, origin);
  // The pop-up is its own window, and it carries the login chat-a made.
  expect(popupTitle).toBe("popup signed=in");
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowsBefore + 1);
});
