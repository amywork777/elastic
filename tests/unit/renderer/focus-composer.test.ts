import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusComposerOf } from "@renderer/app/pane-focus";

/**
 * A click on a chat in the sidebar left focus on the row, so the first keys typed after a switch
 * went nowhere. The chat's composer mounts a few frames later; focus waits for it.
 */
const frame = () => new Promise((resolve) => setTimeout(resolve, 0));

function view(id: string) {
  const root = document.createElement("div");
  root.setAttribute("data-session-view", id);
  document.body.append(root);
  return root;
}

function composer(into: HTMLElement) {
  const box = document.createElement("div");
  box.setAttribute("data-composer-input", "");
  box.setAttribute("contenteditable", "true");
  box.tabIndex = 0;
  into.append(box);
  return box;
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => setTimeout(() => callback(0), 0) as unknown as number);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("focusComposerOf", () => {
  it("focuses the chat's composer once it mounts, and not another chat's", async () => {
    const row = document.createElement("button");
    document.body.append(row);
    row.focus();
    const old = view("old");
    composer(old);

    focusComposerOf("new");
    await frame();
    await frame();
    // The new chat's view arrives a few frames after the click.
    const box = composer(view("new"));
    for (let index = 0; index < 4; index += 1) await frame();
    expect(document.activeElement).toBe(box);
  });

  it("leaves focus alone when the person has moved it meanwhile", async () => {
    const row = document.createElement("button");
    const elsewhere = document.createElement("input");
    document.body.append(row, elsewhere);
    row.focus();

    focusComposerOf("new");
    elsewhere.focus();
    composer(view("new"));
    for (let index = 0; index < 4; index += 1) await frame();
    expect(document.activeElement).toBe(elsewhere);
  });
});
