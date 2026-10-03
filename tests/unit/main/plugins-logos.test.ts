/**
 * Logos for catalog cards without one: where they come from, that only small
 * images are kept, that a miss is remembered, and that nothing is fetched twice.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGO_BYTES, LogoCache, logoSource } from "../../../src/main/plugins/logos";
import type { CatalogEntry, CatalogSource } from "../../../src/shared/plugins";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-logos-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const source = (url: string | null): CatalogSource => ({ marketplace: "/m.json", marketplaceName: "m", name: "p", kind: "git", onDisk: false, codex: false, url });
const entry = (homepage: string | null, url: string | null = null, logo: string | null = null): CatalogEntry => ({
  key: `${homepage}${url}`, name: "p", displayName: "P", description: "", category: null, version: null, homepage, logo,
  compat: { level: "works", label: "Works", detail: "" }, sources: [source(url)], installedId: null,
  publisher: null, verified: false, needs: [], adds: { servers: [], skills: [] }, prompts: [], example: false,
});
const image = (bytes: number, type = "image/png") => new Response(new Uint8Array(bytes), { headers: { "content-type": type } });

describe("where a card's logo comes from", () => {
  it("is the product site's favicon, else the plugin repository owner's avatar, never a catalog's own", () => {
    expect(logoSource(entry("https://linear.app/"))).toBe("https://linear.app/favicon.ico");
    expect(logoSource(entry("https://github.com/makenotion/claude-code-notion-plugin"))).toBe("https://github.com/makenotion.png?size=64");
    expect(logoSource(entry("https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/linear", "https://github.com/anthropics/claude-plugins-official.git"))).toBeNull();
    expect(logoSource(entry(null, "https://github.com/vercel/vercel-plugin.git"))).toBe("https://github.com/vercel.png?size=64");
    expect(logoSource(entry("http://insecure.example"))).toBeNull();
  });
});

describe("the logo cache", () => {
  it("keeps small images, refuses other types and big ones, remembers misses, and fetches each once", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.includes("linear")) return image(100);
      if (text.includes("big")) return image(LOGO_BYTES + 1);
      return new Response("<html>", { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const file = path.join(dir, "logos.json");
    const cache = new LogoCache(file, fetcher);
    const catalog = [entry("https://linear.app/"), entry("https://big.example/"), entry("https://html.example/"), entry("https://has.example/", null, "data:image/png;base64,AA==")];
    const first = cache.fill(catalog);
    expect(first.missing.sort()).toEqual(["https://big.example/favicon.ico", "https://html.example/favicon.ico", "https://linear.app/favicon.ico"]);
    expect(await cache.fetchAll(first.missing)).toBe(true);
    const second = new LogoCache(file, fetcher).fill(catalog);
    expect(second.catalog[0]!.logo).toMatch(/^data:image\/png;base64,/);
    expect(second.catalog[1]!.logo).toBeNull();
    expect(second.catalog[3]!.logo).toBe("data:image/png;base64,AA==");
    // Misses are remembered: nothing left to fetch until they are a week old.
    expect(second.missing).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
