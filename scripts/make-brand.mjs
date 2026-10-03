/**
 * Renders the elastic wordmark into `resources/brand/` (committed): the mark
 * (scripts/brand-mark.mjs) beside the word "elastic" in the system sans at
 * semibold, light and dark, 1x and 2x. The README and the docs use these.
 * Inside the app the sidebar draws the same lockup live (`Wordmark.tsx`).
 *
 *   npm run brand
 *
 * The word is set in the platform UI face (SF Pro on macOS), the same face the
 * app's chrome uses, so the lockup matches the window it sits in. Re-render on
 * a Mac to get the committed look.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { CHOSEN, TILE, markArt } from "./brand-mark.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = path.join(appRoot, "resources", "brand");

const MARK_PX = 96;
const WORD_PX = 76;

const lockup = (ink) => `<div id="lockup" style="display:inline-flex;align-items:center;gap:22px;padding:12px 18px 12px 12px;">
  <svg width="${MARK_PX}" height="${MARK_PX}" viewBox="0 0 ${TILE} ${TILE}">${markArt({ ...CHOSEN.art, id: "w" })}</svg>
  <span style="font:600 ${WORD_PX}px/1 -apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;letter-spacing:-0.035em;color:${ink};padding-bottom:6px">elastic</span>
</div>`;

fs.mkdirSync(brandDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 900, height: 300 } });
    for (const [variant, ink] of [
      ["light", "#0a0a0a"],
      ["dark", "#f5f5f5"],
    ]) {
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>${lockup(ink)}`);
      const suffix = scale === 2 ? "@2x" : "";
      const out = path.join(brandDir, `elastic-wordmark-${variant}${suffix}.png`);
      fs.writeFileSync(out, await page.locator("#lockup").screenshot({ omitBackground: true }));
      console.log(`make-brand: wrote ${path.relative(appRoot, out)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
