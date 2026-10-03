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

## Themes

Two independent choices in Settings › Appearance: light, dark or system
(`theme`), and a colour theme (`colorTheme`) that supplies a palette for
each mode and follows the first. The themes are Default (the stock neutral
tokens, unchanged), Graphite, Paper, Nord, Solarized and High contrast.
A theme only remaps colours, never layout, and the accent still tints
buttons over any of them.

A theme lives in `src/shared/color-themes.ts`: one `COLOR_THEMES` entry
with a `light` and a `dark` palette of eleven colours, plus its id in
`COLOR_THEME_IDS`. `tokensOf` spreads a palette over the shadcn tokens, the
renderer writes them onto `<html>` (`src/renderer/lib/color-theme.ts`,
cached for the first paint), main reads the background for the window's
first colour, and MCP App frames get the same tokens as their theme
variables, live. `tests/unit/shared/color-themes.test.ts` holds every theme
to 4.5:1 for text on each surface, in both modes; a stored theme this build
does not have reads as Default.

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
