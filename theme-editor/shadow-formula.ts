import { parseColorToOklch, formatOklch } from "./color-math"

export type ShadowBase = {
  color: string
  opacity: number
  blur: number
  spread: number
  offsetX: number
  offsetY: number
}

// Reverse-engineered empirically (not guessed) from tweakcn's own generated
// preset CSS: compared the 6 base --shadow-* params against the 8 derived
// --shadow-2xs..2xl box-shadow strings across half a dozen structurally very
// different presets (different blur/spread/offset/opacity/color-space
// combinations) and found the per-tier deltas below are constant regardless
// of the base values — i.e. these are fixed tier multipliers/deltas, not
// something scaled from the user's own numbers except where noted.
const TIERS: Record<string, { opacityMul: number; ambient?: { offsetY: number; blur: number } }> = {
  "2xs": { opacityMul: 0.5 },
  xs: { opacityMul: 0.5 },
  sm: { opacityMul: 1, ambient: { offsetY: 1, blur: 2 } },
  DEFAULT: { opacityMul: 1, ambient: { offsetY: 1, blur: 2 } },
  md: { opacityMul: 1, ambient: { offsetY: 2, blur: 4 } },
  lg: { opacityMul: 1, ambient: { offsetY: 4, blur: 6 } },
  xl: { opacityMul: 1, ambient: { offsetY: 8, blur: 10 } },
  "2xl": { opacityMul: 2.5 },
}

export const SHADOW_TIER_KEYS = ["2xs", "xs", "sm", "DEFAULT", "md", "lg", "xl", "2xl"] as const

// The CSS custom property name for each tier — "DEFAULT" maps to bare
// "--shadow", everything else to "--shadow-<tier>".
export function shadowVarName(tier: (typeof SHADOW_TIER_KEYS)[number]): string {
  return tier === "DEFAULT" ? "--shadow" : `--shadow-${tier}`
}

function layer(offsetX: number, offsetY: number, blur: number, spread: number, baseColor: ReturnType<typeof parseColorToOklch>, alpha: number): string {
  return `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${formatOklch({ ...baseColor, alpha })}`
}

// Builds all 8 derived --shadow-* values from the 6 editable base params —
// these 8 are the ones consumed by shadcn's card/popover/etc. component
// styles; the base 6 only exist to generate them and aren't used directly.
export function deriveShadowTiers(base: ShadowBase): Record<string, string> {
  const { color, opacity, blur, spread, offsetX, offsetY } = base
  // Parsed once — any alpha embedded in the base color string is discarded here
  // (each tier supplies its own final alpha), matching tweakcn's own output.
  const baseColor = parseColorToOklch(color)
  const out: Record<string, string> = {}
  for (const tier of SHADOW_TIER_KEYS) {
    const cfg = TIERS[tier]
    const mainLayer = layer(offsetX, offsetY, blur, spread, baseColor, opacity * cfg.opacityMul)
    const value = cfg.ambient
      ? `${mainLayer}, ${layer(offsetX, cfg.ambient.offsetY, cfg.ambient.blur, spread - 1, baseColor, opacity * cfg.opacityMul)}`
      : mainLayer
    out[shadowVarName(tier)] = value
  }
  return out
}
