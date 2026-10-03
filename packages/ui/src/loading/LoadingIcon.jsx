import { createElement, useEffect, useState } from "react";

/*
 * elastic's mark as a loading glyph: a band around three pegs, in the text colour. While
 * something loads the band winds itself around the pegs, then unwinds from where it
 * started. Pure SVG (SMIL), no raster and no animation loop in JS. The band's geometry is
 * the app icon's (scripts/brand-mark.mjs) at a small scale, centred in the box.
 */

const PEG_R = 7;
const BAND_W = 9;
const SAG = 0.08;

/** Clockwise on screen, like the icon; the band's reach past them is centred at 50,50. */
const PEGS = [[24, 35], [76, 25], [48, 75]];

const f = (n) => n.toFixed(2);

function bandPath(pegs, d) {
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
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const k = (Math.hypot(b[0] - a[0], b[1] - a[1]) * SAG) / Math.hypot(cx - mx, cy - my);
    path += `Q${f(mx + (cx - mx) * k)},${f(my + (cy - my) * k)} ${f(b[0])},${f(b[1])}`;
    const c = at(next, normals[(i + 1) % pegs.length]);
    path += `A${d},${d} 0 0 1 ${f(c[0])},${f(c[1])}`;
  });
  return `${path}Z`;
}

const DURATION = "2.2s";
const EASE = "0.45 0 0.25 1";

/** Draw the band on over the first half, then take it off from its start over the second. */
function wind() {
  const common = { keyTimes: "0;0.5;1", keySplines: `${EASE};${EASE}`, calcMode: "spline", dur: DURATION, repeatCount: "indefinite" };
  return [
    createElement("animate", { key: "array", attributeName: "stroke-dasharray", values: "0 100;100 100;100 100", ...common }),
    createElement("animate", { key: "offset", attributeName: "stroke-dashoffset", values: "0;0;-100", ...common }),
  ];
}

/**
 * Decorative: the surrounding loading status owns the accessible announcement. It animates
 * unless the system asks for reduced motion, the page is hidden, the host passes
 * `reducedMotion` (an app's own motion setting), or `active` is false (a still pose, e.g.
 * while waiting on a permission).
 */
export default function LoadingIcon({ active = true, size = 96, className = "", reducedMotion = false }) {
  const [animateOk, setAnimateOk] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAnimateOk(!motion.matches && !document.hidden);
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const moving = active && animateOk && !reducedMotion;
  const center = PEG_R + BAND_W / 2;
  const pegs = PEGS.map((peg, i) =>
    createElement("circle", { key: i, cx: peg[0], cy: peg[1], r: PEG_R - 1, fill: "currentColor", opacity: 0.45 }),
  );
  const band = createElement(
    "path",
    {
      d: bandPath(PEGS, center),
      fill: "none",
      stroke: "currentColor",
      strokeWidth: BAND_W,
      strokeLinejoin: "round",
      strokeLinecap: "round",
      pathLength: 100,
    },
    moving ? wind() : null,
  );

  // Keep this tiny public entry usable without a JSX transform.
  return createElement(
    "svg",
    {
      viewBox: "0 0 100 100",
      width: size,
      height: size,
      "aria-hidden": true,
      focusable: "false",
      "data-loading-icon": moving ? "moving" : "still",
      className: `shrink-0 select-none ${className}`,
    },
    pegs,
    band,
  );
}
