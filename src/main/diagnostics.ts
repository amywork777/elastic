/**
 * Copy diagnostics: a plain-text report a person pastes into an issue. Nothing
 * here leaves the machine on its own (no telemetry; analytics live in plugins):
 * the report is built on request and handed to the renderer, which copies it.
 *
 * It names versions, agents, plugins and providers, and the main process's
 * recent errors from a small ring buffer. It never carries a key, a token or a
 * provider URL: providers are listed by kind, and every line goes through
 * `redact` (home directory to `~`, anything that looks like a secret replaced).
 */
import os from "node:os";

/** The last errors main logged, newest last. */
const MAX_ERRORS = 50;
const MAX_ERROR_LENGTH = 500;
const errors: string[] = [];

const SECRET_PATTERNS: RegExp[] = [
  // Provider and service keys: sk-…, sk-ant-…, sk-or-…, ghp_/gho_/github_pat_, xox?-, AKIA…, AIza…
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Authorization headers and key=value secrets.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)(?!(?:Bearer|Basic)\s)[^\s"',;]{6,}/gi,
  // A long opaque run (JWTs, hex digests used as tokens).
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
];

/** The text with the home directory shortened and anything secret-shaped replaced. */
export function redact(text: string, home: string = os.homedir()): string {
  let out = home && home !== "/" ? text.split(home).join("~") : text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: unknown) => {
      // "Bearer …" keeps the scheme; "api_key=…" keeps the name; anything else goes whole.
      if (/^(Bearer|Basic)\s/i.test(match)) return `${match.split(/\s/)[0]} [redacted]`;
      return typeof prefix === "string" && prefix && match.startsWith(prefix) ? `${prefix}[redacted]` : "[redacted]";
    });
  }
  return out;
}

/** Remember an error main logged, redacted and capped. */
export function recordError(parts: unknown[]): void {
  const text = parts
    .map((part) => (part instanceof Error ? `${part.message}` : typeof part === "string" ? part : safeJson(part)))
    .join(" ")
    .slice(0, MAX_ERROR_LENGTH);
  errors.push(`${new Date().toISOString()} ${redact(text)}`);
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
}

export function recentErrors(): readonly string[] {
  return errors;
}

/** Keep `console.error` printing as before, and remember what it printed. Safe to call twice. */
let installed = false;
export function captureMainErrors(): void {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...parts: unknown[]) => {
    try { recordError(parts); } catch { /* a report must never break logging */ }
    original(...parts);
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export type DiagnosticsInput = {
  version: string;
  commit: string;
  platform: string;
  arch: string;
  osRelease: string;
  versions: { electron?: string; node?: string; chrome?: string };
  agents: Array<{ name: string; installed: boolean; version: string | null; auth: string }>;
  plugins: Array<{ name: string; enabled: boolean; version?: string | null; servers: Array<{ name: string; status: string; error?: string | null }>; error?: string | null }>;
  providers: Array<{ kind: string }>;
  errors: readonly string[];
};

/** The report, as text. Every line is redacted, the inputs included. */
export function formatDiagnostics(input: DiagnosticsInput, home: string = os.homedir()): string {
  const lines: string[] = [];
  lines.push(`elastic ${input.version} beta (${input.commit})`);
  lines.push(`OS: ${input.platform} ${input.osRelease} (${input.arch})`);
  lines.push(`Electron ${input.versions.electron ?? "?"} · Node ${input.versions.node ?? "?"} · Chrome ${input.versions.chrome ?? "?"}`);
  lines.push("", "Agents:");
  const installed = input.agents.filter((agent) => agent.installed);
  if (installed.length === 0) lines.push("  none installed");
  for (const agent of installed) lines.push(`  ${agent.name} ${agent.version ?? ""} · ${agent.auth}`.replace(/\s+·/, " ·"));
  lines.push("", "Plugins:");
  if (input.plugins.length === 0) lines.push("  none");
  for (const plugin of input.plugins) {
    lines.push(`  ${plugin.name}${plugin.version ? ` ${plugin.version}` : ""}${plugin.enabled ? "" : " (off)"}${plugin.error ? ` · error: ${plugin.error}` : ""}`);
    for (const server of plugin.servers) lines.push(`    ${server.name}: ${server.status}${server.error ? ` · ${server.error}` : ""}`);
  }
  lines.push("", `Providers: ${input.providers.length === 0 ? "none" : input.providers.map((provider) => provider.kind).join(", ")}`);
  lines.push("", "Recent errors:");
  if (input.errors.length === 0) lines.push("  none");
  for (const error of input.errors.slice(-20)) lines.push(`  ${error}`);
  return redact(lines.join("\n"), home);
}
