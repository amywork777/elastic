/**
 * The providers a person added in Settings › Models & keys, in one JSON file
 * under the app's data directory. Keys are sealed apart from the records with
 * the same `Codec` plugin sign-ins use (Electron's `safeStorage` in the app),
 * so the record the renderer reads never carries one. Nothing here writes to
 * an agent's own configuration (`~/.claude`, `~/.codex`).
 */
import fs from "node:fs";
import path from "node:path";

import { PLAIN_CODEC, type Codec } from "../plugins/oauth";
import {
  KIND_LABELS,
  ProviderSchema,
  newProviderId,
  rememberModel,
  type Provider,
  type ProviderInput,
} from "../../shared/providers";

type Stored = { providers: Provider[]; keys: Record<string, string> };

export class ProviderStore {
  constructor(private readonly file: string, private readonly codec: Codec = PLAIN_CODEC) {}

  private read(): Stored {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { providers?: unknown; keys?: unknown };
      // One bad record never takes the others with it.
      const providers = Array.isArray(raw.providers)
        ? raw.providers.flatMap((entry) => {
            const parsed = ProviderSchema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      const keys = raw.keys && typeof raw.keys === "object" ? raw.keys as Record<string, string> : {};
      return { providers, keys };
    } catch {
      return { providers: [], keys: {} };
    }
  }

  private write(stored: Stored): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  list(): Provider[] {
    const { providers, keys } = this.read();
    return providers.map((provider) => ({ ...provider, hasKey: Boolean(keys[provider.id]) }));
  }

  get(id: string): Provider | null {
    return this.list().find((provider) => provider.id === id) ?? null;
  }

  /** The stored key, unsealed. Main only: it never crosses IPC. */
  key(id: string): string | null {
    const sealed = this.read().keys[id];
    if (!sealed) return null;
    try {
      return this.codec.open(sealed);
    } catch {
      return null;
    }
  }

  save(input: ProviderInput): Provider {
    const stored = this.read();
    const id = input.id ?? newProviderId(input.kind, stored.providers.map((provider) => provider.id));
    const existing = stored.providers.find((provider) => provider.id === id);
    const next = ProviderSchema.parse({
      ...existing,
      id,
      kind: input.kind,
      label: input.label ?? existing?.label ?? KIND_LABELS[input.kind],
      baseUrl: input.baseUrl === undefined ? (existing?.baseUrl ?? null) : input.baseUrl,
      protocol: input.kind === "custom" ? (input.protocol === undefined ? (existing?.protocol ?? "openai-chat") : input.protocol) : null,
      defaultModel: input.defaultModel === undefined ? (existing?.defaultModel ?? null) : input.defaultModel,
      recentModels: existing?.recentModels ?? [],
      hasKey: false,
    });
    const providers = existing ? stored.providers.map((provider) => (provider.id === id ? next : provider)) : [...stored.providers, next];
    const keys = { ...stored.keys };
    if (input.key === null) delete keys[id];
    else if (input.key !== undefined) keys[id] = this.codec.seal(input.key);
    this.write({ providers, keys });
    return { ...next, hasKey: Boolean(keys[id]) };
  }

  remove(id: string): void {
    const stored = this.read();
    const keys = { ...stored.keys };
    delete keys[id];
    this.write({ providers: stored.providers.filter((provider) => provider.id !== id), keys });
  }

  /** A model was used on this provider: it heads the picker's "recently used". */
  remember(id: string, model: string): void {
    const stored = this.read();
    this.write({
      ...stored,
      providers: stored.providers.map((provider) => (provider.id === id ? { ...provider, recentModels: rememberModel(provider.recentModels, model) } : provider)),
    });
  }
}
