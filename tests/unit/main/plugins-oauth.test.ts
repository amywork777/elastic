/**
 * OAuth for remote plugin servers, against a local fake: an MCP server that
 * answers 401 without a bearer token, and the authorization server it names
 * (protected-resource and authorization-server metadata, dynamic client
 * registration, PKCE-checked code exchange, refresh). The "browser" follows
 * the authorization URL's redirect to the app's loopback listener.
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
import { AuthStore, isAuthError, type Codec } from "../../../src/main/plugins/oauth";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { PluginService } from "../../../src/main/plugins/service";

const SEALED: Codec = { seal: (text) => `sealed:${Buffer.from(text).toString("base64")}`, open: (sealed) => Buffer.from(sealed.slice(7), "base64").toString("utf8") };

let base = "";
let fake: http.Server;
let dir: string;
const live = new Set<string>();
const refreshes = new Map<string, string>();
const codes = new Map<string, { challenge: string; redirect: string }>();
let registrations = 0;
let refreshed = 0;

function json(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

async function body(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function issue(): { access_token: string; refresh_token: string; token_type: string; expires_in: number } {
  const access = randomBytes(8).toString("hex");
  const refresh = randomBytes(8).toString("hex");
  live.add(access);
  refreshes.set(refresh, access);
  return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600 };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-oauth-"));
  fake = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(response, 200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register") {
      registrations += 1;
      const metadata = JSON.parse(await body(request)) as Record<string, unknown>;
      return json(response, 201, { ...metadata, client_id: `client-${registrations}` });
    }
    if (url.pathname === "/authorize") {
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
      if (form.get("grant_type") === "authorization_code") {
        const pending = codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (!pending || pending.challenge !== challenge || pending.redirect !== form.get("redirect_uri")) return json(response, 400, { error: "invalid_grant" });
        codes.delete(form.get("code")!);
        return json(response, 200, issue());
      }
      if (form.get("grant_type") === "refresh_token" && refreshes.has(form.get("refresh_token") ?? "")) {
        refreshed += 1;
        refreshes.delete(form.get("refresh_token")!);
        return json(response, 200, issue());
      }
      return json(response, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/mcp") {
      const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!live.has(token)) {
        return json(response, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      }
      const server = new McpServer({ name: "remote", version: "0" });
      server.registerTool("whoami", {}, async () => ({ content: [{ type: "text", text: "signed in" }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.method === "POST" ? JSON.parse(await body(request)) : undefined);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const address = fake.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => fake.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The system browser: follow the authorization URL's redirect to the loopback callback. */
async function browser(url: URL): Promise<void> {
  const redirected = await fetch(url, { redirect: "manual" });
  await fetch(redirected.headers.get("location")!);
}

function service(opened: URL[] = []) {
  const store = new AuthStore(path.join(dir, "auth.json"), SEALED);
  const host = new PluginHost({
    environment: async () => ({}),
    clientName: "elastic-test",
    clientVersion: "0",
    auth: { store, open: async (url) => { opened.push(url); await browser(url); } },
  });
  return { store, plugins: new PluginService({ registry: new PluginRegistry(path.join(dir, "installed.json")), host }) };
}

describe("signing in to a remote plugin server", () => {
  it("starts as Sign in, signs in through the browser, then lists tools", async () => {
    const folder = path.join(dir, "remote");
    fs.mkdirSync(path.join(folder, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "remote" }));
    fs.writeFileSync(path.join(folder, ".mcp.json"), JSON.stringify({ remote: { type: "http", url: `${base}/mcp` } }));
    const opened: URL[] = [];
    const { store, plugins } = service(opened);
    const installed = await plugins.installFolder(folder);
    expect(installed.servers[0]).toMatchObject({ status: "signin", signedIn: false, toolNames: [] });
    // Nothing opened a browser on its own.
    expect(opened).toEqual([]);

    const after = await plugins.signIn("remote", "remote");
    expect(opened).toHaveLength(1);
    expect(opened[0]!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(after.servers[0]).toMatchObject({ status: "ready", signedIn: true, toolNames: ["whoami"] });
    // Sealed at rest.
    const file = fs.readFileSync(path.join(dir, "auth.json"), "utf8");
    expect(file).not.toContain("access_token");
    expect(store.get(`${base}/mcp`).tokens?.access_token).toBeTruthy();
    await plugins.dispose();
  });

  it("reconnects with saved tokens and refreshes an expired one, without a browser", async () => {
    const opened: URL[] = [];
    const { plugins } = service(opened);
    live.clear();
    const before = refreshed;
    await plugins.listAll();
    expect(plugins.plugin("remote")!.servers[0]).toMatchObject({ status: "ready", toolNames: ["whoami"] });
    expect(refreshed).toBe(before + 1);
    expect(opened).toEqual([]);
    await plugins.dispose();
  });

  it("goes back to Sign in when the credentials are gone, and Sign out forgets them", async () => {
    const { plugins, store } = service();
    await plugins.listAll();
    const out = await plugins.signOut("remote", "remote");
    expect(out.servers[0]).toMatchObject({ status: "signin", signedIn: false });
    expect(store.get(`${base}/mcp`)).toEqual({});
    await plugins.dispose();
  });

  it("knows a 401 when it sees one", () => {
    expect(isAuthError(Object.assign(new Error("Error POSTing to endpoint: Unauthorized"), { code: 401 }))).toBe(true);
    expect(isAuthError(new Error("ECONNREFUSED"))).toBe(false);
  });
});
