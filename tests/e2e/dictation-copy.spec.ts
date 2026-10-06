/**
 * The two ways a message leaves or enters the box without typing, in the
 * built app:
 *
 *   - Copy under a reply puts it on the clipboard as HTML and as markdown.
 *   - The microphone dictates into the composer. The page's microphone is
 *     a stream playing a sentence `say` recorded, so everything after the
 *     device runs — the composer's worklet, `dictation.push`, the Swift
 *     helper, the words in the box — with no real microphone and no
 *     permission prompt. (Chromium's `--use-file-for-fake-audio-capture`
 *     plays silence under Electron, so the stream stands in at
 *     `getUserMedia` instead.) It needs macOS 26 and a build with the helper
 *     (`npm run build`), and skips otherwise.
 *
 * The clipboard is the machine's own, so what was on it is put back.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { appRoot, chooseDirectory, launch, scratch } from "./launch";

const helper = path.join(appRoot, "out", "native", "elastic-dictation");
const macos26 = process.platform === "darwin" && Number(os.release().split(".")[0]) >= 25;

let app: ElectronApplication;
let page: Page;
let userData: string;
let project: string;
let speech: string | null = null;
let saved: { text: string; html: string } | null = null;

test.beforeAll(async () => {
  userData = scratch("dictation-copy");
  project = scratch("dictation-copy-project");
  if (macos26 && fs.existsSync(helper)) {
    const wav = path.join(userData, "speech.wav");
    const said = spawnSync("say", ["-o", wav, "--file-format=WAVE", "--data-format=LEI16@16000", "Please open the review tab."]);
    if (said.status === 0 && fs.statSync(wav).size > 16_000) speech = wav;
  }
  ({ app, page } = await launch({ userData, env: { WORKBENCH_E2E_INSTALLED_AGENTS: "claude-code,codex" } }));
  saved = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
  await chooseDirectory(app, project);
});

test.afterAll(async () => {
  if (saved) {
    const previous = saved;
    await app?.evaluate(({ clipboard }, value) => clipboard.write(value), previous).catch(() => {});
  }
  await app?.close();
  for (const dir of [userData, project]) fs.rmSync(dir, { recursive: true, force: true });
});

test("Copy under a reply puts it on the clipboard as formatted text and as markdown", async () => {
  const composer = page.getByPlaceholder("Ask for anything…", { exact: true });
  await composer.fill("thought: say hello");
  await composer.press("Enter");
  await expect(page.locator("[data-session-view]")).toHaveAttribute("data-session-status", "idle", { timeout: 20_000 });

  const copy = page.getByRole("button", { name: "Copy reply" }).last();
  await expect(copy).toBeVisible();
  const answer = (await page.locator("[data-role=agent] [data-part=text]").last().innerText()).trim();
  await copy.click();
  await expect(page.locator("[data-reply-actions] [role=status]").last()).toHaveText("Copied");

  const copied = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
  expect(copied.text.trim().length).toBeGreaterThan(0);
  // The words on screen are the words copied; the HTML carries them inside its own markup.
  expect(answer.replace(/\s+/g, " ")).toContain(copied.text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20));
  expect(copied.html).toMatch(/<p>|<ul>|<ol>|<h\d>/);
});

test("the microphone dictates into the composer, on device", async () => {
  test.skip(!speech, "needs macOS 26, `say`, and a build with the dictation helper");
  // A CI runner has the SDK and `say`, but no speech model installed and nobody to grant the
  // microphone: the listening state never comes. The release still requires the helper to build.
  test.skip(Boolean(process.env.CI), "on device only: a CI runner cannot listen");
  // The microphone: the sentence, looped, as the stream `getUserMedia` answers with.
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const context = new AudioContext();
    const source = context.createBufferSource();
    source.buffer = await context.decodeAudioData(bytes.buffer);
    source.loop = true;
    const output = context.createMediaStreamDestination();
    source.connect(output);
    source.start();
    navigator.mediaDevices.getUserMedia = async () => output.stream;
  }, fs.readFileSync(speech!).toString("base64"));

  const composer = page.locator("[data-session-view] .ProseMirror");
  const dictate = page.getByRole("button", { name: "Dictate" });
  await expect(dictate).toBeVisible();
  await dictate.click();
  // The first dictation on a machine installs Apple's model for the language.
  await expect(page.locator("[data-dictation=listening]")).toBeVisible({ timeout: 300_000 });
  await expect(composer).toHaveAttribute("contenteditable", "false");
  await expect(composer).toContainText(/review tab/i, { timeout: 60_000 });

  await page.getByRole("button", { name: "Stop dictation" }).click();
  await expect(page.locator("[data-dictation=idle]")).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveAttribute("contenteditable", "true");
  await expect(composer).toContainText(/review tab/i);
  // Focus is back in the box, so the next key is typed or sends.
  await expect(composer).toBeFocused();
});
