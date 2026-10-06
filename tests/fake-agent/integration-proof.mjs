/** Opt-in Electron proof: real session-provided MCP configs (stdio or HTTP), never a model. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** The transport an agent would open for this `session/new` entry: an HTTP one names a url. */
export function transportFor(config) {
  if (config.type === 'http') {
    const headers = Object.fromEntries((config.headers ?? []).map(header => [header.name, header.value]));
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } });
  }
  const env = { ...process.env, ...Object.fromEntries((config.env ?? []).map(entry => [entry.name, entry.value])) };
  return new StdioClientTransport({ command: config.command, args: config.args ?? [], env });
}

/** The bridge's URL and this server's token, from either kind of entry. */
function bridgeOf(config) {
  if (config.type === 'http') {
    const header = (config.headers ?? []).find(entry => entry.name.toLowerCase() === 'authorization');
    return { url: config.url.replace(/\/mcp$/, ''), token: header.value.replace(/^Bearer /, '') };
  }
  const env = Object.fromEntries(config.env.map(entry => [entry.name, entry.value]));
  return { url: env.WORKBENCH_BRIDGE_URL, token: env.WORKBENCH_BRIDGE_TOKEN };
}

/**
 * One client per server for the life of the agent process, the way a real agent keeps the MCP
 * servers `session/new` gave it for the whole session: started on first use with exactly the
 * command and environment the app sent, never restarted per call, and ended with the process.
 */
const clients = new Map();

async function withServer(config, operation) {
  if (!config) throw new Error('Requested integration was not supplied on session/new.');
  let client = clients.get(config.name);
  if (!client) {
    const transport = transportFor(config);
    client = new Client({ name: 'elastic-integration-proof', version: '1.0.0' });
    await client.connect(transport);
    clients.set(config.name, client);
  }
  return operation(client);
}
export async function integrationProof(servers, request) {
  if (request.operation === 'catalog') {
    const catalog = await Promise.all(servers.map(config => withServer(config, async client => ({ name: config.name, tools: (await client.listTools()).tools.map(tool => tool.name) }))));
    return { catalog };
  }
  if (request.operation === 'isolation') {
    const config = servers.find(server => server.name === 'app-pdf');
    const bridge = bridgeOf(config);
    const response = await fetch(`${bridge.url}/rpc`, { method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'read_document', params: { tabId: request.tabId } }) });
    return { status: response.status, body: await response.json() };
  }
  if (request.operation === 'batch') return withServer(servers.find(server => server.name === `app-${request.domain}`), async client => {
    const results = [];
    for (const call of request.calls) results.push(await client.callTool({ name: call.name, arguments: call.args ?? {} }));
    return results;
  });
  return withServer(servers.find(server => server.name === `app-${request.domain}`), client => client.callTool({ name: request.name, arguments: request.args ?? {} }));
}
