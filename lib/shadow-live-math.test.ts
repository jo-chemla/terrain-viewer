// Run with: node scripts/test-lib.mjs lib/shadow-live-math.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  sunStepVector, sunTanAltitude, shadowStep, shadowStepsToReach, SHADOW_STEP_GROWTH, SHADOW_MAX_STEPS, SHADOW_MOSAIC_MAX_SIDE,
  chooseMosaicLayout, layoutContains, lngLatToMercator, marchShadowCpu,
  sunVisibilityCpu, texelGroundMeters, curvatureDrop, chooseFarLayout, farTransform,
  CURVATURE_PER_M2, SUN_RADIUS_DEG, FAR_LEVELS,
  type ElevationGrid, type SunMarchOptions, type MosaicLayout,
} from "./shadow-live-math"
import { computeShadowTile } from "./shadow-kernel"

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test("sun step vector: north is up (−y), east is +x, same as shadow-protocol's (dCol, dRow)", () => {
  const n = sunStepVector(0); close(n[0], 0); close(n[1], -1)
  const e = sunStepVector(90); close(e[0], 1); close(e[1], 0)
  const s = sunStepVector(180); close(s[0], 0); close(s[1], 1)
  const se = sunStepVector(135); close(se[0], Math.SQRT1_2); close(se[1], Math.SQRT1_2)
  for (const az of [0, 37, 135, 251, 359]) {
    const [x, y] = sunStepVector(az)
    close(Math.hypot(x, y), 1)
    close(x, Math.sin((az * Math.PI) / 180)); close(y, -Math.cos((az * Math.PI) / 180))
  }
})

test("tan altitude: negative at night, finite at the zenith", () => {
  assert.ok(sunTanAltitude(-5) < 0)
  close(sunTanAltitude(45), 1, 1e-12)
  assert.equal(sunTanAltitude(90), 1e6)
})

test("step schedule: one-texel steps first, then geometric growth, reaching the mosaic diagonal", () => {
  const firstUnit = 1 / SHADOW_STEP_GROWTH
  let d = 0
  for (let i = 0; i < firstUnit; i++) { assert.equal(shadowStep(d), 1); d += shadowStep(d) }
  assert.equal(d, firstUnit)
  assert.ok(shadowStep(1000) > 20 && shadowStep(1000) < 30)
  assert.equal(shadowStepsToReach(10), 10)
  assert.ok(shadowStepsToReach(firstUnit * 2) < firstUnit * 2)
  // The shader's loop bound reaches the diagonal of the largest mosaic, in a few hundred steps.
  let reach = 0
  for (let i = 0; i < SHADOW_MAX_STEPS; i++) reach += shadowStep(reach)
  assert.ok(reach >= SHADOW_MOSAIC_MAX_SIDE * Math.SQRT2)
  assert.ok(SHADOW_MAX_STEPS < 400, `${SHADOW_MAX_STEPS} steps`)
})

test("mosaic layout: view tiles plus a margin, coarser until it fits", () => {
  // A 3 x 2 tile view at z12 (512 px tiles, map zoom 12).
  const s = 2 ** 12
  const b = { x0: 2000.2 / s, y0: 1400.5 / s, x1: 2002.7 / s, y1: 1401.9 / s }
  const l = chooseMosaicLayout(b, 12, 512)!
  assert.deepEqual(l, { z: 12, x0: 1999, y0: 1399, nx: 5, ny: 4 })
  // 256 px tiles: one zoom finer (z13), 8 x 6 = 48 tiles, still fits.
  assert.equal(chooseMosaicLayout(b, 12, 256)!.z, 13)
  // A tiny tile budget forces a coarser zoom.
  const coarse = chooseMosaicLayout(b, 12, 512, { maxTiles: 9 })!
  assert.ok(coarse.z < 12 && coarse.nx * coarse.ny <= 9)
  // Bounds exactly on tile edges do not pull in the next tile.
  const edge = chooseMosaicLayout({ x0: 10 / 1024, y0: 10 / 1024, x1: 12 / 1024, y1: 12 / 1024 }, 10, 512, { margin: 0 })!
  assert.deepEqual(edge, { z: 10, x0: 10, y0: 10, nx: 2, ny: 2 })
  // Hysteresis: a preferred zoom within 0.75 is kept.
  assert.equal(chooseMosaicLayout(b, 12.6, 512, { preferZ: 12 })!.z, 12)
  assert.equal(chooseMosaicLayout(b, 12.6, 512)!.z, 13)
  // maxzoom caps the zoom.
  assert.equal(chooseMosaicLayout(b, 12, 512, { maxzoom: 11 })!.z, 11)
  // The y range is clamped to the world.
  const top = chooseMosaicLayout({ x0: 0.4, y0: 0, x1: 0.41, y1: 0.001 }, 8, 512)!
  assert.equal(top.y0, 0)
})

test("layoutContains: same zoom, inner rectangle, unwrapped x except a whole-world mosaic", () => {
  const outer = { z: 4, x0: 14, y0: 5, nx: 4, ny: 3 }
  assert.ok(layoutContains(outer, { z: 4, x0: 15, y0: 6, nx: 2, ny: 2 }))
  assert.ok(!layoutContains(outer, { z: 4, x0: 15, y0: 6, nx: 4, ny: 2 }))
  assert.ok(!layoutContains(outer, { z: 5, x0: 15, y0: 6, nx: 1, ny: 1 }))
  // x 0..1 is another world copy of x 16..17 (16 tiles at z4): not contained.
  assert.ok(!layoutContains(outer, { z: 4, x0: 0, y0: 6, nx: 2, ny: 1 }))
  assert.ok(layoutContains({ z: 2, x0: 0, y0: 0, nx: 4, ny: 4 }, { z: 2, x0: 5, y0: 1, nx: 2, ny: 2 }))
})

test("lngLatToMercator", () => {
  const [x, y] = lngLatToMercator(0, 0); close(x, 0.5); close(y, 0.5)
  const [x2] = lngLatToMercator(-180, 10); close(x2, 0)
})

test("march: a 0.5 m plateau edge still casts a shadow (no tolerance), and stops above the view's top", () => {
  // 64 x 8 grid, 1 m texels: a 0.5 m step at x >= 40, sun in the east at 1°.
  const w = 64, h = 8
  const grid = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 40; x < w; x++) grid[y * w + x] = 0.5
  // tan(1°) * 1 m ≈ 0.0175 m per texel: the 0.5 m edge shades about 28 m below it.
  assert.equal(marchShadowCpu(grid, w, h, 30.5, 4.5, 90, 1, 1, 0.5), true)
  assert.equal(marchShadowCpu(grid, w, h, 5.5, 4.5, 90, 1, 1, 0.5), false)
  // On the plateau itself, lit.
  assert.equal(marchShadowCpu(grid, w, h, 50.5, 4.5, 90, 1, 1, 0.5), false)
  // Sun in the west: the low ground is lit.
  assert.equal(marchShadowCpu(grid, w, h, 30.5, 4.5, 270, 1, 1, 0.5), false)
  // Night shades everything.
  assert.equal(marchShadowCpu(grid, w, h, 50.5, 4.5, 90, -2, 1, 0.5), true)
  // A wrong (too low) max height makes the early exit fire: documents that the
  // layer must pass the true maximum of the mosaic.
  assert.equal(marchShadowCpu(grid, w, h, 30.5, 4.5, 90, 1, 1, 0.01), false)
})

// ─── Sun direction, scale and units: a synthetic cliff through the shader's math ───
// The cliff runs across the sun direction through the grid's centre, high
// ground on the sun's side. Under a sun at altitude a, the shadow on the low
// ground ends h / tan(a) metres from the cliff on a flat Earth, and where
// L tan(a) + curvatureDrop(L) = h with curvature. Measured by moving a
// fragment down-sun from the cliff, in texels, times the ground size of a
// texel at its latitude (texelGroundMeters): checks the azimuth convention
// (compass, toward the sun), the altitude (degrees in, radians in the
// march), the Mercator scale (1 / cos(lat)) and metres for heights.

/** A w × h Mercator grid at zoom z (512 px tiles) centred on (6.86° E, lat), with a
 *  cliff of height H across the sun direction through its centre, high on the sun's side. */
function cliffGrid(w: number, z: number, latDeg: number, azimuthDeg: number, H: number): ElevationGrid {
  const [sx, sy] = sunStepVector(azimuthDeg)
  const mercPerTexel = 1 / (512 * 2 ** z)
  const [mxc, myc] = lngLatToMercator(6.86, latDeg)
  const mx0 = mxc - (w / 2) * mercPerTexel, mercY0 = myc - (w / 2) * mercPerTexel
  const data = new Float32Array(w * w)
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const tx = (mx0 + (x + 0.5) * mercPerTexel - mxc) / mercPerTexel, ty = (mercY0 + (y + 0.5) * mercPerTexel - myc) / mercPerTexel
    data[y * w + x] = tx * sx + ty * sy > 0 ? H : 0
  }
  return { data, w, h: w, mercY0, mercPerTexel, maxElev: H }
}

/** The farthest texel distance down-sun from the cliff (along the sun line through the centre) still in shadow. */
function shadowReachTexels(grid: ElevationGrid, azimuthDeg: number, opts: Omit<SunMarchOptions, "azimuthDeg">, maxT: number): number {
  const [sx, sy] = sunStepVector(azimuthDeg)
  let last = 0
  for (let t = 1; t <= maxT; t++) {
    if (sunVisibilityCpu(grid, grid.w / 2 - sx * t, grid.h / 2 - sy * t, { azimuthDeg, ...opts }) < 0.5) last = t
  }
  return last
}
const metresAt = (grid: ElevationGrid, py: number) => texelGroundMeters(grid.mercY0 + py * grid.mercPerTexel, grid.mercPerTexel)

test("cliff: shadow length = h / tan(alt) in metres, for several suns, through the shader's math", () => {
  // z13, 512 px tiles, at 46° N (Chamonix): 6.64 m texels.
  const W = 1500, H = 300
  for (const az of [0, 45, 135, 200, 290]) {
    const grid = cliffGrid(W, 13, 46, az, H)
    const sy = sunStepVector(az)[1]
    for (const alt of [5, 15, 30, 60]) {
      const t = shadowReachTexels(grid, az, { altitudeDeg: alt }, 700)
      const mpt = metresAt(grid, W / 2 - sy * t)
      const got = t * mpt, want = H / Math.tan((alt * Math.PI) / 180)
      assert.ok(Math.abs(got - want) <= Math.max(2 * mpt, 0.03 * want), `az ${az} alt ${alt}: ${got.toFixed(0)} m, want ${want.toFixed(0)} m (${mpt.toFixed(2)} m/texel)`)
    }
  }
})

test("texel size: 1 / cos(lat) Mercator scale, the same as groundResolutionM", () => {
  const z = 13, n = 512, mercPerTexel = 1 / (n * 2 ** z)
  for (const lat of [0, 30, 46, 60, 75]) {
    const [, my] = lngLatToMercator(0, lat)
    const want = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (n * 2 ** z)
    close(texelGroundMeters(my, mercPerTexel), want, want * 1e-6)
  }
})

test("curvature: a 2 000 m ridge under a 1° sun shades 86 km, not 115 km", () => {
  close(curvatureDrop(10000), (10000 ** 2 * (1 - 0.13)) / (2 * 6371008.8), 1e-9)
  assert.ok(curvatureDrop(50000) > 160 && curvatureDrop(50000) < 180)
  // z9, 512 px tiles: 106 m texels at 46° N.
  const az = 250, H = 2000, alt = 1, W = 2600
  const grid = cliffGrid(W, 9, 46, az, H)
  const sy = sunStepVector(az)[1]
  const tanA = Math.tan((alt * Math.PI) / 180)
  for (const [curvature, want] of [
    [0, H / tanA],
    [CURVATURE_PER_M2, (-tanA + Math.sqrt(tanA * tanA + 4 * CURVATURE_PER_M2 * H)) / (2 * CURVATURE_PER_M2)],
  ] as const) {
    const t = shadowReachTexels(grid, az, { altitudeDeg: alt, curvature }, 1250)
    const got = t * metresAt(grid, W / 2 - sy * t)
    assert.ok(Math.abs(got - want) <= 0.03 * want, `curvature ${curvature}: ${(got / 1000).toFixed(1)} km, want ${(want / 1000).toFixed(1)} km`)
  }
})

test("far field: a ridge beyond the view mosaic shades through the coarse mosaic, at the right distance", () => {
  // View mosaic: 2 × 2 tiles of 256 px at z13 near Mont Blanc; far mosaic chosen by chooseFarLayout.
  const n = 256
  const fine: MosaicLayout = { z: 13, x0: 4252, y0: 2914, nx: 2, ny: 2 }
  const far = chooseFarLayout(fine, n)!
  assert.ok(far && far.z === 10, JSON.stringify(far))
  const xf = farTransform(fine, far, n)
  const az = 270, alt = 4, H = 500
  const [sx, sy] = sunStepVector(az)
  const fineMpt = 1 / (n * 2 ** fine.z), farMpt = 1 / (n * 2 ** far.z)
  // The fragment: the view mosaic's centre.
  const pmx = (fine.x0 * n + n) * fineMpt, pmy = (fine.y0 * n + n) * fineMpt
  const mPerMerc = texelGroundMeters(pmy, 1)
  const build = (layout: MosaicLayout, mpt: number, cliffM: number): ElevationGrid => {
    const w = layout.nx * n, h = layout.ny * n, data = new Float32Array(w * h)
    const mercY0 = layout.y0 * n * mpt, mx0 = layout.x0 * n * mpt
    let maxElev = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const along = ((mx0 + (x + 0.5) * mpt - pmx) * sx + (mercY0 + (y + 0.5) * mpt - pmy) * sy) * mPerMerc
      const v = along > cliffM ? H : 0
      data[y * w + x] = v
      if (v > maxElev) maxElev = v
    }
    return { data, w, h, mercY0, mercPerTexel: mpt, maxElev }
  }
  const tanA = Math.tan((alt * Math.PI) / 180)
  const want = (-tanA + Math.sqrt(tanA * tanA + 4 * CURVATURE_PER_M2 * H)) / (2 * CURVATURE_PER_M2)
  let reach = 0
  for (let D = 4000; D <= 9000; D += 50) {
    const fg = build(fine, fineMpt, D), cg = build(far, farMpt, D)
    const opts = { azimuthDeg: az, altitudeDeg: alt, curvature: CURVATURE_PER_M2 }
    // The cliff is beyond the view mosaic (3.4 km from its centre): no far field, no shadow.
    assert.equal(sunVisibilityCpu(fg, n, n, opts), 1, `D ${D}: lit without the far field`)
    if (sunVisibilityCpu(fg, n, n, { ...opts, far: { grid: cg, ...xf } }) < 0.5) reach = D
  }
  const farTexelM = texelGroundMeters(pmy, farMpt)
  assert.ok(Math.abs(reach - want) <= Math.max(2 * farTexelM, 0.04 * want), `far-field reach ${reach} m, want ${want.toFixed(0)} m`)
})

test("far layout: FAR_LEVELS coarser, margin shrinks to fit, none for a whole-world or minzoom-bound mosaic", () => {
  const fine: MosaicLayout = { z: 12, x0: 2120, y0: 1450, nx: 6, ny: 5 }
  const far = chooseFarLayout(fine, 512)!
  assert.equal(far.z, 12 - FAR_LEVELS)
  assert.ok(far.nx * far.ny <= 36)
  assert.ok(far.x0 * 8 < fine.x0 && (far.x0 + far.nx) * 8 > fine.x0 + fine.nx)
  assert.equal(chooseFarLayout(fine, 512, { minzoom: 12 }), null)
  assert.equal(chooseFarLayout({ z: 2, x0: 0, y0: 0, nx: 4, ny: 4 }, 512), null)
  const t = farTransform(fine, far, 512)
  close(t.scale, 1 / 8)
  close(t.offsetX, (fine.x0 / 8 - far.x0) * 512)
})

test("soft edge: the sun's disc spreads the edge around the hard one; hard and soft agree away from it", () => {
  const az = 90, W = 1500
  const grid = cliffGrid(W, 13, 46, az, 300)
  const [sx, sy] = sunStepVector(az)
  const hard = shadowReachTexels(grid, az, { altitudeDeg: 10 }, 700)
  const vis = (t: number) => sunVisibilityCpu(grid, W / 2 - sx * t, W / 2 - sy * t, { azimuthDeg: az, altitudeDeg: 10, sunRadiusDeg: SUN_RADIUS_DEG })
  const v = vis(hard)
  assert.ok(v > 0.2 && v < 0.8, `visibility at the hard edge ${v}`)
  assert.equal(vis(hard * 0.8), 0)
  assert.equal(vis(hard * 1.2), 1)
  for (let t = Math.round(hard * 0.9); t < hard * 1.1; t++) assert.ok(vis(t + 1) >= vis(t) - 1e-9, "visibility grows away from the cliff")
  // Sun half under the flat horizon: half visible on flat ground.
  const flat: ElevationGrid = { data: new Float32Array(64 * 64), w: 64, h: 64, mercY0: 0.35, mercPerTexel: grid.mercPerTexel, maxElev: 0 }
  close(sunVisibilityCpu(flat, 32, 32, { azimuthDeg: 90, altitudeDeg: 0, sunRadiusDeg: SUN_RADIUS_DEG }), 0.5, 1e-9)
  assert.equal(sunVisibilityCpu(flat, 32, 32, { azimuthDeg: 90, altitudeDeg: -1, sunRadiusDeg: SUN_RADIUS_DEG }), 0)
})

test("the tile kernel (shadow:// tiles) uses the same conventions: same cliff, same shadow length", () => {
  // computeShadowTile with shadow-protocol.ts's direction (dCol, dRow) = (sin az, −cos az)
  // and groundResolutionM's texel size, on a cliff through the tile's centre.
  const n = 256, R = 512, stride = n + 2 * R, lat = 46, z = 14
  const groundResM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (n * 2 ** z)
  for (const [az, alt] of [[135, 15], [0, 20], [290, 30], [200, 45], [45, 10]] as const) {
    const [sx, sy] = sunStepVector(az)
    const padded = new Float32Array(stride * stride)
    for (let r = 0; r < stride; r++) for (let c = 0; c < stride; c++) padded[r * stride + c] = (c - R - n / 2 + 0.5) * sx + (r - R - n / 2 + 0.5) * sy > 0 ? 100 : 0
    const out = new Uint8ClampedArray(n * n * 4)
    const azr = (az * Math.PI) / 180
    computeShadowTile({ padded, stride, n, radiusPx: R, dRow: -Math.cos(azr), dCol: Math.sin(azr), groundResM, altitudeRad: (alt * Math.PI) / 180 }, out)
    let last = 0
    for (let t = 1; t < n / 2; t++) {
      const c = Math.round(n / 2 - 0.5 - sx * t), r = Math.round(n / 2 - 0.5 - sy * t)
      if (c < 0 || r < 0 || c >= n || r >= n) break
      if (out[(r * n + c) * 4 + 3]) last = t
    }
    const want = 100 / Math.tan((alt * Math.PI) / 180) / groundResM
    assert.ok(Math.abs(last - want) <= 2.5, `az ${az} alt ${alt}: tile kernel ${last} px, want ${want.toFixed(1)} px`)
  }
})
