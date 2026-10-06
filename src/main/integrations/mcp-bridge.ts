/**
 * The bridge between the app MCP server and main (plan §8).
 *
 * Two ways in, one set of checks. An agent that can reach an HTTP MCP server
 * (Claude Code, Codex: `capabilities.mcpHttp`) is given `POST /mcp` here: the
 * app's servers (`resources/app-mcp/servers.mjs`) served by main itself over
 * Streamable HTTP, with no process per server. Any other agent, and the
 * browser (whose Playwright runtime lives in its own process), is given the
 * stdio server (`resources/app-mcp/server.mjs`) that the *agent* spawns, with
 * an environment: the URL of this bridge, a token that names one session, and
 * that session's cwd; each of its tool calls is one `POST /rpc`. Both arrive
 * at `BridgeActions` through the same token, method and schema checks.
 * Measured: fourteen stdio servers a Claude chat, at 73 MB each, were 4.9 GB
 * across five open chats.
 *
 * Local only: the listener is 127.0.0.1 on an OS-assigned port, and a request
 * without a live session's token is refused before its body is read. A token
 * is minted per session and integration (`tokenFor`) and forgotten when the
 * session is archived, closed or deleted (`revoke`), so a server left running
 * by a dead agent cannot act on a later one.
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { McpServer } from "@agentclientprotocol/sdk";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type BridgeSession = { sessionId: string; projectId: string; cwd: string };

/** App handlers share authenticated identity; each MCP gets its own allowed method set. */
export type BridgeActions = Record<string, (session: BridgeSession, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>;
export type BridgeMethod = string;
/** A bridge call as the app's MCP servers make it (`servers.mjs`): the method and its params. */
export type BridgeCall = (method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
/** An MCP server over a bridge call, for one integration: `createServer` or `createPluginProxy`. */
export type HttpServerFactory = (integration: string, name: string, bridge: BridgeCall) => {
  connect(transport: StreamableHTTPServerTransport): Promise<void>;
  close(): Promise<void>;
};
import { integrations, integrationById, toolByName } from "./registry.mjs";
import { MAX_DOCUMENT_CHARS } from "./documents/module.mjs";
export const BRIDGE_METHODS: readonly string[] = integrations.flatMap(entry => [...entry.tools, ...(entry.hostTools ?? [])].map(tool => tool.name));

/**
 * A plugin server's proxy authenticates as `plugin:<pluginId>/<server>` and
 * may call one method, `plugin_rpc`: an MCP request (`{ method, params }`) the
 * app forwards to the plugin server it runs for that session.
 */
export const PLUGIN_INTEGRATION_PREFIX = "plugin:";
export const PLUGIN_RPC = "plugin_rpc";
export type PluginRpcHandler = (session: BridgeSession, target: { pluginId: string; server: string }, request: { method: string; params: Record<string, unknown> }, signal?: AbortSignal) => Promise<unknown>;

/** The plugin and server a `plugin:` integration names, or null for an app integration. */
export function pluginTarget(integration: string): { pluginId: string; server: string } | null {
  if (!integration.startsWith(PLUGIN_INTEGRATION_PREFIX)) return null;
  const rest = integration.slice(PLUGIN_INTEGRATION_PREFIX.length);
  const slash = rest.lastIndexOf("/");
  if (slash <= 0 || slash === rest.length - 1) throw new Error(`Unknown integration: ${integration}`);
  return { pluginId: rest.slice(0, slash), server: rest.slice(slash + 1) };
}

/** An app integration must exist; a plugin one must be well formed (the handler checks it is enabled). */
function checkIntegration(integration: string): void {
  if (!pluginTarget(integration)) integrationById(integration);
}

/** The environment the MCP server reads. One place, shared with server.mjs by name. */
export const BRIDGE_ENV = {
  url: "WORKBENCH_BRIDGE_URL",
  token: "WORKBENCH_BRIDGE_TOKEN",
  cwd: "WORKBENCH_CWD",
  session: "WORKBENCH_SESSION_ID",
} as const;

/**
 * The request body cap, from the largest thing a tool accepts: a document of
 * `MAX_DOCUMENT_CHARS`. JSON can spend six bytes on one UTF-16 unit (a control
 * character or a lone surrogate is `\u00XX`), so a buffer the schema accepts
 * must not be refused here as too large; 64 KB covers the rest of the request.
 */
const MAX_BODY_BYTES = 6 * MAX_DOCUMENT_CHARS + 64 * 1024;

export class McpBridge {
  private server: http.Server | null = null;
  private url: string | null = null;
  private readonly tokens = new Map<string, { token: string; session: BridgeSession }>();
  private readonly inFlight = new Map<AbortController, BridgeSession>();
  private readonly byToken = new Map<string, { session: BridgeSession; integration: string; name: string }>();

  constructor(
    private readonly actions: BridgeActions,
    private readonly serverScript: () => { command: string; args: string[]; env: Record<string, string> },
    private readonly resources?: {
      revoke(sessionId: string): void;
      /** The session's open pages: what a workspace change strands, though the session lives on. */
      disposePages?(session: BridgeSession): void | Promise<void>;
      dispose(): Promise<void>;
    },
    private readonly pluginRpc?: PluginRpcHandler,
    /** Serves `POST /mcp`; without it the bridge offers stdio servers only. */
    private readonly httpServers?: HttpServerFactory,
  ) {}

  /** Listen. Idempotent. */
  async start(): Promise<string> {
    if (this.url) {
      return this.url;
    }
    const server = http.createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const { port } = server.address() as AddressInfo;
    this.server = server;
    this.url = `http://127.0.0.1:${port}`;
    return this.url;
  }

  address(): string | null {
    return this.url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.url = null;
    for (const controller of this.inFlight.keys()) controller.abort(new Error("the app is shutting down"));
    this.tokens.clear();
    this.byToken.clear();
    try {
      await this.resources?.dispose();
    } finally {
      // The listener closes whatever the disposal did: a rejection is surfaced to the caller, not
      // a reason to leave a loopback port open.
      if (server) {
        await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      }
    }
  }

  /** The token for a session, minted once. */
  tokenFor(session: BridgeSession, integration = "workspace", name = `app-${integration}`): string {
    checkIntegration(integration);
    const key = `${session.sessionId}:${integration}`;
    const existing = this.tokens.get(key);
    if (existing) {
      // The cwd or project can change across a resume; the token does not.
      if (existing.session.cwd !== session.cwd || existing.session.projectId !== session.projectId) {
        this.resources?.revoke(session.sessionId);
        // Pages opened in a scope the new workspace does not name are out of
        // reach of the person's tabs and the agent alike, and would outlive it
        // until archive; the ones in a scope it still names stay.
        void this.resources?.disposePages?.(session);
        for (const [controller, active] of this.inFlight) if (active.sessionId === session.sessionId) controller.abort(new Error("Session workspace changed"));
      }
      existing.session = session;
      this.byToken.set(existing.token, { session, integration, name });
      return existing.token;
    }
    const token = randomBytes(24).toString("base64url");
    this.tokens.set(key, { token, session });
    this.byToken.set(token, { session, integration, name });
    return token;
  }

  revoke(sessionId: string): void {
    this.resources?.revoke(sessionId);
    for (const [controller, session] of this.inFlight) if (session.sessionId === sessionId) controller.abort(new Error("Session authorization revoked"));
    for (const [key, entry] of this.tokens) {
      if (entry.session.sessionId === sessionId) { this.tokens.delete(key); this.byToken.delete(entry.token); }
    }
  }

  /**
   * The ACP `McpServer` entry for a session — what `session/new` carries. `http` for an agent
   * that can reach an HTTP MCP server: `/mcp` here, the token in its header, no process. An
   * integration with a runtime of its own (the browser's Playwright) is stdio either way.
   */
  serverFor(session: BridgeSession, integration = "workspace", name = `app-${integration}`, http = false): McpServer {
    checkIntegration(integration);
    if (!this.url) {
      throw new Error("the MCP bridge is not listening");
    }
    const runtime = pluginTarget(integration) ? undefined : integrationById(integration).runtime;
    if (http && this.httpServers && !runtime) {
      return {
        type: "http",
        name,
        url: `${this.url}/mcp`,
        headers: [{ name: "Authorization", value: `Bearer ${this.tokenFor(session, integration, name)}` }],
      };
    }
    const script = this.serverScript();
    const env = {
      ...script.env,
      [BRIDGE_ENV.url]: this.url,
      [BRIDGE_ENV.token]: this.tokenFor(session, integration, name),
      WORKBENCH_INTEGRATION: integration,
      [BRIDGE_ENV.cwd]: session.cwd,
      [BRIDGE_ENV.session]: session.sessionId,
    };
    // No `type` field on purpose: claude-agent-acp treats any entry that
    // carries one as http/sse and drops it unless the type matches, and
    // reads an entry without one as stdio. Codex-acp accepts either.
    return {
      name,
      command: script.command,
      args: script.args,
      env: Object.entries(env).map(([name, value]) => ({ name, value })),
    };
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const mcp = request.url === "/mcp" && this.httpServers !== undefined;
    if (!mcp && (request.method !== "POST" || request.url !== "/rpc")) {
      send(404, { ok: false, error: "not found" });
      return;
    }
    const auth = request.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const authorization = token ? this.byToken.get(token) : undefined;
    if (!authorization) {
      send(401, { ok: false, error: "unknown session token" });
      request.resume();
      return;
    }
    if (mcp) {
      await this.handleMcp(request, response, token, authorization, send);
      return;
    }
    const { session, integration } = authorization;
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_BODY_BYTES) { send(413, { ok: false, error: "request too large" }); return; }
        chunks.push(bytes);
      }
    } catch { if (!response.destroyed) send(400, { ok: false, error: "request interrupted" }); return; }
    let parsed: { method?: unknown; params?: unknown };
    try {
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
      parsed = value;
    } catch { send(400, { ok: false, error: "malformed JSON object" }); return; }
    // Revocation can happen while a client is still sending its body. `tokenFor`
    // re-records the entry on every `serverFor`, so the entry is not compared:
    // the token must still be live and still name the workspace the request
    // began in.
    const current = this.byToken.get(token)?.session;
    if (!current || current.cwd !== session.cwd || current.projectId !== session.projectId) { send(401, { ok: false, error: "session authorization changed" }); return; }
    const method = parsed.method;
    const target = pluginTarget(integration);
    if (target) {
      await this.handlePlugin(session, target, method, parsed.params, response, send);
      return;
    }
    if (typeof method !== "string" || !(BRIDGE_METHODS as readonly string[]).includes(method)) {
      send(400, { ok: false, error: `unknown method ${String(method)}` });
      return;
    }
    const definition = toolByName(method);
    if (!definition || definition.integration.id !== integration) {
      send(403, { ok: false, error: "method is outside this integration" }); return;
    }
    const validated = definition.tool.inputSchema.safeParse(parsed.params ?? {});
    if (!validated.success) { send(400, { ok: false, error: validated.error.message }); return; }
    const controller = new AbortController();
    this.inFlight.set(controller, session);
    const disconnected = () => { if (!response.writableEnded) controller.abort(new Error("tool request cancelled")); };
    response.once("close", disconnected);
    try {
      const handler = this.actions[method];
      if (!handler) throw new Error(`Integration method is unavailable: ${method}`);
      const result = await handler(session, validated.data, controller.signal);
      // The handler has finished: a write_terminal or edit_document is done,
      // and "revoked" alone would read as if it were not. Say which it is, in
      // the abort's own words (a shutdown, a revoke and a move are not one thing).
      if (controller.signal.aborted) {
        const why = controller.signal.reason instanceof Error ? controller.signal.reason.message : "cancelled";
        throw new Error(`${method} was applied, but the request was aborted before the reply (${why}); check the result before retrying`);
      }
      if (!response.destroyed) send(200, { ok: true, result });
    } catch (error) {
      if (!response.destroyed) send(200, { ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally { this.inFlight.delete(controller); response.off("close", disconnected); }
  }

  /**
   * `/mcp`: one stateless Streamable HTTP exchange with the integration's server, made for this
   * request and closed after it. JSON answers, no stream: a GET (for server-sent events) is 405,
   * which a client takes as "no notifications". The body has the `/rpc` cap.
   */
  private async handleMcp(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    token: string,
    authorization: { session: BridgeSession; integration: string; name: string },
    send: (status: number, body: unknown) => void,
  ) {
    if (request.method !== "POST") {
      request.resume();
      response.writeHead(405, { allow: "POST" }).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_BODY_BYTES) { send(413, { ok: false, error: "request too large" }); return; }
        chunks.push(bytes);
      }
    } catch { if (!response.destroyed) send(400, { ok: false, error: "request interrupted" }); return; }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { send(400, { ok: false, error: "malformed JSON" }); return; }
    const server = this.httpServers!(authorization.integration, authorization.name,
      (method, params, signal) => this.call(token, authorization.session, method, params, signal));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once("close", () => { void transport.close().catch(() => {}); void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) send(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * One call from a server `/mcp` made in-process: the checks `/rpc` applies, in the same order.
   * The token must still be live and name the workspace the exchange began in; the method must be
   * this integration's (or `plugin_rpc`, for a plugin's); the params must pass its schema. A
   * refusal or a failure is thrown, and the server reports it to the agent as the tool's error.
   */
  private async call(token: string, began: BridgeSession, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const current = this.byToken.get(token);
    if (!current || current.session.cwd !== began.cwd || current.session.projectId !== began.projectId) {
      throw new Error("session authorization changed");
    }
    const { session, integration } = current;
    const target = pluginTarget(integration);
    let run: (signal: AbortSignal) => Promise<unknown>;
    if (target) {
      if (method !== PLUGIN_RPC || !this.pluginRpc) throw new Error("method is outside this integration");
      const request = params as { method?: unknown; params?: unknown };
      if (typeof request.method !== "string" || (request.params !== undefined && (typeof request.params !== "object" || request.params === null || Array.isArray(request.params)))) {
        throw new Error("plugin_rpc needs { method, params }");
      }
      const forwarded = { method: request.method, params: (request.params ?? {}) as Record<string, unknown> };
      run = (abort) => this.pluginRpc!(session, target, forwarded, abort);
    } else {
      if (!(BRIDGE_METHODS as readonly string[]).includes(method)) throw new Error(`unknown method ${method}`);
      const definition = toolByName(method);
      if (!definition || definition.integration.id !== integration) throw new Error("method is outside this integration");
      const validated = definition.tool.inputSchema.safeParse(params ?? {});
      if (!validated.success) throw new Error(validated.error.message);
      const handler = this.actions[method];
      if (!handler) throw new Error(`Integration method is unavailable: ${method}`);
      run = (abort) => handler(session, validated.data, abort);
    }
    const controller = new AbortController();
    const forward = () => controller.abort(signal?.reason ?? new Error("tool request cancelled"));
    if (signal?.aborted) forward();
    else signal?.addEventListener("abort", forward, { once: true });
    this.inFlight.set(controller, session);
    try {
      const result = await run(controller.signal);
      if (controller.signal.aborted && !target) {
        const why = controller.signal.reason instanceof Error ? controller.signal.reason.message : "cancelled";
        throw new Error(`${method} was applied, but the request was aborted before the reply (${why}); check the result before retrying`);
      }
      return result;
    } finally {
      this.inFlight.delete(controller);
      signal?.removeEventListener("abort", forward);
    }
  }

  /** `plugin_rpc` from a plugin server's proxy: `{ method, params }`, forwarded by `pluginRpc`. */
  private async handlePlugin(session: BridgeSession, target: { pluginId: string; server: string }, method: unknown, params: unknown, response: http.ServerResponse, send: (status: number, body: unknown) => void) {
    if (method !== PLUGIN_RPC || !this.pluginRpc) { send(403, { ok: false, error: "method is outside this integration" }); return; }
    const request = params as { method?: unknown; params?: unknown } | null;
    if (!request || typeof request !== "object" || typeof request.method !== "string"
      || (request.params !== undefined && (typeof request.params !== "object" || request.params === null || Array.isArray(request.params)))) {
      send(400, { ok: false, error: "plugin_rpc needs { method, params }" }); return;
    }
    const controller = new AbortController();
    this.inFlight.set(controller, session);
    const disconnected = () => { if (!response.writableEnded) controller.abort(new Error("tool request cancelled")); };
    response.once("close", disconnected);
    try {
      const result = await this.pluginRpc(session, target, { method: request.method, params: (request.params ?? {}) as Record<string, unknown> }, controller.signal);
      if (!response.destroyed) send(200, { ok: true, result });
    } catch (error) {
      if (!response.destroyed) send(200, { ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally { this.inFlight.delete(controller); response.off("close", disconnected); }
  }
}
