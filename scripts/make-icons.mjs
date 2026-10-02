/**
 * Draw elastic's mark: a pink rubber band stretched around three plum pegs on a
 * dot-grid geoboard. The pegs are plugins; the band is the app stretching to fit
 * them. Writes the mark used inside the app and the 1024 px source that
 * electron-builder turns into the packaged .icns and .ico.
 *
 *   npm run icons
 *
 * Colours come from ~/code/taste (warm paper, plum ink, pink accent). Every fill
 * is flat; depth comes from a soft contact shadow and the band's inner edge.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markTarget = path.join(appRoot, "src", "renderer", "assets", "brand", "elastic-mark.svg");
const iconTarget = path.join(appRoot, "build", "icon.png");

const CANVAS_PX = 1024;
/** The tile's side, Apple's 824 of 1024. All geometry below is in tile units. */
const TILE = 824;

const PAPER = "#f7f3ee";
const PLUM = "#3a2a47";
const PLUM_LIGHT = "#5e4b6e";
const PINK = "#ff6fa3";
const PINK_INK = "#d6447e";
const PINK_LIGHT = "#ffb0cb";

const GRID = [172, 292, 412, 532, 652];
/** Clockwise on screen, so (dy, -dx) is each edge's outward normal. */
const PEGS = [
  [172, 292],
  [652, 172],
  [532, 652],
];
const PEG_R = 40;
const BAND_W = 54;

/**
 * A superellipse, |x/a|^n + |y/a|^n = 1, sampled as a path. macOS's icon corner
 * is a continuous curve rather than a circular arc; n = 5 is close to Apple's.
 */
function squirclePath(size, n = 5, samples = 256) {
  const a = size / 2;
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const x = Math.sign(cos) * a * Math.abs(cos) ** (2 / n);
    const y = Math.sign(sin) * a * Math.abs(sin) ** (2 / n);
    points.push(`${(a + x).toFixed(2)},${(a + y).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

/** The pegs' outline pushed out by `d`: straight runs joined by arcs around each peg. */
function bandPath(d) {
  const normals = PEGS.map((p, i) => {
    const q = PEGS[(i + 1) % PEGS.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
  });
  const at = (p, n) => `${(p[0] + n[0] * d).toFixed(2)},${(p[1] + n[1] * d).toFixed(2)}`;
  let path = `M${at(PEGS[0], normals[0])}`;
  PEGS.forEach((p, i) => {
    const next = PEGS[(i + 1) % PEGS.length];
    path += `L${at(next, normals[i])}`;
    path += `A${d},${d} 0 0 1 ${at(next, normals[(i + 1) % PEGS.length])}`;
  });
  return `${path}Z`;
}

function art() {
  const isPeg = (x, y) => PEGS.some(([px, py]) => px === x && py === y);
  const dots = GRID.flatMap((y) =>
    GRID.filter((x) => !isPeg(x, y)).map((x) => `<circle cx="${x}" cy="${y}" r="10"/>`),
  ).join("");
  const center = BAND_W / 2 + PEG_R;
  const pegs = (fill, dx = 0, dy = 0, r = PEG_R) =>
    PEGS.map(([x, y]) => `<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="${fill}"/>`).join("");
  return (
    `<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feGaussianBlur stdDeviation="9"/></filter>` +
    `<clipPath id="tile"><path d="${squirclePath(TILE)}"/></clipPath></defs>` +
    `<path d="${squirclePath(TILE)}" fill="${PAPER}"/>` +
    `<g clip-path="url(#tile)">` +
    `<g fill="${PLUM}" opacity="0.2">${dots}</g>` +
    `<g opacity="0.22" filter="url(#soft)" transform="translate(10 18)">` +
    `<path d="${bandPath(center)}" fill="none" stroke="${PLUM}" stroke-width="${BAND_W}"/>` +
    `${pegs(PLUM)}</g>` +
    pegs(PLUM) +
    pegs(PLUM_LIGHT, -11, -11, 13) +
    `<path d="${bandPath(center)}" fill="none" stroke="${PINK}" stroke-width="${BAND_W}"/>` +
    `<path d="${bandPath(PEG_R + 6)}" fill="none" stroke="${PINK_INK}" stroke-width="12"/>` +
    `<path d="${bandPath(PEG_R + BAND_W - 13)}" fill="none" stroke="${PINK_LIGHT}" stroke-width="7"/>` +
    `</g>` +
    `<path d="${squirclePath(TILE)}" fill="none" stroke="${PLUM}" stroke-opacity="0.1" stroke-width="4"/>`
  );
}

const markSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}"><title>elastic</title>${art()}</svg>\n`;
fs.writeFileSync(markTarget, markSvg);

const inset = (CANVAS_PX - TILE) / 2;
const iconSvg =
  `<svg id="icon" xmlns="http://www.w3.org/2000/svg" width="${CANVAS_PX}" height="${CANVAS_PX}"` +
  ` viewBox="0 0 ${CANVAS_PX} ${CANVAS_PX}"><g transform="translate(${inset} ${inset})">${art()}</g></svg>`;

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
    `${path.relative(appRoot, iconTarget)} (${CANVAS_PX}x${CANVAS_PX})`,
);
