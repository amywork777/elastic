# elastic

A desktop app for coding agents (Claude Code, Codex and others over the Agent
Client Protocol) where everything beyond the chat is a plugin. The core stays
small: projects and sessions, an explorer of tabs (files, review, browser,
terminal), git worktrees. Plugins add the rest as MCP servers, skills and MCP
App views, in the same format Codex and Claude Code use, so any model and any
plugin can plug in.

It started as the text-to-cad desktop app with the hardware parts taken out.
The CAD tools are meant to come back as a plugin from the text-to-cad repo.

## Run it

```sh
npm install
npm run dev          # the app, with hot reload
npm run build        # out/ (skills, main, preload, renderer, the app's MCP server)
```

The renderer and main unit suites need Node 24 (`node:sqlite`, `Set.union`):

```sh
npm run typecheck
npm run lint
npx vitest run --project node --project renderer
npm run e2e          # Playwright against the built app
```

## Plugins

Rail › Plugins lists what is installed and what the marketplaces offer. The
app ships an examples marketplace (`resources/plugins/`): Tables (opens CSV
files, a rail page, a skill), the reference filesystem and memory servers, and
the MCP Apps demo. Add your own folder or marketplace from Add.

- How to write one, and how the pieces fit: [docs/plugins.md](docs/plugins.md)
- What Codex does, which this copies: [docs/research/codex-plugins.md](docs/research/codex-plugins.md)
  and the UX study with screenshots, [docs/research/codex-ux/README.md](docs/research/codex-ux/README.md)

## More

- [docs/design.md](docs/design.md): the long-form design notes (layout,
  keyboard, explorer, ACP, git, packaging, checks)
- [docs/integrations.md](docs/integrations.md): the app's own MCP server and
  what agents can do in the window
- [AGENTS.md](AGENTS.md): conventions for agents working in this repo
