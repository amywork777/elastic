/**
 * The login shell's environment from the last launch, sealed on disk, so a launch does not wait
 * for `$SHELL -ilc` before its first agent (`loginEnv` in `./shell-env.ts` refreshes it behind).
 *
 * An environment holds what a person's rc exports, API keys included, so it is kept only where
 * Electron's `safeStorage` can seal it with the login keychain; without that there is no cache
 * and every launch captures, as before. One file, written whole through a temporary sibling.
 */
import fs from "node:fs";
import path from "node:path";

import { safeStorage } from "electron";

import type { EnvCache, Env } from "./shell-env";

export function sealedEnvCache(userData: string): EnvCache | null {
  // A keychain that cannot be asked is no cache, never a launch that fails.
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
  } catch {
    return null;
  }
  const file = path.join(userData, "shell-env.sealed");
  return {
    load() {
      try {
        const env = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as unknown;
        if (!env || typeof env !== "object" || Array.isArray(env)) return null;
        const values = Object.entries(env as Record<string, unknown>);
        // A capture always has a PATH; anything else is not one of ours.
        if (!values.every(([, value]) => typeof value === "string") || !("PATH" in env)) return null;
        return env as Env;
      } catch {
        return null;
      }
    },
    save(env) {
      try {
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(env)), { mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (error) {
        console.warn(`[shell-env] could not keep the environment for the next launch: ${String(error)}`);
      }
    },
  };
}
