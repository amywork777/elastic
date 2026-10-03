/**
 * Every colour theme, in both modes, keeps text readable (WCAG 1.4.3, 4.5:1): the foreground and
 * the muted foreground on each surface they are drawn on, and a primary button's label on the
 * button. `default` is the stylesheet itself, held by tests/unit/renderer/contrast.test.ts.
 */
import { describe, expect, it } from "vitest";

import { COLOR_THEMES, ColorThemeIdSchema, contrastRatio, oklchToHex, paletteOf, tokensOf } from "../../../src/shared/color-themes";
import { SettingsSchema, defaultSettings } from "../../../src/shared/types";

const SURFACES = ["background", "surface", "sunken", "raised", "sidebar"] as const;

describe("colour themes", () => {
  for (const theme of COLOR_THEMES.filter((entry) => entry.id !== "default")) {
    for (const mode of ["light", "dark"] as const) {
      it(`${theme.id} (${mode}) keeps text at 4.5:1 on every surface`, () => {
        const palette = paletteOf(theme.id, mode);
        const failing: string[] = [];
        for (const surface of SURFACES) {
          for (const text of ["foreground", "mutedForeground"] as const) {
            const ratio = contrastRatio(palette[text], palette[surface]);
            if (ratio < 4.5) failing.push(`${text} on ${surface} ${ratio.toFixed(2)}:1`);
          }
        }
        const button = contrastRatio(palette.primaryForeground, palette.primary);
        if (button < 4.5) failing.push(`primaryForeground on primary ${button.toFixed(2)}:1`);
        expect(failing).toEqual([]);
      });
    }
  }

  it("sets the same tokens for every theme, and nothing for default", () => {
    const keys = Object.keys(tokensOf(paletteOf("graphite", "light"))).sort();
    for (const theme of COLOR_THEMES) {
      expect(theme.id === "default" ? theme.light : Object.keys(tokensOf(theme.light!)).sort()).toEqual(theme.id === "default" ? null : keys);
    }
  });

  it("lists every registry entry in the schema, once", () => {
    expect(COLOR_THEMES.map((theme) => theme.id)).toEqual([...ColorThemeIdSchema.options]);
  });

  it("converts a palette colour to hex for the window", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
  });
});

describe("the colorTheme setting", () => {
  it("defaults to default and refuses a theme it does not have", () => {
    expect(defaultSettings().colorTheme).toBe("default");
    expect(SettingsSchema.safeParse({ colorTheme: "neon" }).success).toBe(false);
    expect(SettingsSchema.parse({ colorTheme: "nord" }).colorTheme).toBe("nord");
  });
});
