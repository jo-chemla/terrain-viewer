import type { TokenGroup } from "./types"

const color = (key: string, label: string) => ({ key, label, type: "color" as const })

// Full parity with tweakcn.com's own editor — every CSS custom property its
// panels expose. Colors are split into tweakcn's own small per-pair groups
// (Primary, Secondary, Accent, Base, Card, Popover, Muted, Destructive,
// Border/Input/Ring) rather than one flat list, matching how its own editor
// presents them. See shadow-formula.ts for why the 8 --shadow-2xs..2xl
// values aren't listed here: they're computed from the 6 base shadow tokens
// in the "Shadow" group below, not edited directly (matching tweakcn, whose
// shadow-control.tsx only ever takes those 6 inputs too).
export const TOKEN_GROUPS: TokenGroup[] = [
  { id: "primary", title: "Primary", tokens: [color("primary", "Primary"), color("primary-foreground", "Primary Foreground")] },
  { id: "secondary", title: "Secondary", tokens: [color("secondary", "Secondary"), color("secondary-foreground", "Secondary Foreground")] },
  { id: "accent", title: "Accent", tokens: [color("accent", "Accent"), color("accent-foreground", "Accent Foreground")] },
  { id: "base", title: "Base", tokens: [color("background", "Background"), color("foreground", "Foreground")] },
  { id: "card", title: "Card", tokens: [color("card", "Card"), color("card-foreground", "Card Foreground")] },
  { id: "popover", title: "Popover", tokens: [color("popover", "Popover"), color("popover-foreground", "Popover Foreground")] },
  { id: "muted", title: "Muted", tokens: [color("muted", "Muted"), color("muted-foreground", "Muted Foreground")] },
  { id: "destructive", title: "Destructive", tokens: [color("destructive", "Destructive"), color("destructive-foreground", "Destructive Foreground")] },
  { id: "border-input", title: "Border, Input & Ring", tokens: [color("border", "Border"), color("input", "Input"), color("ring", "Ring")] },
  { id: "chart", title: "Chart Colors", tokens: [1, 2, 3, 4, 5].map((n) => color(`chart-${n}`, `Chart ${n}`)) },
  {
    id: "sidebar",
    title: "Sidebar Colors",
    tokens: [
      color("sidebar", "Sidebar"),
      color("sidebar-foreground", "Sidebar Foreground"),
      color("sidebar-primary", "Sidebar Primary"),
      color("sidebar-primary-foreground", "Sidebar Primary Foreground"),
      color("sidebar-accent", "Sidebar Accent"),
      color("sidebar-accent-foreground", "Sidebar Accent Foreground"),
      color("sidebar-border", "Sidebar Border"),
      color("sidebar-ring", "Sidebar Ring"),
    ],
  },
  {
    id: "radius-spacing",
    title: "Radius & Spacing",
    tokens: [
      { key: "radius", label: "Radius", type: "length", unit: "rem", min: 0, max: 2, step: 0.05 },
      { key: "spacing", label: "Spacing Unit", type: "length", unit: "rem", min: 0.1, max: 0.5, step: 0.025 },
    ],
  },
  {
    id: "typography",
    title: "Typography",
    tokens: [
      { key: "font-sans", label: "Sans Font", type: "font" },
      { key: "font-serif", label: "Serif Font", type: "font" },
      { key: "font-mono", label: "Mono Font", type: "font" },
      { key: "letter-spacing", label: "Letter Spacing", type: "length", unit: "em", min: -0.1, max: 0.1, step: 0.005 },
    ],
  },
  {
    id: "shadow",
    title: "Shadow",
    tokens: [
      { key: "shadow-color", label: "Color", type: "shadow-color" },
      { key: "shadow-opacity", label: "Opacity", type: "shadow-opacity", min: 0, max: 1, step: 0.01 },
      { key: "shadow-blur", label: "Blur", type: "shadow-length", min: 0, max: 40, step: 1 },
      { key: "shadow-spread", label: "Spread", type: "shadow-length", min: -20, max: 20, step: 1 },
      { key: "shadow-offset-x", label: "Offset X", type: "shadow-offset", min: -20, max: 20, step: 1 },
      { key: "shadow-offset-y", label: "Offset Y", type: "shadow-offset", min: -20, max: 20, step: 1 },
    ],
  },
]

// Every color-typed token key, in schema order — used by both the HSL
// adjustment engine (which tokens a hue/sat/lightness nudge applies to) and
// the randomizer (which tokens get a generated color vs. a plain number).
export const COLOR_TOKEN_KEYS: string[] = TOKEN_GROUPS.flatMap((g) => g.tokens.filter((t) => t.type === "color").map((t) => t.key))

export const SHADOW_BASE_KEYS = ["shadow-color", "shadow-opacity", "shadow-blur", "shadow-spread", "shadow-offset-x", "shadow-offset-y"] as const

export const FONT_PRESETS: { sans: Record<string, string>; serif: Record<string, string>; mono: Record<string, string> } = {
  sans: {
    "System Sans": 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    Inter: "Inter, ui-sans-serif, system-ui, sans-serif",
    Outfit: "Outfit, ui-sans-serif, system-ui, sans-serif",
    "Plus Jakarta Sans": '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
  },
  serif: {
    "System Serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    "Playfair Display": '"Playfair Display", ui-serif, Georgia, serif',
    Merriweather: "Merriweather, ui-serif, Georgia, serif",
  },
  mono: {
    "System Mono": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    "JetBrains Mono": '"JetBrains Mono", ui-monospace, monospace',
    "Fira Code": '"Fira Code", ui-monospace, monospace',
  },
}

export function fontCategoryForKey(key: string): keyof typeof FONT_PRESETS {
  if (key === "font-serif") return "serif"
  if (key === "font-mono") return "mono"
  return "sans"
}
