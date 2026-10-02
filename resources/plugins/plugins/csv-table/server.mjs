#!/usr/bin/env node
/**
 * The Tables plugin's MCP server, with no dependencies: newline-delimited
 * JSON-RPC on stdio, the handful of MCP methods a tool with a UI needs, and
 * nothing else. Small on purpose, so it reads as a reference for what a
 * plugin server has to do.
 *
 *   show_table   CSV text, or a file, as a table. Visible to agents and to the
 *                app; its UI opens .csv and .tsv files (a `file` entrypoint) and
 *                is a tab a session can open (`thread`).
 *   tables_home  The rail page (`global`): asks for nothing, shows the UI's
 *                paste box. For the app only, so agents never see it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_URI = "ui://tables/table.html";
const UI_MIME = "text/html;profile=mcp-app";
const MAX_ROWS = 2000;
const MAX_BYTES = 20 * 1024 * 1024;

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, any one-character delimiter. */
export function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ""));
}

function table(text, name, delimiter) {
  const rows = parseDelimited(text, delimiter);
  const [header = [], ...body] = rows;
  const columns = header.map((column, index) => column.trim() || `Column ${index + 1}`);
  return { name, columns, rows: body.slice(0, MAX_ROWS), total: body.length, truncated: body.length > MAX_ROWS };
}

/** The file a call names: `file.resourceUri` (the app opening a file), or `path` (an agent), inside the roots. */
function readTarget(args, roots) {
  let file = null;
  if (args.file?.resourceUri) file = fileURLToPath(args.file.resourceUri);
  else if (typeof args.path === "string") file = path.resolve(roots[0] ?? process.cwd(), args.path);
  if (!file) return null;
  if (roots.length > 0 && !roots.some((root) => !path.relative(root, file).startsWith(".."))) {
    throw new Error(`${file} is outside this session's folder`);
  }
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) throw new Error(`${path.basename(file)} is ${Math.round(stat.size / 1024 / 1024)} MB; the limit is 20 MB`);
  return { file, text: fs.readFileSync(file, "utf8") };
}

const TOOLS = [
  {
    name: "show_table",
    title: "Table",
    description: "Show a table to the person, sortable and filterable, in a tab beside the chat. Pass `csv` (CSV text, header row first) or `path` (a .csv or .tsv file in the session's folder). Prefer this to a long Markdown table.",
    inputSchema: {
      type: "object",
      properties: {
        csv: { type: "string", description: "CSV text, header row first." },
        path: { type: "string", description: "A .csv or .tsv file, relative to the session's folder." },
        title: { type: "string", description: "What to call the table." },
      },
    },
    _meta: {
      ui: { resourceUri: UI_URI, visibility: ["model", "app"] },
      "openai/ui": { entrypoints: [{ type: "file", extensions: ["csv", "tsv"] }, { type: "thread" }] },
    },
  },
  {
    name: "tables_home",
    title: "Tables",
    description: "The Tables page.",
    inputSchema: { type: "object", properties: {} },
    _meta: {
      ui: { resourceUri: UI_URI, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  },
];

let roots = [];
let rootsListed = false;
let nextId = 1;
const waiting = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ask(method, params) {
  const id = `server-${nextId++}`;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

async function currentRoots(clientCapabilities) {
  if (!clientCapabilities?.roots || rootsListed) return roots;
  try {
    const answer = await ask("roots/list", {});
    roots = (answer.roots ?? []).map((root) => fileURLToPath(root.uri));
  } catch { /* a client without roots: the cwd */ }
  rootsListed = true;
  return roots;
}

let clientCapabilities = null;

async function callTool(name, args) {
  if (name === "tables_home") {
    return { content: [{ type: "text", text: "Paste CSV, or open a .csv file from a session's files." }], structuredContent: { home: true } };
  }
  if (name !== "show_table") throw new Error(`no tool named ${name}`);
  const target = readTarget(args, await currentRoots(clientCapabilities));
  let result;
  if (target) {
    const delimiter = target.file.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    result = table(target.text, args.title ?? path.basename(target.file), delimiter);
  } else if (typeof args.csv === "string") {
    result = table(args.csv, args.title ?? "Table", ",");
  } else {
    return { isError: true, content: [{ type: "text", text: "show_table needs `csv` or `path`" }] };
  }
  const summary = `${result.name}: ${result.total} row${result.total === 1 ? "" : "s"}, columns ${result.columns.join(", ")}${result.truncated ? ` (showing the first ${MAX_ROWS})` : ""}. Shown to the person as a table.`;
  return { content: [{ type: "text", text: summary }], structuredContent: result };
}

async function handle(message) {
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize":
      clientCapabilities = params.capabilities ?? {};
      return {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "tables", version: "0.1.0" },
      };
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call": return callTool(params.name, params.arguments ?? {});
    case "resources/list": return { resources: [{ uri: UI_URI, name: "Table view", mimeType: UI_MIME }] };
    case "resources/read":
      if (params.uri !== UI_URI) throw Object.assign(new Error(`no resource ${params.uri}`), { code: -32002 });
      return { contents: [{ uri: UI_URI, mimeType: UI_MIME, text: fs.readFileSync(path.join(here, "ui.html"), "utf8") }] };
    default:
      if (id === undefined) return undefined;
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === undefined && message.id !== undefined) {
    const pending = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) pending?.reject(new Error(message.error.message));
    else pending?.resolve(message.result);
    return;
  }
  if (message.method === "notifications/roots/list_changed") { rootsListed = false; return; }
  if (message.id === undefined) return;
  Promise.resolve(handle(message)).then(
    (result) => send({ jsonrpc: "2.0", id: message.id, result }),
    (error) => send({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32603, message: error.message } }),
  );
});
lines.on("close", () => process.exit(0));
