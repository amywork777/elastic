/**
 * A provider's Test button: one cheap real request that says whether the key
 * or the server works, and lists the models it offers where it can. Never a
 * paid generation: a model list, a key check, a local server's tags.
 */
import { DEFAULT_OLLAMA_URL, OPENAI_URL, protocolOf, type Provider, type ProviderTest } from "../../shared/providers";

type Fetch = typeof fetch;

const TIMEOUT_MS = 10_000;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function getJson(fetchFn: Fetch, url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

function ids(body: unknown, field: "data" | "models", key: "id" | "name"): string[] {
  const list = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : null;
  return Array.isArray(list)
    ? list.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>)[key] === "string" ? [(entry as Record<string, string>)[key]!] : [])).slice(0, 500)
    : [];
}

function failed(status: number, what: string): ProviderTest {
  const reason = status === 401 || status === 403 ? "the key was refused" : `the server answered ${status}`;
  return { ok: false, message: `${what}: ${reason}.`, models: [] };
}

export async function testProvider(provider: Provider, key: string | null, fetchFn: Fetch = fetch): Promise<ProviderTest> {
  try {
    switch (provider.kind) {
      case "anthropic": {
        if (!key) return { ok: false, message: "Add a key first.", models: [] };
        const { status, body } = await getJson(fetchFn, "https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" });
        if (status !== 200) return failed(status, "Anthropic");
        const models = ids(body, "data", "id");
        return { ok: true, message: `Key works. ${models.length} models.`, models };
      }
      case "openai": {
        if (!key) return { ok: false, message: "Add a key first.", models: [] };
        const { status, body } = await getJson(fetchFn, `${OPENAI_URL}/models`, { Authorization: `Bearer ${key}` });
        if (status !== 200) return failed(status, "OpenAI");
        const models = ids(body, "data", "id").filter((id) => /^(gpt|o\d|codex)/i.test(id));
        return { ok: true, message: `Key works. ${models.length} models.`, models };
      }
      case "openrouter": {
        if (!key) return { ok: false, message: "Add a key first.", models: [] };
        const check = await getJson(fetchFn, "https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` });
        if (check.status !== 200) return failed(check.status, "OpenRouter");
        const { body } = await getJson(fetchFn, "https://openrouter.ai/api/v1/models", {});
        const models = ids(body, "data", "id");
        return { ok: true, message: `Key works. ${models.length} models.`, models };
      }
      case "ollama": {
        const base = trimSlash(provider.baseUrl ?? DEFAULT_OLLAMA_URL);
        const { status, body } = await getJson(fetchFn, `${base}/api/tags`, {});
        if (status !== 200) return failed(status, "Ollama");
        const models = ids(body, "models", "name");
        return models.length > 0
          ? { ok: true, message: `Ollama is running. ${models.length} models.`, models }
          : { ok: true, message: "Ollama is running but has no models. Pull one with `ollama pull <model>`.", models };
      }
      case "custom": {
        if (!provider.baseUrl) return { ok: false, message: "Add the endpoint's URL first.", models: [] };
        const base = trimSlash(provider.baseUrl);
        const headers: Record<string, string> = protocolOf(provider) === "anthropic"
          ? { ...(key ? { "x-api-key": key, Authorization: `Bearer ${key}` } : {}), "anthropic-version": "2023-06-01" }
          : key ? { Authorization: `Bearer ${key}` } : {};
        const { status, body } = await getJson(fetchFn, `${base}/models`, headers);
        const second = status === 404 ? await getJson(fetchFn, `${base}/v1/models`, headers) : { status, body };
        if (second.status !== 200) return failed(second.status, "The endpoint");
        const models = ids(second.body, "data", "id");
        return { ok: true, message: `The endpoint answered. ${models.length} models.`, models };
      }
    }
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "no answer within 10 s" : error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not reach it: ${reason}.`, models: [] };
  }
}
