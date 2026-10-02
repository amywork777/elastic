/**
 * The app as an MCP host for plugin servers.
 *
 * Every plugin MCP server the app talks to runs here, as the app's own MCP
 * client, one process per (scope, server): a session's scope is its id, so a
 * session has its own processes the way a Codex thread does; the "app" scope
 * serves global pages and the tool listing. Agents never spawn a plugin's
 * server themselves: they get the app's proxy (`resources/app-mcp/server.mjs`
 * in plugin mode), which forwards here, so the agent's `cad_show` and the CAD
 * tab's `cad_sync` reach the same process and see the same state.
 *
 * The client says it renders MCP Apps (the `io.modelcontextprotocol/ui`
 * extension with `text/html;profile=mcp-app`) and answers `roots/list` with
 * the session's directory.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListRootsRequestSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  MCP_APP_MIME,
  MCP_UI_EXTENSION,
  UI_ENTRYPOINTS,
  UI_ENTRYPOINTS_EXTENSION,
  type PluginServerConfig,
} from "../../shared/plugins";
import { expandPluginRoot, insidePlugin } from "./manifest";

/** The MCP methods a proxy may forward, and the result each is read as. */
export const FORWARDED_METHODS = {
  "tools/list": ListToolsResultSchema,
  "tools/call": CallToolResultSchema,
  "resources/list": ListResourcesResultSchema,
  "resources/templates/list": ListResourceTemplatesResultSchema,
  "resources/read": ReadResourceResultSchema,
  "prompts/list": ListPromptsResultSchema,
  "prompts/get": GetPromptResultSchema,
} as const;
export type ForwardedMethod = keyof typeof FORWARDED_METHODS;

export const APP_SCOPE = "app";
const DEFAULT_STARTUP_SECONDS = 30;
const DEFAULT_TOOL_SECONDS = 120;
const STDERR_LINES = 20;

export type HostedServer = { pluginId: string; root: string; name: string; config: PluginServerConfig };

type Connection = { client: Client; closed: boolean; stderr: string[]; roots: string[] };

export type PluginHostDeps = {
  /** The login shell's environment (PATH for `npx`, `uvx`, ...). */
  environment: () => Promise<Record<string, string>>;
  clientName: string;
  clientVersion: string;
  /** Extra directories in front of PATH (the app's own runtime, if any). */
  pathPrefix?: () => string[];
};

export class PluginHost {
  private readonly servers = new Map<string, HostedServer>();
  private readonly connections = new Map<string, Promise<Connection>>();

  constructor(private readonly deps: PluginHostDeps) {}

  private static key(pluginId: string, server: string): string {
    return `${pluginId}/${server}`;
  }

  /** Replace what can be run. A server that changed or went away has its processes closed. */
  setServers(servers: readonly HostedServer[]): void {
    const next = new Map(servers.map((server) => [PluginHost.key(server.pluginId, server.name), server]));
    for (const [key, previous] of this.servers) {
      const replacement = next.get(key);
      if (!replacement || JSON.stringify(replacement) !== JSON.stringify(previous)) void this.closeServer(key);
    }
    this.servers.clear();
    for (const [key, server] of next) this.servers.set(key, server);
  }

  has(pluginId: string, server: string): boolean {
    return this.servers.has(PluginHost.key(pluginId, server));
  }

  private async connect(scope: string, server: HostedServer, roots: string[]): Promise<Connection> {
    const { config } = server;
    const client = new Client(
      { name: this.deps.clientName, version: this.deps.clientVersion },
      {
        capabilities: {
          roots: { listChanged: false },
          extensions: {
            [MCP_UI_EXTENSION]: { mimeTypes: [MCP_APP_MIME] },
            [UI_ENTRYPOINTS_EXTENSION]: { entrypoints: [...UI_ENTRYPOINTS] },
          },
        },
      },
    );
    const connection: Connection = { client, closed: false, stderr: [], roots };
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: connection.roots.map((root) => ({ uri: pathToFileURL(root).href, name: path.basename(root) })),
    }));
    client.onclose = () => { connection.closed = true; };
    const timeout = (config.startup_timeout_sec ?? DEFAULT_STARTUP_SECONDS) * 1000;
    if (config.url) {
      const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
      await client.connect(transport, { timeout });
      return connection;
    }
    const shell = await this.deps.environment();
    const cwd = config.cwd ? insidePlugin(server.root, config.cwd) : server.root;
    const env: Record<string, string> = { ...shell };
    const prefix = this.deps.pathPrefix?.() ?? [];
    if (prefix.length > 0) {
      const pathKey = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
      env[pathKey] = [...prefix, env[pathKey]].filter(Boolean).join(path.delimiter);
    }
    for (const [name, value] of Object.entries(config.env)) env[name] = expandPluginRoot(value, server.root);
    env.PLUGIN_ROOT = server.root;
    env.CLAUDE_PLUGIN_ROOT = server.root;
    const transport = new StdioClientTransport({
      command: expandPluginRoot(config.command!, server.root),
      args: config.args.map((arg) => expandPluginRoot(arg, server.root)),
      env,
      cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => {
      connection.stderr.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean));
      if (connection.stderr.length > STDERR_LINES) connection.stderr.splice(0, connection.stderr.length - STDERR_LINES);
    });
    try {
      await client.connect(transport, { timeout });
    } catch (error) {
      await client.close().catch(() => {});
      const tail = connection.stderr.slice(-5).join("\n");
      throw new Error(`${server.name} did not start: ${error instanceof Error ? error.message : String(error)}${tail ? `\n${tail}` : ""}`, { cause: error });
    }
    return connection;
  }

  /** The live connection for a scope, started on first use. `roots` updates an existing one. */
  async client(scope: string, pluginId: string, serverName: string, roots: string[] = []): Promise<Client> {
    const serverKey = PluginHost.key(pluginId, serverName);
    const server = this.servers.get(serverKey);
    if (!server) throw new Error(`no enabled plugin "${pluginId}" with an MCP server "${serverName}"`);
    const key = `${scope}\u0000${serverKey}`;
    let pending = this.connections.get(key);
    if (pending) {
      const existing = await pending.catch(() => null);
      if (existing && !existing.closed) {
        existing.roots = roots.length > 0 ? roots : existing.roots;
        return existing.client;
      }
      this.connections.delete(key);
    }
    pending = this.connect(scope, server, roots);
    this.connections.set(key, pending);
    pending.catch(() => { if (this.connections.get(key) === pending) this.connections.delete(key); });
    return (await pending).client;
  }

  /** One MCP request from a proxy or the renderer, as the server answered it. */
  async request(scope: string, pluginId: string, serverName: string, method: ForwardedMethod, params: Record<string, unknown> = {}, options: { roots?: string[]; signal?: AbortSignal } = {}): Promise<unknown> {
    const schema = FORWARDED_METHODS[method];
    if (!schema) throw new Error(`${String(method)} is not forwarded to plugin servers`);
    const client = await this.client(scope, pluginId, serverName, options.roots);
    const server = this.servers.get(PluginHost.key(pluginId, serverName))!;
    const timeout = (server.config.tool_timeout_sec ?? DEFAULT_TOOL_SECONDS) * 1000;
    return client.request({ method, params } as never, schema, { timeout, signal: options.signal });
  }

  /** Every tool a server lists, through the app's own connection. */
  async listTools(pluginId: string, serverName: string): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request(APP_SCOPE, pluginId, serverName, "tools/list", cursor ? { cursor } : {}) as { tools: Tool[]; nextCursor?: string };
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** A server's last stderr lines, for a failure the person can act on. */
  async stderrOf(scope: string, pluginId: string, serverName: string): Promise<string[]> {
    const pending = this.connections.get(`${scope}\u0000${PluginHost.key(pluginId, serverName)}`);
    const connection = pending ? await pending.catch(() => null) : null;
    return connection ? [...connection.stderr] : [];
  }

  private async closeWhere(match: (scope: string, serverKey: string) => boolean): Promise<void> {
    const closing: Promise<unknown>[] = [];
    for (const [key, pending] of this.connections) {
      const [scope, serverKey] = key.split("\u0000") as [string, string];
      if (!match(scope, serverKey)) continue;
      this.connections.delete(key);
      closing.push(pending.then((connection) => connection.client.close()).catch(() => {}));
    }
    await Promise.all(closing);
  }

  /** A session ended: its processes go with it. */
  closeScope(scope: string): Promise<void> {
    return this.closeWhere((candidate) => candidate === scope);
  }

  private closeServer(serverKey: string): Promise<void> {
    return this.closeWhere((_, candidate) => candidate === serverKey);
  }

  closePlugin(pluginId: string): Promise<void> {
    return this.closeWhere((_, serverKey) => serverKey.startsWith(`${pluginId}/`));
  }

  dispose(): Promise<void> {
    return this.closeWhere(() => true);
  }
}
