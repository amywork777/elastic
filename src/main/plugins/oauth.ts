/**
 * OAuth for remote (Streamable HTTP) plugin servers: Figma's, Linear's, any
 * server that answers 401 and names its authorization server.
 *
 * The MCP SDK does the protocol (protected-resource and authorization-server
 * discovery, dynamic client registration, PKCE, the code exchange and the
 * refresh); this file is the client side it asks for: where tokens live,
 * which redirect to register, and how the browser is opened.
 *
 * - Credentials are kept per server URL in one file under the app's user
 *   data, each value sealed by `Codec` (Electron's `safeStorage` in the app,
 *   so another account on the machine reads ciphertext).
 * - Nothing opens a browser on its own. A server with no tokens answers 401
 *   at start and shows "Sign in"; only the person's click runs `signIn`,
 *   which listens on a loopback port for the redirect (RFC 8252), opens the
 *   system browser at the authorization URL, and exchanges the code.
 * - A connection with saved tokens hands the SDK a provider that refreshes on
 *   its own; when that fails the server goes back to "Sign in".
 * - A server that does not let apps register themselves (Slack's, GitHub's,
 *   Google's) is signed in to with the client the plugin names in its
 *   `.mcp.json` `oauth` block, in either spelling: Codex's `client_id`,
 *   `client_secret`, `callback_port`, `callback_url` and a top-level `scopes`,
 *   or Claude Code's `clientId` and `callbackPort` (`oauthOptions`). A fixed
 *   port or URL is the redirect that client was registered with, so the
 *   listener takes exactly that one.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export type StoredAuth = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirectUrl?: string };

/** Where the authorization server sends the browser back: the loopback listener's address. */
export type OAuthCallback = { host: "127.0.0.1" | "localhost"; port: number; path: string };

/** What a plugin's `.mcp.json` says about signing in to its server. */
export type OAuthOptions = {
  /** A client registered ahead of time; without one the SDK registers one, where the server lets it. */
  client?: { client_id: string; client_secret?: string };
  /** Space-separated, as the authorization request carries it. */
  scope?: string;
  /** A fixed redirect; without one, a free port on 127.0.0.1 at `/callback`. */
  callback?: OAuthCallback;
};

/** A value a marketplace left for the publisher to fill in (`<GOOGLE_CALENDAR_PUBLIC_CLIENT_ID>`). */
const PLACEHOLDER = /^<[^>]*>$/;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && !PLACEHOLDER.test(value.trim()) ? value.trim() : undefined;
}

function port(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 && number < 65536 ? number : undefined;
}

/**
 * The sign-in a server's config asks for, read from either spelling. Claude Code's `callbackPort`
 * redirects to `localhost`, as Claude Code registers its clients; Codex's to `127.0.0.1`.
 */
export function oauthOptions(config: Record<string, unknown>): OAuthOptions {
  const oauth = config.oauth && typeof config.oauth === "object" ? config.oauth as Record<string, unknown> : {};
  const options: OAuthOptions = {};
  const clientId = text(oauth.client_id) ?? text(oauth.clientId);
  if (clientId) {
    const secret = text(oauth.client_secret) ?? text(oauth.clientSecret);
    options.client = secret ? { client_id: clientId, client_secret: secret } : { client_id: clientId };
  }
  const scopes = Array.isArray(config.scopes) ? config.scopes.filter((scope): scope is string => typeof scope === "string" && scope.length > 0) : [];
  if (scopes.length > 0) options.scope = scopes.join(" ");
  const url = text(oauth.callback_url);
  const callbackUrl = url ? (() => { try { return new URL(url); } catch { return null; } })() : null;
  if (callbackUrl && callbackUrl.protocol === "http:" && (callbackUrl.hostname === "127.0.0.1" || callbackUrl.hostname === "localhost") && port(callbackUrl.port)) {
    options.callback = { host: callbackUrl.hostname, port: Number(callbackUrl.port), path: callbackUrl.pathname || "/callback" };
  } else if (port(oauth.callback_port)) {
    options.callback = { host: "127.0.0.1", port: port(oauth.callback_port)!, path: "/callback" };
  } else if (port(oauth.callbackPort)) {
    options.callback = { host: "localhost", port: port(oauth.callbackPort)!, path: "/callback" };
  }
  return options;
}

/** Seals a credential at rest. */
export type Codec = { seal(text: string): string; open(sealed: string): string };

export const PLAIN_CODEC: Codec = { seal: (text) => text, open: (sealed) => sealed };

/** Credentials per server URL, in one JSON file of sealed values. */
export class AuthStore {
  constructor(private readonly file: string, private readonly codec: Codec = PLAIN_CODEC) {}

  private readAll(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }

  get(url: string): StoredAuth {
    const sealed = this.readAll()[url];
    if (!sealed) return {};
    try {
      return JSON.parse(this.codec.open(sealed)) as StoredAuth;
    } catch {
      return {};
    }
  }

  set(url: string, value: StoredAuth | undefined): void {
    const all = this.readAll();
    if (value && (value.client || value.tokens)) all[url] = this.codec.seal(JSON.stringify(value));
    else delete all[url];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  signedIn(url: string): boolean {
    return Boolean(this.get(url).tokens?.access_token);
  }
}

/**
 * The SDK's view of one server's credentials. `interactive` is set only for a
 * sign-in the person started: outside one, a request to send the browser
 * somewhere is refused, and the connection fails as "needs sign-in".
 */
export class ServerAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  private expectedState: string | undefined;
  private interactiveRedirect: string | undefined;

  constructor(
    private readonly url: string,
    private readonly store: AuthStore,
    private readonly clientName: string,
    private readonly open: (url: URL) => void | Promise<void> = () => {},
    private readonly options: OAuthOptions = {},
  ) {}

  /** Begin a sign-in that will receive the code at `redirect`. */
  beginInteractive(redirect: string): void {
    this.interactiveRedirect = redirect;
  }

  endInteractive(): void {
    this.interactiveRedirect = undefined;
  }

  state(): string {
    this.expectedState = randomBytes(16).toString("hex");
    return this.expectedState;
  }

  checkState(state: string | null): boolean {
    return Boolean(this.expectedState) && state === this.expectedState;
  }

  get redirectUrl(): string | undefined {
    return this.interactiveRedirect ?? this.store.get(this.url).redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: this.redirectUrl ? [this.redirectUrl] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.options.client?.client_secret ? "client_secret_post" : "none",
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    // The plugin's own client, registered ahead of time: nothing to register, whatever the port.
    if (this.options.client) return this.options.client;
    const stored = this.store.get(this.url);
    // A client registered for another loopback port cannot take this redirect: register again.
    if (this.interactiveRedirect && stored.redirectUrl !== this.interactiveRedirect) return undefined;
    return stored.client;
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    const stored = this.store.get(this.url);
    this.store.set(this.url, { ...stored, client, redirectUrl: this.interactiveRedirect ?? stored.redirectUrl });
  }

  tokens(): OAuthTokens | undefined {
    return this.store.get(this.url).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    // The redirect goes with the tokens too: the SDK reads a provider with none as a flow that
    // cannot refresh, and a plugin's own client never registers, which is where it was saved.
    const stored = this.store.get(this.url);
    this.store.set(this.url, { ...stored, tokens, redirectUrl: this.interactiveRedirect ?? stored.redirectUrl });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactiveRedirect) throw new SignInRequired(this.url);
    await this.open(authorizationUrl);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error("no sign-in is under way");
    return this.verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "verifier") { this.verifier = undefined; return; }
    if (scope === "discovery") return;
    const stored = this.store.get(this.url);
    if (scope === "all") this.store.set(this.url, undefined);
    else if (scope === "client") this.store.set(this.url, { tokens: stored.tokens });
    else this.store.set(this.url, { client: stored.client, redirectUrl: stored.redirectUrl });
  }
}

/** A remote server answered 401 and there is nothing to sign in with: the person has to. */
export class SignInRequired extends Error {
  constructor(readonly url: string) {
    super("Sign in to use this server");
    this.name = "SignInRequired";
  }
}

/** True for an error that means "this server wants credentials". */
export function isAuthError(error: unknown): boolean {
  if (error instanceof SignInRequired) return true;
  const record = error as { name?: string; code?: number; message?: string } | null;
  if (!record) return false;
  if (record.name === "UnauthorizedError" || record.code === 401) return true;
  return /\bUnauthorized\b|\b401\b/.test(String(record.message ?? ""));
}

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/**
 * The person's sign-in: a loopback listener, the browser at the authorization
 * URL, and the code exchanged for tokens. Resolves once tokens are saved.
 */
export async function signIn(
  url: string,
  provider: ServerAuthProvider,
  options: { timeoutMs?: number; fetchFn?: typeof fetch; oauth?: OAuthOptions } = {},
): Promise<void> {
  const fixed = options.oauth?.callback;
  const { servers, port } = await listen(fixed);
  const callbackPath = fixed?.path ?? "/callback";
  const redirect = `http://${fixed?.host ?? "127.0.0.1"}:${port}${callbackPath}`;
  let settle: (code: string) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const received = new Promise<string>((resolve, reject) => { settle = resolve; fail = reject; });
  const onRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
    const at = new URL(request.url ?? "/", redirect);
    if (at.pathname !== callbackPath) { response.writeHead(404).end(); return; }
    const error = at.searchParams.get("error");
    const code = at.searchParams.get("code");
    const ok = !error && code && provider.checkState(at.searchParams.get("state"));
    response.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    response.end(page(ok ? "Signed in. You can close this tab and go back to the app." : `Sign-in did not finish${error ? `: ${escape(error)}` : ""}. Close this tab and try again from the app.`));
    if (ok) settle(code!);
    else fail(new Error(error ? `the server refused the sign-in: ${error}` : "the sign-in came back without a valid code"));
  };
  for (const server of servers) server.on("request", onRequest);
  const timer = setTimeout(() => fail(new Error("the sign-in was not finished in the browser within 5 minutes")), options.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
  // The last refusal, to say which step failed: a server that only lets approved apps register is common.
  let refused: { url: string; status: number } | null = null;
  const base = options.fetchFn ?? fetch;
  const fetchFn: typeof fetch = async (input, init) => {
    const response = await base(input, init);
    if (response.status >= 400) refused = { url: String(input instanceof Request ? input.url : input), status: response.status };
    return response;
  };
  provider.beginInteractive(redirect);
  try {
    const scope = options.oauth?.scope;
    const first = await auth(provider, { serverUrl: url, fetchFn, ...(scope ? { scope } : {}) });
    if (first === "AUTHORIZED") return;
    const code = await received;
    const second = await auth(provider, { serverUrl: url, authorizationCode: code, fetchFn, ...(scope ? { scope } : {}) });
    if (second !== "AUTHORIZED") throw new Error("the server did not accept the sign-in");
  } catch (error) {
    const last = refused as { url: string; status: number } | null;
    if (last && /\/register\b/.test(new URL(last.url).pathname) && (last.status === 401 || last.status === 403)) {
      throw new Error(`${new URL(url).host} only lets approved apps sign in (its client registration answered ${last.status}). The server's owner has to allow this app.`, { cause: error });
    }
    // The SDK's words for a server with no registration endpoint, when the plugin names no client.
    if (error instanceof Error && /does not support dynamic client registration/.test(error.message)) {
      throw new Error(`${new URL(url).host} only signs in apps registered with it, and this plugin does not name one (no oauth client_id in its .mcp.json).`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    provider.endInteractive();
    for (const server of servers) server.close();
  }
}

/**
 * The loopback listener: on the fixed port a registered client needs, or any free one. A
 * `localhost` redirect is answered on IPv6's loopback as well, since a browser may try `::1`
 * first; nothing listens beyond loopback.
 */
async function listen(fixed?: OAuthCallback): Promise<{ servers: http.Server[]; port: number }> {
  const one = (host: string, wanted: number) => new Promise<{ server: http.Server; port: number }>((resolve, reject) => {
    const server = http.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "EADDRINUSE" && fixed
        ? new Error(`port ${fixed.port}, which this server's sign-in has to come back to, is in use. Close what holds it and try again.`)
        : error);
    });
    server.listen(wanted, host, () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
  const first = await one("127.0.0.1", fixed?.port ?? 0);
  if (fixed?.host !== "localhost") return { servers: [first.server], port: first.port };
  // A machine without IPv6 still has 127.0.0.1, which is enough.
  const second = await one("::1", first.port).catch(() => null);
  return { servers: second ? [first.server, second.server] : [first.server], port: first.port };
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Sign in</title><body style="font:16px system-ui;margin:4rem auto;max-width:28rem">${escape(message)}</body>`;
}
