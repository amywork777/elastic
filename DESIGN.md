# DESIGN.md: elastic

Route: Codex's window, with taste/routes/tool.md for the brand (Amy's
`~/code/taste`). Amy's brief: "make sure it looks like Codex" wins for the app
chrome; taste supplies the mark, the accent and the one hand-made detail.
Precedence: this file > taste/SIGNATURE.md > Impeccable defaults. The
long-form behaviour record is [docs/design.md](docs/design.md); this file is
only the look.

## The chrome is Codex's

Mode: Operate. The window should read as Codex at a glance
(docs/research/codex-ux/ has 72 shots of the real thing):

- **Rail** down the left edge is the app switcher: Home (sessions), Plugins,
  then one icon per plugin page. The item selected owns the sidebar beside it.
- **Sidebar**: the wordmark, `New` with a pen, projects as folder rows with
  their threads under them.
- **Session**: one centred column of turns; the composer is a floating
  rounded card with the model and effort chips. A finished earlier turn folds
  its work under "Worked for 2m 37s ›" (`WorkFold`, `Transcript.tsx`); tool
  calls fold to plain-language rows ("Used cad, read 2 files").
- **Tools** are tabs in one right-hand pane with a `+` launcher. A plugin's
  view is a tab, a rail page or how a file type opens.
- **Plugins** store: title and one-line pitch, search in the header, Popular
  first then one section per category, two columns of rows (logo, name, one
  line, `+`). Every row says whether it works here (Works, Needs sign-in,
  Partly, Needs Codex, Checked on install).

## Tokens

One token set, light and dark: `packages/ui/src/styles/tokens.css` (shadcn's
neutral palette). The app, the shared viewer and every MCP App frame (passed
in as MCP Apps style variables, `McpAppFrame.tsx`) read it.

- Dark is a cool graphite like Codex's: every surface darker than mid-grey
  carries chroma 0.006 at hue 275.
- `--brand` `#ff6fa3` and `--brand-ink` `#d6447e` (taste's pink) are used for
  the mark, the loading glyph and the selected rail item. Never for buttons,
  links or backgrounds; Codex's chrome stays neutral.
- Status colours are semantic (success, warning, info, error) and only mean
  status.
- Type: the system sans at 13px (`--text-ui`), 22px for page titles, 15px for
  section heads. No monospace outside code, diffs and terminals.
- Radii: 10px rows and tiles, a full pill for search, 8px controls.

## The mark

`scripts/brand-mark.mjs` draws it; `npm run icons` and `npm run brand` render
the app icon, the in-app SVG and the wordmark PNGs. A pink band stretched
around three paper pegs on a graphite tile: the pegs are plugins, the band
is the app stretching to fit them. The right peg sits far out, so the band
is under visible tension and its sides bow in. Flat fills, a contact shadow,
no gradient, no glow. Variants considered: `docs/brand/variants.png`.

Logo-less plugins get their initial in plum on one of taste's flat pastel
tiles, picked by name so a plugin keeps its colour (`PluginLogo.tsx`).

## One signature moment

The loading glyph (`@workbench/ui/loading-icon`): the band itself, its pegs
drifting apart and back so it stretches and settles while a file, a tab or a
turn loads. SVG, still under reduced motion.

## One hand-made detail

The brand pink pill beside the selected rail item: the only colour in the
chrome.
