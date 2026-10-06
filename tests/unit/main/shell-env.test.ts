import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ENV_BEGIN, ENV_END, captureLoginEnv, loginEnv, parseLoginOutput, processEnv } from "@main/agents/shell-env";

const temps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A stand-in for `$SHELL`: called as `<shell> -ilc <command>`, it prints what
 * a chatty rc file would (a banner with no trailing newline), runs the command
 * with a known PATH, and prints more on the way out, as a .zlogout might.
 */
function fakeShell(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-shell-"));
  temps.push(dir);
  const file = path.join(dir, "shell");
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

describe.skipIf(process.platform === "win32")("capturing the login shell", () => {
  it("keeps the first variable (PATH) when the rc files print before env, and ignores what follows", async () => {
    const shell = fakeShell(
      [
        "printf 'Welcome to your shell\\nlast login: today'",
        'env -i PATH=/fake/bin:/usr/bin:/bin HOME=/home/fake /bin/sh -c "$2"',
        "printf 'bye'",
      ].join("\n"),
    );
    const env = await captureLoginEnv(5_000, shell);
    expect(env.PATH).toBe("/fake/bin:/usr/bin:/bin");
    expect(env.HOME).toBe("/home/fake");
  });

  it("gives agents the login shell's PATH through $SHELL even when an rc file prints a banner first", async () => {
    // What the app calls: `loginEnv`, with the user's $SHELL. The banner has
    // no trailing newline, so without the sentinels it is glued onto the first
    // record (PATH) and the capture falls back to the Dock's environment.
    vi.stubEnv(
      "SHELL",
      fakeShell(
        [
          "printf 'Welcome to your shell\\nlast login: today'",
          'env -i PATH=/fake/bin:/usr/bin:/bin HOME=/home/fake /bin/sh -c "$2"',
          "printf 'bye'",
        ].join("\n"),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const env = await loginEnv({ force: true, timeoutMs: 5_000 });
      expect(env.PATH).toBe("/fake/bin:/usr/bin:/bin");
      expect(env.HOME).toBe("/home/fake");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drops a host Claude Code session's variables but keeps the ones the login shell set itself", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "host");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    const shell = fakeShell(
      'env -i PATH=/fake/bin:/usr/bin:/bin CLAUDE_CODE_OAUTH_TOKEN=mine ANTHROPIC_BASE_URL=https://proxy.example /bin/sh -c "$2"',
    );
    try {
      const env = await loginEnv({ force: true, timeoutMs: 5_000, shell });
      // The rc's own value survives; the host's, inherited unchanged, does not.
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("mine");
      expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example");
      expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
      expect(env).not.toHaveProperty("CLAUDECODE");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps a Claude variable the rc exports even when the host session inherited the same value from it", async () => {
    // The usual shape: the person's rc exports the token, the terminal that
    // started the host Claude Code session ran that rc, so both hold "same".
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "same");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://proxy.example");
    const shell = fakeShell(
      'CLAUDE_CODE_OAUTH_TOKEN=same ANTHROPIC_BASE_URL=https://proxy.example /bin/sh -c "$2"',
    );
    try {
      const env = await loginEnv({ force: true, timeoutMs: 5_000, shell });
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("same");
      expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("strips a host variable the rc does not set, and CLAUDECODE unless the rc sets it", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://host.example");
    // A shell that passes its inherited environment through untouched.
    const plain = fakeShell('/bin/sh -c "$2"');
    const sets = fakeShell('CLAUDECODE=rc /bin/sh -c "$2"');
    try {
      const env = await loginEnv({ force: true, timeoutMs: 5_000, shell: plain });
      expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
      expect(env).not.toHaveProperty("ANTHROPIC_BASE_URL");
      expect(env).not.toHaveProperty("CLAUDECODE");
      expect((await loginEnv({ force: true, timeoutMs: 5_000, shell: sets })).CLAUDECODE).toBe("rc");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to process.env with a warning when the shell is too slow", async () => {
    const shell = fakeShell("sleep 5");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = await loginEnv({ force: true, timeoutMs: 200, shell });
    expect(env.PATH).toBe(processEnv().PATH);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/login shell.*process environment/i));
  });
});

describe("the login shell's output", () => {
  it("reads only between the sentinels", () => {
    const output = `motd\nno newline${"\n"}${ENV_BEGIN}\nPATH=/a:/b\0HOME=/h\0${"\n"}${ENV_END}\ngoodbye`;
    expect(parseLoginOutput(output)).toEqual({ PATH: "/a:/b", HOME: "/h" });
  });

  it("reads plain env output between the sentinels", () => {
    expect(parseLoginOutput(`noise${"\n"}${ENV_BEGIN}\nPATH=/a\nHOME=/h\n${"\n"}${ENV_END}\n`)).toEqual({
      PATH: "/a",
      HOME: "/h",
    });
  });
});

/**
 * A launch answers with the last launch's capture and refreshes behind it (`setEnvCache`): the
 * login shell took 10.7 s at one busy launch, and every agent waited for it.
 */
describe.skipIf(process.platform === "win32")("the environment kept between launches", () => {
  const shellPrinting = (pathValue: string) =>
    fakeShell(`env -i PATH=${pathValue}:/usr/bin:/bin HOME=/home/fake /bin/sh -c "$2"`);
  /** A fresh copy of the module: its capture is module state, held for the app's life. */
  async function fresh() {
    vi.resetModules();
    return import("@main/agents/shell-env");
  }
  const memory = (saved: Record<string, string> | null) => {
    const store = { saved, writes: [] as Record<string, string>[] };
    return { store, cache: { load: () => store.saved, save: (env: Record<string, string>) => { store.writes.push(env); store.saved = env; } } };
  };

  it("answers with the saved environment at once, then uses and keeps a capture that changed", async () => {
    const module = await fresh();
    const saved = { PATH: "/old/bin", HOME: "/home/fake" };
    const { store, cache } = memory(saved);
    module.setEnvCache(cache);
    vi.stubEnv("SHELL", shellPrinting("/new/bin"));
    expect(await module.loginEnv({ timeoutMs: 5_000 })).toBe(saved);
    await vi.waitFor(() => expect(store.writes).toHaveLength(1));
    expect(store.writes[0]!.PATH).toBe("/new/bin:/usr/bin:/bin");
    expect((await module.loginEnv()).PATH).toBe("/new/bin:/usr/bin:/bin");
  });

  it("keeps the saved object when the capture is the same, so a warm adapter's options still match", async () => {
    vi.stubEnv("SHELL", shellPrinting("/same/bin"));
    // What the last launch kept: a real capture (the shell's variables over the app's own).
    const first = memory(null);
    const last = await fresh();
    last.setEnvCache(first.cache);
    const saved = await last.loginEnv({ timeoutMs: 5_000 });
    // This launch: the same shell answers the same, so nothing is written and the object stays.
    const module = await fresh();
    const { store, cache } = memory(saved);
    module.setEnvCache(cache);
    expect(await module.loginEnv({ timeoutMs: 5_000 })).toBe(saved);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(store.writes).toHaveLength(0);
    expect(await module.loginEnv()).toBe(saved);
  });

  it("captures and keeps the first time, and a named refresh waits for the real shell", async () => {
    const module = await fresh();
    const { store, cache } = memory(null);
    module.setEnvCache(cache);
    vi.stubEnv("SHELL", shellPrinting("/first/bin"));
    expect((await module.loginEnv({ timeoutMs: 5_000 })).PATH).toBe("/first/bin:/usr/bin:/bin");
    expect(store.writes.at(-1)!.PATH).toBe("/first/bin:/usr/bin:/bin");
    vi.stubEnv("SHELL", shellPrinting("/after/sign-in/bin"));
    expect((await module.loginEnv({ force: true, timeoutMs: 5_000 })).PATH).toBe("/after/sign-in/bin:/usr/bin:/bin");
  });

  it("keeps the saved environment when the shell fails, rather than the Dock's", async () => {
    const module = await fresh();
    const saved = { PATH: "/saved/bin", HOME: "/home/fake" };
    const { store, cache } = memory(saved);
    module.setEnvCache(cache);
    vi.stubEnv("SHELL", fakeShell("exit 3"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await module.loginEnv({ timeoutMs: 5_000 })).toBe(saved);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(store.writes).toHaveLength(0);
    expect(await module.loginEnv()).toBe(saved);
  });
});
