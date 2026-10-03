# Design

## The rule

elastic keeps the look of the desktop app it was extracted from (the
text-to-cad desktop app): neutral shadcn tokens (`packages/ui/src/styles/tokens.css`),
its rail, sidebar, transcript and explorer as they were. Do not restyle the
existing chrome. Anything new (the plugin store, plugin detail pages, plugin
views such as Code Review, sign-in states) is built from the same tokens and
components so it looks like it was always there. No new accent colours in the
window chrome.

Amy's call (2026-10-02): a Codex-style restyle (pink rail marker, sectioned
store, pastel plugin tiles, "Worked for" folds, graphite dark) was tried and
reverted. Behaviour can follow Codex; the look stays the app's own.

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
band stretches and settles. It holds still under reduced motion.
