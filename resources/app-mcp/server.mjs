/**
 * The app's MCP server: the app's actions, as tools an agent
 * can call, on stdio: one process per integration per session, spawned by the agent because
 * the app passes it in `session/new`'s `mcpServers`. Only for an agent that cannot reach an HTTP
 * MCP server, and for the browser's Playwright runtime; the rest are served by main over HTTP
 * from the same code (`./servers.mjs`, `src/main/integrations/mcp-bridge.ts`).
 *
 * The server knows nothing about Electron. It reads four environment
 * variables: `WORKBENCH_BRIDGE_URL` and `WORKBENCH_BRIDGE_TOKEN` (the
 * bridge and the scoped token that names one session), `WORKBENCH_INTEGRATION`
 * (which integration's tools it serves, "workspace" when unset) and
 * `WORKBENCH_SKILLS_ROOT` (the skills the app materialised). It forwards
 * app-owned tool calls to main as `POST <bridge>/rpc` (see
 * `src/main/integrations/mcp-bridge.ts`, whose `BRIDGE_ENV` also sets the
 * session id and cwd; the token already names both, so they are not read here). Main does the work; this file is the
 * agent-facing description of it. The browser entry instead bootstraps a
 * scoped native connection and runs the upstream Playwright MCP server.
 *
 * Two tools are answered here instead: `list_skills` and `read_skill` read the
 * skills root the app materialised (`WORKBENCH_SKILLS_ROOT`,
 * `src/main/integrations/skills.ts`), which is static files on disk and needs neither
 * main nor a window. They are how an agent that does not load an additional
 * directory's skills by itself reaches the same files.
 *
 * `createServer` is exported so the unit test can drive the same tools over
 * an in-memory transport against a fake bridge; the stdio wiring at the
 * bottom runs only when this file is the entry point. In a packaged app the
 * script the agent runs is the esbuild bundle of this file
 * (scripts/build-mcp.mjs), alongside the copied upstream Playwright packages; in a
 * checkout the source itself resolves the SDK from `apps/desktop`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { integrationById } from "../../src/main/integrations/registry.mjs";
import { createPluginProxy, createServer, httpBridge } from "./servers.mjs";

export * from "./servers.mjs";

export async function main() {
  const version = readVersion();
  if ((process.env.WORKBENCH_INTEGRATION ?? "").startsWith("plugin:")) {
    await createPluginProxy(httpBridge(), { version }).connect(new StdioServerTransport());
    return;
  }
  if (integrationById(process.env.WORKBENCH_INTEGRATION ?? "workspace").runtime === "playwright") {
    const connection = await httpBridge()("browser_connection", {});
    process.chdir(connection.root);
    const { createConnection } = await import("@playwright/mcp");
    const server = await createConnection({ browser: { cdpEndpoint: connection.endpoint },
      capabilities: ["core", "pdf", "vision"],
      snapshot: { mode: "none" }, codegen: "none", console: { level: "error" },
      outputDir: connection.outputDir, timeouts: { action: 5000, navigation: 60000, settle: 500 } });
    await server.connect(new StdioServerTransport());
    return;
  }
  const server = createServer(httpBridge(), { version });
  await server.connect(new StdioServerTransport());
}

function readVersion() {
  // Beside the bundle in a packaged app (scripts/build-mcp.mjs writes it);
  // absent in a checkout, where the version is not what matters.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return fs.readFileSync(path.join(here, "VERSION"), "utf8").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`app-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
