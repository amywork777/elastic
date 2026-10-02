/**
 * Compose the app's skills into `resources/skills/`.
 *
 * The app hands its skills to every session itself — nothing is installed into
 * an agent's global configuration. What ships is the focused skill each
 * integration in the registry declares (`skills/<name>`); a plugin's skills
 * are added at run time, while it is enabled (`src/main/integrations/index.ts`).
 * One skill per directory, exactly as it is in the repository: no manifest, no
 * version stamp — the version is the app's, and
 * `src/main/integrations/skills.ts` records it where it materialises the root.
 *
 * Copies, never symlinks (`cpSync` with `dereference`, then a walk that fails
 * the build if a link survived): agent installers disagree about symlinks and
 * one drops them silently.
 *
 *   node scripts/build-skills.mjs                 # -> resources/skills
 *   node scripts/build-skills.mjs --out <dir>
 *
 * Runs as part of `npm run build` and of packaging (scripts/build.mjs); the
 * flag exists for the unit test, which composes into a temporary directory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { integrations } from "../src/main/integrations/registry.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Focused skills declared by app integrations. */
export const APP_SKILLS = integrations.flatMap(integration => integration.skills);

/** Never copied out of a skill directory: caches, envs, scratch. */
const SKIP_ENTRIES = new Set(["node_modules", "__pycache__", ".venv", "tmp", ".DS_Store", ".pytest_cache"]);

function copyTree(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => !SKIP_ENTRIES.has(path.basename(source)),
  });
}

/** Every symlink under `root`, for the assertion. */
function findSymlinks(root) {
  const links = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links.push(full);
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(root);
  return links;
}

/** Which skills the app carries: the ones its integrations declare. */
export function planSkills(desktopRoot = appRoot) {
  const skills = APP_SKILLS.map(relative => {
    const from = path.join(desktopRoot, relative);
    if (!fs.existsSync(path.join(from, "SKILL.md"))) throw new Error(`missing ${from}/SKILL.md`);
    return { name: path.basename(from), from };
  });
  if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error("Duplicate registered skill identity");
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSkills({ out, desktopRoot = appRoot }) {
  const skills = planSkills(desktopRoot);

  // A clean slate, keeping the placeholder that makes the directory exist in git.
  fs.mkdirSync(out, { recursive: true });
  for (const entry of fs.readdirSync(out)) {
    if (entry !== ".gitkeep") {
      fs.rmSync(path.join(out, entry), { recursive: true, force: true });
    }
  }

  for (const skill of skills) {
    copyTree(skill.from, path.join(out, skill.name));
  }

  const links = findSymlinks(out);
  if (links.length > 0) {
    throw new Error(`symlinks in the composed skills (some installers drop them silently):\n  ${links.join("\n  ")}`);
  }
  return { out, skills: skills.map((skill) => skill.name) };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const out = options.out ? path.resolve(options.out) : path.join(appRoot, "resources", "skills");
  const result = buildSkills({ out });
  console.info(`composed ${result.skills.length} skills -> ${result.out}`);
  console.info(`  ${result.skills.join(", ")}`);
}
