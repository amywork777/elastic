/**
 * Click-to-prompt's page side (`docs/browser.md`, "Pick an element"). Main serializes these into
 * the page's isolated world (`PICKER_SOURCE`), where the page's own scripts can neither see nor
 * call them, and awaits one pick at a time. Pure DOM, no imports: what is serialized is exactly
 * these function bodies, so each refers only to the others here and to the page's globals.
 */

export type PickRect = { x: number; y: number; width: number; height: number };

export type Pick = {
  rect: PickRect;
  viewport: { width: number; height: number };
  html: string;
  selector: string;
  tag: string;
  size: { width: number; height: number };
};

/** A selector that finds `element` again: its id when unique, else a path from the nearest unique ancestor. */
export function cssSelector(element: Element): string {
  const doc = element.ownerDocument;
  const unique = (selector: string) => {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  if (element.id && unique(`#${CSS.escape(element.id)}`)) return `#${CSS.escape(element.id)}`;
  const segments: string[] = [];
  let node: Element | null = element;
  while (node && node !== doc.documentElement) {
    if (node !== element && node.id && unique(`#${CSS.escape(node.id)}`)) {
      segments.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const classes = Array.from(node.classList).slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("");
    let segment = tag + classes;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((child) => child.tagName === node!.tagName);
      if (same.length > 1) segment += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    segments.unshift(segment);
    const candidate = segments.join(" > ");
    if (unique(candidate) && doc.querySelector(candidate) === element) return candidate;
    node = parent;
  }
  return segments.join(" > ");
}

/** The element's HTML for the prompt: no scripts or styles, whitespace collapsed, at most `max` characters. */
export function trimHtml(html: string, max = 4096): string {
  const clean = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** The crop: padded by `pad`, clamped to the viewport, rounded; null when none of it is visible. */
export function clampRect(rect: PickRect, viewport: { width: number; height: number }, pad = 4): PickRect | null {
  const left = Math.max(0, Math.floor(rect.x - pad));
  const top = Math.max(0, Math.floor(rect.y - pad));
  const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + pad));
  const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + pad));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Pick mode in this world. A full-page layer of our own (a closed shadow root, so the page can
 * neither style nor read it) takes every pointer event while picking, so nothing under it is
 * clicked: not the page's controls, not a frame's. Hovering outlines the element under the
 * pointer; a click picks it; Esc ends. Every key is kept from the page meanwhile. Only the
 * person's own input counts (`trusted`, `event.isTrusted` unless a test stands in): a page
 * script dispatching a click, a key or a move is ignored. The outline is hidden for two frames
 * before a pick is handed over, so the crop main takes is the page and not our overlay.
 * `__elasticPicker.next()` resolves the next pick or null when picking ends; `stop()` ends it.
 */
export function installPicker(trusted: (event: Event) => boolean = (event) => event.isTrusted): void {
  const scope = globalThis as unknown as { __elasticPicker?: { next(): Promise<Pick | null>; stop(): void } };
  if (scope.__elasticPicker) return;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;pointer-events:auto;cursor:crosshair;z-index:2147483647;background:transparent";
  const root = host.attachShadow({ mode: "closed" });
  const outline = document.createElement("div");
  outline.style.cssText = "position:fixed;border:2px solid #2563eb;background:rgba(37,99,235,.08);border-radius:3px;display:none;box-sizing:border-box;pointer-events:none";
  const label = document.createElement("div");
  label.style.cssText = "position:fixed;font:11px/16px system-ui,sans-serif;color:#fff;background:#2563eb;padding:0 6px;border-radius:3px;display:none;white-space:nowrap;pointer-events:none";
  root.append(outline, label);
  document.documentElement.append(host);

  let hovered: Element | null = null;
  let waiting: ((pick: Pick | null) => void) | null = null;
  const queued: Array<Pick | null> = [];
  const deliver = (pick: Pick | null) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(pick);
    } else queued.push(pick);
  };
  const frame = (run: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 16));
  /** The page's element under the pointer: our layer is the topmost, so the next one down. */
  const under = (x: number, y: number): Element | null =>
    document.elementsFromPoint(x, y).find((element) => element !== host && element !== document.documentElement) ?? null;
  const show = (element: Element | null) => {
    hovered = element;
    if (!element) {
      outline.style.display = label.style.display = "none";
      return;
    }
    const box = element.getBoundingClientRect();
    Object.assign(outline.style, { display: "block", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    label.textContent = `${element.tagName.toLowerCase()} ${Math.round(box.width)} × ${Math.round(box.height)}`;
    Object.assign(label.style, { display: "block", left: `${box.left}px`, top: `${Math.max(0, box.top - 18)}px` });
  };
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onMove = (event: PointerEvent) => {
    if (!trusted(event)) return;
    host.style.visibility = "visible";
    show(under(event.clientX, event.clientY));
  };
  const onClick = (event: MouseEvent) => {
    swallow(event);
    if (!trusted(event)) return;
    const element = under(event.clientX, event.clientY) ?? hovered;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const pick: Pick = {
      rect: { x: box.left, y: box.top, width: box.width, height: box.height },
      viewport: { width: innerWidth, height: innerHeight },
      html: trimHtml(element.outerHTML),
      selector: cssSelector(element),
      tag: element.tagName.toLowerCase(),
      size: { width: Math.round(box.width), height: Math.round(box.height) },
    };
    // Out of the picture before main crops it; back with the next move.
    host.style.visibility = "hidden";
    frame(() => frame(() => deliver(pick)));
  };
  const onKey = (event: KeyboardEvent) => {
    swallow(event);
    if (event.type === "keydown" && event.key === "Escape" && trusted(event)) stop();
  };
  const POINTER = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu", "auxclick"];
  const stop = () => {
    removeEventListener("pointermove", onMove, true);
    for (const type of POINTER) removeEventListener(type, swallow, true);
    removeEventListener("click", onClick, true);
    removeEventListener("keydown", onKey, true);
    removeEventListener("keyup", onKey, true);
    host.remove();
    delete scope.__elasticPicker;
    deliver(null);
  };
  addEventListener("pointermove", onMove, true);
  for (const type of POINTER) addEventListener(type, swallow, true);
  addEventListener("click", onClick, true);
  addEventListener("keydown", onKey, true);
  addEventListener("keyup", onKey, true);
  scope.__elasticPicker = {
    next: () => (queued.length > 0 ? Promise.resolve(queued.shift()!) : new Promise<Pick | null>((resolve) => { waiting = resolve; })),
    stop,
  };
}

/** What main injects: the picker and the helpers it calls, then the call. Names come from the
 * functions themselves, since a minified build renames them. */
export const PICKER_SOURCE = `${[cssSelector, trimHtml, installPicker].map(String).join("\n")}\n${installPicker.name}();`;
