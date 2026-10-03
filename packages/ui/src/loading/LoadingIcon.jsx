import { createElement, useEffect, useState } from "react";

/*
 * elastic's mark as a loading glyph: a pink band around three pegs, and while
 * something loads the pegs drift apart and back so the band stretches and
 * settles. Pure SVG (SMIL), no raster and no animation loop in JS. The band's
 * geometry is the app icon's (scripts/brand-mark.mjs) at a small scale.
 */

const PEG_R = 7;
const BAND_W = 9;
const SAG = 0.08;

/** Rest, then each peg in turn pulled out a little. Clockwise on screen, like the icon. */
const POSES = [
  [[26, 38], [78, 28], [50, 78]],
  [[24, 37], [88, 20], [50, 79]],
  [[26, 38], [78, 28], [50, 78]],
  [[25, 39], [77, 29], [46, 90]],
  [[26, 38], [78, 28], [50, 78]],
];

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

const DURATION = "2.4s";
const SPLINES = POSES.slice(1).map(() => "0.45 0 0.25 1").join(";");
const TIMES = POSES.map((_, i) => (i / (POSES.length - 1)).toFixed(3)).join(";");

function animate(attributeName, values) {
  return createElement("animate", {
    attributeName,
    values: values.join(";"),
    keyTimes: TIMES,
    keySplines: SPLINES,
    calcMode: "spline",
    dur: DURATION,
    repeatCount: "indefinite",
  });
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
  const rest = POSES[0];
  const band = (d, props) =>
    createElement(
      "path",
      { d: bandPath(rest, d), fill: "none", strokeLinejoin: "round", ...props },
      moving ? animate("d", POSES.map((pose) => bandPath(pose, d))) : null,
    );
  const pegs = rest.map((peg, i) =>
    createElement(
      "circle",
      { key: i, cx: peg[0], cy: peg[1], r: PEG_R - 1, fill: "currentColor", opacity: 0.85 },
      moving ? animate("cx", POSES.map((pose) => pose[i][0])) : null,
      moving ? animate("cy", POSES.map((pose) => pose[i][1])) : null,
    ),
  );

  // Keep this tiny public entry usable without the CAD surface's JSX transform.
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
    band(center, { stroke: "var(--brand, #ff6fa3)", strokeWidth: BAND_W }),
    band(PEG_R + 1.5, { stroke: "var(--brand-ink, #d6447e)", strokeWidth: 2.2 }),
  );
}
