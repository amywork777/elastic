/**
 * Writes elastic's mark (scripts/brand-mark.mjs) as the in-app SVG and as the
 * 1024 px `build/icon.png` that electron-builder turns into the .icns and .ico.
 *
 *   npm run icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { CHOSEN, TILE, markArt } from "./brand-mark.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markTarget = path.join(appRoot, "src", "renderer", "assets", "brand", "elastic-mark.svg");
const iconTarget = path.join(appRoot, "build", "icon.png");

const CANVAS_PX = 1024;

const art = markArt({ ...CHOSEN.art, id: "elastic" });
fs.writeFileSync(
  markTarget,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}"><title>elastic</title>${art}</svg>\n`,
);

const inset = (CANVAS_PX - TILE) / 2;
const iconSvg =
  `<svg id="icon" xmlns="http://www.w3.org/2000/svg" width="${CANVAS_PX}" height="${CANVAS_PX}"` +
  ` viewBox="0 0 ${CANVAS_PX} ${CANVAS_PX}"><g transform="translate(${inset} ${inset})">${art}</g></svg>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: CANVAS_PX, height: CANVAS_PX } });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}` +
      `svg{display:block}</style><body>${iconSvg}</body>`,
  );
  const buffer = await page.locator("#icon").screenshot({ omitBackground: true, scale: "device" });
  fs.mkdirSync(path.dirname(iconTarget), { recursive: true });
  fs.writeFileSync(iconTarget, buffer);
} finally {
  await browser.close();
}

console.log(
  `make-icons: wrote ${path.relative(appRoot, markTarget)} and ` +
    `${path.relative(appRoot, iconTarget)} (${CANVAS_PX}x${CANVAS_PX}, "${CHOSEN.name}")`,
);
