import { describe, expect, it } from "vitest";

import {
  ProviderSchema,
  agentFor,
  newProviderId,
  providerGroupLabel,
  providerReady,
  rememberModel,
  routeFor,
  type Provider,
} from "@shared/providers";

const provider = (fields: Partial<Provider> & Pick<Provider, "kind">): Provider =>
  ProviderSchema.parse({ id: fields.kind, label: fields.kind, ...fields });

describe("routing a provider to an agent", () => {
  it("runs Anthropic-protocol providers through Claude Code and the rest by protocol", () => {
    expect(agentFor(provider({ kind: "anthropic" }))).toBe("claude-code");
    expect(agentFor(provider({ kind: "openrouter" }))).toBe("claude-code");
    expect(agentFor(provider({ kind: "ollama" }))).toBe("claude-code");
    expect(agentFor(provider({ kind: "openai" }))).toBe("codex");
    expect(agentFor(provider({ kind: "custom", protocol: "openai-responses" }))).toBe("codex");
    expect(agentFor(provider({ kind: "custom", protocol: "openai-chat" }))).toBe("opencode");
    expect(agentFor(provider({ kind: "custom", protocol: "anthropic" }))).toBe("claude-code");
    expect(providerGroupLabel(provider({ kind: "openrouter", label: "OpenRouter" }))).toBe("OpenRouter (via Claude Code)");
  });

  it("gives an Anthropic key to Claude Code's environment, and its model to every tier", () => {
    const route = routeFor(provider({ kind: "anthropic" }), "sk-ant", "claude-x");
    expect(route).toMatchObject({ agentId: "claude-code", setProvider: null, model: "claude-x" });
    expect(route.env).toMatchObject({ ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_MODEL: "claude-x", ANTHROPIC_SMALL_FAST_MODEL: "claude-x", CLAUDE_CODE_SUBAGENT_MODEL: "claude-x" });
  });

  it("sets OpenRouter and Ollama as Claude Code's provider, the key only as a header", () => {
    const openrouter = routeFor(provider({ kind: "openrouter" }), "sk-or", "openai/gpt-x");
    expect(openrouter.setProvider).toEqual({ providerId: "main", apiType: "anthropic", baseUrl: "https://openrouter.ai/api", headers: { Authorization: "Bearer sk-or" } });
    expect(JSON.stringify(openrouter.env)).not.toContain("sk-or");
    const ollama = routeFor(provider({ kind: "ollama", defaultModel: "qwen" }), null, null);
    expect(ollama.setProvider).toMatchObject({ baseUrl: "http://127.0.0.1:11434", headers: {} });
    expect(ollama.model).toBe("qwen");
    expect(ollama.env.ANTHROPIC_MODEL).toBe("qwen");
  });

  it("sets an OpenAI key as Codex's gateway, so it wins over a ChatGPT login, and the model through CODEX_CONFIG", () => {
    const route = routeFor(provider({ kind: "openai", label: "OpenAI API key" }), "sk-oa", "gpt-x");
    expect(route).toMatchObject({ agentId: "codex", setProvider: { providerId: "openai", apiType: "openai", baseUrl: "https://api.openai.com/v1", headers: { Authorization: "Bearer sk-oa" }, providerName: "OpenAI API key" } });
    expect(JSON.parse(route.env.CODEX_CONFIG!)).toEqual({ model: "gpt-x" });
  });

  it("defines an OpenAI Chat endpoint inline for OpenCode", () => {
    const route = routeFor(provider({ kind: "custom", protocol: "openai-chat", label: "Groq", baseUrl: "https://api.groq.com/openai/v1" }), "gsk", "llama-x");
    expect(route.agentId).toBe("opencode");
    const config = JSON.parse(route.env.OPENCODE_CONFIG_CONTENT!);
    expect(config.model).toBe("elastic/llama-x");
    expect(config.provider.elastic.options).toEqual({ baseURL: "https://api.groq.com/openai/v1", apiKey: "gsk" });
  });
});

describe("provider bookkeeping", () => {
  it("is ready only with what it needs", () => {
    expect(providerReady(provider({ kind: "openrouter" }))).toBe(false);
    expect(providerReady(provider({ kind: "openrouter", hasKey: true }))).toBe(true);
    expect(providerReady(provider({ kind: "ollama" }))).toBe(true);
    expect(providerReady(provider({ kind: "custom" }))).toBe(false);
  });

  it("names a second provider of a kind, and keeps recent models newest first without repeats", () => {
    expect(newProviderId("custom", [])).toBe("custom");
    expect(newProviderId("custom", ["custom", "custom-2"])).toBe("custom-3");
    expect(rememberModel(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("refuses a base URL that is not http(s)", () => {
    expect(ProviderSchema.safeParse({ id: "x", kind: "custom", label: "x", baseUrl: "file:///etc" }).success).toBe(false);
  });
});
