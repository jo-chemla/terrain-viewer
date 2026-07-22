import { formatOklch, hexToOklch } from "./color-math"
import { FONT_PRESETS } from "./token-schema"

// ─── Style ──────────────────────────────────────────────────────────────────
//
// Names verified against ui.shadcn.com/create's actual "Style" picker (Vega,
// Nova, Maia, Lyra, Mira, Luma, Sera, Rhea are its real 8 options — checked
// live, not guessed). The per-style font/shadow VALUES below are this
// package's own curated choices, not extracted from shadcn's — its "Get Code"
// output requires signing in, so there was no way to read its private
// generation algorithm. Same names, independently designed personalities.
// Radius is its own separate Basic-mode control (matching the real page,
// where Radius is independent of Style too), not bundled into a style.
export interface StylePreset {
  name: string
  fontSans: string
  fontHeading: string
  fontMono: string
  shadowOpacity: number
  shadowBlur: number // px
}

export const STYLE_PRESETS: StylePreset[] = [
  { name: "Vega", fontSans: FONT_PRESETS.sans.Inter, fontHeading: FONT_PRESETS.sans.Inter, fontMono: FONT_PRESETS.mono["System Mono"], shadowOpacity: 0.1, shadowBlur: 3 },
  { name: "Nova", fontSans: FONT_PRESETS.sans["System Sans"], fontHeading: FONT_PRESETS.sans.Outfit, fontMono: FONT_PRESETS.mono["JetBrains Mono"], shadowOpacity: 0.08, shadowBlur: 4 },
  { name: "Maia", fontSans: FONT_PRESETS.sans["Plus Jakarta Sans"], fontHeading: FONT_PRESETS.sans["Plus Jakarta Sans"], fontMono: FONT_PRESETS.mono["Fira Code"], shadowOpacity: 0.12, shadowBlur: 6 },
  { name: "Lyra", fontSans: FONT_PRESETS.sans.Inter, fontHeading: FONT_PRESETS.serif["Playfair Display"], fontMono: FONT_PRESETS.mono["System Mono"], shadowOpacity: 0.06, shadowBlur: 2 },
  { name: "Mira", fontSans: FONT_PRESETS.sans.Outfit, fontHeading: FONT_PRESETS.sans.Outfit, fontMono: FONT_PRESETS.mono["JetBrains Mono"], shadowOpacity: 0.15, shadowBlur: 8 },
  { name: "Luma", fontSans: FONT_PRESETS.sans["System Sans"], fontHeading: FONT_PRESETS.sans["System Sans"], fontMono: FONT_PRESETS.mono["System Mono"], shadowOpacity: 0.05, shadowBlur: 2 },
  { name: "Sera", fontSans: FONT_PRESETS.sans["Plus Jakarta Sans"], fontHeading: FONT_PRESETS.serif.Merriweather, fontMono: FONT_PRESETS.mono["Fira Code"], shadowOpacity: 0.1, shadowBlur: 4 },
  { name: "Rhea", fontSans: FONT_PRESETS.sans.Inter, fontHeading: FONT_PRESETS.sans.Inter, fontMono: FONT_PRESETS.mono["System Mono"], shadowOpacity: 0.2, shadowBlur: 0 },
]

// ─── Base Color ─────────────────────────────────────────────────────────────
//
// shadcn/ui's long-standing 5 base-color families (components.json's
// tailwind.baseColor) — near-zero-chroma neutrals, each with a faint hue
// tint: Neutral is truly hueless, Slate/Zinc lean cool, Stone leans warm.
export interface BaseColorFamily { name: string; hue: number; chroma: number }
export const BASE_COLOR_FAMILIES: BaseColorFamily[] = [
  { name: "Neutral", hue: 0, chroma: 0 },
  { name: "Gray", hue: 240, chroma: 0.004 },
  { name: "Zinc", hue: 240, chroma: 0.006 },
  { name: "Stone", hue: 50, chroma: 0.006 },
  { name: "Slate", hue: 250, chroma: 0.012 },
]

// ─── Theme / Chart color ────────────────────────────────────────────────────
//
// A curated named-hue list (Tailwind/Radix-style color names) shared by both
// the "Theme" (primary accent) and "Chart Color" pickers — each just needs a
// representative OKLCH hue angle, not a whole palette of its own.
export interface NamedHue { name: string; hue: number }
export const NAMED_HUES: NamedHue[] = [
  { name: "Neutral", hue: 0 },
  { name: "Red", hue: 25 },
  { name: "Orange", hue: 50 },
  { name: "Amber", hue: 70 },
  { name: "Yellow", hue: 95 },
  { name: "Lime", hue: 125 },
  { name: "Green", hue: 145 },
  { name: "Emerald", hue: 160 },
  { name: "Teal", hue: 180 },
  { name: "Cyan", hue: 200 },
  { name: "Sky", hue: 220 },
  { name: "Blue", hue: 255 },
  { name: "Indigo", hue: 275 },
  { name: "Violet", hue: 295 },
  { name: "Purple", hue: 305 },
  { name: "Fuchsia", hue: 320 },
  { name: "Pink", hue: 340 },
  { name: "Rose", hue: 355 },
]

export const MENU_ACCENT_LEVELS = ["Subtle", "Medium", "Bold"] as const
export type MenuAccentLevel = (typeof MENU_ACCENT_LEVELS)[number]
const MENU_ACCENT_CHROMA_SCALE: Record<MenuAccentLevel, number> = { Subtle: 0.4, Medium: 0.7, Bold: 1.1 }

export type BasicOptions = {
  style: string // StylePreset name
  baseColor: string // BaseColorFamily name
  theme: string // NamedHue name — "Neutral" means primary stays neutral too
  chartColor: string // NamedHue name
  radius: number // rem — independent of Style, matching the real page
  menuSolid: boolean
  menuAccent: MenuAccentLevel
}

export const DEFAULT_BASIC_OPTIONS: BasicOptions = {
  style: "Vega",
  baseColor: "Neutral",
  theme: "Blue",
  chartColor: "Blue",
  radius: 0.625,
  menuSolid: false,
  menuAccent: "Subtle",
}

// "Theme"/"Chart Color" normally hold a NAMED_HUES name, but either can also
// hold a custom user-picked color instead of the curated hue list — encoded
// as this sentinel prefix + a hex color, so BasicOptions stays a plain
// Record<string, string> (no new field/type needed) and the existing lock
// system (keyed on BasicOptions' own keys) already covers it for free.
const CUSTOM_HUE_PREFIX = "custom:"
export function isCustomHueValue(value: string): boolean {
  return value.startsWith(CUSTOM_HUE_PREFIX)
}
export function customHueHex(value: string): string {
  return value.slice(CUSTOM_HUE_PREFIX.length)
}
export function makeCustomHueValue(hex: string): string {
  return `${CUSTOM_HUE_PREFIX}${hex}`
}
function findHue(name: string): number {
  if (isCustomHueValue(name)) return hexToOklch(customHueHex(name)).h
  return NAMED_HUES.find((h) => h.name === name)?.hue ?? 0
}
function findBase(name: string): BaseColorFamily {
  return BASE_COLOR_FAMILIES.find((b) => b.name === name) ?? BASE_COLOR_FAMILIES[0]
}
function col(l: number, c: number, h: number): string { return formatOklch({ l, c, h, alpha: 1 }) }
function wrapHue(h: number): number { return ((h % 360) + 360) % 360 }

// Derives the full ~30-token color palette from the handful of Basic-mode
// choices — same overall construction as randomize.ts's semantic generator
// (foreground lightness/contrast derived from its own surface rather than
// independently chosen, destructive always red regardless of theme), just
// with explicit named inputs instead of Math.random().
export function buildBasicPalette(options: BasicOptions, isDark: boolean): Record<string, string> {
  const base = findBase(options.baseColor)
  const themeHue = findHue(options.theme)
  const themeIsNeutral = options.theme === "Neutral"
  const chartHue = findHue(options.chartColor)
  const accentScale = MENU_ACCENT_CHROMA_SCALE[options.menuAccent]

  const bgL = isDark ? 0.16 : 0.99
  const cardL = isDark ? 0.20 : 1
  const fgL = isDark ? 0.92 : 0.18
  const mutedL = isDark ? 0.24 : 0.96
  const mutedFgL = isDark ? 0.68 : 0.48
  const borderL = isDark ? 0.30 : 0.88

  const primaryL = themeIsNeutral ? (isDark ? 0.85 : 0.25) : 0.60
  const primaryC = themeIsNeutral ? base.chroma : 0.19
  const primaryFgL = primaryL < 0.55 ? 0.98 : 0.12

  const secondaryL = isDark ? 0.28 : 0.94
  const accentL = isDark ? 0.26 + 0.05 * accentScale : 0.92 - 0.04 * accentScale
  const accentC = (themeIsNeutral ? base.chroma * 2 : 0.06) * accentScale
  const onAccentL = isDark ? 0.95 : 0.20

  const sidebarL = options.menuSolid ? (isDark ? bgL + 0.04 : cardL - 0.02) : bgL

  return {
    background: col(bgL, base.chroma, base.hue),
    foreground: col(fgL, base.chroma, base.hue),
    card: col(cardL, base.chroma, base.hue),
    "card-foreground": col(fgL, base.chroma, base.hue),
    popover: col(cardL, base.chroma, base.hue),
    "popover-foreground": col(fgL, base.chroma, base.hue),
    primary: col(primaryL, primaryC, themeHue),
    "primary-foreground": col(primaryFgL, 0.01, themeHue),
    secondary: col(secondaryL, base.chroma, base.hue),
    "secondary-foreground": col(fgL, base.chroma, base.hue),
    muted: col(mutedL, base.chroma, base.hue),
    "muted-foreground": col(mutedFgL, base.chroma, base.hue),
    accent: col(accentL, accentC, themeHue),
    "accent-foreground": col(onAccentL, 0.01, themeHue),
    destructive: col(0.58, 0.24, 22),
    "destructive-foreground": col(0.98, 0.01, 22),
    border: col(borderL, base.chroma, base.hue),
    input: col(borderL, base.chroma, base.hue),
    ring: col(primaryL, primaryC * 0.9, themeHue),
    "chart-1": col(0.62, 0.20, chartHue),
    "chart-2": col(0.62, 0.18, wrapHue(chartHue + 45)),
    "chart-3": col(0.62, 0.18, wrapHue(chartHue + 90)),
    "chart-4": col(0.62, 0.18, wrapHue(chartHue + 200)),
    "chart-5": col(0.62, 0.18, wrapHue(chartHue + 260)),
    sidebar: col(sidebarL, base.chroma, base.hue),
    "sidebar-foreground": col(fgL, base.chroma, base.hue),
    "sidebar-primary": col(primaryL, primaryC, themeHue),
    "sidebar-primary-foreground": col(primaryFgL, 0.01, themeHue),
    "sidebar-accent": col(accentL, accentC, themeHue),
    "sidebar-accent-foreground": col(onAccentL, 0.01, themeHue),
    "sidebar-border": col(borderL, base.chroma, base.hue),
    "sidebar-ring": col(primaryL, primaryC * 0.9, themeHue),
  }
}

export function findStyle(name: string): StylePreset {
  return STYLE_PRESETS.find((s) => s.name === name) ?? STYLE_PRESETS[0]
}

// Non-color values a Style bundles — shadow personality + fonts. Kept
// separate from buildBasicPalette (which is colors only) since these apply
// regardless of Base/Theme/Chart choices. Radius is NOT here — it's its own
// independent Basic-mode control, applied separately.
export function buildStyleValues(style: StylePreset): Record<string, string> {
  return {
    "font-sans": style.fontSans,
    "font-heading": style.fontHeading,
    "font-mono": style.fontMono,
    "shadow-opacity": `${style.shadowOpacity}`,
    "shadow-blur": `${style.shadowBlur}px`,
  }
}
