/**
 * elastic's mark, drawn as geometry so the app icon, the in-app mark, the
 * wordmark and the variants sheet all come from one place.
 *
 * The idea: a pink rubber band stretched around plugin pegs. The band's sides
 * bow inward, so it reads as elastic under tension rather than a triangle.
 * Colours are Amy's taste "tool" route (~/code/taste/kit/tokens/tool.css): a
 * near-black graphite tile, warm paper pegs, pink band with its darker ink for
 * the inner edge. Every fill is flat; depth is a contact shadow and the band's
 * inner edge, never a gradient or a glow.
 */

export const TILE = 824;

export const PALETTE = {
  graphite: "#17161a",
  graphiteEdge: "#2a2830",
  paper: "#f7f3ee",
  paperShade: "#d9d2c9",
  plum: "#3a2a47",
  pink: "#ff6fa3",
  pinkInk: "#d6447e",
  pinkLight: "#ffb0cb",
};

/** |x/a|^n + |y/a|^n = 1, sampled. macOS's icon corner is this curve, not a circular arc. */
export function squirclePath(size, n = 5, samples = 256) {
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

const f = (n) => n.toFixed(2);

/**
 * The pegs' outline pushed out by `d`, pegs listed clockwise on screen. Each
 * straight run between pegs bows toward the centre by `sag` of its length,
 * which is what makes the band look pulled taut and springy.
 */
export function bandPath(pegs, d, sag = 0) {
  const cx = pegs.reduce((s, p) => s + p[0], 0) / pegs.length;
  const cy = pegs.reduce((s, p) => s + p[1], 0) / pegs.length;
  const normals = pegs.map((p, i) => {
    const q = pegs[(i + 1) % pegs.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
  });
  const at = (p, n) => [p[0] + n[0] * d, p[1] + n[1] * d];
  const start = at(pegs[0], normals[0]);
  let path = `M${f(start[0])},${f(start[1])}`;
  pegs.forEach((p, i) => {
    const next = pegs[(i + 1) % pegs.length];
    const a = at(p, normals[i]);
    const b = at(next, normals[i]);
    if (sag) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const toward = Math.hypot(cx - mx, cy - my);
      const k = (len * sag) / toward;
      path += `Q${f(mx + (cx - mx) * k)},${f(my + (cy - my) * k)} ${f(b[0])},${f(b[1])}`;
    } else {
      path += `L${f(b[0])},${f(b[1])}`;
    }
    const n2 = normals[(i + 1) % pegs.length];
    const c = at(next, n2);
    path += `A${d},${d} 0 0 1 ${f(c[0])},${f(c[1])}`;
  });
  return `${path}Z`;
}

/**
 * One mark. `tile` is "dark" or "paper"; `pegs` clockwise; `sag` bows the band.
 * Returns the SVG body in TILE units (no <svg> wrapper).
 */
export function markArt({ tile = "dark", pegs, pegR = 46, bandW = 62, sag = 0.07, grid = true, id = "m" }) {
  const P = PALETTE;
  const dark = tile === "dark";
  const bg = dark ? P.graphite : P.paper;
  const dotFill = dark ? P.paper : P.plum;
  const pegFill = dark ? P.paper : P.plum;
  const pegShade = dark ? P.paperShade : "#5e4b6e";
  const center = bandW / 2 + pegR;
  const GRID = [172, 292, 412, 532, 652];
  const near = (x, y) => pegs.some(([px, py]) => Math.hypot(px - x, py - y) < 70);
  const dots = grid
    ? GRID.flatMap((y) => GRID.filter((x) => !near(x, y)).map((x) => `<circle cx="${x}" cy="${y}" r="9"/>`)).join("")
    : "";
  const pegCircles = (fill, dx = 0, dy = 0, r = pegR) =>
    pegs.map(([x, y]) => `<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="${fill}"/>`).join("");
  const shape = squirclePath(TILE);
  return (
    `<defs><filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feGaussianBlur stdDeviation="${dark ? 14 : 9}"/></filter>` +
    `<clipPath id="${id}-tile"><path d="${shape}"/></clipPath></defs>` +
    `<path d="${shape}" fill="${bg}"/>` +
    `<g clip-path="url(#${id}-tile)">` +
    `<g fill="${dotFill}" opacity="${dark ? 0.16 : 0.2}">${dots}</g>` +
    `<g opacity="${dark ? 0.55 : 0.22}" filter="url(#${id}-soft)" transform="translate(12 22)">` +
    `<path d="${bandPath(pegs, center, sag)}" fill="none" stroke="#000" stroke-width="${bandW}"/>` +
    `${pegCircles("#000")}</g>` +
    pegCircles(pegFill) +
    pegCircles(pegShade, 9, 11, pegR - 14) +
    pegCircles(pegFill, -4, -5, pegR - 16) +
    `<path d="${bandPath(pegs, center, sag)}" fill="none" stroke="${P.pink}" stroke-width="${bandW}" stroke-linejoin="round"/>` +
    `<path d="${bandPath(pegs, pegR + 7, sag)}" fill="none" stroke="${P.pinkInk}" stroke-width="14" stroke-linejoin="round"/>` +
    `<path d="${bandPath(pegs, pegR + bandW - 14, sag)}" fill="none" stroke="${P.pinkLight}" stroke-width="8" stroke-linejoin="round" opacity="0.9"/>` +
    `</g>` +
    `<path d="${shape}" fill="none" stroke="${dark ? "#ffffff" : P.plum}" stroke-opacity="${dark ? 0.16 : 0.1}" stroke-width="4"/>`
  );
}

/**
 * Pegs moved (and scaled by `scale` about their centre) so the band is centred
 * in the tile. The band reaches the same distance past every peg and its sides
 * bow inward, so centring the pegs' box centres the band.
 */
export function centred(pegs, { scale = 1 } = {}) {
  const xs = pegs.map((p) => p[0]);
  const ys = pegs.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pegs.map(([x, y]) => [Math.round(TILE / 2 + (x - cx) * scale), Math.round(TILE / 2 + (y - cy) * scale)]);
}

/** The variants on the sheet (docs/brand/variants.png). The first is the one in use. */
export const VARIANTS = [
  {
    name: "tension",
    note: "Dark tile; the right peg sits far out, so the band is visibly pulled and its sides bow in.",
    art: { tile: "dark", pegs: centred([[200, 300], [700, 210], [430, 650]], { scale: 0.92 }), sag: 0.08 },
  },
  {
    name: "stretch",
    note: "Two pegs on the diagonal; the band is a long loop with a pinched waist. Simplest at 16 px, least about plugins.",
    art: { tile: "dark", pegs: [[230, 594], [594, 230]], pegR: 58, bandW: 74, sag: 0.1, grid: false },
  },
  {
    name: "geoboard-paper",
    note: "The previous mark, sharpened: paper tile, three pegs. Friendly, but pale beside Codex and Claude in a dark Dock.",
    art: { tile: "paper", pegs: [[172, 292], [652, 172], [532, 652]], sag: 0.05 },
  },
];

export const CHOSEN = VARIANTS[0];
