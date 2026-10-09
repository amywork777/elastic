/// <reference lib="dom" />
/**
 * Any file on disk can be attached: one the prompt cannot carry (a PDF here) is attached and goes
 * to the agent as a `resource_link` to where it is, its bytes never read into the prompt
 * (`composer/attachments.ts`, `linkedPathOf`).
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launch, scratch } from "./launch";
import { selectFixtureSession } from "./session-fixture";

test("a PDF from outside the project is attached and sent as a link to its file", async () => {
  const root = scratch("attach-any");
  const project = scratch("attach-any-project");
  const elsewhere = scratch("attach-any-elsewhere");
  const record = path.join(root, "agent.jsonl");
  const pdf = path.join(elsewhere, "spec sheet.pdf");
  fs.writeFileSync(path.join(project, "README.md"), "# Attach\n");
  fs.writeFileSync(pdf, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0xff, 0xfe]));
  const { app, page } = await launch({ userData: path.join(root, "profile"), env: { FAKE_AGENT_RECORD: record } });
  try {
    await selectFixtureSession(app, page, project);
    await page.locator("[data-attach-input]").setInputFiles(pdf);
    await expect(page.locator('[data-composer] [title="spec sheet.pdf"]')).toBeVisible();
    await page.locator("[data-composer-input]").click();
    await page.keyboard.type("read this");
    await page.keyboard.press("Enter");
    const prompts = () => fs.existsSync(record)
      ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; params: { prompt?: { type: string; uri?: string; name?: string }[] } })
        .filter((frame) => frame.kind === "prompt")
      : [];
    await expect.poll(() => prompts().length, { timeout: 20_000 }).toBe(1);
    const link = prompts()[0]!.params.prompt?.find((block) => block.type === "resource_link");
    expect(link).toMatchObject({ uri: `file://${pdf.split("/").map(encodeURIComponent).join("/")}`, name: "spec sheet.pdf" });
    expect(prompts()[0]!.params.prompt?.some((block) => block.type === "resource" || block.type === "image")).toBe(false);
  } finally {
    await app.close();
    for (const dir of [root, project, elsewhere]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
