// Run with: node scripts/test-lib.mjs lib/shadow-live-math.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  sunStepVector, sunTanAltitude, shadowStep, shadowStepsToReach, SHADOW_STEP_GROWTH, SHADOW_MAX_STEPS, SHADOW_MOSAIC_MAX_SIDE,
  chooseMosaicLayout, layoutContains, lngLatToMercator, marchShadowCpu,
} from "./shadow-live-math"

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
