import type * as ChildProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `scripts/package.mjs`, imported rather than run: every decision it makes
 * before handing over to electron-builder is a function of its arguments and
 * its environment, and a test that had to package to see one would take
 * minutes and a runtime. The child-process module is replaced, so nothing
 * here can start a build even if the script's guard were to fail.
 */
const spawned = vi.hoisted(() => ({ spawnSync: vi.fn(() => ({ status: 0 })) }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawnSync: spawned.spawnSync,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("package.mjs", () => {
  it("imports without packaging, exiting or spawning anything", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit during import");
    }) as never);
    await import("../../../scripts/package.mjs");
    expect(exit).not.toHaveBeenCalled();
    expect(spawned.spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    // No arch flag: the config's own arch list, nothing to narrow.
    [["--mac"], ["--mac"]],
    [["--win"], ["--win"]],
    // An arch flag narrows only with target names beside it (app-builder-lib).
    [["--mac", "--arm64"], ["--mac", "dmg", "zip", "--arm64"]],
    [["--mac", "--arm64", "--x64"], ["--mac", "dmg", "zip", "--arm64", "--x64"]],
    [["--linux", "--x64"], ["--linux", "AppImage", "deb", "--x64"]],
    [["--win", "--x64"], ["--win", "nsis", "--x64"]],
    // Target names the caller already gave are theirs.
    [["--mac", "zip", "--arm64"], ["--mac", "zip", "--arm64"]],
  ])("hands electron-builder %j as %j", async (args, builder) => {
    const { builderArgsFor } = await import("../../../scripts/package.mjs");
    expect(builderArgsFor(args)).toEqual(builder);
  });

  describe("signingEnv", () => {
    const APPLE = {
      CSC_LINK: "apple.p12",
      CSC_KEY_PASSWORD: "pw",
      APPLE_ID: "id@example.invalid",
      APPLE_APP_SPECIFIC_PASSWORD: "app-pw",
      APPLE_TEAM_ID: "TEAM",
    };

    it("treats empty signing secrets as absent, as a workflow without them passes them", async () => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      const empty = { CSC_LINK: "", CSC_KEY_PASSWORD: "", APPLE_ID: "", APPLE_APP_SPECIFIC_PASSWORD: "", APPLE_TEAM_ID: "", GITHUB_ACTIONS: "true" };
      const { env, signed, notarize } = signingEnv(["--mac", "--arm64", "--x64"], empty);
      expect([signed, notarize]).toEqual([false, false]);
      expect(Object.keys(env).filter((name) => name.startsWith("CSC_LINK") || name.startsWith("APPLE_") || name === "CSC_KEY_PASSWORD")).toEqual([]);
      expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toBe("false");
    });

    it("signs and notarises the Mac with the Apple credentials", async () => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      const { env, signed, notarize } = signingEnv(["--mac"], { PATH: "/bin", ...APPLE });
      expect({ signed, notarize }).toEqual({ signed: true, notarize: true });
      expect(env).toMatchObject(APPLE);
      expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toBeUndefined();
    });

    it.each([["--win"], ["--linux"]])("never hands the Apple certificate to %s", async (flag) => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      const { env, signed, notarize } = signingEnv([flag], { PATH: "/bin", ...APPLE });
      expect({ signed, notarize }).toEqual({ signed: false, notarize: false });
      for (const name of Object.keys(APPLE)) {
        expect(env).not.toHaveProperty(name);
      }
      expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toBe("false");
      expect(env.PATH).toBe("/bin");
    });

    it("signs Windows with its own certificate only", async () => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      const { env, signed } = signingEnv(["--win"], { ...APPLE, WIN_CSC_LINK: "win.pfx", WIN_CSC_KEY_PASSWORD: "wpw" });
      expect(signed).toBe(true);
      expect(env).toMatchObject({ WIN_CSC_LINK: "win.pfx", WIN_CSC_KEY_PASSWORD: "wpw" });
      expect(env).not.toHaveProperty("CSC_LINK");
    });

    it("refuses to sign the Mac in the same run as another os", async () => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      expect(() => signingEnv(["--mac", "--win"], APPLE)).toThrow(/package --mac on its own/);
      expect(signingEnv(["--mac", "--win"], {}).signed).toBe(false);
    });

    it("refuses a signed, un-notarised Mac build on CI and allows it on a laptop", async () => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      const partial = { CSC_LINK: "apple.p12", APPLE_ID: "id@example.invalid" };
      expect(() => signingEnv(["--mac"], { ...partial, CI: "true" })).toThrow(
        /notarisation is off \(missing APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID\)/,
      );
      expect(() => signingEnv(["--mac"], { ...partial, GITHUB_ACTIONS: "true" })).toThrow(/notarisation is off/);
      expect(signingEnv(["--mac"], partial)).toMatchObject({ signed: true, notarize: false });
      // Unsigned on CI (no secrets yet) and fully notarised on CI both go ahead.
      expect(signingEnv(["--mac"], { CI: "true" })).toMatchObject({ signed: false, notarize: false });
      expect(signingEnv(["--mac"], { ...APPLE, CI: "true" })).toMatchObject({ signed: true, notarize: true });
    });

    it("refuses notarisation credentials with no certificate on CI, and allows them on a laptop", async () => {
      const { signingEnv } = await import("../../../scripts/package.mjs");
      const { CSC_LINK: _certificate, CSC_KEY_PASSWORD: _password, ...credentialsOnly } = APPLE;
      expect(() => signingEnv(["--mac"], { ...credentialsOnly, CI: "true" })).toThrow(/APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID set but CSC_LINK is not/);
      expect(() => signingEnv(["--mac"], { ...credentialsOnly, GITHUB_ACTIONS: "true" })).toThrow(/CSC_LINK is not/);
      expect(signingEnv(["--mac"], credentialsOnly)).toMatchObject({ signed: false, notarize: false });
      // The workflow blanks the secrets it has not been given: empty is absent.
      expect(signingEnv(["--mac"], { CI: "true", APPLE_ID: "", CSC_LINK: "" })).toMatchObject({ signed: false });
    });

    it("logs the certificate each os is signed with, and none for Linux, which is never signed", async () => {
      const { signingEnv, signingLine } = await import("../../../scripts/package.mjs");
      const logged = (flag: string, source: Record<string, string>) => signingLine([flag], signingEnv([flag], source));
      expect(logged("--mac", APPLE)).toBe("signing: on (CSC_LINK), notarisation: on");
      expect(logged("--win", { WIN_CSC_LINK: "win.pfx" })).toBe("signing: on (WIN_CSC_LINK), notarisation: n/a");
      expect(logged("--win", {})).toBe("signing: off (no WIN_CSC_LINK) — CSC_IDENTITY_AUTO_DISCOVERY=false");
      expect(logged("--linux", { WIN_CSC_LINK: "win.pfx" })).toBe("signing: off (Linux builds are not signed) — CSC_IDENTITY_AUTO_DISCOVERY=false");
    });
  });

  describe("lfsPointers", () => {
    const POINTER = "version https://git-lfs.github.com/spec/v1\noid sha256:3a071fc73a485baeb718c0b2d4b31d2433a6b7035e8fe25e0c4529ad49274184\nsize 89499\n";

    it("finds a pointer among the checked-out resources and nothing else", async () => {
      const { lfsPointers } = await import("../../../scripts/package.mjs");
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-lfs-"));
      try {
        const write = (file: string, content: string) => {
          fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
          fs.writeFileSync(path.join(root, file), content);
        };
        write("resources/plugins/marketplace.json", "{}\n");
        write("resources/plugins/plugins/tables/assets/logo.png", "PNG");
        write("resources/bundled/plugins/elastic-pdf/skills/pdf/SKILL.md", "---\nname: pdf\n---\n");
        expect(lfsPointers(root)).toEqual([]);

        write("resources/plugins/plugins/tables/assets/logo.png", POINTER);
        write("resources/bundled/plugins/elastic-pdf/skills/pdf/assets/demo.gif", POINTER);
        // Outside what ships: not this check's business.
        write("tmp/pointer.bin", POINTER);
        expect(lfsPointers(root)).toEqual([
          path.join("resources", "bundled", "plugins", "elastic-pdf", "skills", "pdf", "assets", "demo.gif"),
          path.join("resources", "plugins", "plugins", "tables", "assets", "logo.png"),
        ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("covers every extraResource electron-builder.yml copies from the checkout", async () => {
      const { CHECKED_OUT_RESOURCES } = await import("../../../scripts/package.mjs");
      const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
      // Every `- from:` in the config is an extraResources entry (nothing else there has one).
      const config = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
      const copied = [...config.matchAll(/^\s*- from: (\S+)$/gm)].map((match) => match[1]!).filter((from) => !from.startsWith("resources/runtime/"));
      expect([...CHECKED_OUT_RESOURCES].sort()).toEqual([...copied].sort());
    });
  });

  describe("the design notes' Packaging section", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const readme = fs.readFileSync(path.join(appRoot, "docs", "design.md"), "utf8");
    const section = (heading: string) => {
      const start = readme.indexOf(`\n### ${heading}\n`);
      expect(start, heading).toBeGreaterThan(-1);
      const end = readme.slice(start + 1).search(/\n##+ /);
      return readme.slice(start, end === -1 ? undefined : start + 1 + end);
    };

    it("names every variable signingEnv reads under Signing", () => {
      const signing = section("Signing");
      for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
        expect(signing, name).toContain(`\`${name}\``);
      }
    });

    it("names every extraResource electron-builder.yml copies under What is bundled", () => {
      const bundled = section("What is bundled");
      const config = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
      for (const [, from] of config.matchAll(/^\s*- from: (\S+)$/gm)) {
        // `resources/runtime/${os}-${arch}` is written `resources/runtime/<os>-<arch>/`.
        const named = from!.replace("${os}-${arch}", "<os>-<arch>");
        expect(bundled, from).toMatch(new RegExp(`\`${named.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?\``));
      }
    });
  });
});
