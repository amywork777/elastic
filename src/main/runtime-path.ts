/**
 * Directories put in front of every session's `PATH`: what an enabled plugin
 * ships for its agents to run. Adapters, agent-opened terminals and the
 * terminals integration all read this one list.
 */
let providers: Array<() => string[]> = [];

export function sessionRuntimePath(): string[] {
  return [...new Set(providers.flatMap((provide) => provide()))];
}

/** Register a source of PATH entries; returns its removal. */
export function addRuntimePath(provide: () => string[]): () => void {
  providers = [...providers, provide];
  return () => { providers = providers.filter((entry) => entry !== provide); };
}
