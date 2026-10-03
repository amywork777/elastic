# Design

## The rule

Codex's structure, the original app's neutral colours. elastic follows Codex
where Codex has a good pattern: the left rail as an app switcher, the plugin
store laid out by section (popular first, then categories, search in the
header, a round `+` to install), projects as folder rows, a finished turn's
tool work folded under "Worked for 2m 37s ›" with "Used 2 tools" summaries,
and a cool graphite dark theme. Colour stays the neutral shadcn tokens of the
desktop app it came from (`packages/ui/src/styles/tokens.css`).

No brand colour in the chrome (Amy, 2026-10-02: "generic enough so that when
we add other apps, it looks okay"). Plugins bring their own logos and brand
colours; the window around them stays neutral so any of them sits well in it.
A plugin with no logo gets its initial on a neutral `muted` tile. The
selected rail item is marked by the `sidebar-accent` fill alone.

## Plugin views

MCP App frames receive the app's own tokens as the MCP Apps theme variables
(`--color-background-primary`, `--color-text-primary`, `--font-sans`, ...),
so a plugin's view matches the window in light and dark. Bundled plugins
(Code Review, Tables, ...) use those variables and nothing else.

## Brand

`scripts/brand-mark.mjs` draws the app icon, the in-app mark, the wordmark
PNGs and the variants sheet (`docs/brand/variants.png`). The mark is a pink
band stretched around three pegs on a dark tile: the pegs are plugins, the
band is the app stretching to fit them. The pink lives in the icon only.

The loading glyph (`@workbench/ui/loading-icon`) is the band itself, drawn in
the text colour: while something loads, the pegs drift apart and back so the
band stretches and settles. It holds still under reduced motion. It also sits
above the new-session prompt, the way Codex shows its mark there.
