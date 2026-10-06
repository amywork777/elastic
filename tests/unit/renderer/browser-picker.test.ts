import { beforeEach, describe, expect, it } from "vitest";

import { PICKER_SOURCE, clampRect, cssSelector, trimHtml } from "@shared/browser-picker";

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

  it("installs a picker from its source that resolves a click on an element, and the page's handler does not run", async () => {
    let clicked = false;
    document.getElementById("go")!.addEventListener("click", () => { clicked = true; });
    new Function(PICKER_SOURCE)();
    const picker = (globalThis as unknown as { __elasticPicker: { next(): Promise<{ selector: string; tag: string; more: boolean } | null>; stop(): void } }).__elasticPicker;
    const next = picker.next();
    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await expect(next).resolves.toMatchObject({ selector: "#go", tag: "button", more: false });
    expect(clicked).toBe(false);
    const ended = picker.next();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(ended).resolves.toBeNull();
  });
});
