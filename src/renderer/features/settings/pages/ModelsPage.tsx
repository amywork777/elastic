/**
 * Settings › Models & keys: bring a key, a local server or a gateway, and its
 * models join the composer's model picker. Each provider runs through an agent
 * elastic already has (`src/shared/providers.ts`, `docs/models.md`); the row
 * says which, and Test makes one cheap real request.
 *
 * A key typed here goes to main and is sealed there; nothing on this page ever
 * reads one back (`hasKey` is all the renderer gets).
 */
import { useEffect, useId, useState } from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { Spinner } from "@renderer/components/ui/spinner";
import { SettingCard, SettingRow } from "@renderer/features/settings/SettingCard";
import { providerModels, useProviders } from "@renderer/state/providers";
import {
  AGENT_NAMES,
  DEFAULT_OLLAMA_URL,
  KIND_LABELS,
  PROTOCOL_LABELS,
  agentFor,
  needsKey,
  type Provider,
  type ProviderKind,
  type ProviderProtocol,
} from "@shared/providers";

const KIND_HINTS: Record<ProviderKind, string> = {
  anthropic: "Claude models on your own Anthropic API key.",
  openai: "GPT models on your own OpenAI API key, even when Codex is signed in to ChatGPT.",
  openrouter: "Hundreds of models from one key. Type any model id, like openai/gpt-5 or google/gemini-3-pro.",
  ollama: "Models running on this Mac. Ollama 0.14 or later.",
  custom: "Any gateway: LiteLLM, vLLM, LM Studio, Groq, Azure.",
};

const KINDS: ProviderKind[] = ["anthropic", "openai", "openrouter", "ollama", "custom"];

export function ModelsPage() {
  const { providers, loaded, load } = useProviders();
  const [adding, setAdding] = useState<ProviderKind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SettingCard title="Your providers">
        {!loaded ? (
          <SettingRow description="Reading what you added." title="Loading" />
        ) : providers.length === 0 ? (
          <SettingRow
            description="Add a key or a local server below. Its models show up in the composer's model picker."
            title="Nothing added yet"
          />
        ) : (
          providers.map((provider) =>
            editing === provider.id ? (
              <ProviderForm key={provider.id} kind={provider.kind} onDone={() => setEditing(null)} provider={provider} />
            ) : (
              <ProviderRow key={provider.id} onEdit={() => setEditing(provider.id)} provider={provider} />
            ),
          )
        )}
      </SettingCard>

      <SettingCard title="Add a provider">
        {adding ? (
          <ProviderForm kind={adding} onDone={() => setAdding(null)} />
        ) : (
          KINDS.map((kind) => (
            <SettingRow
              control={
                <Button className="h-8" onClick={() => setAdding(kind)} size="sm" variant="secondary">
                  Add
                </Button>
              }
              description={`${KIND_HINTS[kind]} Runs through ${kind === "custom" ? "Claude Code, Codex or OpenCode, by its protocol" : AGENT_NAMES[agentFor({ kind, protocol: null })]}.`}
              key={kind}
              keywords="api key provider model openrouter ollama gateway"
              title={KIND_LABELS[kind]}
            />
          ))
        )}
      </SettingCard>

      <p className="px-1 text-xs text-muted-foreground">
        Keys are stored in this Mac's keychain and only ever handed to the agent that runs the chat. Non-Claude models through
        Claude Code, or non-OpenAI models through Codex, can use tools less well than in their own agents.
      </p>
    </>
  );
}

function ProviderRow({ provider, onEdit }: { provider: Provider; onEdit: () => void }) {
  const test = useProviders((state) => state.tests[provider.id]);
  const runTest = useProviders((state) => state.test);
  const remove = useProviders((state) => state.remove);
  const agent = AGENT_NAMES[agentFor(provider)];
  const missing = needsKey(provider) && !provider.hasKey ? "No key saved. " : "";
  const model = provider.defaultModel ? ` Default model: ${provider.defaultModel}.` : "";
  const result = test === "testing" ? "Testing…" : test ? test.message : "";
  return (
    <SettingRow
      control={
        <div className="flex items-center gap-1.5">
          <Button className="h-8" disabled={test === "testing"} onClick={() => void runTest(provider.id)} size="sm" variant="secondary">
            {test === "testing" ? <Spinner className="size-3.5" /> : null}
            Test
          </Button>
          <Button className="h-8" onClick={onEdit} size="sm" variant="ghost">
            Edit
          </Button>
          <Button className="h-8" onClick={() => void remove(provider.id)} size="sm" variant="ghost">
            Remove
          </Button>
        </div>
      }
      description={`${missing}Powers ${agent}.${model}${result ? ` ${result}` : ""}`}
      keywords={`${provider.kind} ${agent}`}
      live
      title={provider.label}
    />
  );
}

function ProviderForm({ kind, provider, onDone }: { kind: ProviderKind; provider?: Provider; onDone: () => void }) {
  const save = useProviders((state) => state.save);
  const runTest = useProviders((state) => state.test);
  const test = useProviders((state) => (provider ? state.tests[provider.id] : undefined));
  const [label, setLabel] = useState(provider?.label ?? KIND_LABELS[kind]);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? (kind === "ollama" ? DEFAULT_OLLAMA_URL : ""));
  const [protocol, setProtocol] = useState<ProviderProtocol>(provider?.protocol ?? "openai-chat");
  const [model, setModel] = useState(provider?.defaultModel ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { label: useId(), key: useId(), url: useId(), protocol: useId(), model: useId(), models: useId() };
  const offered = provider ? providerModels(provider, test) : [];
  const keyRequired = needsKey({ kind }) && !provider?.hasKey;
  const urlShown = kind === "ollama" || kind === "custom";

  const submit = async () => {
    if (keyRequired && !key.trim()) return setProblem("Paste the key first.");
    if (kind === "custom" && !baseUrl.trim()) return setProblem("Add the endpoint's URL.");
    setSaving(true);
    const saved = await save({
      ...(provider ? { id: provider.id } : {}),
      kind,
      label: label.trim() || KIND_LABELS[kind],
      ...(urlShown ? { baseUrl: baseUrl.trim() || null } : {}),
      ...(kind === "custom" ? { protocol } : {}),
      ...(key.trim() ? { key: key.trim() } : {}),
      defaultModel: model.trim() || null,
    });
    setSaving(false);
    if (!saved) return;
    // A first save tests at once, so the picker has the models to offer.
    void runTest(saved.id);
    onDone();
  };

  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-sm font-medium">{provider ? `Edit ${provider.label}` : `Add ${KIND_LABELS[kind]}`}</div>
      <p className="text-xs text-muted-foreground">{KIND_HINTS[kind]}</p>
      <Field id={ids.label} label="Name">
        <Input id={ids.label} onChange={(event) => setLabel(event.target.value)} value={label} />
      </Field>
      {kind !== "ollama" ? (
        <Field id={ids.key} label={provider?.hasKey ? "Key (saved; paste a new one to replace it)" : kind === "custom" ? "Key (if it needs one)" : "Key"}>
          <Input autoComplete="off" id={ids.key} onChange={(event) => setKey(event.target.value)} spellCheck={false} type="password" value={key} />
        </Field>
      ) : null}
      {urlShown ? (
        <Field id={ids.url} label={kind === "ollama" ? "Server" : "Base URL"}>
          <Input id={ids.url} onChange={(event) => setBaseUrl(event.target.value)} placeholder={kind === "ollama" ? DEFAULT_OLLAMA_URL : "https://…/v1"} spellCheck={false} value={baseUrl} />
        </Field>
      ) : null}
      {kind === "custom" ? (
        <Field id={ids.protocol} label="Protocol">
          <Select onValueChange={(value) => setProtocol(value as ProviderProtocol)} value={protocol}>
            <SelectTrigger className="h-9 w-full" id={ids.protocol}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROTOCOL_LABELS) as ProviderProtocol[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {PROTOCOL_LABELS[value]} (through {AGENT_NAMES[agentFor({ kind: "custom", protocol: value })]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <Field id={ids.model} label="Default model (optional)">
        <Input
          id={ids.model}
          list={offered.length > 0 ? ids.models : undefined}
          onChange={(event) => setModel(event.target.value)}
          placeholder={kind === "openrouter" ? "anthropic/claude-sonnet-4.5" : kind === "ollama" ? "qwen3-coder" : ""}
          spellCheck={false}
          value={model}
        />
        {offered.length > 0 ? (
          <datalist id={ids.models}>
            {offered.map((entry) => (
              <option key={entry} value={entry} />
            ))}
          </datalist>
        ) : null}
      </Field>
      {problem ? (
        <p className="text-xs text-destructive" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={saving} size="sm" type="submit">
          {saving ? <Spinner className="size-3.5" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}
