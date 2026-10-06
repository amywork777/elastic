import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PreviewServer } from "@main/preview/server";

/**
 * The live preview's server: a project's folder at a private loopback address, so an agent's
 * HTML loads with its relative CSS, scripts and modules. It serves that folder and nothing else.
 */
let root: string;
let outside: string;
let server: PreviewServer;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-root-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-outside-")));
  fs.mkdirSync(path.join(root, "site"));
  fs.writeFileSync(path.join(root, "site", "index.html"), "<link rel=stylesheet href=style.css><h1>Hi</h1>");
  fs.writeFileSync(path.join(root, "site", "style.css"), "h1{color:red}");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const x = 1;");
  fs.writeFileSync(path.join(outside, "secret.txt"), "nope");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
  server = new PreviewServer();
});
afterEach(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const get = (url: string) => fetch(url).then(async (response) => ({ status: response.status, type: response.headers.get("content-type"), body: await response.text() }));

describe("PreviewServer", () => {
  it("serves a file and its neighbours from a loopback address private to the folder", async () => {
    const url = await server.urlFor(root, "site/index.html");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/site\/index\.html$/);
    expect(await get(url)).toMatchObject({ status: 200, type: "text/html; charset=utf-8", body: expect.stringContaining("<h1>Hi</h1>") });
    expect(await get(url.replace("index.html", "style.css"))).toMatchObject({ status: 200, type: "text/css; charset=utf-8" });
    expect(await get(url.replace("site/index.html", "app.mjs"))).toMatchObject({ status: 200, type: "text/javascript; charset=utf-8" });
    // A folder is its index.
    expect((await get(url.replace("index.html", ""))).body).toContain("<h1>Hi</h1>");
  });

  it("gives the same folder the same address, and another folder another", async () => {
    const a = await server.urlFor(root, "site/index.html");
    const b = await server.urlFor(root, "app.mjs");
    expect(new URL(a).pathname.split("/")[1]).toBe(new URL(b).pathname.split("/")[1]);
    const other = await server.urlFor(outside, "secret.txt");
    expect(new URL(other).pathname.split("/")[1]).not.toBe(new URL(a).pathname.split("/")[1]);
  });

  it("refuses anything outside the folder: climbing, a link out, an unknown address", async () => {
    const url = await server.urlFor(root, "site/index.html");
    const base = url.slice(0, url.indexOf("/site/"));
    expect((await get(`${base}/../${path.basename(outside)}/secret.txt`)).status).toBe(404);
    expect((await get(`${base}/%2e%2e/secret.txt`)).status).toBe(404);
    expect((await get(`${base}/link.txt`)).status).toBe(404);
    expect((await get(`${new URL(url).origin}/${"0".repeat(32)}/site/index.html`)).status).toBe(404);
    expect((await get(`${base}/missing.html`)).status).toBe(404);
  });
});
