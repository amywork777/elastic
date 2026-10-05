/**
 * The app's name, in one place. Renaming the app is this constant plus
 * `productName` (and `build.productName`/`appId` in electron-builder.yml);
 * tests/unit/shared/brand.test.ts holds the three together.
 */
export const APP_NAME = "elastic";
/** Directory names and identifiers derived from the name (userData, MCP server ids). */
/** The GitHub repository releases and issues live in (owner/name). */
export const APP_REPO = "amywork777/elastic";
/** Shown after the version while the app is pre-1.0. */
export const APP_STAGE = "beta";
export const APP_SLUG = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-");
