// The Hard Shadows sweep (computeShadowTile) and the ray march it replaced
// (computeShadowRowsMarch), on synthetic DEMs: a cone and a step (a straight
// cliff), at several sun directions, against a continuous ray (bilinear
// samples every half pixel, the DEM read as a bilinear surface). The march
// rounds each step to the nearest pixel: at azimuth 30 its first step looks
// due north, and it shadows cone flanks the sun actually lights; the sweep
// must be at least as close to the continuous ray. Offline, no app imports:
//   node scripts/test-lib.mjs lib/shadow-kernel.test.ts
//   node --test lib/shadow-kernel.test.ts   (Node 22.18+, type stripping)
import { test } from "node:test"
import assert from "node:assert/strict"
import { computeShadowTile, computeShadowRowsMarch, buildShadowRay, type ShadowKernelInput } from "./shadow-kernel.ts"

const N = 128, RADIUS = 96, RES = 10 // m per pixel

function input(height: (x: number, y: number) => number, azimuthDeg: number, altitudeDeg: number, radiusPx = RADIUS): ShadowKernelInput {
  const stride = N + 2 * radiusPx, padded = new Float32Array(stride * stride)
  for (let r = 0; r < stride; r++) for (let c = 0; c < stride; c++) padded[r * stride + c] = height(c - radiusPx, r - radiusPx)
  const az = (azimuthDeg * Math.PI) / 180
  return { padded, stride, n: N, radiusPx, dRow: -Math.cos(az), dCol: Math.sin(az), groundResM: RES, altitudeRad: (altitudeDeg * Math.PI) / 180 }
}
const sweep = (inp: ShadowKernelInput) => { const o = new Uint8ClampedArray(N * N * 4); computeShadowTile(inp, o); return o }
const march = (inp: ShadowKernelInput) => { const o = new Uint8ClampedArray(N * N * 4); computeShadowRowsMarch(inp, buildShadowRay(inp), 0, N, o); return o }
/** Continuous ray: bilinear samples every half pixel up to the radius. */
function reference(inp: ShadowKernelInput) {
  const { padded, stride, radiusPx: R, dRow, dCol, groundResM, altitudeRad } = inp, o = new Uint8ClampedArray(N * N * 4)
  const tanA = Math.tan(altitudeRad)
  const bil = (y: number, x: number) => {
    const x0 = Math.min(Math.max(Math.floor(x), 0), stride - 2), y0 = Math.min(Math.max(Math.floor(y), 0), stride - 2), fx = x - x0, fy = y - y0
    const i = y0 * stride + x0
    return (padded[i] * (1 - fx) + padded[i + 1] * fx) * (1 - fy) + (padded[i + stride] * (1 - fx) + padded[i + stride + 1] * fx) * fy
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const h = padded[(r + R) * stride + c + R]
    for (let s = 0.5; s <= R; s += 0.5) if (bil(r + R + s * dRow, c + R + s * dCol) > h + s * groundResM * tanA) { o[(r * N + c) * 4 + 3] = 255; break }
  }
  return o
}
const count = (o: Uint8ClampedArray) => { let s = 0; for (let i = 3; i < o.length; i += 4) if (o[i]) s++; return s }
function iou(p: Uint8ClampedArray, q: Uint8ClampedArray) { let both = 0, either = 0; for (let i = 3; i < p.length; i += 4) { if (p[i] && q[i]) both++; if (p[i] || q[i]) either++ } return either ? both / either : 1 }

// A cone 600 m high, 60 px base radius, centred in the tile.
const cone = (x: number, y: number) => Math.max(0, 600 - 10 * Math.hypot(x - N / 2, y - N / 2))
// A 300 m cliff along a line through the tile's centre, facing south-west
// (high ground to the north-east), on a gently tilted plain.
const step = (x: number, y: number) => ((x - N / 2) - (y - N / 2) > 0 ? 300 : 0) + 0.5 * x

const SUNS = [[135, 15], [150, 30], [0, 20], [30, 10], [45, 25], [200, 12], [270, 35], [313, 8]] as const

for (const [name, dem] of [["cone", cone], ["step", step]] as const) {
  test(`sweep matches a continuous ray on a ${name}, at least as well as the march`, () => {
    for (const [az, alt] of SUNS) {
      const inp = input(dem, az, alt), s = sweep(inp), m = march(inp), ref = reference(inp)
      const label = `${name} az ${az} alt ${alt}: sweep ${count(s)}, march ${count(m)}, continuous ${count(ref)} px`
      // Edges can move by about a pixel. A sun from the cliff's low side
      // leaves at most a one-pixel line at its foot (the DEM's ramp between
      // two pixel centres), which a sampling detail puts in or out: counts only.
      if (count(ref) < 2 * N) { assert.ok(count(s) <= 2 * N, label); continue }
      assert.ok(iou(s, ref) >= 0.97, `${label}; sweep IoU ${iou(s, ref).toFixed(3)}`)
      assert.ok(Math.abs(count(s) - count(ref)) <= 0.03 * count(ref), label)
      assert.ok(iou(s, ref) >= iou(m, ref) - 0.01, `${label}; sweep IoU ${iou(s, ref).toFixed(3)} < march ${iou(m, ref).toFixed(3)}`)
    }
  })
}

test("the step's shadow has the analytic length", () => {
  // Sun due north-east, straight over the cliff: the shadow on the low side
  // reaches 300 / tan(alt) metres from the cliff foot (more: the plain
  // tilts up 0.5 m per px eastward, which a sun from the north-east sees as a
  // rise of 0.5 / sqrt 2 per diagonal px). Shadow pixels on the tile's
  // diagonal (x = y), counted from the cliff: within two pixels.
  const alt = 30, inp = input(step, 45, alt), s = sweep(inp)
  const tanA = Math.tan((alt * Math.PI) / 180)
  let len = 0
  for (let d = 1; d < N / 2; d++) { const x = N / 2 - d, y = N / 2 + d; if (x < 0 || y >= N) break; if (s[(y * N + x) * 4 + 3]) len = d; else break }
  // Distance along the sun direction from (N/2 - d, N/2 + d) to the cliff: d * sqrt 2 px.
  const expected = 300 / (RES * tanA - 0.5 / Math.SQRT2) / Math.SQRT2
  assert.ok(Math.abs(len - expected) <= 2, `shadow ${len} px along the diagonal, expected ${expected.toFixed(1)}`)
})

test("reach is the radius, the same for every pixel (no seams)", () => {
  // A wall 1000 m high on the tile's north edge (rows above -40), sun due
  // north, 5°: the wall's shadow would be 1.1 km = 114 px; a radius of 64
  // cuts it at 64 px from the wall for every column.
  const wall = (_x: number, y: number) => (y < -40 ? 1000 : 0)
  const inp = input(wall, 0, 5, 64), s = sweep(inp), m = march(inp)
  for (const o of [s, m]) for (let c = 0; c < N; c++) {
    let rows = 0
    for (let r = 0; r < N; r++) if (o[(r * N + c) * 4 + 3]) rows++
    assert.equal(rows, 64 - 40, `column ${c}: ${rows} shadow rows`)
  }
})

test("sun overhead, flat ground, sun below the horizon", () => {
  assert.equal(count(sweep(input(cone, 135, 90))), 0)
  assert.equal(count(sweep(input(() => 120, 135, 10))), 0)
  assert.equal(count(march(input(() => 120, 135, 10))), 0)
  const below = input(cone, 135, -5)
  assert.ok(iou(sweep(below), reference(below)) >= 0.97)
})
