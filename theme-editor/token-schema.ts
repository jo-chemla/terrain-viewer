import type { TokenGroup } from "./types"

const color = (key: string, label: string) => ({ key, label, type: "color" as const })

// Full parity with tweakcn.com's own editor — every CSS custom property its
// "Colors" / "Radius" / "Spacing" / "Typography" / "Shadow" panels expose,
// grouped the same way. See shadow-formula.ts for why the 8 --shadow-2xs..2xl
// values aren't listed here: they're computed from the 6 base shadow tokens
// in the "Shadow" group below, not edited directly (matching tweakcn, whose
// shadow-control.tsx only ever takes those 6 inputs too).
export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: "base",
    title: "Base Colors",
    tokens: [
      color("background", "Background"),
      color("foreground", "Foreground"),
      color("card", "Card"),
      color("card-foreground", "Card Foreground"),
      color("popover", "Popover"),
      color("popover-foreground", "Popover Foreground"),
      color("primary", "Primary"),
      color("primary-foreground", "Primary Foreground"),
      color("secondary", "Secondary"),
      color("secondary-foreground", "Secondary Foreground"),
      color("muted", "Muted"),
      color("muted-foreground", "Muted Foreground"),
      color("accent", "Accent"),
      color("accent-foreground", "Accent Foreground"),
      color("destructive", "Destructive"),
      color("destructive-foreground", "Destructive Foreground"),
      color("border", "Border"),
      color("input", "Input"),
      color("ring", "Ring"),
    ],
  },
  {
    id: "chart",
    title: "Chart Colors",
    tokens: [1, 2, 3, 4, 5].map((n) => color(`chart-${n}`, `Chart ${n}`)),
  },
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
      { key: "letter-spacing", label: "Letter Spacing", type: "length", unit: "em", min: -0.1, max: 0.1, step: 0.005 },
    ],
  },
  {
    id: "typography",
    title: "Typography",
    tokens: [
      { key: "font-sans", label: "Sans Font", type: "font" },
      { key: "font-serif", label: "Serif Font", type: "font" },
      { key: "font-mono", label: "Mono Font", type: "font" },
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

export const SHADOW_BASE_KEYS = ["shadow-color", "shadow-opacity", "shadow-blur", "shadow-spread", "shadow-offset-x", "shadow-offset-y"] as const

export const FONT_PRESETS: Record<string, string> = {
  "System Sans": 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  "System Serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  "System Mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
  Inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  "Playfair Display": "\"Playfair Display\", ui-serif, Georgia, serif",
  "JetBrains Mono": "\"JetBrains Mono\", ui-monospace, monospace",
}
