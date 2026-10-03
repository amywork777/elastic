/**
 * The bundled Code Review plugin (resources/bundled/plugins/elastic-code-review)
 * against a stand-in GitHub CLI (tests/fixtures/code-review/gh.mjs): run the
 * way the app runs it (`${ELASTIC_NODE}`, the app's own binary as Node), its
 * tools, its views' data, its writes (logged by the stub, never sent), and
 * the sign-in states a person can act on.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PluginHost } from "../../../src/main/plugins/host";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { PluginService } from "../../../src/main/plugins/service";

const root = path.resolve(".");
const plugin = path.join(root, "resources", "bundled", "plugins", "elastic-code-review");
const stub = path.join(root, "tests", "fixtures", "code-review", "gh.mjs");

type Result = { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
type Tool = { name: string; annotations?: { readOnlyHint?: boolean }; _meta?: Record<string, { entrypoints?: Array<{ type: string }>; visibility?: string[] }> };

let dir: string;
let project: string;
let log: string;

/** A gh on disk that runs the stub with this test's Node, whatever the shell's PATH says. */
function ghWrapper(name: string, extra = ""): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${extra}exec "${process.execPath}" "${stub}" "$@"\n`, { mode: 0o755 });
  return file;
}

async function serviceWith(env: Record<string, string>): Promise<PluginService> {
  const host = new PluginHost({ environment: async () => ({ ...process.env, ...env }) as Record<string, string>, clientName: "elastic-test", clientVersion: "0" });
  const service = new PluginService({ registry: new PluginRegistry(path.join(fs.mkdtempSync(path.join(dir, "reg-")), "installed.json")), host });
  await service.installFolder(plugin);
  return service;
}

let service: PluginService;
const call = (name: string, args: Record<string, unknown> = {}, roots: string[] = []) =>
  service.request("s1", "elastic-code-review", "code-review", "tools/call", { name, arguments: args }, { roots }) as Promise<Result>;

beforeAll(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "elastic-code-review-")));
  project = path.join(dir, "widgets");
  fs.mkdirSync(project);
  log = path.join(dir, "writes.log");
  service = await serviceWith({ ELASTIC_GH: ghWrapper("gh"), FAKE_GH_LOG: log });
}, 30_000);

afterAll(async () => {
  await service?.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Code Review, against a stand-in gh", () => {
  it("starts on the app's own Node and lists its tools: a thread view for agents, a rail page for the app", async () => {
    const entry = service.plugin("elastic-code-review")!;
    expect(entry.servers.every((server) => server.status === "ready"), JSON.stringify(entry.servers)).toBe(true);
    const { tools } = await service.request(null, "elastic-code-review", "code-review", "tools/list", {}) as { tools: Tool[] };
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName).sort()).toEqual(["add_review_comment", "code_review_home", "get_pr", "get_pr_diff", "list_prs", "list_review_comments", "show_pr", "submit_review"]);
    expect(byName.show_pr!._meta!["openai/ui"]!.entrypoints).toEqual([{ type: "thread" }]);
    expect(byName.code_review_home!._meta!["openai/ui"]!.entrypoints).toEqual([{ type: "global" }]);
    expect(byName.code_review_home!._meta!.ui!.visibility).toEqual(["app"]);
    expect(byName.add_review_comment!.annotations!.readOnlyHint).toBe(false);
    expect(byName.submit_review!.annotations!.readOnlyHint).toBe(false);
    expect(byName.get_pr!.annotations!.readOnlyHint).toBe(true);
    expect(entry.tools.map((tool) => [tool.id, tool.entrypoints.map((point) => point.type)])).toEqual([
      ["code-review/show_pr", ["thread"]],
      ["code-review/code_review_home", ["global"]],
    ]);
  });

  it("the rail page groups pull requests as Codex does, without repeating one", async () => {
    const result = await call("code_review_home");
    const sections = result.structuredContent!.sections as Record<string, Array<{ number: number; repo: string }>>;
    expect(sections.review!.map((pr) => pr.number)).toEqual([42, 57]);
    expect(sections.yours!.map((pr) => pr.number)).toEqual([61]);
    expect(sections.recent!.map((pr) => pr.number)).toEqual([12]);
    expect(sections.review![0]!.repo).toBe("acme/widgets");
  });

  it("lists the session repository's pull requests when the session is in a checkout", async () => {
    const result = await call("list_prs", {}, [project]);
    expect(result.structuredContent!.repo).toBe("acme/widgets");
    expect(result.content[0]!.text).toContain("acme/widgets#42 Add a retry budget to the uploader (maya)");
  });

  it("show_pr hands the view the pull request, its checks, diff and threads", async () => {
    const result = await call("show_pr", { url: "https://github.com/acme/widgets/pull/42" });
    const data = result.structuredContent as { view: string; pr: { checks: Array<{ state: string }>; headSha: string }; diff: string; comments: unknown[]; reviews: unknown[] };
    expect(data.view).toBe("pr");
    expect(data.pr.checks.map((check) => check.state)).toEqual(["passed", "failed", "pending"]);
    expect(data.pr.headSha).toBe("abc123def4567890");
    expect(data.diff).toContain("+const MAX_RETRIES = 3;");
    expect(data.comments).toHaveLength(2);
    expect(result.content[0]!.text).toContain("3 checks (1 failing), 2 inline comments");
    // Opened by the person in a checkout with no number: the repository's list.
    const list = await call("show_pr", {}, [project]);
    expect(list.structuredContent!.view).toBe("list");
  });

  it("reads one file's diff", async () => {
    const result = await call("get_pr_diff", { repo: "acme/widgets", number: 42, path: "test/uploader.test.ts" });
    expect(result.content[0]!.text).toContain("gives up after the retry budget");
    expect(result.content[0]!.text).not.toContain("src/uploader.ts");
  });

  it("posts comments, replies and reviews through gh api, on the head commit", async () => {
    fs.rmSync(log, { force: true });
    await call("add_review_comment", { repo: "acme/widgets", number: 42, path: "src/uploader.ts", line: 5, body: "Nice." });
    await call("add_review_comment", { repo: "acme/widgets", number: 42, in_reply_to: 101, body: "Agreed." });
    await call("submit_review", { repo: "acme/widgets", number: 42, event: "approve" });
    const writes = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(writes[0]).toEqual(["api", "-X", "POST", "repos/acme/widgets/pulls/42/comments", "-f", "body=Nice.", "-f", "commit_id=abc123def4567890", "-f", "path=src/uploader.ts", "-F", "line=5", "-f", "side=RIGHT"]);
    expect(writes[1]).toEqual(["api", "-X", "POST", "repos/acme/widgets/pulls/42/comments/101/replies", "-f", "body=Agreed."]);
    expect(writes[2]).toEqual(["api", "-X", "POST", "repos/acme/widgets/pulls/42/reviews", "-f", "event=APPROVE", "-f", "body="]);
    const refused = await call("submit_review", { repo: "acme/widgets", number: 42, event: "request_changes" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("needs a `body`");
  });

  it("an unknown pull request is the tool's answer, not a protocol error", async () => {
    const result = await call("get_pr", { repo: "acme/widgets", number: 7 });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Could not resolve to a PullRequest");
  });
});

describe("Code Review without a usable gh", () => {
  it("signed out: says to run gh auth login, and the view knows why", async () => {
    const signedOut = await serviceWith({ ELASTIC_GH: ghWrapper("gh-signed-out", "export FAKE_GH_STATE=signed-out\n") });
    try {
      const result = await signedOut.request(null, "elastic-code-review", "code-review", "tools/call", { name: "code_review_home", arguments: {} }) as Result;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ view: "error", reason: "signed-out" });
      expect(result.content[0]!.text).toContain("gh auth login");
    } finally {
      await signedOut.dispose();
    }
  });

  it("not installed: says where to get it", async () => {
    const missing = await serviceWith({ ELASTIC_GH: path.join(dir, "no-such-gh") });
    try {
      const result = await missing.request(null, "elastic-code-review", "code-review", "tools/call", { name: "list_prs", arguments: {} }) as Result;
      expect(result.structuredContent).toMatchObject({ view: "error", reason: "missing" });
      expect(result.content[0]!.text).toContain("https://cli.github.com");
    } finally {
      await missing.dispose();
    }
  });
});
