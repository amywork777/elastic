/**
 * Writes a colour theme (`src/shared/color-themes.ts`) onto `<html>` as custom properties, which
 * win over the stylesheet's `:root` and `.dark` blocks. `default` clears them, so the stylesheet
 * stands. `data-color-theme` names the choice for CSS and tests.
 *
 * The choice is cached in localStorage the way the light/dark preference is (`use-theme.ts`), so
 * the first paint already has it rather than flashing the stock palette for an IPC round trip.
 */
import { ColorThemeIdSchema, THEMED_TOKENS, colorTheme, tokensOf, type ColorThemeId } from "@shared/color-themes";

const CACHE_KEY = "elastic.colorTheme";

export function readCachedColorTheme(): ColorThemeId {
  try {
    const parsed = ColorThemeIdSchema.safeParse(window.localStorage.getItem(CACHE_KEY));
    return parsed.success ? parsed.data : "default";
  } catch {
    return "default";
  }
}

export function writeCachedColorTheme(id: ColorThemeId): void {
  try {
    window.localStorage.setItem(CACHE_KEY, id);
  } catch {
    /* a renderer with storage blocked repaints from settings instead */
  }
}

export function applyColorTheme(id: ColorThemeId, resolved: "light" | "dark"): void {
  const root = document.documentElement;
  const palette = colorTheme(id)[resolved];
  for (const token of THEMED_TOKENS) root.style.removeProperty(token);
  root.setAttribute("data-color-theme", id);
  if (!palette) return;
  for (const [token, value] of Object.entries(tokensOf(palette))) root.style.setProperty(token, value);
}
