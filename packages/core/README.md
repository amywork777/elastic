# @workbench/core

Framework-free pieces the app and `@workbench/ui` share:

- `./prompt`: the prompt-context contract a viewer uses to hand references and
  text to the composer (`createPromptContext`, `referencePart`, `textPart`).
- `./lib/fileFormats.js` and `./lib/renderCapabilities.js`: which extensions
  are which kind of file, for the explorer's icons and menus.
- `./lib/drawing2d`: 2D pan and zoom limits the PDF view uses.

Builds to ESM and declarations in `dist/` (`npm run build`). No React, no
Electron, no Node-only code.
