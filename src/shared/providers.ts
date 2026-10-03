/**
 * Models & keys: the providers a person adds (an API key, a local server, a
 * gateway) and how each reaches a model through an agent elastic already runs.
 * There is no agent loop of elastic's own. Each provider is routed to the agent
 * that speaks its protocol:
 *
 *   - Anthropic Messages (Anthropic, OpenRouter, Ollama, a custom gateway) runs
 *     through Claude Code: `providers/set` on claude-agent-acp 0.84.0
 *     (`unstable_setProvider`, providerId `main`, apiType `anthropic`), or, for
 *     an Anthropic API key, `ANTHROPIC_API_KEY` in the adapter's environment.
 *   - OpenAI Responses (OpenAI, a custom gateway) runs through Codex:
 *     `providers/set` on codex-acp 1.13.1 (providerId `openai`, apiType
 *     `openai`, which it maps to `wire_api = "responses"`).
 *   - Anything else that speaks OpenAI Chat Completions (Groq, Gemini's
 *     OpenAI endpoint, LM Studio, vLLM) runs through OpenCode, configured by
 *     `OPENCODE_CONFIG_CONTENT`.
 *
 * Every session has its own adapter process (`src/main/acp/connection.ts`), so a
 * provider set on one is that session's alone. Keys never enter `~/.claude` or
 * `~/.codex`: they reach the adapter as a header or an environment variable.
 *
 * Pure and dependency-free (zod aside): the renderer imports it.
 */
import { z } from "zod";

export const ProviderKindSchema = z.enum(["anthropic", "openai", "openrouter", "ollama", "custom"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProviderProtocolSchema = z.enum(["anthropic", "openai-responses", "openai-chat"]);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

/** The agents a provider can run through. */
export type ProviderAgentId = "claude-code" | "codex" | "opencode";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const OPENROUTER_ANTHROPIC_URL = "https://openrouter.ai/api";
export const OPENAI_URL = "https://api.openai.com/v1";

const url = z.string().trim().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}, "an http(s) URL");
const modelId = z.string().trim().min(1).max(200);

/** A provider as the renderer sees it: never its key, only whether one is stored. */
export const ProviderSchema = z.object({
  id: z.string().min(1).max(64),
  kind: ProviderKindSchema,
  label: z.string().min(1).max(80),
  /** Ollama's server, or a custom endpoint. */
  baseUrl: url.nullable().default(null),
  /** A custom endpoint's protocol; the others' is fixed by their kind. */
  protocol: ProviderProtocolSchema.nullable().default(null),
  hasKey: z.boolean().default(false),
  /** The model a new chat with this provider starts on. */
  defaultModel: modelId.nullable().default(null),
  /** Models picked before, newest first: the picker's "recently used". */
  recentModels: z.array(modelId).max(12).default([]),
});
export type Provider = z.infer<typeof ProviderSchema>;

/** What Save sends. `key` absent keeps the stored key; null clears it. */
export const ProviderInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  kind: ProviderKindSchema,
  label: z.string().trim().min(1).max(80).optional(),
  baseUrl: url.nullable().optional(),
  protocol: ProviderProtocolSchema.nullable().optional(),
  key: z.string().trim().min(1).max(4096).nullable().optional(),
  defaultModel: modelId.nullable().optional(),
}).strict();
export type ProviderInput = z.infer<typeof ProviderInputSchema>;

/** What a session records: which provider runs it, on which model. */
export const SessionProviderSchema = z.object({ id: z.string().min(1).max(64), model: modelId.nullable() });
export type SessionProvider = z.infer<typeof SessionProviderSchema>;

/** The result of a provider's Test button. */
export const ProviderTestSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  models: z.array(z.string()).max(500).default([]),
});
export type ProviderTest = z.infer<typeof ProviderTestSchema>;

export const KIND_LABELS: Record<ProviderKind, string> = {
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  custom: "Custom endpoint",
};

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  anthropic: "Anthropic Messages",
  "openai-responses": "OpenAI Responses",
  "openai-chat": "OpenAI Chat Completions",
};

export const AGENT_NAMES: Record<ProviderAgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

/** The protocol a provider speaks. */
export function protocolOf(provider: Pick<Provider, "kind" | "protocol">): ProviderProtocol {
  switch (provider.kind) {
    case "anthropic":
    case "openrouter":
    case "ollama":
      return "anthropic";
    case "openai":
      return "openai-responses";
    case "custom":
      return provider.protocol ?? "openai-chat";
  }
}

/** The agent that speaks a protocol. */
export function agentForProtocol(protocol: ProviderProtocol): ProviderAgentId {
  return protocol === "anthropic" ? "claude-code" : protocol === "openai-responses" ? "codex" : "opencode";
}

/** The agent a provider runs through. */
export function agentFor(provider: Pick<Provider, "kind" | "protocol">): ProviderAgentId {
  return agentForProtocol(protocolOf(provider));
}

/** The group label in the model picker: "OpenRouter (via Claude Code)". */
export function providerGroupLabel(provider: Pick<Provider, "kind" | "protocol" | "label">): string {
  return `${provider.label} (via ${AGENT_NAMES[agentFor(provider)]})`;
}

/** Whether a provider needs a key before it can run anything. */
export function needsKey(provider: Pick<Provider, "kind">): boolean {
  return provider.kind === "anthropic" || provider.kind === "openai" || provider.kind === "openrouter";
}

/** Whether a provider has what it needs to start a chat. */
export function providerReady(provider: Provider): boolean {
  if (needsKey(provider) && !provider.hasKey) return false;
  if (provider.kind === "custom" && !provider.baseUrl) return false;
  return true;
}

/**
 * `providers/set` as an adapter takes it (ACP's unstable `SetProviderRequest`):
 * Claude Code's slot is `main`, Codex's is `openai`.
 */
export type ProviderSet = {
  providerId: "main" | "openai";
  apiType: "anthropic" | "openai";
  baseUrl: string;
  headers: Record<string, string>;
  providerName?: string;
};

/** How one session reaches its model: the agent, its extra environment, and a provider to set. */
export type ProviderRoute = {
  agentId: ProviderAgentId;
  env: Record<string, string>;
  setProvider: ProviderSet | null;
  model: string | null;
};

/**
 * Claude Code asks for its tiers by name (the main model, a fast one for
 * titles and summaries, subagents); behind another provider each of them is
 * the model the person picked, or Claude Code would ask that provider for a
 * Claude model it does not serve.
 */
function claudeModelEnv(model: string | null): Record<string, string> {
  if (!model) return {};
  return {
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
  };
}

/** Codex reads a JSON config from `CODEX_CONFIG` (codex-acp 1.13.1, `startAcpServer`). */
function codexModelEnv(model: string | null): Record<string, string> {
  return model ? { CODEX_CONFIG: JSON.stringify({ model }) } : {};
}

const bearer = (key: string | null): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

/**
 * The route for one session on one provider. `key` is the stored key (main
 * only reads it), `model` the session's model or the provider's default.
 */
export function routeFor(provider: Provider, key: string | null, model: string | null): ProviderRoute {
  const chosen = model ?? provider.defaultModel;
  switch (provider.kind) {
    case "anthropic":
      // An API key is what Claude Code reads from its environment; `providers/set`
      // would also send its own placeholder bearer token beside the key.
      return { agentId: "claude-code", env: { ...(key ? { ANTHROPIC_API_KEY: key } : {}), ...claudeModelEnv(chosen) }, setProvider: null, model: chosen };
    case "openrouter":
      return {
        agentId: "claude-code",
        env: claudeModelEnv(chosen),
        setProvider: { providerId: "main", apiType: "anthropic", baseUrl: OPENROUTER_ANTHROPIC_URL, headers: bearer(key) },
        model: chosen,
      };
    case "ollama":
      return {
        agentId: "claude-code",
        env: claudeModelEnv(chosen),
        setProvider: { providerId: "main", apiType: "anthropic", baseUrl: provider.baseUrl ?? DEFAULT_OLLAMA_URL, headers: {} },
        model: chosen,
      };
    case "openai":
      return {
        agentId: "codex",
        env: codexModelEnv(chosen),
        setProvider: { providerId: "openai", apiType: "openai", baseUrl: OPENAI_URL, headers: bearer(key), providerName: provider.label },
        model: chosen,
      };
    case "custom": {
      const protocol = protocolOf(provider);
      const baseUrl = provider.baseUrl ?? "";
      if (protocol === "anthropic") {
        return { agentId: "claude-code", env: claudeModelEnv(chosen), setProvider: { providerId: "main", apiType: "anthropic", baseUrl, headers: bearer(key) }, model: chosen };
      }
      if (protocol === "openai-responses") {
        return { agentId: "codex", env: codexModelEnv(chosen), setProvider: { providerId: "openai", apiType: "openai", baseUrl, headers: bearer(key), providerName: provider.label }, model: chosen };
      }
      // OpenCode: one provider of its own, defined inline (`OPENCODE_CONFIG_CONTENT`),
      // on the OpenAI-compatible adapter it ships with.
      const models = chosen ? { [chosen]: { name: chosen } } : {};
      const config = {
        provider: { elastic: { npm: "@ai-sdk/openai-compatible", name: provider.label, options: { baseURL: baseUrl, ...(key ? { apiKey: key } : {}) }, models } },
        ...(chosen ? { model: `elastic/${chosen}` } : {}),
      };
      return { agentId: "opencode", env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }, setProvider: null, model: chosen };
    }
  }
}

/** The chip's label for a session on a provider: "qwen2.5vl:3b · Ollama". */
export function providerModelLabel(provider: Pick<Provider, "label">, model: string | null): string {
  return model ? `${model} · ${provider.label}` : provider.label;
}

/** A new provider's id: its kind, and a counter for a second of the same kind. */
export function newProviderId(kind: ProviderKind, taken: readonly string[]): string {
  if (!taken.includes(kind)) return kind;
  for (let n = 2; ; n += 1) {
    const id = `${kind}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/** Remember a model as most recently used. */
export function rememberModel(recent: readonly string[], model: string): string[] {
  return [model, ...recent.filter((entry) => entry !== model)].slice(0, 12);
}
