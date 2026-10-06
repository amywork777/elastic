/**
 * Signing in to a remote plugin server that does not let apps register
 * themselves — Slack's, GitHub's, Google's — with the client the plugin names
 * in its `.mcp.json`. The fake authorization server here has no registration
 * endpoint and accepts one client id; it records what each request carried,
 * so the tests can say which client, redirect and scopes the sign-in used.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PluginHost } from "../../../src/main/plugins/host";
import { AuthStore, oauthOptions } from "../../../src/main/plugins/oauth";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { PluginService } from "../../../src/main/plugins/service";

const CLIENT = "11843774967.preset";

let base = "";
let fake: http.Server;
let dir: string;
const live = new Set<string>();
const refreshes = new Set<string>();
const codes = new Map<string, { challenge: string; redirect: string }>();
const seen: { authorize: URLSearchParams[]; token: URLSearchParams[]; registrations: number } = { authorize: [], token: [], registrations: 0 };

function json(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

async function body(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-oauth-preset-"));
  fake = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      // Slack's shape: no registration_endpoint.
      return json(response, 200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    }
    if (url.pathname === "/register") {
      seen.registrations += 1;
      return json(response, 404, { error: "not_found" });
    }
    if (url.pathname === "/authorize") {
      seen.authorize.push(url.searchParams);
      if (url.searchParams.get("client_id") !== CLIENT) return json(response, 400, { error: "invalid_client" });
      const code = randomBytes(8).toString("hex");
      const redirect = url.searchParams.get("redirect_uri")!;
      codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirect });
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: back.href }).end();
      return;
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(await body(request));
      seen.token.push(form);
      if (form.get("client_id") !== CLIENT) return json(response, 401, { error: "invalid_client" });
      const issue = () => {
        const access = randomBytes(8).toString("hex");
        const refresh = randomBytes(8).toString("hex");
        live.add(access);
        refreshes.add(refresh);
        return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600 };
      };
      if (form.get("grant_type") === "authorization_code") {
        const pending = codes.get(form.get("code") ?? "");
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (!pending || pending.challenge !== challenge || pending.redirect !== form.get("redirect_uri")) return json(response, 400, { error: "invalid_grant" });
        codes.delete(form.get("code")!);
        return json(response, 200, issue());
      }
      if (form.get("grant_type") === "refresh_token" && refreshes.delete(form.get("refresh_token") ?? "")) {
        return json(response, 200, issue());
      }
      return json(response, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/mcp") {
      const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!live.has(token)) {
        return json(response, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      }
      const server = new McpServer({ name: "slackish", version: "0" });
      server.registerTool("post_message", {}, async () => ({ content: [{ type: "text", text: "posted" }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.method === "POST" ? JSON.parse(await body(request)) : undefined);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});

afterAll(async () => {
  fake.closeAllConnections();
  await new Promise((resolve) => fake.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The system browser: follow the authorization URL's redirect to the loopback callback. */
async function browser(url: URL): Promise<void> {
  const redirected = await fetch(url, { redirect: "manual" });
  const location = redirected.headers.get("location");
  if (!location) throw new Error(`the authorization server answered ${redirected.status}`);
  await fetch(location);
}

/** A free port, for a plugin that names a fixed one. */
async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The app for one plugin: its own credentials and install record, which a relaunch reads again. */
function app(name: string) {
  const store = new AuthStore(path.join(dir, `${name}-auth.json`));
  const host = new PluginHost({
    environment: async () => ({}),
    clientName: "elastic-test",
    clientVersion: "0",
    auth: { store, open: browser },
  });
  const plugins = new PluginService({ registry: new PluginRegistry(path.join(dir, `${name}-installed.json`)), host });
  return { plugins, store };
}

async function install(name: string, server: Record<string, unknown>) {
  const folder = path.join(dir, name);
  fs.mkdirSync(path.join(folder, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".codex-plugin", "plugin.json"), JSON.stringify({ name }));
  fs.writeFileSync(path.join(folder, ".mcp.json"), JSON.stringify({ mcpServers: { [name]: { type: "http", url: `${base}/mcp`, ...server } } }));
  const opened = app(name);
  await opened.plugins.installFolder(folder);
  return opened;
}

describe("a server that does not let apps register", () => {
  it("signs in with Codex's client_id and scopes, on a free 127.0.0.1 port, and registers nothing", async () => {
    const { plugins } = await install("slack", { oauth: { client_id: CLIENT }, scopes: ["channels:read", "chat:write"] });
    const before = seen.registrations;
    const after = await plugins.signIn("slack", "slack");
    expect(after.servers[0]).toMatchObject({ status: "ready", signedIn: true, toolNames: ["post_message"] });
    const asked = seen.authorize.at(-1)!;
    expect(asked.get("client_id")).toBe(CLIENT);
    expect(asked.get("scope")).toBe("channels:read chat:write");
    expect(asked.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(seen.registrations).toBe(before);
    await plugins.dispose();
  });

  it("refreshes with the same client when the token has expired", async () => {
    const first = await install("slack-refresh", { oauth: { client_id: CLIENT } });
    await first.plugins.signIn("slack-refresh", "slack-refresh");
    await first.plugins.dispose();
    // The next launch, with the access token expired: the saved refresh token goes to the same client.
    live.clear();
    const { plugins } = app("slack-refresh");
    await plugins.listAll();
    expect(plugins.plugin("slack-refresh")!.servers[0]).toMatchObject({ status: "ready", toolNames: ["post_message"] });
    const refresh = seen.token.at(-1)!;
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("client_id")).toBe(CLIENT);
    await plugins.dispose();
  });

  it("comes back to Claude Code's clientId and callbackPort at localhost on that port", async () => {
    const port = await freePort();
    const { plugins } = await install("slack-claude", { oauth: { clientId: CLIENT, callbackPort: port } });
    await plugins.signIn("slack-claude", "slack-claude");
    expect(seen.authorize.at(-1)!.get("redirect_uri")).toBe(`http://localhost:${port}/callback`);
    await plugins.dispose();
  });

  it("comes back to Codex's callback_url exactly, path and all", async () => {
    const port = await freePort();
    const { plugins } = await install("github-ish", {
      oauth: { client_id: CLIENT, client_secret: "s3cret", callback_port: port, callback_url: `http://127.0.0.1:${port}/callback/ymAt1Jnt6ghN` },
    });
    const after = await plugins.signIn("github-ish", "github-ish");
    expect(after.servers[0]).toMatchObject({ status: "ready", signedIn: true });
    expect(seen.authorize.at(-1)!.get("redirect_uri")).toBe(`http://127.0.0.1:${port}/callback/ymAt1Jnt6ghN`);
    expect(seen.token.at(-1)!.get("client_secret")).toBe("s3cret");
    await plugins.dispose();
  });

  it("says in words why a plugin that names no client cannot sign in, placeholders included", async () => {
    for (const [name, server] of [["bare", {}], ["placeholder", { oauth: { client_id: "<SLACK_PUBLIC_CLIENT_ID>" } }]] as const) {
      const { plugins } = await install(name, server);
      await expect(plugins.signIn(name, name)).rejects.toThrow(/only signs in apps registered with it, and this plugin does not name one/);
      await plugins.dispose();
    }
  });
});

describe("oauthOptions", () => {
  it("reads both spellings, and leaves placeholders and nonsense out", () => {
    expect(oauthOptions({ oauth: { client_id: "a" }, scopes: ["x", "y"] })).toEqual({ client: { client_id: "a" }, scope: "x y" });
    expect(oauthOptions({ oauth: { clientId: "a", callbackPort: 3118 } })).toEqual({
      client: { client_id: "a" },
      callback: { host: "localhost", port: 3118, path: "/callback" },
    });
    expect(oauthOptions({ oauth: { client_id: "<X>", client_secret: "<Y>", callback_port: 12798 } })).toEqual({
      callback: { host: "127.0.0.1", port: 12798, path: "/callback" },
    });
    expect(oauthOptions({ oauth: { client_id: "a", callback_url: "https://example.com/cb" } })).toEqual({ client: { client_id: "a" } });
    expect(oauthOptions({ oauth: { callback_port: 70000 } })).toEqual({});
    expect(oauthOptions({})).toEqual({});
  });
});
