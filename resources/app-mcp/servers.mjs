/**
 * The app's MCP servers, without a transport: what an agent's tool call reaches, written once for
 * the two ways it is served. `server.mjs` runs one over stdio in a process the agent spawns (the
 * browser's, and any agent that cannot reach an HTTP server); main serves the rest over
 * Streamable HTTP on its own bridge (`src/main/integrations/mcp-bridge.ts`, `/mcp`), with no
 * process at all. Both hand every call to the same bridge function, so the same token, method and
 * schema checks apply either way.
 */
import fs from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { integrationById } from "../../src/main/integrations/registry.mjs";

export const BRIDGE_ENV = {
  url: "WORKBENCH_BRIDGE_URL",
  token: "WORKBENCH_BRIDGE_TOKEN",
  cwd: "WORKBENCH_CWD",
  session: "WORKBENCH_SESSION_ID",
};

/** Where the app put its skills. Shared with `src/main/integrations/skills.ts` by name. */
export const SKILLS_ROOT_ENV = "WORKBENCH_SKILLS_ROOT";

/** The layout inside the skills root that this server reads. */
const SKILLS_LAYOUT = path.join(".claude", "skills");

/** The `name` and `description` of a SKILL.md's front matter, folded onto one line. */
export function skillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) {
    return {};
  }
  const fields = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const start = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (start) {
      key = start[1];
      fields[key] = start[2] ?? "";
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    } else {
      key = null;
    }
  }
  const unquote = (value) => (value ? value.replace(/^['"]|['"]$/g, "").trim() : "");
  return { name: unquote(fields.name), description: unquote(fields.description) };
}

/**
 * The skills on disk, or an empty list when the app did not name a root. The
 * directory name is the skill's identity; the description comes out of its
 * SKILL.md.
 */
export function readSkills(root) {
  if (!root) {
    return [];
  }
  const directory = path.join(root, SKILLS_LAYOUT);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const file = path.join(directory, entry.name, "SKILL.md");
    // A regular file only: a FIFO an agent left in the root would block the
    // read below forever, and with it every tool this server answers.
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      continue;
    }
    skills.push({ name: entry.name, description: skillFrontmatter(fs.readFileSync(file, "utf8")).description ?? "" });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether `child` lies strictly under `parent`. `path.relative` answers an
 * ABSOLUTE path, not one starting with "..", when the two are on different
 * Windows drives (C:\… vs D:\…), so both cases are refused. `flavour` is
 * for the tests, which check Windows paths from any machine.
 */
export function isInside(parent, child, flavour = path) {
  const relative = flavour.relative(flavour.resolve(parent), flavour.resolve(child));
  return (
    relative !== "" &&
    !flavour.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${flavour.sep}`)
  );
}

/**
 * A file inside one skill, refused outside it. `relative` defaults to the
 * SKILL.md; a skill's `references/*.md` is the other thing worth reading.
 */
export function readSkillFile(root, name, relative = "SKILL.md") {
  if (!root) {
    throw new Error("this session was given no skills root");
  }
  const directory = path.resolve(path.join(root, SKILLS_LAYOUT, name));
  const skillRoot = path.resolve(path.join(root, SKILLS_LAYOUT));
  if (!isInside(skillRoot, directory)) {
    throw new Error(`${name} is not a skill`);
  }
  if (!fs.existsSync(path.join(directory, "SKILL.md"))) {
    throw new Error(`no skill named ${name}; call list_skills`);
  }
  const target = path.resolve(directory, relative);
  if (!isInside(directory, target)) {
    throw new Error(`${relative} is outside the ${name} skill`);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`${relative} is not a file in the ${name} skill`);
  }
  return { path: path.join(name, relative), text: fs.readFileSync(target, "utf8") };
}

/** A bridge over HTTP, from the environment. */
export function httpBridge(env = process.env) {
  const url = env[BRIDGE_ENV.url];
  const token = env[BRIDGE_ENV.token];
  if (!url || !token) {
    throw new Error(
      `${BRIDGE_ENV.url} and ${BRIDGE_ENV.token} must be set — this server is started by the app, not by hand`,
    );
  }
  return async (method, params, signal) => {
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, params }),
    });
    const body = await response.json().catch(() => ({ ok: false, error: `bridge answered HTTP ${response.status}` }));
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `bridge answered HTTP ${response.status}`);
    }
    return body.result;
  };
}

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failure = (error) => ({
  isError: true,
  content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
});

/**
 * Build the server over a bridge function `(method, params) => result`.
 *
 * The descriptions are written for the agent reading them, because that is
 * who reads them: what the tool does in the person's window, when to call it,
 * and what to pass.
 */
export function createServer(bridge, options = {}) {
  const integration = integrationById(options.integration ?? process.env.WORKBENCH_INTEGRATION ?? "workspace");
  if (integration.runtime) throw new Error(`${integration.id} uses its upstream MCP runtime`);
  const skillsRoot = options.skillsRoot ?? process.env[SKILLS_ROOT_ENV] ?? null;
  const server = new McpServer({ name: `app-${integration.id}`, version: options.version ?? "0.0.0" });
  for (const definition of integration.tools) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: definition.inputSchema,
    }, async (params, extra) => {
      try {
        if (definition.name === "list_skills") return text(readSkills(skillsRoot));
        if (definition.name === "read_skill") return text(readSkillFile(skillsRoot, params.name, params.path));
        const result = await bridge(definition.name, params, extra.signal);
        if (definition.output === "image") {
          if (!result?.base64 || !result?.mimeType) throw new Error("Capture did not return an image");
          const { base64, mimeType, ...metadata } = result;
          return { content: [
            { type: "image", data: base64, mimeType },
            { type: "text", text: JSON.stringify(metadata) },
          ] };
        }
        return text(result);
      } catch (error) { return failure(error); }
    });
  }
  return server;
}

/** The MCP requests a plugin proxy forwards, by the schema the SDK routes them with. */
const PLUGIN_FORWARDED = [
  ["tools/list", ListToolsRequestSchema],
  ["tools/call", CallToolRequestSchema],
  ["resources/list", ListResourcesRequestSchema],
  ["resources/templates/list", ListResourceTemplatesRequestSchema],
  ["resources/read", ReadResourceRequestSchema],
  ["prompts/list", ListPromptsRequestSchema],
  ["prompts/get", GetPromptRequestSchema],
];

/**
 * A plugin server, as an agent reaches it (`WORKBENCH_INTEGRATION=plugin:<id>/<server>`).
 *
 * The agent never runs a plugin's server itself: this proxy forwards each MCP
 * request to the app (`plugin_rpc`), which runs the real server once per
 * session as its own MCP client (`src/main/plugins/host.ts`). So the agent's
 * tool call and the plugin's tab in the explorer reach one process and see
 * one state, and the app can keep app-only tools away from the model.
 */
export function createPluginProxy(bridge, options = {}) {
  const name = options.name ?? process.env.WORKBENCH_INTEGRATION ?? "plugin";
  const server = new Server(
    { name, version: options.version ?? "0.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  for (const [method, schema] of PLUGIN_FORWARDED) {
    server.setRequestHandler(schema, async (request, extra) => {
      const { _meta, ...params } = request.params ?? {};
      try {
        return await bridge("plugin_rpc", { method, params }, extra.signal);
      } catch (error) {
        if (method === "tools/call") return failure(error);
        throw error;
      }
    });
  }
  return server;
}

