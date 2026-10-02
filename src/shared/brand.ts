/**
 * The app's name, in one place. Renaming the app is this constant plus
 * `productName` (and `build.productName`/`appId` in electron-builder.yml);
 * tests/unit/shared/brand.test.ts holds the three together.
 */
export const APP_NAME = "elastic";
/** Directory names and identifiers derived from the name (userData, MCP server ids). */
export const APP_SLUG = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-");
