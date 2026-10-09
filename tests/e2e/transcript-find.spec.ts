/// <reference lib="dom" />
/**
 * Find in the chat (Mod+F, `features/session/FindBar.tsx`): the bar counts every match in the
 * chat, the turns not mounted included, and going to one of those mounts the window down to it;
 * Escape gives focus back; with focus in the explorer Mod+F is not the chat's.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launch, mod, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

// `CSS.highlights` is a maplike the node tsconfig's DOM lib types without `get`; it is cast to a Map below.
declare const window: Window & { workbench: { sessions: { prompt(request: { id: string; content: { type: "text"; text: string }[] }): Promise<unknown> } } };

test("Mod+F finds across the whole chat, mounts an earlier match, and gives focus back", async () => {
  const root = scratch("transcript-find");
  const project = scratch("transcript-find-project");
  const other = scratch("transcript-find-other");
  const { app, page } = await launch({ userData: path.join(root, "profile") });
  try {
    const session = await selectFixtureSession(app, page, project);
    // Eight prompts: sixteen turns, four more than a transcript mounts when it opens.
    const prompts = ["needle in the first prompt", ...Array.from({ length: 6 }, (_, at) => `filler ${at}`), "the last needle"];
    for (const text of prompts) {
      await page.evaluate(({ id, text }) => window.workbench.sessions.prompt({ id, content: [{ type: "text", text }] }), { id: session.id, text });
    }
    await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "the last needle" })).toBeVisible();
    // Away and back: the transcript opens again on its latest window.
    await selectFixtureSession(app, page, other);
    await selectFixtureSession(app, page, project);
    await expect(page.locator("[data-earlier-turns]")).toBeVisible();
    await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "needle in the first prompt" })).toHaveCount(0);

    await page.locator("[data-composer-input]").click();
    await page.keyboard.press(`${mod}+f`);
    const input = page.locator("[data-find-input]");
    await expect(input).toBeFocused();
    await page.keyboard.type("NEEDLE");
    // The match nearest the bottom first, and the one in the unmounted turns counted.
    await expect(page.locator("[data-find-count]")).toHaveText("2 of 2");
    const current = () => page.evaluate(() => {
      const range = [...((CSS.highlights as unknown as Map<string, Set<Range>>).get("transcript-find-current") ?? [])][0];
      if (!range) return null;
      const box = range.getBoundingClientRect();
      const pane = document.querySelector("[data-transcript]")!.getBoundingClientRect();
      return { text: range.toString(), inView: box.top >= pane.top + 48 && box.bottom <= pane.bottom, turn: (range.startContainer.parentElement?.closest("[data-turn]") as HTMLElement | null)?.innerText ?? "" };
    });
    await expect.poll(current).toMatchObject({ text: "needle", inView: true });
    expect((await current())?.turn).toContain("the last needle");

    // Back to the first: its turn mounts, and it is scrolled to.
    await page.keyboard.press("Shift+Enter");
    await expect(page.locator("[data-find-count]")).toHaveText("1 of 2");
    await expect(page.locator("[data-turn][data-role=user]").filter({ hasText: "needle in the first prompt" })).toHaveCount(1);
    await expect.poll(current).toMatchObject({ text: "needle", inView: true });
    expect((await current())?.turn).toContain("needle in the first prompt");
    // Wraps.
    await page.keyboard.press("Shift+Enter");
    await expect(page.locator("[data-find-count]")).toHaveText("2 of 2");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-find-count]")).toHaveText("1 of 2");
    await page.screenshot({ path: test.info().outputPath("transcript-find.png"), animations: "disabled" });

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-find-bar]")).toHaveCount(0);
    await expect(page.locator("[data-composer-input]")).toBeFocused();
    expect(await page.evaluate(() => (CSS.highlights as unknown as Map<string, Set<Range>>).get("transcript-find")?.size ?? 0)).toBe(0);

    // In the explorer, Mod+F is the explorer's (Monaco's, a terminal's, a page's), not the chat's.
    await page.keyboard.press(`${mod}+Alt+b`);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("#explorer"))).toBe(true);
    await page.keyboard.press(`${mod}+f`);
    await expect(page.locator("[data-find-bar]")).toHaveCount(0);
  } finally {
    await app.close();
    for (const dir of [root, project, other]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
