import { describe, expect, it } from "vitest";

import { formatDiagnostics, recentErrors, recordError, redact } from "@main/diagnostics";

const HOME = "/Users/someone";

describe("diagnostics redaction", () => {
  it("shortens the home directory and replaces secret-shaped text", () => {
    const text = redact(
      [
        `${HOME}/code/project/a.ts failed`,
        "key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX and sk-or-v1-0123456789abcdef0123",
        "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "Authorization: Bearer abc.def.ghi-jklmnopq",
        'api_key="supersecretvalue123"',
        "AKIAABCDEFGHIJKLMNOP",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      ].join("\n"),
      HOME,
    );
    expect(text).toContain("~/code/project/a.ts failed");
    expect(text).not.toContain(HOME);
    for (const secret of ["sk-ant-api03-ABCDEF", "sk-or-v1-0123", "ghp_ABCDEF", "abc.def.ghi", "supersecretvalue123", "AKIAABCDEFGHIJKLMNOP", "eyJhbGciOiJIUzI1NiJ9"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("api_key=\"[redacted]");
  });

  it("keeps ordinary words, versions and model names", () => {
    expect(redact("claude-code 2.1.261 · authenticated · openai/gpt-x skill-creator", HOME)).toBe("claude-code 2.1.261 · authenticated · openai/gpt-x skill-creator");
  });

  it("records errors redacted, capped at 50 and 500 characters", () => {
    for (let i = 0; i < 60; i += 1) recordError([`boom ${i} sk-proj-${"x".repeat(30)}`, "y".repeat(600)]);
    const errors = recentErrors();
    expect(errors).toHaveLength(50);
    expect(errors.at(-1)).toContain("boom 59");
    expect(errors.join("\n")).not.toContain("sk-proj-x");
    expect(errors.every((line) => line.length < 600)).toBe(true);
  });

  it("formats a report that lists provider kinds only", () => {
    const text = formatDiagnostics({
      version: "0.1.0", commit: "abc1234", platform: "darwin", arch: "arm64", osRelease: "25.6.0",
      versions: { electron: "40", node: "24", chrome: "140" },
      agents: [{ name: "Claude Code", installed: true, version: "2.1.261", auth: "authenticated" }, { name: "Codex", installed: false, version: null, auth: "unknown" }],
      plugins: [{ name: "text-to-cad", enabled: true, version: "0.7.10", servers: [{ name: "cad", status: "failed", error: `${HOME}/x: token=abcdefghijk` }] }],
      providers: [{ kind: "openrouter" }],
      errors: [],
    }, HOME);
    expect(text).toContain("elastic 0.1.0 beta (abc1234)");
    expect(text).toContain("Claude Code 2.1.261 · authenticated");
    expect(text).not.toContain("Codex");
    expect(text).toContain("Providers: openrouter");
    expect(text).toContain("cad: failed · ~/x: token=[redacted]");
  });
});
