/**
 * What is installed, and whether it is on: `<userData>/plugins/installed.json`.
 *
 * Installing records where a plugin lives. A local plugin is used in place
 * (edit it, press Refresh, see the change), and so is one from a local
 * marketplace; a plugin from a git marketplace or repository is copied into
 * the plugin cache at one commit (`service.ts`). The file also keeps the
 * marketplaces a person added (folders, and git repositories with the commit
 * each was fetched at), whether the default ones were added, the file-type handler choices
 * (extension → `<pluginId>/<toolId>` or "builtin") and which plugins a
 * project allowed to open its files. Plain `node:fs`, so it is testable
 * without Electron.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { PluginSourceSchema, type PluginSource } from "../../shared/plugins";

const InstalledSchema = z.object({
  id: z.string(),
  source: PluginSourceSchema,
  enabled: z.boolean().default(true),
  installedAt: z.number().default(0),
  /** Skills of this plugin the person turned off; a new session does not get them. */
  disabledSkills: z.array(z.string()).default([]),
});
export type InstalledPlugin = z.infer<typeof InstalledSchema>;

/** A marketplace in a git repository, cloned into `dir`. */
const RemoteMarketplaceSchema = z.object({
  url: z.string(),
  ref: z.string().nullable().default(null),
  /** Where its clone is: `<userData>/plugins/marketplaces/<slug>`. */
  dir: z.string(),
  /** The commit the clone is at, or null before the first fetch finished. */
  commit: z.string().nullable().default(null),
  fetchedAt: z.number().nullable().default(null),
  /** Why the last fetch failed, or null. */
  error: z.string().nullable().default(null),
});
export type RemoteMarketplace = z.infer<typeof RemoteMarketplaceSchema>;

const FileSchema = z.object({
  version: z.literal(1).default(1),
  plugins: z.array(InstalledSchema).default([]),
  marketplaces: z.array(z.string()).default([]),
  remoteMarketplaces: z.array(RemoteMarketplaceSchema).default([]),
  /** The default marketplaces were offered once; removing one keeps it removed. */
  defaultsAdded: z.boolean().default(false),
  /** Extension (no dot, lowercase) → "builtin" or `<pluginId>/<toolId>`. Unset: the plugin's, when one claims it. */
  fileHandlers: z.record(z.string(), z.string()).default({}),
  /** `<projectPath>` → plugin ids allowed to open its files without asking. */
  fileConsent: z.record(z.string(), z.array(z.string())).default({}),
});
type RegistryFile = z.infer<typeof FileSchema>;

export class PluginRegistry {
  private data: RegistryFile;

  constructor(private readonly file: string) {
    this.data = this.read();
  }

  private read(): RegistryFile {
    try {
      return FileSchema.parse(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // A file a newer build wrote, or one a person broke by hand: kept aside, never overwritten blind.
        console.error(`[plugins] ${this.file} could not be read; starting empty and keeping the old file as .bad:`, error);
        try { fs.renameSync(this.file, `${this.file}.bad`); } catch { /* nothing to keep */ }
      }
      return FileSchema.parse({});
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`);
    fs.renameSync(temporary, this.file);
  }

  list(): InstalledPlugin[] {
    return this.data.plugins.map((plugin) => ({ ...plugin }));
  }

  get(id: string): InstalledPlugin | null {
    return this.data.plugins.find((plugin) => plugin.id === id) ?? null;
  }

  /** Add or replace a plugin by id; a reinstall keeps its enabled state off only if it was off. */
  install(id: string, source: PluginSource, now = Date.now()): InstalledPlugin {
    const previous = this.get(id);
    const entry = { id, source, enabled: previous?.enabled ?? true, installedAt: previous?.installedAt ?? now, disabledSkills: previous?.disabledSkills ?? [] };
    this.data.plugins = [...this.data.plugins.filter((plugin) => plugin.id !== id), entry];
    this.write();
    return entry;
  }

  uninstall(id: string): boolean {
    const before = this.data.plugins.length;
    this.data.plugins = this.data.plugins.filter((plugin) => plugin.id !== id);
    // Its handler choices and consents go with it.
    for (const [extension, handler] of Object.entries(this.data.fileHandlers)) {
      if (handler.startsWith(`${id}/`)) delete this.data.fileHandlers[extension];
    }
    for (const [project, allowed] of Object.entries(this.data.fileConsent)) {
      this.data.fileConsent[project] = allowed.filter((plugin) => plugin !== id);
    }
    this.write();
    return this.data.plugins.length !== before;
  }

  /** Turn one of a plugin's skills off (or back on); the plugin stays on. */
  setSkillEnabled(id: string, skill: string, enabled: boolean): InstalledPlugin {
    const entry = this.get(id);
    if (!entry) throw new Error(`no plugin "${id}" is installed`);
    const off = new Set(entry.disabledSkills);
    if (enabled) off.delete(skill); else off.add(skill);
    const next = { ...entry, disabledSkills: [...off].sort() };
    this.data.plugins = this.data.plugins.map((plugin) => plugin.id === id ? next : plugin);
    this.write();
    return next;
  }

  setEnabled(id: string, enabled: boolean): InstalledPlugin {
    const entry = this.get(id);
    if (!entry) throw new Error(`no plugin "${id}" is installed`);
    this.data.plugins = this.data.plugins.map((plugin) => plugin.id === id ? { ...plugin, enabled } : plugin);
    this.write();
    return { ...entry, enabled };
  }

  marketplaces(): string[] {
    return [...this.data.marketplaces];
  }

  addMarketplace(file: string): void {
    if (!this.data.marketplaces.includes(file)) {
      this.data.marketplaces = [...this.data.marketplaces, file];
      this.write();
    }
  }

  removeMarketplace(file: string): void {
    this.data.marketplaces = this.data.marketplaces.filter((entry) => entry !== file);
    this.write();
  }

  remoteMarketplaces(): RemoteMarketplace[] {
    return this.data.remoteMarketplaces.map((entry) => ({ ...entry }));
  }

  /** Add or update a git marketplace, by its clone folder. */
  putRemoteMarketplace(entry: RemoteMarketplace): void {
    this.data.remoteMarketplaces = [...this.data.remoteMarketplaces.filter((item) => item.dir !== entry.dir), entry];
    this.write();
  }

  removeRemoteMarketplace(dir: string): void {
    this.data.remoteMarketplaces = this.data.remoteMarketplaces.filter((item) => item.dir !== dir);
    this.write();
  }

  defaultsAdded(): boolean {
    return this.data.defaultsAdded;
  }

  markDefaultsAdded(): void {
    this.data.defaultsAdded = true;
    this.write();
  }

  fileHandlers(): Record<string, string> {
    return { ...this.data.fileHandlers };
  }

  /** Choose a handler for an extension; null puts it back to the default. */
  setFileHandler(extension: string, handler: string | null): void {
    const key = extension.replace(/^\./, "").toLowerCase();
    if (handler === null) delete this.data.fileHandlers[key];
    else this.data.fileHandlers[key] = handler;
    this.write();
  }

  fileConsent(): Record<string, string[]> {
    return Object.fromEntries(Object.entries(this.data.fileConsent).map(([project, ids]) => [project, [...ids]]));
  }

  allowFiles(projectPath: string, pluginId: string): void {
    const allowed = new Set(this.data.fileConsent[projectPath] ?? []);
    allowed.add(pluginId);
    this.data.fileConsent[projectPath] = [...allowed];
    this.write();
  }
}
