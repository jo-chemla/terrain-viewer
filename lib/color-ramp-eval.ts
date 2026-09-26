// Evaluates a mode layer's color-relief ramp on the CPU, so a colour-mapped
// export uses exactly what the map shows: the ramp, its bounds, symmetric and
// inverted settings are all already baked into the layer's
// `color-relief-color` expression (lib/color-ramps.ts builds it). Supports the
// two shapes that builder produces: ["interpolate", ["linear"], input, v, c, ...]
// and ["step", input, c0, v1, c1, ...].

type Rgba = [number, number, number, number]

let parseCanvas: CanvasRenderingContext2D | null = null
/** Any CSS colour (or a [r, g, b, a?] array) to 0-255 RGBA, via the canvas's
 *  own parser so every notation MapLibre accepts works. */
function parseColor(c: unknown): Rgba {
  if (Array.isArray(c)) return [c[0], c[1], c[2], Math.round((c[3] ?? 1) * 255)]
  if (!parseCanvas) {
    const cv = document.createElement("canvas")
    cv.width = cv.height = 1
    parseCanvas = cv.getContext("2d", { willReadFrequently: true })!
  }
  parseCanvas.clearRect(0, 0, 1, 1)
  parseCanvas.fillStyle = "#000000"
  parseCanvas.fillStyle = String(c)
  parseCanvas.fillRect(0, 0, 1, 1)
  const d = parseCanvas.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

export type RampFn = (value: number) => Rgba

/** A function from a (tile-encoded) value to RGBA, or null if the
 *  expression is not one of the two supported shapes. */
export function compileRamp(expr: unknown): RampFn | null {
  if (!Array.isArray(expr)) return null
  if (expr[0] === "interpolate") {
    const stops: number[] = []
    const colors: Rgba[] = []
    for (let i = 3; i + 1 < expr.length; i += 2) { stops.push(Number(expr[i])); colors.push(parseColor(expr[i + 1])) }
    if (!stops.length) return null
    return (v) => {
      if (!(v > stops[0])) return colors[0]
      const last = stops.length - 1
      if (v >= stops[last]) return colors[last]
      let k = 1
      while (stops[k] < v) k++
      const t = (v - stops[k - 1]) / (stops[k] - stops[k - 1] || 1)
      const a = colors[k - 1], b = colors[k]
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
    }
  }
  if (expr[0] === "step") {
    const base = parseColor(expr[2])
    const stops: number[] = []
    const colors: Rgba[] = []
    for (let i = 3; i + 1 < expr.length; i += 2) { stops.push(Number(expr[i])); colors.push(parseColor(expr[i + 1])) }
    return (v) => {
      let c = base
      for (let k = 0; k < stops.length && v >= stops[k]; k++) c = colors[k]
      return c
    }
  }
  return null
}

/** Colours a float grid with a ramp; NaN (nodata) becomes transparent. */
export function colorize(values: Float32Array, ramp: RampFn): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) continue
    const c = ramp(v)
    const o = i * 4
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3]
  }
  return out
}
