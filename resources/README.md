# resources/

What ships beside the app instead of inside the asar. `electron-builder.yml`
copies `resources/bundled` and `resources/plugins` into the packaged app's
`Resources/`, and `process.resourcesPath` is where main reads them back.

| Directory | Filled by | Contents |
| --- | --- | --- |
| `bundled/` | committed | the bundled plugins: elastic's own browser, documents, PDF and terminals, each a plugin folder with its skill and an app server (`builtin` in its `.mcp.json`). Installed on start, can be turned off, never uninstalled (`src/main/plugins/service.ts`). Their skills join the enabled plugins' in `<userData>/skills/<version>/` (`src/main/integrations/skills.ts`); nothing is installed into an agent's own configuration |
| `plugins/` | committed | the example plugins and their `marketplace.json`, listed on the Plugins page (`src/main/integrations/index.ts`). Each plugin is its own folder under `plugins/plugins/`; see [`docs/plugins.md`](../docs/plugins.md) |
| `app-mcp/` | committed source | the elastic MCP server (`server.mjs`); NOT an extraResource — the build bundles it into `out/app-mcp/`, which ships unpacked beside the asar |
| `brand/` | `npm run brand` (`scripts/make-brand.mjs`), committed | the elastic wordmark as PNGs, plus the JetBrains Mono ExtraBold Italic face they are set in and its OFL licence. NOT an extraResource — nothing here is opened at run time. The app icon is rendered separately by `scripts/make-icons.mjs` from `src/renderer/assets/brand/elastic-mark.svg` into `build/icon.png` |

`scripts/package.mjs` also refuses to run without a real `VERSION` at the
repository root: `scripts/app-version.mjs` answers `0.0.0` when the file is
missing, and an installer stamped 0.0.0 would never be offered an update.
