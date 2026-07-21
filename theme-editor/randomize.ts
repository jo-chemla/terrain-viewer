import { formatOklch } from "./color-math"
import { FONT_PRESETS } from "./token-schema"

function rand(min: number, max: number): number { return min + Math.random() * (max - min) }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function wrapHue(h: number): number { return ((h % 360) + 360) % 360 }
function col(l: number, c: number, h: number): string { return formatOklch({ l, c, h, alpha: 1 }) }

// A semantically-aware random palette, not per-token noise: one cohesive base
// hue drives background/foreground/base/border/chart-1/sidebar, with
// secondary/accent offset around the wheel for contrast, destructive always
// staying in the red range (a randomized "danger" color reads as a bug, not
// a feature), and every foreground paired with a lightness that actually
// contrasts its own background/surface color rather than being independently
// randomized (which would frequently produce unreadable pairs).
export function randomizeColors(isDark: boolean): Record<string, string> {
  const h0 = rand(0, 360)
  const hSecondary = wrapHue(h0 + rand(30, 60))
  const hAccent = wrapHue(h0 + rand(140, 220))
  const hDestructive = rand(10, 25)

  const bgL = isDark ? rand(0.14, 0.22) : rand(0.97, 0.99)
  const cardL = isDark ? bgL + rand(0.03, 0.06) : Math.max(0, bgL - rand(0.0, 0.01))
  const fgL = isDark ? rand(0.88, 0.95) : rand(0.15, 0.25)
  const mutedL = isDark ? rand(0.22, 0.28) : rand(0.94, 0.97)
  const mutedFgL = isDark ? rand(0.62, 0.72) : rand(0.45, 0.55)
  const borderL = isDark ? rand(0.28, 0.34) : rand(0.85, 0.90)
  const secondaryL = isDark ? rand(0.28, 0.36) : rand(0.85, 0.93)
  const accentL = isDark ? rand(0.30, 0.38) : rand(0.85, 0.93)

  const primaryL = rand(0.5, 0.68)
  const primaryC = rand(0.15, 0.26)
  const primaryFgL = primaryL < 0.6 ? rand(0.95, 0.99) : rand(0.08, 0.15)
  const destructiveL = rand(0.5, 0.62)
  const onSecondaryL = isDark ? rand(0.88, 0.95) : rand(0.20, 0.30)
  const onAccentL = isDark ? rand(0.90, 0.96) : rand(0.16, 0.24)

  return {
    background: col(bgL, isDark ? 0.008 : 0.004, h0),
    foreground: col(fgL, 0.02, h0),
    card: col(cardL, isDark ? 0.010 : 0.004, h0),
    "card-foreground": col(fgL, 0.02, h0),
    popover: col(isDark ? bgL + 0.02 : Math.min(1, bgL + 0.01), isDark ? 0.010 : 0.004, h0),
    "popover-foreground": col(fgL, 0.02, h0),
    primary: col(primaryL, primaryC, h0),
    "primary-foreground": col(primaryFgL, 0.01, h0),
    secondary: col(secondaryL, isDark ? 0.05 : 0.06, hSecondary),
    "secondary-foreground": col(onSecondaryL, 0.02, hSecondary),
    muted: col(mutedL, 0.008, h0),
    "muted-foreground": col(mutedFgL, 0.02, h0),
    accent: col(accentL, isDark ? 0.06 : 0.10, hAccent),
    "accent-foreground": col(onAccentL, 0.02, hAccent),
    destructive: col(destructiveL, rand(0.20, 0.27), hDestructive),
    "destructive-foreground": col(0.98, 0.01, hDestructive),
    border: col(borderL, 0.008, h0),
    input: col(borderL, 0.008, h0),
    ring: col(primaryL, primaryC * 0.9, h0),
    "chart-1": col(rand(0.55, 0.7), rand(0.15, 0.25), h0),
    "chart-2": col(rand(0.55, 0.7), rand(0.15, 0.25), wrapHue(h0 + 72)),
    "chart-3": col(rand(0.55, 0.7), rand(0.15, 0.25), wrapHue(h0 + 144)),
    "chart-4": col(rand(0.55, 0.7), rand(0.15, 0.25), wrapHue(h0 + 216)),
    "chart-5": col(rand(0.55, 0.7), rand(0.15, 0.25), wrapHue(h0 + 288)),
    sidebar: col(bgL, isDark ? 0.008 : 0.004, h0),
    "sidebar-foreground": col(fgL, 0.02, h0),
    "sidebar-primary": col(primaryL, primaryC, h0),
    "sidebar-primary-foreground": col(primaryFgL, 0.01, h0),
    "sidebar-accent": col(accentL, isDark ? 0.06 : 0.10, hAccent),
    "sidebar-accent-foreground": col(onAccentL, 0.02, hAccent),
    "sidebar-border": col(borderL, 0.008, h0),
    "sidebar-ring": col(primaryL, primaryC * 0.9, h0),
  }
}

const RADIUS_STEPS = [0, 0.25, 0.375, 0.5, 0.625, 0.75, 1]

// Kept tasteful on purpose (small ranges, neutral shadow color) rather than
// truly uniform-random — a wildly random blur/spread/offset reads as broken
// layout, not a "fun" theme.
export function randomizeOthers(): Record<string, string> {
  return {
    radius: `${pick(RADIUS_STEPS)}rem`,
    spacing: `${rand(0.2, 0.3).toFixed(3)}rem`,
    "letter-spacing": `${rand(-0.02, 0.02).toFixed(3)}em`,
    "font-sans": pick(Object.values(FONT_PRESETS.sans)),
    "font-serif": pick(Object.values(FONT_PRESETS.serif)),
    "font-mono": pick(Object.values(FONT_PRESETS.mono)),
    "shadow-color": "hsl(0 0% 0%)",
    "shadow-opacity": rand(0.05, 0.18).toFixed(2),
    "shadow-blur": `${Math.round(rand(0, 10))}px`,
    "shadow-spread": `${Math.round(rand(-2, 2))}px`,
    "shadow-offset-x": `${Math.round(rand(-2, 2))}px`,
    "shadow-offset-y": `${Math.round(rand(1, 6))}px`,
  }
}
