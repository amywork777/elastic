/**
 * The real helper (`native/dictation/main.swift`, built by
 * `npm run build:dictation`) on real speech: macOS's `say` reads a sentence
 * into 16 kHz PCM, the service pipes it in, and the transcript has to come
 * back. Opt in with `ELASTIC_DICTATION_HELPER=1` on macOS 26: the first run
 * installs Apple's speech model, and `say` needs a session that can speak.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDictation, dictationBinary, type DictationUpdate } from "@main/dictation";

const appPath = path.resolve(import.meta.dirname, "../../..");
const enabled = process.env.ELASTIC_DICTATION_HELPER === "1" && process.platform === "darwin";

describe.runIf(enabled)("the dictation helper", () => {
  it("transcribes a spoken sentence on device", async () => {
    expect(dictationBinary(appPath), "run npm run build:dictation first").not.toBeNull();
    const scratch = mkdtempSync(path.join(os.tmpdir(), "elastic-dictation-test-"));
    try {
      const wav = path.join(scratch, "speech.wav");
      const said = spawnSync("say", ["-o", wav, "--file-format=WAVE", "--data-format=LEI16@16000", "Please open the review tab."]);
      expect(said.status).toBe(0);
      const file = readFileSync(wav);
      const data = file.indexOf("data");
      const pcm = file.subarray(data + 8, data + 8 + file.readUInt32LE(data + 4));
      expect(pcm.length).toBeGreaterThan(16_000);

      const dictation = createDictation(appPath);
      const updates: DictationUpdate[] = [];
      const done = new Promise<DictationUpdate>((resolve) => {
        const { id } = dictation.start((update) => {
          updates.push(update);
          if (update.state === "done" || update.state === "error") resolve(update);
        });
        for (let at = 0; at < pcm.length; at += 3200) dictation.push(id, pcm.subarray(at, at + 3200));
        dictation.finish(id);
      });
      const last = await done;
      expect(last.state, last.error).toBe("done");
      expect(last.text.toLowerCase()).toContain("review tab");
      expect(updates.some((update) => update.state === "listening")).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 600_000);
});
