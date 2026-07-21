// Zero-dependency OKLCH <-> sRGB hex conversion, so this package never needs a
// color library as a peer dependency. Matrices are Björn Ottosson's published
// OKLab reference (https://bottosson.github.io/posts/oklab/) — the same ones
// browsers/colorjs.io/culori use, not something derived or approximated here.

export type Oklch = { l: number; c: number; h: number; alpha: number }

function srgbToLinear(x: number): number {
  const abs = Math.abs(x)
  return abs <= 0.04045 ? x / 12.92 : Math.sign(x) * Math.pow((abs + 0.055) / 1.055, 2.4)
}

function linearToSrgb(x: number): number {
  const abs = Math.abs(x)
  return abs > 0.0031308 ? Math.sign(x) * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : x * 12.92
}

function linearSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ]
}

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

export function hexToOklch(hex: string): Oklch {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const [L, a2, b2] = linearSrgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))
  const c = Math.sqrt(a2 * a2 + b2 * b2)
  let h = (Math.atan2(b2, a2) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h, alpha: 1 }
}

export function oklchToHex({ l, c, h, alpha }: Oklch): string {
  const hRad = (h * Math.PI) / 180
  const a2 = c * Math.cos(hRad)
  const b2 = c * Math.sin(hRad)
  const [rl, gl, bl] = oklabToLinearSrgb(l, a2, b2)
  const toByte = (x: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(x))) * 255)
  const r = toByte(rl), g = toByte(gl), b = toByte(bl)
  const hex = (n: number) => n.toString(16).padStart(2, "0")
  const base = `#${hex(r)}${hex(g)}${hex(b)}`
  return alpha < 1 ? `${base}${hex(Math.round(alpha * 255))}` : base
}

// Formats an Oklch value the way tweakcn's own preset CSS does: bare
// "oklch(L C H)" when fully opaque, "oklch(L C H / A)" otherwise. Fixed
// decimal precision keeps generated CSS readable and diff-friendly.
export function formatOklch({ l, c, h, alpha }: Oklch): string {
  const nums = `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`
  return alpha >= 1 ? `oklch(${nums})` : `oklch(${nums} / ${round(alpha, 3)})`
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

// Parses any of oklch()/hsl()/rgb()/hex the preset CSS files might use for a
// color token, extracting a best-effort Oklch. Anything already in oklch()
// round-trips exactly; other spaces go through a coarse approximation (hue/
// lightness may drift slightly) since editing always re-emits oklch() anyway.
export function parseColorToOklch(value: string): Oklch {
  const v = value.trim()
  const oklchMatch = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i)
  if (oklchMatch) {
    return { l: parseFloat(oklchMatch[1]), c: parseFloat(oklchMatch[2]), h: parseFloat(oklchMatch[3]), alpha: oklchMatch[4] !== undefined ? parseFloat(oklchMatch[4]) : 1 }
  }
  if (v.startsWith("#")) return hexToOklch(v)
  // Fallback: let the browser resolve any other CSS color syntax (hsl/rgb/named)
  // to rgb(), then convert that. Requires a DOM (fine — this package is browser-only).
  if (typeof document !== "undefined") {
    const probe = document.createElement("div")
    probe.style.color = v
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    document.body.removeChild(probe)
    const m = resolved.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (m) {
      const hex = `#${[m[1], m[2], m[3]].map((n) => Math.round(parseFloat(n)).toString(16).padStart(2, "0")).join("")}`
      const oklch = hexToOklch(hex)
      if (m[4] !== undefined) oklch.alpha = parseFloat(m[4])
      return oklch
    }
  }
  return { l: 0.5, c: 0, h: 0, alpha: 1 }
}
