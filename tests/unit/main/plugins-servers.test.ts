/**
 * The plugin host against real MCP servers: the example Tables plugin (no
 * dependencies, an MCP App with file and global entrypoints) and three
 * open-source servers from npm, run from this checkout's node_modules rather
 * than `npx` so the suite needs no network: the reference filesystem server
 * (which asks the client for its roots), the memory server, and the MCP Apps
 * basic example (SDK v2, a UI tool with no entrypoints).
 *
 * Then the agent's path: the app's MCP proxy (`server.mjs`, plugin mode) over
 * a real bridge, so an agent's `tools/list` hides app-only tools and its
 * `tools/call` reaches the same server process the app runs for the session.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPluginProxy, httpBridge } from "../../../resources/app-mcp/server.mjs";
import { McpBridge, PLUGIN_INTEGRATION_PREFIX } from "../../../src/main/integrations/mcp-bridge";
import { PluginHost } from "../../../src/main/plugins/host";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { PluginService } from "../../../src/main/plugins/service";
import { PluginsSnapshotSchema } from "../../../src/shared/ipc/plugins";

const root = path.resolve(".");
const modules = path.join(root, "node_modules", "@modelcontextprotocol");
let dir: string;
let project: string;
let service: PluginService;

function plugin(name: string, servers: Record<string, unknown>) {
  const folder = path.join(dir, name);
  fs.mkdirSync(path.join(folder, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".codex-plugin", "plugin.json"), JSON.stringify({ name, mcpServers: servers }));
  return folder;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "elastic-servers-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "elastic-project-")));
  fs.writeFileSync(path.join(project, "sizes.csv"), "name,size\nb.txt,20\na.txt,3\n");
  fs.writeFileSync(path.join(project, "notes.txt"), "hello from the project\n");
  const node = process.execPath;
  const host = new PluginHost({ environment: async () => ({ ...process.env }) as Record<string, string>, clientName: "elastic-test", clientVersion: "0" });
  service = new PluginService({ registry: new PluginRegistry(path.join(dir, "installed.json")), host });
  await service.installFolder(path.join(root, "resources", "plugins", "plugins", "csv-table"));
  await service.installFolder(plugin("fs", { filesystem: { command: node, args: [path.join(modules, "server-filesystem", "dist", "index.js")] } }));
  await service.installFolder(plugin("mem", { memory: { command: node, args: [path.join(modules, "server-memory", "dist", "index.js")], env: { MEMORY_FILE_PATH: path.join(dir, "memory.jsonl") } } }));
  await service.installFolder(plugin("demo", { basic: { command: node, args: [path.join(modules, "server-basic-vanillajs", "dist", "index.js"), "--stdio"] } }));
}, 60_000);

afterAll(async () => {
  await service?.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe("the plugin host, against real servers", () => {
  it("lists every server's tools and reads the UI ones' entrypoints", () => {
    const plugins = Object.fromEntries(service.plugins().map((entry) => [entry.id, entry]));
    for (const id of ["csv-table", "fs", "mem", "demo"]) {
      expect(plugins[id]!.servers.every((server) => server.status === "ready"), `${id}: ${JSON.stringify(plugins[id]!.servers)}`).toBe(true);
    }
    expect(plugins["csv-table"]!.skills).toEqual(["csv-tables"]);
    expect(plugins["csv-table"]!.tools.map((tool) => [tool.id, tool.entrypoints.map((entry) => entry.type)])).toEqual([
      ["tables/show_table", ["file", "thread"]],
      ["tables/tables_home", ["global"]],
    ]);
    expect(plugins.fs!.servers[0]!.toolNames).toContain("read_text_file");
    expect(plugins.fs!.tools).toEqual([]);
    expect(plugins.mem!.servers[0]!.toolNames).toContain("create_entities");
    expect(plugins.demo!.tools.map((tool) => [tool.id, tool.entrypoints])).toEqual([["basic/get-time", [{ type: "thread" }]]]);
  });

  it("answers snapshots the IPC contract accepts", () => {
    const parsed = PluginsSnapshotSchema.safeParse(service.snapshot());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("serves an MCP App's HTML and calls its tool, as the frame does", async () => {
    const tool = service.uiTool("demo", "basic/get-time")!;
    const read = await service.request(null, "demo", "basic", "resources/read", { uri: tool.resourceUri }) as { contents: Array<{ mimeType: string; text: string }> };
    expect(read.contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
    expect(read.contents[0]!.text).toContain("<html");
    const result = await service.request(null, "demo", "basic", "tools/call", { name: "get-time", arguments: {} }) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("opens a file in the Tables plugin with Codex's file argument", async () => {
    const result = await service.request("s1", "csv-table", "tables", "tools/call", {
      name: "show_table", arguments: { file: { name: "sizes.csv", resourceUri: `file://${project}/sizes.csv` } },
    }, { roots: [project] }) as { structuredContent: { columns: string[]; total: number } };
    expect(result.structuredContent).toMatchObject({ columns: ["name", "size"], total: 2 });
  });

  it("answers the filesystem server's roots/list with the scope's folder", async () => {
    // The server asks for its roots after initializing, without holding calls for the answer:
    // a call in the first few milliseconds can beat it, so the first one is retried.
    const read = () => service.request("s1", "fs", "filesystem", "tools/call", { name: "read_text_file", arguments: { path: path.join(project, "notes.txt") } }, { roots: [project] }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    let result = await read();
    for (let attempt = 0; result.isError && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = await read();
    }
    expect(result.isError ?? false, JSON.stringify(result)).toBe(false);
    expect(result.content[0]!.text).toContain("hello from the project");
    const outside = await service.request("s1", "fs", "filesystem", "tools/call", { name: "read_text_file", arguments: { path: path.join(dir, "installed.json") } }, { roots: [project] }) as { isError?: boolean };
    expect(outside.isError).toBe(true);
  });

  it("answers an empty list for a family a server does not serve", async () => {
    expect(await service.request(null, "mem", "memory", "prompts/list", {})).toEqual({ prompts: [] });
  });

  it("turns a plugin off and on, closing and restarting its servers", async () => {
    await service.setEnabled("mem", false);
    expect(service.hasServer("mem", "memory")).toBe(false);
    expect(service.plugin("mem")!.tools).toEqual([]);
    await service.setEnabled("mem", true);
    expect(service.plugin("mem")!.servers[0]!.status).toBe("ready");
  });
});

describe("an agent's proxy, through the bridge", () => {
  let bridge: McpBridge;
  let agent: Client;
  const session = { sessionId: "agent-1", projectId: "p1", cwd: "" };

  beforeAll(async () => {
    session.cwd = project;
    bridge = new McpBridge({}, () => ({ command: "node", args: [], env: {} }), undefined, async (bridged, target, request, signal) => {
      return service.agentRequest(bridged.sessionId, bridged.cwd, target.pluginId, target.server, request.method as never, request.params, signal);
    });
    const url = await bridge.start();
    const token = bridge.tokenFor(session, `${PLUGIN_INTEGRATION_PREFIX}csv-table/tables`);
    const proxy = createPluginProxy(httpBridge({ WORKBENCH_BRIDGE_URL: url, WORKBENCH_BRIDGE_TOKEN: token }), { name: "tables" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await proxy.connect(serverSide);
    agent = new Client({ name: "agent", version: "0" });
    await agent.connect(clientSide);
  });

  afterAll(async () => {
    await agent?.close();
    await bridge?.stop();
  });

  it("hides app-only tools from the model and refuses to call them", async () => {
    const { tools } = await agent.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["show_table"]);
    const refused = await agent.callTool({ name: "tables_home", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("not for agents");
  });

  it("calls a tool in the session's folder", async () => {
    const result = await agent.callTool({ name: "show_table", arguments: { path: "sizes.csv" } });
    expect(JSON.stringify(result.content)).toContain("2 rows, columns name, size");
  });

  it("refuses a token for one plugin server used for another method", async () => {
    const response = await fetch(`${bridge.address()}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${bridge.tokenFor(session, `${PLUGIN_INTEGRATION_PREFIX}csv-table/tables`)}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "open_file", params: { path: "x" } }),
    });
    expect(response.status).toBe(403);
  });
});
