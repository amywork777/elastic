# Click-to-prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A crosshair button in the browser tab lets the person click elements on the page; each pick becomes a prompt chip with a cropped screenshot, the element's trimmed HTML, a CSS selector, its size and the page URL.

**Architecture:** Pure DOM helpers (selector, HTML trim, picker install) live in `src/shared/browser-picker.ts` and are serialized into the page's **isolated world** by main. Main loops one awaited pick at a time (`executeJavaScriptInIsolatedWorld`, so page scripts can neither see nor forge picks), crops with `capturePage`, and broadcasts `browser.picked`. The renderer turns each pick into a prompt context (reference + image attachment + text part) through the same `prompt.deliver` path selection and screenshot use.

**Tech Stack:** Electron 40 (WebContentsView, isolated worlds), TypeScript, React, zustand, zod 4, vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-pick-and-split-design.md` (Part 1)

## Global Constraints

- IPC declared once in `src/shared/ipc/browser.ts` (request + response schemas); add new channel and event names to `tests/unit/shared/ipc.test.ts`.
- `src/shared/browser-picker.ts` must be pure (no Node, no Electron): the renderer-imports rule allows only pure shared modules.
- UI copy: tooltip "Pick an element to add to prompt"; toolbar status "Click an element · Esc to stop". No em-dashes, emoji or arrow glyphs.
- HTML trimmed to 4 KB, `<script>` and `<style>` removed; crop padding 4 px, clamped to the viewport.
- The agent's CDP input to a tab is refused while the person is picking in it.
- Node 24 for tests: `export PATH=~/.nvm/versions/node/v24.15.0/bin:$PATH`.

## Review Focus

1. **A page that navigates mid-pick**: pick mode ends, no stale pick is delivered (Task 2 test).
2. **A page script trying to fake a pick** (calling a global, logging a magic string): nothing is delivered (Task 2 e2e).
3. **An element larger than the viewport or partly off screen**: the crop is clamped to the visible area, never an error (Task 1 test on the clamp helper).
4. **Picking does not trigger the page's own click handlers** (Task 4 e2e).
5. **Leaving pick mode on and switching tabs or chats**: picking stops when the tab is hidden or closed (Task 3 test).

---

### Task 1: Pure picker helpers

**Files:**
- Create: `src/shared/browser-picker.ts`
- Test: `tests/unit/renderer/browser-picker.test.ts` (jsdom)

**Interfaces:**
- Produces:
  - `cssSelector(element: Element): string`: `#id` when unique; else a `tag.class` path from the nearest unique ancestor, with `:nth-of-type(n)` where needed; always resolves back to the element.
  - `trimHtml(html: string, max?: number /* 4096 */): string`: removes `<script>…</script>` and `<style>…</style>`, collapses whitespace, cuts at `max` with `…`.
  - `clampRect(rect: {x,y,width,height}, viewport: {width,height}, pad?: number /* 4 */): {x,y,width,height} | null`: padded, clamped, rounded; null when nothing visible.
  - `installPicker(): void`: defines `globalThis.__elasticPicker = { next(): Promise<Pick|null>, stop(): void }` in the calling world. Draws a hover outline and label (tag, size) in a closed shadow root; capture-phase `pointerdown`/`click` with `preventDefault` + `stopImmediatePropagation`; Shift keeps picking; Esc resolves null and tears down.
  - `type Pick = { rect: {x,y,width,height}; html: string; selector: string; tag: string; size: {width,height}; more: boolean }` (`more` true when Shift was held).
  - `PICKER_SOURCE: string`: `installPicker` and the helpers it calls, serialized for injection.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { clampRect, cssSelector, trimHtml } from "@shared/browser-picker";

beforeEach(() => {
  document.body.innerHTML = `<main><section class="card hero"><button id="go">Go</button><p class="x">a</p><p class="x">b</p></section></main>`;
});

describe("browser picker helpers", () => {
  it("builds a selector that finds the element again", () => {
    for (const element of [document.getElementById("go")!, ...document.querySelectorAll("p.x")]) {
      const selector = cssSelector(element);
      expect(document.querySelector(selector)).toBe(element);
    }
    expect(cssSelector(document.getElementById("go")!)).toBe("#go");
  });

  it("trims HTML: no scripts or styles, capped", () => {
    expect(trimHtml(`<div><script>steal()</script><style>a{}</style><b>hi</b></div>`)).toBe("<div><b>hi</b></div>");
    const long = trimHtml(`<p>${"x".repeat(5000)}</p>`);
    expect(long.length).toBeLessThanOrEqual(4096);
    expect(long.endsWith("…")).toBe(true);
  });

  it("pads and clamps a crop to the viewport, and gives up on one off screen", () => {
    expect(clampRect({ x: 10, y: 10, width: 100, height: 50 }, { width: 800, height: 600 })).toEqual({ x: 6, y: 6, width: 108, height: 58 });
    expect(clampRect({ x: -50, y: 500, width: 2000, height: 400 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 496, width: 800, height: 104 });
    expect(clampRect({ x: 900, y: 10, width: 10, height: 10 }, { width: 800, height: 600 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/unit/renderer/browser-picker.test.ts` → cannot resolve `@shared/browser-picker`.

- [ ] **Step 3: Implement `src/shared/browser-picker.ts`** with the functions above. `cssSelector`: if `element.id` and `document.querySelectorAll('#'+CSS.escape(id)).length===1` return it; else walk up building `tag` + up to two classes (`CSS.escape`), adding `:nth-of-type(n)` when siblings share the segment, stopping at an ancestor with a unique id or `body`; verify with `querySelector` and fall back to the full nth-of-type path. `installPicker` must reference only functions defined in this file, and `PICKER_SOURCE` is `[cssSelector, trimHtml, clampRect, installPicker].map(String).join("\n") + "\ninstallPicker();"`.

- [ ] **Step 4: Run, expect PASS**; also `npx vitest run tests/unit/main/renderer-shared-imports.test.ts`.

- [ ] **Step 5: Commit** — `git add src/shared/browser-picker.ts tests/unit/renderer/browser-picker.test.ts && git commit -m "Picker helpers: selector, trimmed HTML, clamped crop, isolated-world picker"`

---

### Task 2: Main: pick mode in the browser service

**Files:**
- Modify: `src/main/browser/service.ts` (Target type, `input`, navigation listener, new `pick`)
- Modify: `src/shared/ipc/browser.ts`, `src/main/ipc/browser.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/unit/main/browser-service.test.ts`

**Interfaces:**
- Consumes: `PICKER_SOURCE`, `Pick` (Task 1).
- Produces: `BrowserService.pick(scope, id, active: boolean): Promise<{ active: boolean }>`; channel `browser.pick: invoke(At.extend({ active: z.boolean() }), z.object({ active: z.boolean() }))`; events `"browser.picked": { sessionId, tabId, url, title, generation, image: string /* base64 png */, html, selector, tag, size }` and `"browser.picking": { sessionId, tabId, active }`.

- [ ] **Step 1: Failing tests** in `browser-service.test.ts` (fake contents gain `executeJavaScriptInIsolatedWorld = vi.fn()` and `capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from("png") }))`):

```ts
it("picks until the person stops, crops each pick, and refuses the agent's input meanwhile", async () => {
  await service.open(scope, { tabId: "k", url: "https://example.com/" });
  const page = contents("k") as unknown as { executeJavaScriptInIsolatedWorld: Mock };
  const pick = { rect: { x: 10, y: 10, width: 50, height: 20 }, html: "<b>x</b>", selector: "#x", tag: "b", size: { width: 50, height: 20 }, more: false };
  page.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(undefined).mockResolvedValueOnce(pick).mockResolvedValueOnce(null);
  const picked: unknown[] = [];
  service.events.on("picked", (event) => picked.push(event));
  await service.pick(scope, "k", true);
  await expect(service.invoke("input", scope, { tabId: "k", input: { action: "point", x: 1, y: 1 } })).rejects.toThrow(/picking/);
  await vi.waitFor(() => expect(picked).toHaveLength(1));
  expect(picked[0]).toMatchObject({ tabId: "k", selector: "#x", image: Buffer.from("png").toString("base64") });
});

it("ends pick mode when the page navigates", async () => {
  await service.open(scope, { tabId: "n", url: "https://example.com/" });
  const page = contents("n") as unknown as { executeJavaScriptInIsolatedWorld: Mock; emit: (e: string, d: unknown) => void };
  page.executeJavaScriptInIsolatedWorld.mockReturnValue(new Promise(() => {}));
  const states: boolean[] = [];
  service.events.on("picking", (event: { active: boolean }) => states.push(event.active));
  await service.pick(scope, "n", true);
  page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  expect(states).toEqual([true, false]);
});
```

- [ ] **Step 2: Run, expect FAIL** (`service.pick` is not a function).

- [ ] **Step 3: Implement.** `Target` gains `picking: boolean`. `pick(scope, id, active)`: when turning on, set `picking`, emit `picking {active:true}`, run `executeJavaScriptInIsolatedWorld(PICK_WORLD /* 1999 */, [{ code: PICKER_SOURCE }])`, then loop `while (target.picking)`: `const next = await wc.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code: "globalThis.__elasticPicker.next()" }], true)`; null → stop; else `clampRect` it against `wc.getOwnerBrowserWindow` view bounds (use the `rect` and the page's `innerWidth/innerHeight` returned in the pick), `capturePage(rect)`, emit `picked` with base64 PNG, url, title, generation; if `!next.more` keep looping (the spec keeps the mode on until Esc), turning off: `picking=false`, run `__elasticPicker.stop()`, emit `picking {active:false}`. In `invoke("input", …)`: if `target.picking` throw `new Error("The person is picking an element in this page; try again when they are done.")`. In `did-start-navigation` (main frame, new document): if picking, set false and emit `picking {active:false}`. Wire `service.events` `picked`/`picking` to `broadcast("browser.picked" | "browser.picking", …)` where `opened`/`closed` are broadcast today. Add the channel and events to `src/shared/ipc/browser.ts`, the handler `pick: request => browserService.pick(scope(request), request.tabId, request.active)`, and the names to `ipc.test.ts`.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/unit/main/browser-service.test.ts tests/unit/shared/ipc.test.ts` (sandbox off for loopback tests).

- [ ] **Step 5: Commit** — `git commit -am "Browser service: pick mode in an isolated world, cropped picks, agent input refused while picking"`

---

### Task 3: Renderer: the crosshair, the chips

**Files:**
- Modify: `src/renderer/features/explorer/BrowserTab.tsx`, `src/renderer/state/browser.ts` (pick state + event), `tests/setup-jsdom.ts` (mocks)
- Test: `tests/unit/renderer/browser-pick.test.tsx`

**Interfaces:**
- Consumes: channel `browser.pick`, events `browser.picked`, `browser.picking` (Task 2).
- Produces: `useBrowser` state `picking: Record<tabId, boolean>`, `setPicking(binding, active)`; BrowserTab button `aria-label="Pick an element to add to prompt"`, `aria-pressed`, `data-pick-element`.

- [ ] **Step 1: Failing test**: render `BrowserTab` with a target; click the crosshair → `window.workbench.browser.pick` called with `{ …binding, active: true }`; emit a `browser.picked` event for this tab through the jsdom bridge mock → `prompt.deliver` (mock the prompt context hook used by BrowserTab) receives a context with three parts: a `reference` (url), an `attachment` named `browser-element.png` of `image/png`, and a `text` part containing the selector and `Element <tag> on <url>`; a `browser.picking { active:false }` event clears `aria-pressed`; unmounting the tab (hidden/closed) calls `pick({ active:false })`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Crosshair button (lucide `Crosshair`) beside the selection/screenshot buttons; while on, the toolbar status reads "Click an element · Esc to stop". On `browser.picked` for this tab: `createPromptContext([reference, { kind: "attachment", name: "browser-element.png", mimeType: "image/png", about: [referenceId], content: Promise.resolve(blobFromBase64(event.image, "image/png")) }, textPart(`Element <${event.tag}> on ${event.url}\nSelector: ${event.selector}\nSize: ${w}×${h}\n\n${event.html}`)])` then `prompt.deliver`. Stop picking in the effect cleanup (tab hidden, closed, chat switched).

- [ ] **Step 4: Run, expect PASS**; `npx vitest run tests/unit/renderer/no-native-title.test.tsx tests/unit/renderer/a11y-source.test.ts`.

- [ ] **Step 5: Commit** — `git commit -am "Browser tab: pick an element, each pick a prompt chip with its image and code"`

---

### Task 4: End to end, docs, release

**Files:**
- Create: `tests/e2e/browser-pick.spec.ts`
- Modify: `docs/browser.md` (a "Pick an element" paragraph), `VERSION`, `README.md`

- [ ] **Step 1: e2e**: serve a local page with `<button id="buy" onclick="document.title='clicked'">Buy</button>` and a script that sets `window.__elasticPicker = { next: () => fakePick }` and logs a fake pick; open it in a chat's browser tab; click `[data-pick-element]`; click the Buy button's center in the browser view through Playwright's CDP mouse on that WebContents (`app.evaluate` → `contents.sendInputEvent` mouseDown/mouseUp at the button's rect); expect a composer chip whose attachment is `browser-element.png`, the page title still not "clicked" (handler did not run), no chip from the page's fake; press Escape → `[data-pick-element]` not pressed.
- [ ] **Step 2: Run** `npm run build && CI=1 npx playwright test tests/e2e/browser-pick.spec.ts` → PASS.
- [ ] **Step 3: Full checks** `npm run typecheck && npm run lint && npm test && CI=1 npx playwright test`.
- [ ] **Step 4: Docs + version 0.1.12**, commit, merge to main, tag `v0.1.12`, wait for CI, verify DMG signature, publish, install.
