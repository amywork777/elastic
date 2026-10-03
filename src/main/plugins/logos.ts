/**
 * Logos for catalog cards whose plugin carries none, fetched once by main and
 * kept in `<userData>/plugins/logos.json`.
 *
 * Where a logo comes from (`logoSource`): the product's own site's
 * `/favicon.ico`, or, for a plugin that lives in someone's GitHub repository,
 * that owner's avatar (`github.com/<owner>.png`). A catalog's own repository
 * (Anthropic's, OpenAI's) says nothing about the plugin, so its owner is never
 * used. Only images are kept, and only small ones (they ride in every
 * snapshot); a miss is remembered too, so a site without a favicon is not
 * asked again on every launch, and asked again after a week.
 *
 * Plain `node:fs` and an injectable `fetch`, so it is testable without
 * Electron or the network.
 */
import fs from "node:fs";
import path from "node:path";

import type { CatalogEntry } from "../../shared/plugins";
import { isRepoPage } from "./catalog";

export const LOGO_BYTES = 24 * 1024;
const MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"]);
/** Repositories that hold catalogs: their owner is the catalog's, not the plugin's. */
const CATALOG_OWNERS = new Set(["anthropics", "openai", "earthtojake"]);

type Cached = { logo: string | null; at: number };

/** Where to fetch a card's logo from, or null when nothing says. */
export function logoSource(entry: Pick<CatalogEntry, "homepage" | "sources">): string | null {
  if (entry.homepage && !isRepoPage(entry.homepage)) {
    try {
      const url = new URL(entry.homepage);
      if (url.protocol === "https:") return `https://${url.host}/favicon.ico`;
    } catch { /* not a URL */ }
  }
  for (const candidate of [entry.homepage, ...entry.sources.map((source) => source.url)]) {
    const owner = candidate ? /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\//i.exec(candidate)?.[1] : undefined;
    if (owner && !CATALOG_OWNERS.has(owner.toLowerCase())) return `https://github.com/${owner}.png?size=64`;
  }
  return null;
}

export class LogoCache {
  private cache: Record<string, Cached>;
  private readonly pending = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.cache = this.read();
  }

  private read(): Record<string, Cached> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, Cached>;
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.cache));
      fs.renameSync(temporary, this.file);
    } catch (error) {
      console.warn("[plugins] logo cache not written:", error instanceof Error ? error.message : error);
    }
  }

  /** The cached logo for a source URL, or null. */
  get(source: string): string | null {
    return this.cache[source]?.logo ?? null;
  }

  /** Cards without a logo get the cached one; answers the sources still worth fetching. */
  fill(catalog: CatalogEntry[]): { catalog: CatalogEntry[]; missing: string[] } {
    const missing = new Set<string>();
    const filled = catalog.map((entry) => {
      if (entry.logo) return entry;
      const source = logoSource(entry);
      if (!source) return entry;
      const cached = this.cache[source];
      if (cached?.logo) return { ...entry, logo: cached.logo };
      if (!cached || this.now() - cached.at > MISS_RETRY_MS) missing.add(source);
      return entry;
    });
    return { catalog: filled, missing: [...missing] };
  }

  /** Fetch each source once (four at a time); answers whether any logo arrived. */
  async fetchAll(sources: readonly string[]): Promise<boolean> {
    const queue = sources.filter((source) => !this.pending.has(source));
    for (const source of queue) this.pending.add(source);
    let found = false;
    const worker = async () => {
      for (let source = queue.shift(); source !== undefined; source = queue.shift()) {
        const logo = await this.fetchOne(source);
        this.cache[source] = { logo, at: this.now() };
        this.pending.delete(source);
        if (logo) found = true;
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (sources.length > 0) this.write();
    return found;
  }

  private async fetchOne(source: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetcher(source, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) return null;
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!IMAGE_TYPES.has(type)) return null;
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > LOGO_BYTES) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > LOGO_BYTES) return null;
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
