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
| text-to-cad (cadgen 0.7.8 + PR #509) | yes, unchanged | ready (stdio) | 16 | rail page, thread tab, `Open with` for STEP/STL/GLB... | | rail page renders recents with thumbnails; a STEP file view fails, see CAD below |
| Linear (Claude Code plugin) | yes (after the bare `.mcp.json` fix) | Sign in (HTTP, OAuth) | after sign-in | none | | registration and PKCE work; the sign-in reaches `mcp.linear.app/authorize` |
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

Two ways out, a decision rather than a bug fix:
1. elastic adds `allow-same-origin` to plugin frames. Each staged document has
   a random `mcp-app://<id>` host, so the origin would be its own, not the
   window's. It is a security trade-off (the frame gets storage and a real
   origin), so it was not made without a decision.
2. cadgen starts its workers from a classic worker or a `data:` URL, which
   works from an opaque origin. That keeps hosts strict.

Codex's "worker did not announce itself within 120s" did not reproduce here;
that message is cadgen's daemon pool (`cadgen/daemon/pool.py:274`), a
different worker.

## What "all the apps" takes

- **CAD:** works as a plugin (rail page, tabs, file handler) once the worker
  question above is settled. PR #509 is what gives elastic the tab surfaces.
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
