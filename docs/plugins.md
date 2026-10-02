# Plugins

Everything elastic does beyond the chat is a plugin: a folder with a manifest,
MCP servers that give agents tools, skills that tell agents how to use them,
and optional views (MCP Apps) that show up as tabs, rail pages, or the way a
file type opens. The format is Codex's, so a Codex or Claude Code plugin
installs unchanged. Where each shape comes from: [research/codex-plugins.md](research/codex-plugins.md).

The example plugins in `resources/plugins/` are the reference:

| Plugin | Shows |
| --- | --- |
| `csv-table` (Tables) | a dependency-free MCP server with a view that opens `.csv`/`.tsv` files, a rail page, a tab agents fill, and a skill |
| `filesystem` | an off-the-shelf server from npm that asks the app for its roots |
| `memory` | an off-the-shelf server with tools only |
| `mcp-app-demo` | the MCP Apps reference example (SDK v2), a view with no entrypoints (so a tab) |

## Writing one

```
my-plugin/
  .codex-plugin/plugin.json
  server.mjs
  skills/my-skill/SKILL.md
  assets/logo.svg
```

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "One sentence.",
  "skills": "./skills/",
  "mcpServers": { "main": { "command": "node", "args": ["${PLUGIN_ROOT}/server.mjs"] } },
  "interface": {
    "displayName": "My plugin",
    "shortDescription": "What it does, for the Plugins page.",
    "logo": "./assets/logo.svg",
    "defaultPrompt": ["A prompt the detail page offers as a chip"]
  }
}
```

`mcpServers` may also be a path to a JSON file (`.mcp.json` beside the manifest
is read when the key is absent). `${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}`
expand to the plugin folder. A path in the manifest that leaves the plugin
folder is refused.

Install it from Plugins › Add › Install a plugin folder. It is used in place:
edit it, press Reload from disk on its page.

## Tools, and who sees them

Every tool a plugin's servers list reaches agents through the app, as an MCP
server named after the server (`<plugin>-<server>` when two plugins share a
name). The agent never starts the server itself; the app runs it, once per
session, and the agent's server is a proxy (`resources/app-mcp/server.mjs` in
plugin mode, over the app's local bridge). So an agent's call and the plugin's
tab in that session talk to the same process.

A tool whose `_meta.ui.visibility` is `["app"]` is for the plugin's own view:
it is left out of the agent's tool list, and calling it is refused.

Servers that ask for roots (`roots/list`) get the session's folder, or the
selected project for a rail page.

## Views (MCP Apps)

A tool has a view when its `_meta` names a `ui://` resource the server serves
as `text/html;profile=mcp-app`:

```js
_meta: {
  ui: { resourceUri: "ui://my-plugin/view.html", visibility: ["model", "app"] },
  "openai/ui": { entrypoints: [{ type: "thread" }, { type: "file", extensions: ["csv"] }] },
}
```

| Entrypoint | Where it shows |
| --- | --- |
| `thread` (the default) | a tab: in a session's `+` menu, and opened (or refreshed) whenever an agent calls the tool |
| `global` | an icon on the rail and a full-window page, in the app's scope |
| `file` with `extensions` | how files of those types open in the explorer, after the person allows the plugin for the project |

At `initialize` the app declares both halves in its client capabilities, so a
server can tell what it is talking to without knowing the app's name:

```js
extensions: {
  "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
  "openai/ui": { entrypoints: ["global", "thread", "file"] },
}
```

The first is the MCP Apps standard (views render). The second says this host
presents Codex's entrypoints, so a server that has tab surfaces (text-to-cad's
CAD plugin) can offer them to any host that declares it rather than to a list
of client names (`src/main/plugins/host.ts`).

The view is a sandboxed frame served from its own `mcp-app://<random id>`
URL, which is its own origin: real, so module and `blob:` workers and storage
work (text-to-cad's CAD page needs them), but never the app's or another
view's. It cannot reach the app's page or `window.workbench`, navigate the
window, or leave its origin, and its storage is cleared when it closes. It is
served under a policy with no network access unless the resource's
`_meta.ui.csp` lists `connectDomains` or `resourceDomains`. It talks to the app
with the MCP Apps protocol over `postMessage`: `ui/initialize`, then the tool's
input and result arrive as `ui/notifications/tool-input` and `tool-result`, and
the view can call its own server's tools (`tools/call`) and read its
resources. `@modelcontextprotocol/ext-apps`'s `App` does this for you;
`resources/plugins/plugins/csv-table/ui.html` does it by hand in 40 lines.

The host context carries `theme` and `styles.variables` (the MCP Apps
`--color-background-primary`, `--color-text-primary`, `--font-sans`, ...) from
the app's own tokens. Use them and the view matches the window.

A file view is called with `{ file: { name, resourceUri: "file:///abs/path" } }`.
The person picks who opens each type from the Open with menu above the file,
or Plugins › File types; Built-in is always there. A format a plugin opens is
also one the composer turns into a reference chip (`part.step#o1.2`), handed to
the view's renderer as typed.

## Skills

A plugin's skills (`skills/<name>/SKILL.md`) are added to the skills root every
new session gets while the plugin is on. A name another skill already has is
skipped, and the log says so.

## Bundled plugins

elastic's own tools are plugins too, the way Codex ships its browser and code
review: `resources/bundled/` is a marketplace of four plugins (Browser,
Documents, PDF, Terminals, ids `elastic-<domain>`), installed on start and
listed on the Plugins page under Built in. Each carries its skill and names an
app server in its `.mcp.json`:

```json
{ "mcpServers": { "app-browser": { "builtin": "browser" } } }
```

`builtin` is a server the app serves itself instead of a process: it acts on
the app's live state (the open browser pages, unsaved editor buffers, the
terminal tabs), so it runs behind the per-session bridge with its own token,
and its methods are the integration's (`docs/integrations.md`). Only a plugin
under `resources/bundled/` may name one; another plugin that tries is listed
with the reason. A bundled plugin can be turned off, which takes its tools and
its skill out of later sessions, but not uninstalled. The workspace tools
(open, reveal, list tabs) are the shell's and every session has them.

## Marketplaces

A marketplace is Codex's `.agents/plugins/marketplace.json`, Claude Code's
`.claude-plugin/marketplace.json`, or a bare `marketplace.json`, listing plugins
with local sources. Add one from Plugins › Add › Add a marketplace. The
examples marketplace ships with the app (`resources/plugins/marketplace.json`).
Remote (git) sources are not installable yet.

## Where the code is

| | |
| --- | --- |
| `src/shared/plugins.ts` | the manifest, tool and record schemas, `readToolUi` |
| `src/main/plugins/manifest.ts` | reading a plugin folder and a marketplace |
| `src/main/plugins/registry.ts` | what is installed and on, handler choices, file consent |
| `src/main/plugins/host.ts` | running servers as the app's MCP client |
| `src/main/plugins/service.ts` | the records the UI draws, requests from views and agents |
| `src/main/plugins/app-protocol.ts` | `mcp-app://` and its content policy |
| `src/main/ipc/plugins.ts` | `plugins.*` |
| `src/renderer/plugins/` | the store, `McpAppFrame`, file renderers, Open with |
| `src/renderer/features/plugins/` | the Plugins pages and rail pages |
| `src/renderer/app/Rail.tsx` | the rail |
| `tests/unit/main/plugins.test.ts`, `tests/unit/main/plugins-servers.test.ts` | the formats, and the host and agent proxy against real servers |
