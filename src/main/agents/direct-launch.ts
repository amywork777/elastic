/**
 * An adapter npm has already fetched, launched without `npm exec` in front of it.
 *
 * The pinned launch (`registry.ts`, `pinned`) is `npm exec --package=<pkg>@<version> -- <bin>`:
 * right for a first run, which has to download the adapter, but the `npm exec` process then
 * stays resident as the adapter's parent for as long as the chat is open. Measured, 90 to 114 MB
 * per live adapter, doing nothing. Once npm's `_npx` cache holds that exact version, the adapter
 * is its bin script run by `node`, which is what `npm exec` ends up doing anyway.
 *
 * Conservative on purpose: anything this cannot account for (Windows, a launch that is not the
 * pinned shape, no cache entry at that version, no `node` on PATH, a bin that is not a file)
 * keeps the `npm exec` launch, which always works.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Launch } from "../../shared/agents";
import { trackChild } from "../children";

type Env = Record<string, string>;

export type DirectLaunchProbes = {
  /** npm's cache directory (`npm config get cache`), or null. */
  npmCache: (env: Env) => Promise<string | null>;
  /** An executable `node` on this PATH, or null. */
  node: (env: Env) => Promise<string | null>;
  platform: NodeJS.Platform;
};

/** `npm exec ... --package=<name>@<version> -- <bin> [args]`, taken apart; null for anything else. */
export function pinnedPackage(launch: Pick<Launch, "command" | "args">): { name: string; version: string; bin: string; rest: string[] } | null {
  if (launch.command !== "npm" || launch.args[0] !== "exec") return null;
  const separator = launch.args.indexOf("--");
  if (separator < 0 || separator === launch.args.length - 1) return null;
  const spec = launch.args.slice(0, separator).find((arg) => arg.startsWith("--package="))?.slice("--package=".length);
  // The version follows the last `@`; a scoped name starts with one.
  const at = spec ? spec.lastIndexOf("@") : -1;
  if (!spec || at <= 0) return null;
  return {
    name: spec.slice(0, at),
    version: spec.slice(at + 1),
    bin: launch.args[separator + 1]!,
    rest: launch.args.slice(separator + 2),
  };
}

/** The bin script of `name@version` in npm's `_npx` cache, or null when that version is not there. */
export function cachedBin(cache: string, pkg: { name: string; version: string; bin: string }): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(cache, "_npx"));
  } catch {
    return null;
  }
  for (const entry of entries) {
    const dir = path.join(cache, "_npx", entry, "node_modules", ...pkg.name.split("/"));
    let manifest: { version?: unknown; bin?: unknown };
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as typeof manifest;
    } catch {
      continue;
    }
    if (manifest.version !== pkg.version) continue;
    const bin = typeof manifest.bin === "string" ? manifest.bin : (manifest.bin as Record<string, unknown> | undefined)?.[pkg.bin];
    if (typeof bin !== "string") continue;
    const script = path.resolve(dir, bin);
    // A bin outside its own package is not one to run.
    if (!script.startsWith(dir + path.sep)) continue;
    if (fs.statSync(script, { throwIfNoEntry: false })?.isFile()) return script;
  }
  return null;
}

/** The launch to spawn: `node <bin>` when the pinned version is cached, else the launch as given. */
export async function directLaunch(launch: Launch, env: Env, probes: DirectLaunchProbes = defaultProbes): Promise<Launch> {
  if (probes.platform === "win32") return launch;
  const pkg = pinnedPackage(launch);
  if (!pkg) return launch;
  const [cache, node] = await Promise.all([probes.npmCache({ ...env, ...launch.env }), probes.node({ ...env, ...launch.env })]);
  if (!cache || !node) return launch;
  const script = cachedBin(cache, pkg);
  if (!script) return launch;
  return { ...launch, command: node, args: [script, ...pkg.rest] };
}

const NPM_CONFIG_TIMEOUT_MS = 5_000;

/** `npm config get cache`, once per PATH and npm config: it takes a few hundred milliseconds. */
const cacheByKey = new Map<string, Promise<string | null>>();

function npmCache(env: Env): Promise<string | null> {
  const key = `${env.PATH ?? ""}\0${env.npm_config_cache ?? env.NPM_CONFIG_CACHE ?? ""}\0${env.HOME ?? ""}`;
  let found = cacheByKey.get(key);
  if (!found) {
    found = new Promise((resolve) => {
      trackChild(
        execFile("npm", ["config", "get", "cache"], { env, timeout: NPM_CONFIG_TIMEOUT_MS, encoding: "utf8" }, (error, stdout) => {
          const dir = stdout?.trim();
          resolve(!error && dir && path.isAbsolute(dir) ? dir : null);
        }),
        "probe",
      );
    });
    // A failure is not remembered: the next spawn asks again.
    void found.then((dir) => {
      if (dir === null) cacheByKey.delete(key);
    });
    cacheByKey.set(key, found);
  }
  return found;
}

async function node(env: Env): Promise<string | null> {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir.replace(/^~(?=$|\/)/, os.homedir()), "node");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

const defaultProbes: DirectLaunchProbes = { npmCache, node, platform: process.platform };
