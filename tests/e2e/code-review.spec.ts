/// <reference lib="dom" />
/**
 * The bundled Code Review plugin in the built app, against the stand-in GitHub
 * CLI (tests/fixtures/code-review/gh.mjs, named by `ELASTIC_GH`): its rail page
 * with the pull requests waiting on you, a pull request opened from it, and the
 * Pull request tab a session's `+` menu opens, with a line comment posted (to
 * the stub's log, never to GitHub).
 *
 * `ELASTIC_DOC_SHOTS=1` also writes its two pictures into
 * docs/research/plugin-matrix/.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";

import { appRoot, launch, newTab, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;
let bin: string;
let log: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userData = scratch("code-review");
  project = scratch("code-review-project");
  bin = scratch("code-review-bin");
  log = path.join(bin, "writes.log");
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, `#!/bin/sh\nexec "${process.execPath}" "${path.join(appRoot, "tests", "fixtures", "code-review", "gh.mjs")}" "$@"\n`, { mode: 0o755 });
  ({ app, page } = await launch({ userData, env: { ELASTIC_GH: gh, FAKE_GH_LOG: log } }));
});

test.afterAll(async () => {
  await app?.close();
  for (const dir of [userData, project, bin]) fs.rmSync(dir, { recursive: true, force: true });
});

async function capture(name: string) {
  await page.screenshot({ path: test.info().outputPath(name), animations: "disabled" });
  if (process.env.ELASTIC_DOC_SHOTS === "1") {
    await page.screenshot({ path: path.join(appRoot, "docs", "research", "plugin-matrix", name), animations: "disabled" });
  }
}

test("the rail page lists what waits on you, and a pull request opens in it", async () => {
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const rail = page.getByRole("navigation", { name: "Rail" });
  await rail.getByRole("button", { name: "Code Review" }).click();
  const surface = page.getByTestId("plugin-app");
  const frame: FrameLocator = surface.frameLocator("iframe");
  await expect(frame.getByRole("button", { name: /Needs your review/ })).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByText("Add a retry budget to the uploader")).toBeVisible();
  await expect(frame.getByText("Docs: how widgets are versioned")).toBeVisible();
  await expect(frame.getByText("Fix the flaky sync test on Windows")).toBeVisible();
  await capture("code-review-rail.png");

  // Compact hides the second line; a section folds.
  await frame.getByRole("button", { name: "Compact" }).click();
  await expect(frame.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  await frame.getByRole("button", { name: /Recently updated/ }).click();
  await expect(frame.getByText("Fix the flaky sync test on Windows")).toHaveCount(0);

  await frame.getByText("Add a retry budget to the uploader").click();
  await expect(frame.getByRole("heading", { name: /Add a retry budget to the uploader/ })).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByText("1 failed")).toBeVisible();
  await expect(frame.getByText("Should the budget come from settings?")).toBeVisible();
  await frame.getByRole("button", { name: "Back" }).click();
  await expect(frame.getByRole("button", { name: /Needs your review/ })).toBeVisible();
});

test("a session's Pull request tab: the repository's list, a pull request, a line comment", async () => {
  await page.getByRole("navigation", { name: "Rail" }).getByRole("button", { name: "Sessions" }).click();
  await selectFixtureSession(app, page, project);
  if (!(await page.getByTestId("explorer").isVisible())) await page.getByRole("button", { name: "Toggle explorer" }).click();
  await newTab(page, "Pull request");
  const frame = page.frameLocator('[data-plugin-frame^="elastic-code-review/code-review/"] iframe');
  await expect(frame.getByRole("heading", { name: "acme/widgets" })).toBeVisible({ timeout: 30_000 });
  await frame.getByText("Add a retry budget to the uploader").click();
  await expect(frame.getByRole("heading", { name: /Add a retry budget to the uploader/ })).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByRole("table", { name: "Diff of src/uploader.ts" })).toContainText("const MAX_RETRIES = 3;");
  await capture("code-review-pr.png");

  const uploader = frame.getByRole("table", { name: "Diff of src/uploader.ts" });
  await uploader.getByRole("button", { name: "Comment on new line 5" }).click();
  await uploader.getByRole("textbox", { name: "Comment on new line 5" }).fill("Could this read the budget from settings?");
  await frame.getByRole("button", { name: "Comment", exact: true }).first().click();
  await expect(frame.getByText("Comment posted.")).toBeVisible({ timeout: 30_000 });
  const writes = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  expect(writes.at(-1)).toEqual(expect.arrayContaining(["repos/acme/widgets/pulls/42/comments", "path=src/uploader.ts", "line=5", "side=RIGHT"]));
});
