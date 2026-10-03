# Plugin matrix: real plugins in the built app

Run on 2026-10-02 against the built app (`tests/e2e/plugin-matrix.spec.ts`,
hidden windows, a throwaway profile). Re-run it with
`ELASTIC_MATRIX_DIR=<folder of prepared plugins> npx playwright test tests/e2e/plugin-matrix.spec.ts`;
add `ELASTIC_MATRIX_AGENT=1` to spend one real Claude turn. Without the
variable the file skips, so CI skips it.

## What was tested for CAD

Jake's current plugin, not the old 0.5.0 one in the Claude Code plugin cache:
the repo root of text-to-cad at Release 0.7.8 (`b347a34b2`) plus PR #509
(`a923f41c9`), installed into elastic as is: `.codex-plugin/plugin.json`
(version 0.7.8), `skills/` (13 skills) and `codex.mcp.json`. The one change is
the launch: instead of `uvx cadgen==0.7.8`, `codex.mcp.json` runs `cadgen mcp`
from a venv holding the cadgen 0.7.8 wheel with PR #509's
`packages/cadgen/src/cadgen/mcp/server.py` copied over it. PR #509 changes only
that file (the wheel's copy matched upstream main before the swap), and the
wheel carries the built `apps/mcp` page, which a source checkout does not have
until it is built. Every CAD result below, the worker failure included, is
from this 0.7.8 setup.

## Results

| Plugin | Installs | Servers | Tools | Views | Agent / call | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| text-to-cad (cadgen 0.7.8 + PR #509) | yes, unchanged | ready (stdio) | 16 | rail page, thread tab, `Open with` for STEP/STL/GLB... | | rail page renders recents with thumbnails; a STEP file renders (fixed: plugin frames are now their own origin, see CAD below) |
| Linear (Claude Code plugin) | yes (after the bare `.mcp.json` fix) | Sign in (HTTP, OAuth) | after sign-in | none | | registration and PKCE work; the sign-in reaches `mcp.linear.app/authorize` |
| Code Review (bundled, `elastic-code-review`) | built in | ready (stdio, `${ELASTIC_NODE}`) | 8 (6 for agents, `show_pr`, the rail page) | rail page, thread tab | read-only check with Amy's real `gh`: rail page loaded; `earthtojake/text-to-cad` listed 22 open; #509 rendered 3 files and 10 checks (`code-review-real-pr509.png`) | no open marketplace has a code review MCP App; this is elastic's own, over the person's `gh`. Stand-in gh e2e: `code-review-rail.png`, `code-review-pr.png` |
| Figma (Claude Code plugin) | yes, 14 skills | Sign in (HTTP, OAuth) | after sign-in | none | | `mcp.figma.com` refuses client registration (403): only apps Figma approved can sign in |
| Playwright MCP (`@playwright/mcp`) | yes | ready | 25 | none (no MCP App) | `browser_navigate` to example.com returns its snapshot | needs `--browser chrome` (or its own browser install) |
| Shell (`mcp-shell-server` via uvx) | yes | ready | 1 | none | `shell_execute uname` returns Darwin | no terminal MCP App with a UI exists that I found |
| Codex `browser`, `chrome`, `latex`, `visualize` | yes, unchanged | none (skills only) | | | | their skills drive Codex's own in-app browser and tools, so they assume Codex |
| Codex `code-review` | yes | failed | | | | its launcher runs `$CODEX_MCP_NODE_PATH`, which only Codex sets |
| Tables (examples marketplace) | yes | ready | 2 | file, tab, rail page | one real Claude turn called `mcp__tables__show_table` through the proxy and answered `2` | |

Screenshots: `docs/research/plugin-matrix/*.png` (CAD plugin page, CAD rail
page, CAD STEP view, Linear and Figma sign-in rows, the Plugins page, the agent turn).

## CAD: the STEP view

The CAD file view opens (consent, `Open with: text-to-cad`, its frame loads)
but the model shows "Couldn't load the model: surf worker failed." Found:

- cadgen's page starts its mesh workers with
  `new Worker(new URL("./surfWorker.js", import.meta.url), { type: "module" })`
  (`packages/core/src/lib/surf/surfWorkerClient.js:254`). In the bundled page
  that URL is a `blob:` URL.
- elastic's plugin frame is sandboxed without `allow-same-origin`, so the page's
  origin is opaque and the URL is `blob:null/...`. Chromium fails a module
  worker from it with an error event that has no message (seen with a probe in
  the frame: `worker blob:null/... {"type":"module"}`, then `worker error undefined`).
- Not the cause, but fixed on the way: elastic dropped the `data:` and `blob:`
  sources cadgen declares in `_meta.ui.csp.connectDomains`.

**Fixed (2026-10-02, Amy chose option 1, "own origin per plugin").** Every
plugin frame now keeps `allow-same-origin` on its own random `mcp-app://<id>`
origin: never the app's or another frame's, no `window.workbench`, no top or
cross-origin navigation (`guardAppFrames`), storage cleared on release
(`src/main/plugins/app-protocol.ts`; unit tests in `tests/unit/main/plugins.test.ts`,
an in-frame probe in `tests/e2e/plugins.spec.ts`). Re-run on the same setup:
the STEP model renders (`cad-step-file.png`), with cadgen's analytics prompt on
top. The other option, cadgen starting workers from a classic worker or a
`data:` URL, is no longer needed.

Codex's "worker did not announce itself within 120s" did not reproduce here;
that message is cadgen's daemon pool (`cadgen/daemon/pool.py:274`), a
different worker.

## A new user's first run (2026-10-02)

`tests/e2e/new-user.spec.ts` (opt-in, network): a fresh profile, the default
marketplaces fetched from GitHub, each plugin installed the way Install does.
Raw results: `new-user.json`; screenshots `new-user-*.png`.

**The store.** Built in (4), Examples (4), Claude Code's official marketplace
(315, at `d182ca4`), Codex official (`openai/plugins`, 65, at `5fd93af`) and
text-to-cad (1, at `7b675cc`, 0.7.9): 389 entries, 360 cards, 28 plugins offered
by two sources shown once (Linear, Notion, Figma, Sentry, Vercel, Supabase,
GitHub, Slack, Stripe, Canva, …). Labels: Works 45, May need sign-in 3,
Partly 71, Needs ChatGPT 5, Checked on install 236. The list puts what works
first; a card has the plugin's own logo when its folder is on disk.

| Plugin | From | Label | Installs | Servers | Exercised |
| --- | --- | --- | --- | --- | --- |
| playwright | Claude official | Works | yes | ready, 25 tools | `browser_navigate` example.com: page title "Example Domain" |
| chrome-devtools-mcp | Claude official | Checked on install | yes, 7 skills | ready, 29 tools | tools listed (a call launches Chrome) |
| desktop-commander | Claude official | Checked on install | yes, 6 skills | ready, 26 tools | `list_directory` lists `part.step` |
| context7 | Claude official | May need sign-in | yes | sign-in | the server now answers 401 with OAuth metadata, though its listing says it works anonymously |
| serena | Claude official | Works | yes | ready, 29 tools | tools listed |
| frontend-design, playground | Claude official | Works | yes, 1 skill each | none | skills reach sessions |
| mcp-apps | Claude official | Checked on install | yes, 4 skills | none | skills reach sessions |
| typescript-lsp | Claude official | Partly | yes | none | a language server (`lspServers`); elastic does not run language servers |
| notion | Codex official | Partly | yes, 4 skills | sign-in | registration accepted; reaches `app.notion.com` login |
| sentry | Codex official | May need sign-in | yes, 1 skill | sign-in | reaches `mcp.sentry.dev` login |
| vercel | Codex official | Partly | yes, 54 skills | sign-in | reaches `vercel.com` login |
| supabase | Codex official | Partly | yes, 2 skills | sign-in | reaches `supabase.com` login |
| atlassian | Claude official | Checked on install | yes, 6 skills | sign-in | reaches `id.atlassian.com` |
| canva | Codex official | Partly | yes, 8 skills | sign-in | registration accepted at `mcp.canva.com/authorize`; canva.com refuses a scripted fetch of the login page (403), a browser is needed |
| miro | Claude official | Checked on install | yes, 3 skills | sign-in | reaches `mcp.miro.com` login |
| linear | Codex official | Partly | yes | sign-in | reaches `mcp.linear.app` login |
| figma | Codex official | Partly | yes, 12 skills | sign-in | refused: `mcp.figma.com` registers only apps Figma approved (403); the app says so |
| text-to-cad 0.7.9 | its GitHub marketplace | Works | yes, unchanged | ready, 16 tools | rail page, thread tab, `cad_file` for STEP: `part.step` renders (`new-user-cad-rail.png`, `new-user-cad-step.png`) |

Every sign-in that registers clients dynamically (Notion, Sentry, Vercel,
Supabase, Atlassian, Canva, Miro, Linear, Context7) works up to the provider's
page; Figma alone refuses. "Partly" on Codex official's Linear, Notion and the
like is their ChatGPT app (`.app.json`), which elastic cannot run; their MCP
server and skills work.

Fixed during the pass:

- **text-to-cad from its marketplace showed no rail page or file handler.**
  cadgen 0.7.9 reads tabs from its own client extension, `dev.texttocad/tabs`
  (#510), not `openai/ui`; elastic now declares that key.
- **chrome-devtools-mcp failed to start** ("command not found"): elastic
  started a Claude Code plugin's server in the plugin's folder, which for this
  plugin is the chrome-devtools-mcp repository, so `npx chrome-devtools-mcp@1.9.0`
  ran the unbuilt local package. A Claude Code plugin's servers now start in
  the project, as Claude Code does; a Codex plugin's in its folder, as Codex does.
- **desktop-commander timed out** on its first `npx` download: a server a
  package runner starts gets 180 s to come up (30 s otherwise).
- The store's first screen led with "Checked on install" entries, had no
  logos, a description missing where the manifest has one, and a search icon
  over the placeholder.

What a first-time user still hits, most important first:

1. **236 of 360 cards say "Checked on install".** They live in other
   repositories, so elastic cannot read them without cloning. Fetching each
   entry's manifest (one small file per repository) in the background would
   give them real labels.
2. **Language servers (`lspServers`) are not run**, so typescript-lsp and the
   other LSP plugins install with nothing to do.
3. **Figma needs Figma's approval** (or a client id from Figma).
4. **Codex's own plugins** that are ChatGPT apps, or `code-review` (a
   launcher only Codex supplies), do nothing here; the labels say so.
5. **Claude's marketplace has no display name**, so its source shows as
   "claude-plugins-official".
6. **cadgen's recent files are shared machine-wide** (`~/.cache`), so test
   projects showed up as "File unavailable" in the CAD page's recents.

## Any model, any plugin

Every plugin reaches every agent the same way: `mcpServersFor`
(`src/main/integrations/index.ts`) hands each session the app's workspace
server, the bundled plugins' app servers and a stdio proxy per enabled plugin
server, in `session/new` and `session/load`, whatever the agent. A stdio MCP
server is the one kind every ACP agent must accept, so nothing is per agent.

Proof, `tests/e2e/agent-plugins.spec.ts` (opt-in), text-to-cad 0.7.8 + PR #509,
2026-10-02:

| Agent | Calls it made | Result |
| --- | --- | --- |
| Claude Code (claude-agent-acp) | `ToolSearch`, `mcp__cad__cad_show` (no open viewer), `mcp__cad__cad_open` | all completed; the CAD tab opened |
| Codex (codex-acp) | `mcp.cad.cad_show`, `mcp.cad.cad_open` | all completed; the CAD tab opened with `part.step` rendered (`agent-turn-codex.png`) |

The model picker is the agent's own (the chips under the composer list what
each adapter advertises: Claude's models, Codex's). Beyond Claude and Codex the
agent registry (`src/main/agents/registry.ts`) already launches 21 more ACP
agents: Gemini CLI, GitHub Copilot, OpenCode, Amp, Qwen Code, Kiro, Auggie,
Goose, Mistral Vibe, Cursor, Droid, Hermes, Cline, Kimi, Kilo, Qoder, Grok
Build, Deep Agents, fast-agent and others, each getting the same plugins. A
custom command (any ACP agent not in the registry, from Settings) is not
built: it needs a settings field for a list of user agents, a provider built
from it (no install or auth probe), and an Add row on the Agents page; the
per-agent `extraArgs`/`env` override already exists to build on.

## What "all the apps" takes

- **CAD:** works as a plugin: rail page, tabs, file handler, and the model
  renders. PR #509 is what gives elastic the tab surfaces.
- **Figma:** OAuth is built (`src/main/plugins/oauth.ts`), but Figma's server
  only registers clients it knows. elastic needs Figma to approve it (or a
  client id from Figma configured in the plugin). Until then Figma works only
  through its skills.
- **Linear and other OAuth servers:** ready to sign in.
- **Browser:** an agent browser works today as an MCP server (Playwright MCP).
  elastic's own browser tab is built in; turning it into an MCP App would mean
  a plugin whose view is a webview the app hosts, which MCP Apps does not
  provide (views are sandboxed HTML with no `frame-src` to arbitrary sites), so
  it stays built in.
- **Terminal:** shell MCP servers work for agents; elastic's terminal stays
  built in for the same reason (a pty needs native access, not an HTML view).
- **Codex's bundled plugins:** install unchanged, but they target Codex's own
  runtime.
