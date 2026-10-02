# Morning notes (2026-10-03)

What happened overnight on `amywork777/elastic`, and what is left for you.

## Where it is

- **Branch:** everything is on `main`, fast-forwarded from `overnight` (which
  still exists). The repo is private.
- **Checks, all green at the last commit:**
  - typecheck for both projects
  - lint
  - unit tests: 1695 passing (`npx vitest run --project node --project renderer`, with Node 24)
  - the package suites
  - `npm run build`
  - e2e: 50 Playwright tests against the built app, including the new
    `tests/e2e/plugins.spec.ts`
- **One flaky e2e test:** `git.spec.ts` "a checkout session runs in the
  project…" timed out once in a full run, then passed twice on its own.

## What changed

**Hardware removed**
- The CAD runtime, cadgen, the STEP/mesh/DXF/GLB/robot renderers, drawings
  (Excalidraw), the CAD sample, Aptabase telemetry, and the monorepo paths are
  all gone.
- `@workbench/ui` keeps the file viewer, navigation, host contract, tab store
  and primitives. `@workbench/core` keeps the prompt context, file formats,
  `cadRefs` (the prompt contract's fragment grammar) and drawing2d.
- three.js, Excalidraw and 120 other packages came out of the install.

**Rename**
- The app is called elastic everywhere: the window, the IPC prefix, storage
  keys, the branch prefix (`elastic/`), worktrees under `~/.elastic`, and the
  app's MCP servers (now `app-<domain>`).
- The new mark is `src/renderer/assets/brand/elastic-mark.svg`, a placeholder.
  `build/icon.png` is still the old star; run `npm run icons` once you like a mark.

**The plugin system** (the guide is `docs/plugins.md`)
- **Install formats:** Codex's (`.codex-plugin/plugin.json`) and Claude Code's
  (`.claude-plugin/plugin.json`) manifests and marketplaces install unchanged.
- **Running servers:** the app runs every plugin MCP server itself, once per
  session. Each agent gets a proxy through the app's bridge, so an agent's
  call and the plugin's tab reach the same process. Tools marked app-only are
  hidden from the model.
- **Views (MCP Apps):** these run in a sandboxed frame served from
  `mcp-app://` under a strict content policy, and get the host's theme tokens.
  They can appear in three places:
  - **Tab** (`thread` entrypoint): opens from the session's `+` menu, and
    opens or refreshes whenever an agent calls the tool.
  - **Rail page** (`global`): an icon on the rail and a full-window page.
  - **File handler** (`file`): opens files of the listed extensions, behind
    a consent screen per plugin and project, with Open with to switch to
    Built-in, and Plugins › File types to pick a handler per extension.
- **References:** a format an enabled plugin opens is also one the composer
  and transcript treat as a reference (`part.step#o1.2`).
- **Plugin skills** join the skills root of new sessions.
- **UI**, following the Codex study:
  - the rail (Sessions, Plugins, then plugin apps)
  - the Plugins pages: Browse grouped by marketplace, a detail page built
    from the manifest with prompt chips, on/off and uninstall
  - an install toast with Try now
- **Examples marketplace** (`resources/plugins/`), proven by the tests:
  - **Tables:** a plugin with no dependencies. It opens CSV and TSV files,
    has a rail page and a tab, and ships a skill.
  - **Filesystem and memory:** the reference servers.
  - **MCP App demo:** the reference example, built on SDK v2.
- **Tests:**
  - `tests/unit/main/plugins-servers.test.ts` drives the host and the agent
    proxy against all four servers.
  - `tests/e2e/plugins.spec.ts` covers install, consent, the file view, Open
    with, the rail page and the tab in the real app.

**Docs**
- `README.md` was rewritten. The long design notes moved to `docs/design.md`
  and are cleaned of CAD.
- `docs/research/codex-plugins.md` covers how Codex plugins are built.
- `docs/research/codex-ux/` is the UX study with its 72 screenshots, copied
  in. The originals in `~/code/elastic-codex-ux*` are untouched.

## Decisions you may want to revisit

- **Rail Settings button:** removed. It duplicated the sidebar's, which broke
  e2e locators. Settings is in the sidebar, the menu and Mod+,.
- **Scope of plugin servers:** each runs per session, plus one app-scope
  process for rail pages and listing tools. Simple, but a heavy server
  (cadgen) would start once per session.
- **File consent:** asked once per plugin per project, not per file.
- **Agent tool results:** a successful agent call to a UI tool always
  opens or updates that tool's tab. Codex shows the result inline instead.
- **Remote marketplace sources:** git sources are listed, but they can't be
  installed. There is also no per-skill toggle yet.
- **Leftover CAD code:** `src/main/explorer/fs.ts` still classifies
  .step/.stl and similar files as kind `cad` for icons, and
  `@workbench/core/lib/cadRefs.js` keeps its name.

## For Jake / the CAD plugin

- cadgen only opens tabs when the MCP client is `codex-mcp-client`
  (`_TAB_HOSTS`). elastic's client name is `elastic`. For the CAD plugin to
  open its tabs here, cadgen needs to accept that name, or detect a tab host
  from the `io.modelcontextprotocol/ui` capability instead
  (`docs/research/codex-plugins.md`).
- Then text-to-cad's Codex plugin should install in elastic as it is: Plugins
  › Add › Install a plugin folder, or add its marketplace.

## Done after the run (2026-10-02 afternoon)

- **Icon:** a pink rubber band stretched around three plum pegs on a dot-grid
  geoboard (pegs are plugins, the band is the app stretching to fit them).
  `scripts/make-icons.mjs` draws it and writes both `build/icon.png` and the
  in-app mark. Commit `ece98ba6`.
- **Packaged .dmg:** `release/elastic-0.1.0-mac-arm64.dmg` (146 MB, unsigned).
  The packaged app launched and stayed up. Attached to a draft GitHub release
  for v0.1.0.
- **CI:** `.github/workflows/test.yml` (typecheck, lint, unit, build, bundle
  check, e2e on macOS for PRs and main) and `release.yml` (tag `v<VERSION>` to
  package and draft a release; signs once the Apple secrets exist).
- **Jake:** invited to the repo with write access.
- **Flaky:** `tests/unit/main/quit-deadline.test.ts` ("kills the app at the
  deadline even when ps hangs") failed once in a full run, passed alone twice.

## Not done

- **Submodule hookup:** the text-to-cad side (pinning this repo as a
  submodule) is Jake's repo; untouched.
- **Signing and notarising:** needs an Apple Developer certificate as secrets.
- **Docker:** not touched; its unused volumes hold about 15 GB.
