# Brand

`elastic-mark.svg` is the app icon's artwork (the Dock icon, with its tile; inside
the app the mark is drawn without the tile by `@workbench/ui/loading-icon`): a white band stretched around three
grey plugin pegs on a graphite tile. It is generated, not drawn by hand:
`scripts/brand-mark.mjs` holds the geometry and palette, `npm run icons`
writes this file and `build/icon.png`, and `npm run brand` writes the
wordmark PNGs in `resources/brand/`. `docs/brand/variants.png` shows the
variants that were considered.

The sidebar sets it beside the word "elastic" in the app's system sans
(`features/sidebar/Wordmark.tsx`).
