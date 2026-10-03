import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import type { ProviderModelGroup } from "@renderer/features/session/ComposerChips";
import type { AgentStatus } from "@shared/agents";
import { errorMessage } from "@shared/ipc/errors";
import { AGENT_NAMES, agentFor, providerGroupLabel, providerReady, type Provider, type ProviderInput, type ProviderTest } from "@shared/providers";

/**
 * Settings › Models & keys, as the renderer holds it: the providers (never a
 * key: main answers `hasKey`), each one's last Test result, and the models a
 * Test listed, which the model picker offers (`src/shared/providers.ts`).
 */
type ProvidersState = {
  providers: Provider[];
  loaded: boolean;
  tests: Record<string, ProviderTest | "testing" | undefined>;
  load: () => Promise<void>;
  save: (input: ProviderInput) => Promise<Provider | null>;
  remove: (id: string) => Promise<void>;
  test: (id: string) => Promise<ProviderTest | null>;
};

export const useProviders = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  tests: {},
  load: async () => {
    try {
      set({ providers: await window.workbench.providers.list(), loaded: true });
    } catch (error) {
      // Quiet: a model picker that cannot list providers still offers the agents' own models.
      set({ loaded: true });
      console.warn(`[providers] could not read Models & keys: ${errorMessage(error)}`);
    }
  },
  save: async (input) => {
    try {
      const saved = await window.workbench.providers.save(input);
      set((state) => ({
        providers: state.providers.some((provider) => provider.id === saved.id)
          ? state.providers.map((provider) => (provider.id === saved.id ? saved : provider))
          : [...state.providers, saved],
      }));
      return saved;
    } catch (error) {
      toast.error(`Could not save: ${errorMessage(error)}`);
      return null;
    }
  },
  remove: async (id) => {
    try {
      await window.workbench.providers.remove({ id });
      set((state) => ({ providers: state.providers.filter((provider) => provider.id !== id), tests: { ...state.tests, [id]: undefined } }));
    } catch (error) {
      toast.error(`Could not remove it: ${errorMessage(error)}`);
    }
  },
  test: async (id) => {
    if (get().tests[id] === "testing") return null;
    set((state) => ({ tests: { ...state.tests, [id]: "testing" } }));
    try {
      const result = await window.workbench.providers.test({ id });
      set((state) => ({ tests: { ...state.tests, [id]: result } }));
      return result;
    } catch (error) {
      const result = { ok: false, message: errorMessage(error), models: [] };
      set((state) => ({ tests: { ...state.tests, [id]: result } }));
      return result;
    }
  },
}));

/** The models to offer for a provider: its default, the recently used, then what its last Test listed. */
export function providerModels(provider: Provider, test: ProviderTest | "testing" | undefined): string[] {
  const listed = test && test !== "testing" ? test.models : [];
  return [...new Set([...(provider.defaultModel ? [provider.defaultModel] : []), ...provider.recentModels, ...listed])];
}

/**
 * The model picker's provider groups: every provider that has what it needs,
 * labelled by the agent it runs through, with that agent's icon. Loads the
 * providers the first time a picker asks.
 */
export function useProviderGroups(agents: AgentStatus[]): ProviderModelGroup[] {
  const providers = useProviders((state) => state.providers);
  const loaded = useProviders((state) => state.loaded);
  const tests = useProviders((state) => state.tests);
  const load = useProviders((state) => state.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return useMemo(
    () =>
      providers.filter(providerReady).map((provider) => {
        const agentId = agentFor(provider);
        const agent = agents.find((candidate) => candidate.id === agentId) ?? null;
        return {
          providerId: provider.id,
          label: providerGroupLabel(provider),
          providerLabel: provider.label,
          agentId,
          icon: agent?.icon ?? null,
          models: providerModels(provider, tests[provider.id]),
          installed: agent?.installed ?? false,
          agentName: agent?.name ?? AGENT_NAMES[agentId],
        };
      }),
    [providers, tests, agents],
  );
}
