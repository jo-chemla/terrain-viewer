// The horizon kernel (sky view factor, openness) and the local dominance
// kernel against the straightforward per-pixel loops they replaced
// (2026-11-25: rays swept a row at a time, duplicate steps dropped, far-ring
// and ancestor bilinear taps made per column and per row, one atan per
// direction, svf's sin(atan(t)) as t / sqrt(1 + t²)). The Terrarium bytes
// must be the same. Offline, no app imports:
//   node scripts/test-lib.mjs lib/horizon-kernel.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { computeHorizonRows, type HorizonKernelInput, type HorizonFarRing } from "./horizon-kernel.ts"
import { computeLocalDominanceRows, type LocalDominanceKernelInput } from "./local-dominance-kernel.ts"

const N = 96

function bilinear(padded: Float32Array, stride: number, px: number, py: number): number {
  const gx = px + 1, gy = py + 1, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, max = stride - 1
  const c = (v: number) => (v < 0 ? 0 : v > max ? max : v)
  const x0c = c(x0), x1c = c(x0 + 1), y0c = c(y0), y1c = c(y0 + 1)
  return padded[y0c * stride + x0c] * (1 - fx) * (1 - fy) + padded[y0c * stride + x1c] * fx * (1 - fy)
    + padded[y1c * stride + x0c] * (1 - fx) * fy + padded[y1c * stride + x1c] * fx * fy
}
function terrarium(out: Uint8ClampedArray, idx: number, value: number) {
  const v = value + 32768
  out[idx] = Math.floor(v / 256); out[idx + 1] = Math.floor(v % 256); out[idx + 2] = Math.floor((v - Math.floor(v)) * 256); out[idx + 3] = 255
}

/** The loop before 2026-11-25, per pixel and direction. */
function horizonReference(inp: HorizonKernelInput): Uint8ClampedArray {
  const { padded, stride, n, nearRadiusPx: R, groundResolutionM, sign, fast, aggregate, farRings } = inp
  const out = new Uint8ClampedArray(n * n * 4)
  const steps: number[] = []
  if (fast) { for (let r = 1; r <= R; r *= 2) steps.push(r); if (steps[steps.length - 1] !== R) steps.push(R) } else for (let r = 1; r <= R; r++) steps.push(r)
  const dirs = Array.from({ length: 8 }, (_, i) => [Math.sin((2 * Math.PI * i) / 8), Math.cos((2 * Math.PI * i) / 8)])
  const subs = dirs.map(([dr, dc]) => [-0.3, 0, 0.3].map((s) => [dr * Math.cos(s) + dc * Math.sin(s), dc * Math.cos(s) - dr * Math.sin(s)]))
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const base = (row + R) * stride + col + R, center = padded[base], angles: number[] = []
    for (let i = 0; i < 8; i++) {
      let maxT = -Infinity
      for (const r of steps) {
        const rr = Math.round(r * dirs[i][0]), rc = Math.round(r * dirs[i][1]), dist = Math.sqrt(rr * rr + rc * rc) * groundResolutionM
        if (dist === 0) continue
        const t = (padded[base + rr * stride + rc] - center) * sign * (1 / dist)
        if (t > maxT) maxT = t
      }
      angles.push(maxT === -Infinity ? 0 : Math.atan(maxT))
    }
    for (const ring of farRings) {
      const ax = (ring.xOffsetTiles * n + col + 0.5) / ring.scale - 0.5, ay = (ring.yOffsetTiles * n + row + 0.5) / ring.scale - 0.5
      for (let i = 0; i < 8; i++) {
        let maxDiff = -Infinity
        for (const [sr, sc] of subs[i]) { const d = (bilinear(ring.padded, ring.stride, ax + sc, ay + sr) - center) * sign; if (d > maxDiff) maxDiff = d }
        if (maxDiff !== -Infinity) { const a = Math.atan(maxDiff / ring.distM); if (a > angles[i]) angles[i] = a }
      }
    }
    let s = 0
    for (const a of angles) s += aggregate === "svf" ? Math.sin(a > 0 ? a : 0) : a
    terrarium(out, (row * n + col) * 4, aggregate === "svf" ? (1 - s / 8) * 100 : -(s / 8) * (180 / Math.PI))
  }
  return out
}

/** A rough surface: a ridge, a pit and pseudo-random noise, metres. */
const surface = (x: number, y: number, k = 1) => 1500 + 400 * Math.sin(x * 0.04 * k) * Math.cos(y * 0.03) - 300 * Math.exp(-((x - 40) ** 2 + (y - 50) ** 2) / 300) + 15 * Math.sin(x * 12.9898 + y * 78.233 * k)
function grid(side: number, f: (x: number, y: number) => number, offset: number) {
  const g = new Float32Array(side * side)
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) g[r * side + c] = f(c - offset, r - offset)
  return g
}
function farRing(scale: number): HorizonFarRing {
  const stride = N + 2
  return { padded: grid(stride, (x, y) => surface(x * scale, y * scale, 0.3), 1), stride, scale, xOffsetTiles: 1, yOffsetTiles: scale - 1, distM: scale * 12 }
}
function horizonInput(R: number, fast: boolean, aggregate: "svf" | "openness", sign: 1 | -1, far: boolean): HorizonKernelInput {
  const stride = N + 2 * R
  return { padded: grid(stride, surface, R), stride, n: N, nearRadiusPx: R, groundResolutionM: 12, sign, fast, aggregate, farRings: far ? [farRing(16), farRing(32)] : [] }
}

for (const [R, fast, aggregate, sign, far] of [
  [8, false, "svf", 1, false], [20, false, "svf", 1, false], [8, false, "openness", 1, false], [13, false, "openness", -1, false],
  [8, true, "svf", 1, true], [8, true, "openness", 1, true], [8, true, "openness", -1, true],
] as const) {
  test(`horizon kernel: ${aggregate}${sign < 0 ? " (negative)" : ""} r = ${R} ${fast ? "fast, far rings" : "precise"}: the same bytes`, () => {
    const inp = horizonInput(R, fast, aggregate, sign, far)
    const out = new Uint8ClampedArray(N * N * 4)
    // In bands, as the protocol calls it between yields.
    for (let row = 0; row < N; row += 16) computeHorizonRows(inp, row, Math.min(N, row + 16), out)
    const ref = horizonReference(inp)
    let diff = 0
    for (let i = 0; i < out.length; i++) if (out[i] !== ref[i]) diff++
    assert.equal(diff, 0, `${diff} bytes differ`)
  })
}

/** Local dominance before 2026-11-25: bilinearSamplePadded per pixel. */
function localDominanceReference(inp: LocalDominanceKernelInput): Uint8ClampedArray {
  const { center, centerWidth, n, levels } = inp, out = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const obs = center[row * centerWidth + col] + 1.6
    let sum = 0
    for (const l of levels) {
      const pcx = (l.xOffsetTiles * n + col + 0.5) / l.scale - 0.5, pcy = (l.yOffsetTiles * n + row + 0.5) / l.scale - 0.5
      for (let d = 0; d < 8; d++) {
        const a = (2 * Math.PI * d) / 8
        sum += Math.atan((obs - bilinear(l.padded, l.stride, pcx + Math.cos(a), pcy + Math.sin(a))) * l.invDist)
      }
    }
    const count = levels.length * 8
    terrarium(out, (row * n + col) * 4, count > 0 ? (sum / count) * (180 / Math.PI) : 0)
  }
  return out
}

test("local dominance kernel: the same bytes", () => {
  const levels = [3, 4, 5].map((k) => {
    const scale = 1 << k, stride = N + 2
    return { padded: grid(stride, (x, y) => surface(x * scale, y * scale, 0.5), 1), stride, scale, xOffsetTiles: 2, yOffsetTiles: scale - 3, invDist: 1 / (scale * 12) }
  })
  const inp: LocalDominanceKernelInput = { center: grid(N, surface, 0), centerWidth: N, n: N, levels }
  const out = new Uint8ClampedArray(N * N * 4)
  for (let row = 0; row < N; row += 16) computeLocalDominanceRows(inp, row, Math.min(N, row + 16), out)
  const ref = localDominanceReference(inp)
  let diff = 0
  for (let i = 0; i < out.length; i++) if (out[i] !== ref[i]) diff++
  assert.equal(diff, 0, `${diff} bytes differ`)
})
