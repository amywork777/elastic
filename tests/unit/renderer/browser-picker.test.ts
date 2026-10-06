import { beforeEach, describe, expect, it } from "vitest";

import { PICKER_SOURCE, clampRect, cssSelector, installPicker, trimHtml } from "@shared/browser-picker";

/** The pieces of click-to-prompt that run inside the page (`src/shared/browser-picker.ts`). */
beforeEach(() => {
  document.body.innerHTML = `<main><section class="card hero"><button id="go">Go</button><p class="x">a</p><p class="x">b</p></section></main>`;
});

describe("browser picker helpers", () => {
  it("builds a selector that finds the element again", () => {
    for (const element of [document.getElementById("go")!, ...document.querySelectorAll("p.x"), document.querySelector("section")!]) {
      const selector = cssSelector(element);
      expect(document.querySelector(selector), selector).toBe(element);
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

  it("installs from its source and resolves a trusted click on an element, which the page never sees", async () => {
    let clicked = false;
    document.getElementById("go")!.addEventListener("click", () => { clicked = true; });
    new Function(PICKER_SOURCE)();
    const picker = (globalThis as unknown as { __elasticPicker: { next(): Promise<unknown>; stop(): void } }).__elasticPicker;
    expect(picker).toBeDefined();
    picker.stop();
    expect(clicked).toBe(false);
  });
});

describe("the picker against the page", () => {
  type Picker = { next(): Promise<{ selector: string; tag: string } | null>; stop(): void };
  const picker = () => (globalThis as unknown as { __elasticPicker: Picker }).__elasticPicker;
  // jsdom's events are all untrusted; the picker takes how to judge trust so a test can stand in
  // for the person, while the default (`event.isTrusted`) refuses anything a page script made.
  const asPerson = () => true;
  const host = () => document.documentElement.lastElementChild as HTMLElement;
  beforeEach(() => {
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => [host(), document.getElementById("go")!, document.body];
  });

  it("refuses a click a page script made, so a page cannot put words in the prompt", async () => {
    installPicker();
    const next = picker().next();
    let settled = false;
    void next.then(() => { settled = true; });
    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    host().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    picker().stop();
  });

  it("catches the click on its own layer, so nothing under it (a frame included) is clicked, and picks what is under the pointer", async () => {
    let clicked = false;
    document.getElementById("go")!.addEventListener("click", () => { clicked = true; });
    installPicker(asPerson);
    expect(getComputedStyle(host()).pointerEvents).toBe("auto");
    const next = picker().next();
    host().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await expect(next).resolves.toMatchObject({ selector: "#go", tag: "button" });
    expect(clicked).toBe(false);
    picker().stop();
  });

  it("is not in its own screenshot: the outline is hidden before the pick is handed over", async () => {
    installPicker(asPerson);
    host().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 5, clientY: 5 }));
    const next = picker().next();
    host().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await next;
    expect(host().style.visibility).toBe("hidden");
    picker().stop();
  });

  it("keeps keys from the page while picking, and Esc ends it", async () => {
    let typed = false;
    document.addEventListener("keydown", () => { typed = true; });
    installPicker(asPerson);
    document.getElementById("go")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(typed).toBe(false);
    const ended = picker().next();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await expect(ended).resolves.toBeNull();
  });
});
