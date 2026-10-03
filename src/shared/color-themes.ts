/**
 * Colour themes: a palette over the shadcn tokens in `packages/ui/src/styles/tokens.css`,
 * one set for light and one for dark, chosen apart from the light/dark/system preference
 * (`theme`) and following it. A theme only remaps colours, never layout.
 *
 * `default` writes nothing, so the stock tokens stand and the default app is exactly the
 * stylesheet. Every other theme is applied by the renderer as custom properties on `<html>`
 * (`src/renderer/lib/color-theme.ts`), which win over the stylesheet's `:root` and `.dark`
 * blocks; MCP App frames read the same tokens (`McpAppFrame.tsx` `hostStyles`).
 *
 * Adding a theme: one entry in `COLOR_THEMES` (a `palette` for light and one for dark) and its
 * id in `COLOR_THEME_IDS`. `tests/unit/shared/color-themes.test.ts` holds every entry to 4.5:1
 * for text on each surface it is drawn on, in both modes.
 *
 * Pure and dependency-free (zod aside): main reads it for the window's first colour.
 */
import { z } from "zod";

export const COLOR_THEME_IDS = ["default", "graphite", "paper", "nord", "solarized", "contrast"] as const;
export const ColorThemeIdSchema = z.enum(COLOR_THEME_IDS);
export type ColorThemeId = z.infer<typeof ColorThemeIdSchema>;

/** The few colours a theme is made of; `tokensOf` spreads them over the token set. */
export type Palette = {
  background: string;
  /** Cards and popovers. */
  surface: string;
  /** Quiet fills: `muted`, `secondary`. */
  sunken: string;
  /** Hover and selection: `accent`, `sidebar-accent`. */
  raised: string;
  sidebar: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  border: string;
  ring: string;
};

export type ColorTheme = {
  id: ColorThemeId;
  label: string;
  description: string;
  light: Palette | null;
  dark: Palette | null;
};

/** The stock tokens, for previews of `default` (the stylesheet's own values). */
const STOCK: { light: Palette; dark: Palette } = {
  light: {
    background: "oklch(1 0 0)", surface: "oklch(1 0 0)", sunken: "oklch(0.97 0 0)", raised: "oklch(0.97 0 0)",
    sidebar: "oklch(0.985 0 0)", foreground: "oklch(0.145 0 0)", mutedForeground: "oklch(0.51 0 0)",
    primary: "oklch(0.205 0 0)", primaryForeground: "oklch(0.985 0 0)", border: "oklch(0.922 0 0)", ring: "oklch(0.708 0 0)",
  },
  dark: {
    background: "oklch(0.28 0.006 275)", surface: "oklch(0.31 0.006 275)", sunken: "oklch(0.34 0.006 275)",
    raised: "oklch(0.38 0.006 275)", sidebar: "oklch(0.30 0.006 275)", foreground: "oklch(0.985 0 0)",
    mutedForeground: "oklch(0.77 0 0)", primary: "oklch(0.922 0 0)", primaryForeground: "oklch(0.205 0.006 275)",
    border: "oklch(1 0 0 / 10%)", ring: "oklch(0.556 0 0)",
  },
};

export const COLOR_THEMES: readonly ColorTheme[] = [
  {
    id: "default",
    label: "Default",
    description: "Neutral greys, the stock look.",
    light: null,
    dark: null,
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Cool and deep, a hair of blue.",
    light: {
      background: "oklch(0.985 0.002 265)", surface: "oklch(1 0 0)", sunken: "oklch(0.955 0.004 265)",
      raised: "oklch(0.935 0.006 265)", sidebar: "oklch(0.965 0.004 265)", foreground: "oklch(0.2 0.01 265)",
      mutedForeground: "oklch(0.47 0.012 265)", primary: "oklch(0.25 0.012 265)", primaryForeground: "oklch(0.985 0 0)",
      border: "oklch(0.9 0.006 265)", ring: "oklch(0.68 0.01 265)",
    },
    dark: {
      background: "oklch(0.2 0.008 268)", surface: "oklch(0.235 0.008 268)", sunken: "oklch(0.26 0.009 268)",
      raised: "oklch(0.3 0.01 268)", sidebar: "oklch(0.22 0.008 268)", foreground: "oklch(0.97 0.002 268)",
      mutedForeground: "oklch(0.75 0.008 268)", primary: "oklch(0.92 0.004 268)", primaryForeground: "oklch(0.2 0.008 268)",
      border: "oklch(1 0 0 / 9%)", ring: "oklch(0.55 0.01 268)",
    },
  },
  {
    id: "paper",
    label: "Paper",
    description: "Warm neutrals, easy on the eyes.",
    light: {
      background: "oklch(0.982 0.008 85)", surface: "oklch(0.995 0.004 85)", sunken: "oklch(0.955 0.012 85)",
      raised: "oklch(0.935 0.014 85)", sidebar: "oklch(0.965 0.01 85)", foreground: "oklch(0.24 0.015 60)",
      mutedForeground: "oklch(0.46 0.02 60)", primary: "oklch(0.3 0.02 55)", primaryForeground: "oklch(0.985 0.006 85)",
      border: "oklch(0.89 0.015 80)", ring: "oklch(0.68 0.02 70)",
    },
    dark: {
      background: "oklch(0.235 0.008 70)", surface: "oklch(0.265 0.009 70)", sunken: "oklch(0.29 0.01 70)",
      raised: "oklch(0.33 0.011 70)", sidebar: "oklch(0.25 0.008 70)", foreground: "oklch(0.95 0.01 85)",
      mutedForeground: "oklch(0.76 0.015 80)", primary: "oklch(0.9 0.015 85)", primaryForeground: "oklch(0.24 0.01 70)",
      border: "oklch(1 0 0 / 10%)", ring: "oklch(0.58 0.015 75)",
    },
  },
  {
    id: "nord",
    label: "Nord",
    description: "Arctic blue-greys.",
    light: {
      background: "oklch(0.951 0.007 260.7)", surface: "oklch(0.975 0.005 260)", sunken: "oklch(0.933 0.01 261.8)",
      raised: "oklch(0.899 0.016 262.7)", sidebar: "oklch(0.933 0.01 261.8)", foreground: "oklch(0.324 0.023 264.2)",
      mutedForeground: "oklch(0.44 0.035 264.1)", primary: "oklch(0.5 0.08 254)", primaryForeground: "oklch(0.975 0.005 260)",
      border: "oklch(0.88 0.016 262.7)", ring: "oklch(0.697 0.059 248.7)",
    },
    dark: {
      background: "oklch(0.324 0.023 264.2)", surface: "oklch(0.379 0.029 266.5)", sunken: "oklch(0.379 0.029 266.5)",
      raised: "oklch(0.416 0.032 264.1)", sidebar: "oklch(0.3 0.022 264)", foreground: "oklch(0.951 0.007 260.7)",
      mutedForeground: "oklch(0.86 0.016 262.7)", primary: "oklch(0.775 0.062 217.5)", primaryForeground: "oklch(0.28 0.023 264.2)",
      border: "oklch(1 0 0 / 10%)", ring: "oklch(0.52 0.035 264.1)",
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    description: "Ethan Schoonover's classic palette.",
    light: {
      background: "oklch(0.974 0.026 90.1)", surface: "oklch(0.985 0.018 90)", sunken: "oklch(0.931 0.026 92.4)",
      raised: "oklch(0.905 0.03 92)", sidebar: "oklch(0.931 0.026 92.4)", foreground: "oklch(0.309 0.052 219.7)",
      mutedForeground: "oklch(0.46 0.03 219.1)", primary: "oklch(0.5 0.13 245)", primaryForeground: "oklch(0.974 0.026 90.1)",
      border: "oklch(0.88 0.03 90)", ring: "oklch(0.615 0.139 244.9)",
    },
    dark: {
      background: "oklch(0.267 0.049 219.8)", surface: "oklch(0.309 0.052 219.7)", sunken: "oklch(0.309 0.052 219.7)",
      raised: "oklch(0.35 0.05 220)", sidebar: "oklch(0.285 0.05 220)", foreground: "oklch(0.92 0.015 196)",
      mutedForeground: "oklch(0.76 0.016 196.8)", primary: "oklch(0.7 0.12 244.9)", primaryForeground: "oklch(0.2 0.045 219.8)",
      border: "oklch(1 0 0 / 10%)", ring: "oklch(0.523 0.028 219.1)",
    },
  },
  {
    id: "contrast",
    label: "High contrast",
    description: "Black and white, strong borders.",
    light: {
      background: "oklch(1 0 0)", surface: "oklch(1 0 0)", sunken: "oklch(0.96 0 0)", raised: "oklch(0.93 0 0)",
      sidebar: "oklch(0.97 0 0)", foreground: "oklch(0 0 0)", mutedForeground: "oklch(0.35 0 0)",
      primary: "oklch(0.15 0 0)", primaryForeground: "oklch(1 0 0)", border: "oklch(0.55 0 0)", ring: "oklch(0.3 0 0)",
    },
    dark: {
      background: "oklch(0.13 0 0)", surface: "oklch(0.17 0 0)", sunken: "oklch(0.2 0 0)", raised: "oklch(0.26 0 0)",
      sidebar: "oklch(0.15 0 0)", foreground: "oklch(1 0 0)", mutedForeground: "oklch(0.86 0 0)",
      primary: "oklch(0.97 0 0)", primaryForeground: "oklch(0.13 0 0)", border: "oklch(1 0 0 / 45%)", ring: "oklch(0.8 0 0)",
    },
  },
];

export function colorTheme(id: ColorThemeId): ColorTheme {
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0]!;
}

/** A theme's palette for a mode, with `default` answered from the stock tokens (previews, main). */
export function paletteOf(id: ColorThemeId, mode: "light" | "dark"): Palette {
  return colorTheme(id)[mode] ?? STOCK[mode];
}

/** The shadcn tokens a palette sets. `default` sets none. */
export function tokensOf(palette: Palette): Record<string, string> {
  return {
    "--background": palette.background,
    "--foreground": palette.foreground,
    "--card": palette.surface,
    "--card-foreground": palette.foreground,
    "--popover": palette.surface,
    "--popover-foreground": palette.foreground,
    "--primary": palette.primary,
    "--primary-foreground": palette.primaryForeground,
    "--secondary": palette.sunken,
    "--secondary-foreground": palette.foreground,
    "--muted": palette.sunken,
    "--muted-foreground": palette.mutedForeground,
    "--accent": palette.raised,
    "--accent-foreground": palette.foreground,
    "--border": palette.border,
    "--input": palette.border,
    "--ring": palette.ring,
    "--sidebar": palette.sidebar,
    "--sidebar-foreground": palette.foreground,
    "--sidebar-primary": palette.primary,
    "--sidebar-primary-foreground": palette.primaryForeground,
    "--sidebar-accent": palette.raised,
    "--sidebar-accent-foreground": palette.foreground,
    "--sidebar-border": palette.border,
    "--sidebar-ring": palette.ring,
    "--background-2": palette.raised,
    "--surface-sunken-hover": palette.raised,
    "--surface-base-selected": palette.raised,
    "--surface-elevated-selected": palette.raised,
    "--surface-paper-selected": palette.raised,
  };
}

/** Every token any theme sets, so switching back to `default` can clear them all. */
export const THEMED_TOKENS: readonly string[] = Object.keys(tokensOf(STOCK.light));

/** `oklch(L C h)` (L a number or a percentage, alpha ignored) as linear sRGB, clamped. */
export function oklchToLinear(value: string): [number, number, number] {
  const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!match) throw new Error(`not an oklch() colour: ${value}`);
  const L = Number(match[1]) / (match[2] ? 100 : 1);
  const C = Number(match[3]);
  const h = (Number(match[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** An opaque `oklch()` as `#rrggbb`, for the BrowserWindow's first colour. */
export function oklchToHex(value: string): string {
  const encode = (x: number) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  return `#${oklchToLinear(value).map((x) => encode(x).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG contrast between two opaque `oklch()` colours. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const [r, g, b] = oklchToLinear(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
