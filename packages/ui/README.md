# @workbench/ui

The app's shared React kit: the file tab and its navigation, the host
contract, the tab store, and the primitives they are drawn with. It was the
CAD viewer's kit in text-to-cad; the CAD renderers are gone, and a format's
viewer is now a plugin (`docs/plugins.md` at the repository root).

| Export | What it is |
| --- | --- |
| `./file-viewer` | `FileViewer`, `defineFileRenderer`, `selectRenderer` and the renderer types ([docs/file-viewer.md](docs/file-viewer.md)) |
| `./file-viewer/presentation`, `./file-viewer/empty` | the loading overlay, the missing-file alert, the empty backdrop |
| `./navigation` | breadcrumbs, the file tree, entry menus, fuzzy filter |
| `./host` | `ViewerHost`, the one object a host supplies ([docs/viewer-host.md](docs/viewer-host.md)) |
| `./tab-store` | per-tab, per-file view state |
| `./primitives/*`, `./loading-icon`, `./utils` | buttons, menus, tooltips, the loading mark |
| `./styles.css`, `./tokens.css` | the design tokens the app's theme is built on |

## Rules

- No Electron, no Node, no app state. What the kit needs from the outside world
  comes through `ViewerHost` (files, clipboard, prompt context, environment).
- Hover hints use `TooltipHint` from `./primitives/tooltip`, with 11px text and
  a 400ms delay: short action names, and full names only when clipped. Native
  HTML `title` attributes are not used for interface hints, here or in the
  desktop screens `tests/unit/renderer/no-native-title.test.tsx` renders.
- Menus and popovers set their own compact text size rather than inheriting the
  trigger's.

## Development

```sh
npm run build -w @workbench/ui      # dist/, which the app imports
npm test -w @workbench/ui           # node:test and vitest suites
npm run typecheck -w @workbench/ui
```

The app imports `dist/`, so rebuild the package after changing it.
