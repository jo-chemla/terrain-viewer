// The River REM's color: a ramp stretched over [min, max] metres above the
// river. RiverREM colors on a log scale from zero (RasterViz._get_cmap_txt:
// 255 colors at logspace(0, log10(max)) - 1), so most of the ramp is spent in
// the first metre or two above the water, where the floodplain's forms are.
// MapLibre's color-relief only interpolates linearly between stops, so the
// stretch is baked into where the stops are put.

import chroma from "chroma-js"

export type RemStretch = "log" | "power" | "linear"

/** Position along the ramp (0..1) of a height `t` (0..1 of the range).
 *  log: ln(1 + t·range) / ln(1 + range), RiverREM's curve; power: t^gamma. */
export function remStretchPosition(t: number, stretch: RemStretch, range: number, gamma: number): number {
  const c = Math.min(1, Math.max(0, t))
  if (stretch === "log") return range > 0 ? Math.log1p(c * range) / Math.log1p(range) : c
  if (stretch === "power") return Math.pow(c, gamma > 0 ? gamma : 1)
  return c
}

/** Its inverse: the height (0..1 of the range) drawn at ramp position `u`. */
export function remStretchInverse(u: number, stretch: RemStretch, range: number, gamma: number): number {
  const c = Math.min(1, Math.max(0, u))
  if (stretch === "log") return range > 0 ? Math.expm1(c * Math.log1p(range)) / range : c
  if (stretch === "power") return Math.pow(c, 1 / (gamma > 0 ? gamma : 1))
  return c
}

/** A `color-relief-color` expression for a ramp (any of lib/color-ramps.ts's
 *  ["interpolate", ["linear"], ["elevation"], v, color, ...]) spread over
 *  [min, max] with the stretch: the ramp is read at `steps` + 1 even
 *  positions and each color is placed at the height that maps to it. */
export function buildRemColorExpression(
  rampColors: unknown[], min: number, max: number, stretch: RemStretch, gamma: number, invert: boolean, steps = 32,
): unknown[] {
  const stops: number[] = [], colors: string[] = []
  // Both shapes (interpolate, step) carry their value/color pairs from index 3.
  for (let i = 3; i + 1 < rampColors.length; i += 2) { stops.push(Number(rampColors[i])); colors.push(String(rampColors[i + 1])) }
  const lo = Math.min(min, max), hi = Math.max(min, max)
  const range = Math.max(hi - lo, 1e-6)
  const expr: unknown[] = ["interpolate", ["linear"], ["elevation"]]
  if (stops.length < 2) { expr.push(lo, colors[0] ?? "#000000", lo + range, colors[0] ?? "#000000"); return expr }
  const s0 = stops[0], s1 = stops[stops.length - 1]
  const scale = chroma.scale(colors).domain(stops.map((s) => (s - s0) / (s1 - s0 || 1))).mode("rgb")
  let previous = -Infinity
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    let value = lo + range * remStretchInverse(u, stretch, range, gamma)
    if (!(value > previous)) value = previous + range * 1e-6
    previous = value
    const [r, g, b, a] = scale(invert ? 1 - u : u).rgba()
    expr.push(value, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})`)
  }
  return expr
}
