/** Renders docs/brand/variants.png: every mark variant at 320, 128, 64, 32 and 16 px on light and dark. `node scripts/brand-variants.mjs` */
import { chromium } from "@playwright/test";
import { VARIANTS, markArt, TILE } from "./brand-mark.mjs";
const svg = (v, i, px) => `<svg width="${px}" height="${px}" viewBox="0 0 ${TILE} ${TILE}">${markArt({ ...v.art, id: "v" + i + px })}</svg>`;
const cols = VARIANTS.map((v, i) => `<div class="col"><div class="big">${svg(v, i, 320)}</div><div class="row">${[128,64,32,16].map(p=>svg(v,i,p)).join("")}</div><div class="row dark">${[128,64,32,16].map(p=>svg(v,i,p)).join("")}</div><h2>${v.name}</h2><p>${v.note}</p></div>`).join("");
const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;font:14px/1.4 -apple-system,system-ui,sans-serif;background:#f4f2ef;color:#222}#s{display:flex;gap:40px;padding:40px;width:max-content}.col{width:360px}.row{display:flex;gap:16px;align-items:center;padding:16px;background:#fff;border-radius:10px;margin-top:12px}.row.dark{background:#1e1e22}h2{font-size:16px;margin:16px 0 4px}p{margin:0;color:#555}</style><div id=s>${cols}</div>`;
const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
await p.setContent(html); await p.locator("#s").screenshot({ path: new URL("../docs/brand/variants.png", import.meta.url).pathname }); await b.close();
