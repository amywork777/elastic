/**
 * `npm run build:dictation`: the composer's dictation helper
 * (`native/dictation/main.swift`) into `out/native/elastic-dictation`, one
 * binary for both Mac architectures.
 *
 * Run by `scripts/build.mjs` after electron-vite. Off a Mac, or on a Mac
 * without a Swift toolchain that has the macOS 26 SDK, there is no helper:
 * the build says so and goes on, and the composer has no microphone
 * (`src/main/dictation/index.ts` reports it unavailable). Set
 * `ELASTIC_REQUIRE_DICTATION=1` to make that a failure, as a release should.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(appRoot, "native", "dictation", "main.swift");
export const DICTATION_BINARY = path.join(appRoot, "out", "native", "elastic-dictation");
/** The oldest macOS the helper starts on; it says "needs macOS 26" there rather than failing to load. */
const DEPLOYMENT = "12.0";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) return { ok: false, output: result.error.message };
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

export function buildDictation({ env = process.env } = {}) {
  const required = env.ELASTIC_REQUIRE_DICTATION === "1";
  const skip = (reason) => {
    if (required) throw new Error(`dictation helper: ${reason}`);
    console.warn(`dictation helper skipped: ${reason}. The composer will have no microphone.`);
    return null;
  };
  if (process.platform !== "darwin") return skip("not macOS");

  const scratch = mkdtempSync(path.join(os.tmpdir(), "elastic-dictation-"));
  try {
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
      const out = path.join(scratch, arch);
      const built = run("xcrun", [
        "swiftc", "-parse-as-library", "-O",
        "-target", `${arch}-apple-macos${DEPLOYMENT}`,
        // Its own module cache: the shared one is outside what a sandboxed build may write.
        "-module-cache-path", path.join(scratch, "module-cache"),
        SOURCE, "-o", out,
      ]);
      if (!built.ok) return skip(`swiftc failed for ${arch}\n${built.output}`);
      slices.push(out);
    }
    mkdirSync(path.dirname(DICTATION_BINARY), { recursive: true });
    const merged = run("lipo", ["-create", ...slices, "-output", DICTATION_BINARY]);
    if (!merged.ok) return skip(`lipo failed\n${merged.output}`);
    return DICTATION_BINARY;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildDictation();
  if (built) console.info(`built ${path.relative(appRoot, built)}`);
}
