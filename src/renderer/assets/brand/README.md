# Sidebar mark

`elastic-mark.svg` is the sidebar mark. It is an embedded raster with SVG
presentation, not a path-only vector logo: an exterior clip removes the
surrounding app-icon tile and the image is not regenerated or redrawn.

It sits beside elastic in the application’s regular system sans-serif type.
`scripts/make-icons.mjs` renders it onto a dark tile as `build/icon.png`.
