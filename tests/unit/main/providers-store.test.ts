import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderStore } from "@main/providers/store";
import { testProvider } from "@main/providers/test";

let dir: string;
let file: string;
const codec = { seal: (text: string) => `sealed:${Buffer.from(text).toString("base64")}`, open: (sealed: string) => Buffer.from(sealed.slice(7), "base64").toString() };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-providers-")); file = path.join(dir, "providers.json"); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the provider store", () => {
  it("seals keys apart from the records, and never lists one", () => {
    const store = new ProviderStore(file, codec);
    const saved = store.save({ kind: "openrouter", key: "sk-or-secret" });
    expect(saved).toMatchObject({ id: "openrouter", label: "OpenRouter", hasKey: true });
    expect(fs.readFileSync(file, "utf8")).not.toContain("sk-or-secret");
    expect(JSON.stringify(store.list())).not.toContain("sk-or-secret");
    expect(store.key("openrouter")).toBe("sk-or-secret");
  });

  it("keeps a stored key when Save leaves it out, clears it on null, and forgets everything on remove", () => {
    const store = new ProviderStore(file, codec);
    store.save({ kind: "openai", key: "sk-1" });
    store.save({ id: "openai", kind: "openai", label: "Work key" });
    expect(store.key("openai")).toBe("sk-1");
    expect(store.get("openai")?.label).toBe("Work key");
    store.save({ id: "openai", kind: "openai", key: null });
    expect(store.get("openai")?.hasKey).toBe(false);
    store.remove("openai");
    expect(store.list()).toEqual([]);
  });

  it("remembers recent models and survives a bad record", () => {
    const store = new ProviderStore(file, codec);
    store.save({ kind: "ollama" });
    store.remember("ollama", "qwen");
    store.remember("ollama", "llama");
    expect(store.get("ollama")?.recentModels).toEqual(["llama", "qwen"]);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.providers.push({ id: "", kind: "nope" });
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(store.list().map((provider) => provider.id)).toEqual(["ollama"]);
  });
});

describe("the Test button", () => {
  const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("lists a local Ollama's models", async () => {
    const store = new ProviderStore(file, codec);
    const ollama = store.save({ kind: "ollama" });
    const result = await testProvider(ollama, null, (async (url: string) => {
      expect(url).toBe("http://127.0.0.1:11434/api/tags");
      return response(200, { models: [{ name: "qwen2.5vl:3b" }] });
    }) as typeof fetch);
    expect(result).toEqual({ ok: true, message: "Ollama is running. 1 models.", models: ["qwen2.5vl:3b"] });
  });

  it("says when a key is refused, and asks for a key before trying", async () => {
    const store = new ProviderStore(file, codec);
    const openai = store.save({ kind: "openai", key: "bad" });
    const refused = await testProvider(openai, "bad", (async () => response(401, {})) as typeof fetch);
    expect(refused).toMatchObject({ ok: false, message: "OpenAI: the key was refused." });
    expect(await testProvider({ ...openai, hasKey: false }, null)).toMatchObject({ ok: false, message: "Add a key first." });
  });

  it("says when nothing answers", async () => {
    const store = new ProviderStore(file, codec);
    const ollama = store.save({ kind: "ollama", baseUrl: "http://127.0.0.1:1" });
    const result = await testProvider(ollama, null, (async () => { throw new Error("connect ECONNREFUSED"); }) as typeof fetch);
    expect(result).toMatchObject({ ok: false, message: "Could not reach it: connect ECONNREFUSED." });
  });
});
