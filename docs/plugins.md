# Plugins

Everything elastic does beyond the chat is a plugin: a folder with a manifest,
MCP servers that give agents tools, skills that tell agents how to use them,
and optional views (MCP Apps) that show up as tabs, rail pages, or the way a
file type opens. The format is Codex's, so a Codex or Claude Code plugin
installs unchanged. Each shape follows the Codex and Claude Code plugin formats.

The example plugins in `resources/plugins/` are the reference:

| Plugin | Shows |
| --- | --- |
| `csv-table` (Tables) | a dependency-free MCP server with a view that opens `.csv`/`.tsv` files, a rail page, a tab agents fill, and a skill |
| `filesystem` | an off-the-shelf server from npm that asks the app for its roots |
| `memory` | an off-the-shelf server with tools only |
| `mcp-app-demo` | the MCP Apps reference example (SDK v2), a view with no entrypoints (so a tab) |

## Write a plugin in 10 minutes

1. **Make a folder** with a manifest at `.codex-plugin/plugin.json` (the shape
   is below). A Claude Code plugin's `.claude-plugin/plugin.json` works too.
2. **Add an MCP server** that gives agents tools: a `server.mjs` using
   `@modelcontextprotocol/sdk`'s `McpServer` over stdio, named in the
   manifest's `mcpServers`. Any language works; elastic only runs the command.
3. **Optionally add a view.** Give a tool a `ui://` resource served as
   `text/html;profile=mcp-app`, and say where it shows with
   `_meta["openai/ui"].entrypoints`: `thread` (a tab), `global` (a rail page)
   or `file` with `extensions` (how those files open). See
   [Views](#views-mcp-apps) below; the Tables example
   (`resources/plugins/plugins/csv-table/`) does all three in one small file.
4. **Optionally add a skill**: `skills/<name>/SKILL.md` telling agents when and
   how to use your tools.
5. **Try it:** Plugins › Add › Install a plugin folder, pick the folder, then
   ask an agent to use it. After a change, turn the plugin off and on to
   restart its server; a view reloads when its tab is reopened.
6. **Share it:** push the folder to GitHub with a marketplace file, and anyone
   can add it from Plugins › Add a catalog.

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

### Remote servers and sign-in

A server with a `url` instead of a `command` is reached over Streamable HTTP.
If it answers 401, its row says Sign in, and nothing opens a browser until the
person clicks it (`src/main/plugins/oauth.ts`). Most servers let an app register
itself on the spot; some do not (Slack's, GitHub's, Google's), and those need
the client their owner registered, named in the server's `oauth` block, in
either app's spelling:

```json
{ "slack": { "type": "http", "url": "https://mcp.slack.com/mcp",
  "oauth": { "client_id": "…", "client_secret": "…", "callback_port": 12799,
             "callback_url": "http://127.0.0.1:12799/callback/…" },
  "scopes": ["…"] } }
```

Codex's keys are those; Claude Code's are `clientId` and `callbackPort`, which
come back to `localhost` rather than `127.0.0.1`. A fixed port or URL is the
redirect that client was registered with, so the sign-in listens on exactly that
one; without one it takes a free port on `127.0.0.1` at `/callback`. A value left
as a placeholder (`<SLACK_PUBLIC_CLIENT_ID>`) counts as none, and a server that
needs a client gets a sentence saying the plugin names none.

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
  "dev.texttocad/tabs": { entrypoints: ["global", "thread", "file"] },
}
```

The first is the MCP Apps standard (views render). The second says this host
presents Codex's entrypoints (rail page, thread tab, file handler), so a server
that has tab surfaces can offer them to any host that declares it rather than
to a list of client names (`src/main/plugins/host.ts`). No standard names this
yet; the key is text-to-cad's (cadgen 0.7.9 and later), which also expects one
server process per thread and the thread's folder through MCP roots, as
elastic does.

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

A view reaches the chat it sits beside (`src/renderer/plugins/chat-context.ts`).
`ui/update-model-context` queues text and images for the person's next message:
each update replaces the view's last one, it shows in the box as a chip titled by
the block's `_meta["openai/title"]`, and it goes out after what they typed. When
it is sent or the chip is taken out, the view gets a host-context change with
`"openai/modelContext": null` and starts afresh (text-to-cad's Quick Edit works
this way). `ui/message` sends the person's message now, queued behind a running
turn. A view with no session of its own (a rail page) reaches the selected chat.

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
skipped, and the log says so. Each skill has its own switch on the plugin's
page: one turned off (`disabledSkills` in `installed.json`) is left out of the
root while the plugin and its other skills stay on.

## Bundled plugins

elastic's own tools are plugins too, the way Codex ships its browser and code
review: `resources/bundled/` is a marketplace of five plugins (Browser,
Documents, PDF, Terminals and Code Review, ids `elastic-<domain>`), installed on
start and listed on the Plugins page as Installed. The first four carry a
skill and name an app server in their `.mcp.json`:

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

### Code Review

`elastic-code-review` is the one bundled plugin that is an ordinary MCP
server with an MCP App, the open counterpart of Codex's Code Review (which
ships only inside ChatGPT.app). It reaches GitHub through the person's own
GitHub CLI (`gh search prs`, `gh pr view`, `gh pr diff`, `gh api`), so the
sign-in is theirs and no token is stored; signed out, every view says to run
`gh auth login`. `ELASTIC_GH` names another gh (the tests' stand-in,
`tests/fixtures/code-review/gh.mjs`).

- Rail page (`code_review_home`, `global`): Needs your review, Yours and
  Recently updated across GitHub, Compact or Detailed, each group folds; an
  Open box takes `owner/repo`, `owner/repo#123` or a pull request URL.
- Pull request tab (`show_pr`, `thread`): the session repository's open pull
  requests, or one pull request with its branches, checks, changed files, the
  diff with its comment threads (reply, or `+` on a line to comment), and
  Comment, Request changes and Approve.
- Agent tools: `list_prs`, `get_pr`, `get_pr_diff`, `list_review_comments`
  (read), `add_review_comment` and `submit_review` (write, `readOnlyHint:
  false`, so the agent's own permission flow asks), and `show_pr`.

Its server runs on `${ELASTIC_NODE}`: a `command` the host replaces with its
own binary run as Node (`ELECTRON_RUN_AS_NODE`), so a plugin in JavaScript
needs no Node on the machine (`src/main/plugins/manifest.ts`).

## Marketplaces and the Plugins page

A marketplace is Codex's `.agents/plugins/marketplace.json`, Claude Code's
`.claude-plugin/marketplace.json`, or a bare `marketplace.json`. It can be a
folder, or a git repository elastic fetches: Plugins › Add › Add a catalog
from GitHub takes `owner/repo` or any git URL (`#ref` for a branch or tag).
Look shows what it would add first (fetched into a throwaway folder and
dropped), and a catalog that is not one of the official ones says that its
plugins run code on the Mac before it is added.
A first run adds three: Claude Code's official marketplace
(`anthropics/claude-plugins-official`, shown as "Claude official"), Codex's
(`openai/plugins`, "Codex official") and text-to-cad's
(`earthtojake/text-to-cad`), beside the bundled plugins and the examples
(`resources/plugins/marketplace.json`). The examples are for plugin authors and
stay out of the list until Show examples is on. Remove a catalog under
Catalogs, at the foot of the page; a removed default stays removed. Codex's
`openai-primary-runtime` lives only inside Codex's own runtime and is not
offered.

Git work uses the person's own `git` and credentials: no token is stored, a
private repository works when their git can reach it, and git never prompts
(`GIT_TERMINAL_PROMPT=0`). A marketplace is a shallow clone under
`<userData>/plugins/marketplaces/`, fetched in the background on start when it
is older than six hours and by Refresh; the page never waits on the network.
Git LFS objects stay pointers.

Every entry kind the two formats use installs:

| `source` | Installs |
| --- | --- |
| `"./folder"`, `{ "source": "local", "path" }` | from a folder marketplace, in place; from a git marketplace, a copy at the marketplace's commit |
| `{ "source": "url", "url", "sha"? }`, `{ "source": "github", "repo" }` | a shallow clone of that repository at `sha` |
| `{ "source": "git-subdir", "url", "path", "ref"?, "sha"? }` | the same, then its subfolder |
| an entry with `"strict": false` and no manifest of its own | the entry becomes its manifest |
| anything else (`npm`, `pip`) | listed as Can't install |

Copies and clones live under `<userData>/plugins/cache/<marketplace>/<plugin>/<commit>`.
A plugin from a git marketplace shows Update when its marketplace offers a new
commit (`sha`) or a new version (or different files, when it names none);
Update installs again and drops the old copy.

The Plugins page is one list (`src/main/plugins/catalog.ts`): every
marketplace's entries, and the same plugin offered by two marketplaces once,
matched by repository folder and then by name. Its card installs from the
source that works best here (Works, then May need sign-in, then Partly), and
among equals a folder with a Codex manifest (MCP App views are declared
there), then any folder, then a remote repository; the others are listed on
its page under Also offered by. What the card shows is gathered from every
source, so Claude's working Linear still shows the logo, site and prompts that
Codex's listing carries. A card also says who publishes it, whether an official
catalog lists it (the check mark), what it needs (a sign-in, an API key, a
download on first run) and, on its page, the servers and skills it adds. A card
with no logo gets the product site's favicon or the repository owner's GitHub
avatar, fetched once by main and kept in `<userData>/plugins/logos.json`
(`src/main/plugins/logos.ts`). A catalog's own test fixtures (Claude's
`fakechat`) are left out (`HIDDEN` in `catalog.ts`). Each card says whether it
works here, read from its folder without installing it:

| Label | Means |
| --- | --- |
| Works | MCP servers that run here, and skills |
| May need sign-in | a remote server; you sign in if it asks |
| Partly | some parts elastic does not run: Claude Code's hooks, slash commands, subagents, language servers, output styles; ChatGPT apps |
| Needs Codex / Needs ChatGPT | nothing but a launcher Codex supplies, or ChatGPT apps |
| Checked on install | a plugin in another repository: elastic reads it when you install it |
| Can't install | a source kind elastic does not install |

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
