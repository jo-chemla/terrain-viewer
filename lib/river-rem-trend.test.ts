// node scripts/test-lib.mjs lib/river-rem-trend.test.ts
// The River REM parts added in the third round (2026-11-26): the labeled
// distance transform and its refinement against the scanned nearest
// centerline, the blending of the creases, the staircase of a water profile
// read as ramps, several readings per height. The last test prints timings
// (BENCH=1 for the large grids).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createTrendGrid, fillTrendRows, fillTrendEdt, burnCenterline, labelNearestSeed, refineNearest, blendTrendByDistance,
  rampProfile, smoothProfile, cleanProfile, subSamplePoints, reduceStations, type LngLat, type TrendPoints,
} from "./river-rem"

/** A meandering river in mercator metres, falling 5 m, `count` samples. */
function meander(count: number, lengthM = 60000): TrendPoints {
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    x[i] = 9000 * Math.sin(t * Math.PI * 5) + 3000 * Math.sin(t * Math.PI * 13)
    y[i] = lengthM / 2 - t * lengthM
    z[i] = 35 - 5 * t
  }
  return { x, y, z, starts: Uint8Array.from({ length: count }, (_, i) => (i === 0 ? 1 : 0)) }
}
const EXTENT = { x0: -30000, y0: -40000, x1: 30000, y1: 40000 }

test("a staircase of rounded heights is read as the slope it stands for", () => {
  const n = 1000
  const truth = Float64Array.from({ length: n }, (_, i) => 35 - (4.7 * i) / (n - 1))
  const rounded = truth.map((v) => Math.round(v * 2) / 2) // 0.5 m, Mapterhorn at z12
  const ramped = rampProfile(cleanProfile(rounded, "min"))
  let worstStairs = 0, worstRamp = 0, worstInside = 0, rises = 0, biggestStep = 0
  for (let i = 0; i < n; i++) {
    worstStairs = Math.max(worstStairs, Math.abs(rounded[i] - truth[i]))
    worstRamp = Math.max(worstRamp, Math.abs(ramped[i] - truth[i]))
    if (i > 120 && i < n - 120) worstInside = Math.max(worstInside, Math.abs(ramped[i] - truth[i]))
    if (i > 0) { if (ramped[i] > ramped[i - 1] + 1e-9) rises++; biggestStep = Math.max(biggestStep, ramped[i - 1] - ramped[i]) }
  }
  assert.ok(worstStairs > 0.24, `the staircase is off by half a step (${worstStairs})`)
  assert.ok(worstInside < 0.02, `the ramps follow the slope (${worstInside})`)
  // The first and last treads are cut short by the ends of the line and half
  // of each stays flat: no worse than the staircase there.
  assert.ok(worstRamp <= worstStairs + 1e-9, `the ends are no worse (${worstRamp})`)
  assert.equal(rises, 0)
  assert.ok(biggestStep < 0.02, `no step left (${biggestStep} m between two samples)`)
})

test("ramps leave a profile with no treads alone, keep NaN, and stop short in a long tread", () => {
  const strict = Float64Array.from({ length: 50 }, (_, i) => 100 - i * 0.3 - (i % 3) * 0.01)
  assert.deepEqual(Array.from(rampProfile(strict)), Array.from(strict))
  const holes = Float64Array.from([5, 5, NaN, 5, 4, 4, NaN, 4, 3, 3])
  const out = rampProfile(holes)
  assert.ok(Number.isNaN(out[2]) && Number.isNaN(out[6]))
  assert.ok(out[3] <= 5 && out[3] >= 4 && out[9] === 3 && out[0] === 5)
  // A reservoir (200 samples at 50 m) above a 10 m dam, then a river: with a
  // reach of 5 samples the pool is flat until 5 samples before the dam.
  const dam = Float64Array.from({ length: 300 }, (_, i) => (i < 200 ? 50 : 40 - (i - 200) * 0.01))
  const kept = rampProfile(dam, 5)
  assert.equal(kept[100], 50)
  assert.equal(kept[194], 50)
  assert.ok(kept[198] < 50 && kept[198] > 40)
  const free = rampProfile(dam)
  assert.ok(free[150] < 49, "without a reach the ramp runs from the middle of the pool")
})

test("a lone step in a falling profile is spread, and nothing rises", () => {
  // Falls 1 mm a sample, with a 13 cm seam in the middle: no two heights are
  // equal, so the ramps leave it alone.
  const stepped = Float64Array.from({ length: 400 }, (_, i) => 30 - i * 0.001 - (i >= 200 ? 0.13 : 0))
  assert.deepEqual(Array.from(rampProfile(stepped)), Array.from(stepped))
  const smoothed = smoothProfile(stepped, 4)
  let biggest = 0
  for (let i = 1; i < 400; i++) { assert.ok(smoothed[i] <= smoothed[i - 1] + 1e-12); biggest = Math.max(biggest, smoothed[i - 1] - smoothed[i]) }
  assert.ok(biggest < 0.02, `the 13 cm step is now ${(biggest * 100).toFixed(1)} cm at most between two heights`)
  // Far from the seam nothing moved, the ends included.
  assert.ok(Math.abs(smoothed[100] - stepped[100]) < 1e-9 && Math.abs(smoothed[300] - stepped[300]) < 1e-9)
  assert.ok(Math.abs(smoothed[0] - stepped[0]) < 0.004 && Math.abs(smoothed[399] - stepped[399]) < 0.004)
  const holes = smoothProfile([5, NaN, 5, 4, 4, NaN, 3], 1)
  assert.ok(Number.isNaN(holes[1]) && Number.isNaN(holes[5]) && holes[0] <= 5 && holes[6] >= 3)
})

test("several readings per height: spread around each point, reduced to a low quantile", () => {
  const line: LngLat[] = [[0, 0], [1, 0], [2, 0]]
  const dense = subSamplePoints(line, 4)
  assert.equal(dense.length, 12)
  // Point 1's readings lie between the midpoints to its neighbors.
  for (const p of dense.slice(4, 8)) assert.ok(p[0] > 0.5 && p[0] < 1.5)
  assert.deepEqual(dense.slice(0, 2), [[0, 0], [0, 0]]) // nothing before the first point
  assert.deepEqual(subSamplePoints(line, 1), line)
  // A bar under half of the readings does not raise the height; one pit does not set it.
  const values = [30, 30, 30, 30, 33, 33, 33, 30, 12, 30, 30, 30, NaN, NaN, NaN, NaN]
  const reduced = reduceStations(values, 4)
  assert.equal(reduced[0], 30)
  assert.ok(reduced[1] < 33)
  assert.ok(reduced[2] > 20)
  assert.ok(Number.isNaN(reduced[3]))
})

test("the distance transform labels every cell with its nearest seed", () => {
  const w = 97, h = 61
  const seeds = new Int32Array(w * h).fill(-1)
  const placed: [number, number][] = []
  let state = 12345
  const rand = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let i = 0; i < 40; i++) { const col = Math.floor(rand() * w), row = Math.floor(rand() * h); seeds[row * w + col] = i; placed[i] = [col, row] }
  const labels = labelNearestSeed(seeds, w, h)
  for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
    let best = Infinity
    for (const [c, r] of placed) best = Math.min(best, (c - col) ** 2 + (r - row) ** 2)
    const [lc, lr] = placed[labels[row * w + col]]
    // A tie can go either way; the distance is what must be the smallest.
    assert.equal((lc - col) ** 2 + (lr - row) ** 2, best, `cell ${col},${row}`)
  }
  assert.ok(labelNearestSeed(new Int32Array(w * h).fill(-1), w, h).every((v) => v === -1))
})

test("EDT then refinement gives the scanned nearest centerline", () => {
  const points = meander(1000)
  const scanned = createTrendGrid(EXTENT, 256)
  scanned.dist = new Float32Array(scanned.w * scanned.h)
  fillTrendRows(scanned, points, { power: 1, neighbors: 0, method: "nearest" })
  const edt = createTrendGrid(EXTENT, 256)
  fillTrendEdt(edt, points)
  let differing = 0, worstDist = 0
  for (let i = 0; i < scanned.data.length; i++) {
    if (Math.abs(scanned.data[i] - edt.data[i]) > 0.01) differing++
    worstDist = Math.max(worstDist, edt.dist![i] - scanned.dist![i])
  }
  // The two can only pick different reaches where both are about equally
  // near (within a cell of a crease: a seed is a cell, not a point), and the
  // transform never finds a place that is farther by more than a cell's
  // diagonal.
  const cell = (EXTENT.x1 - EXTENT.x0) / (edt.w - 1)
  assert.ok(differing / scanned.data.length < 0.02, `${differing} cells differ`)
  assert.ok(worstDist < cell * Math.SQRT2, `at worst ${worstDist.toFixed(1)} m farther (cell ${cell.toFixed(0)} m)`)
})

test("two channels are never joined across a line start", () => {
  const points: TrendPoints = {
    x: Float64Array.from([-5000, -5000, 5000, 5000]), y: Float64Array.from([10000, -10000, 10000, -10000]),
    z: Float64Array.from([20, 20, 30, 30]), starts: Uint8Array.from([1, 0, 1, 0]),
  }
  const grid = createTrendGrid({ x0: -10000, y0: -10000, x1: 10000, y1: 10000 }, 128)
  const seeds = burnCenterline(grid, points)
  // Nothing is burned on the diagonal from the end of one line to the start of the other.
  assert.equal(seeds[64 * grid.w + 64], -1)
  refineNearest(grid, points, labelNearestSeed(seeds, grid.w, grid.h))
  assert.equal(grid.data[64 * grid.w + 10], 20)
  assert.equal(grid.data[64 * grid.w + 118], 30)
})

test("blending turns the crease between two reaches into a ramp and leaves the banks alone", () => {
  const points: TrendPoints = {
    x: Float64Array.from([-5000, -5000, 5000, 5000]), y: Float64Array.from([10000, -10000, 10000, -10000]),
    z: Float64Array.from([20, 20, 30, 30]), starts: Uint8Array.from([1, 0, 1, 0]),
  }
  const grid = createTrendGrid({ x0: -10000, y0: -10000, x1: 10000, y1: 10000 }, 256)
  fillTrendEdt(grid, points)
  const row = 128 * grid.w
  const jump = (data: Float32Array) => { let worst = 0; for (let col = 1; col < grid.w; col++) worst = Math.max(worst, Math.abs(data[row + col] - data[row + col - 1])); return worst }
  assert.ok(jump(grid.data) > 9.9, "a 10 m crease halfway between the two")
  const cell = 20000 / (grid.w - 1)
  blendTrendByDistance(grid.data, grid.dist!, grid.w, grid.h, cell, 0.5)
  assert.ok(jump(grid.data) < 0.5, `the crease is a ramp (${jump(grid.data).toFixed(3)} m between two cells)`)
  // On each line, and a few cells from it, the level is the line's.
  const colOf = (x: number) => Math.round((x + 10000) / cell)
  assert.ok(Math.abs(grid.data[row + colOf(-5000)] - 20) < 0.01)
  assert.ok(Math.abs(grid.data[row + colOf(5000)] - 30) < 0.01)
  assert.ok(Math.abs(grid.data[row + colOf(-5000) + 6] - 20) < 0.05)
  // Monotone across: no overshoot.
  for (let col = colOf(-5000); col < colOf(5000); col++) assert.ok(grid.data[row + col + 1] >= grid.data[row + col] - 1e-4)
  // Amount 0 changes nothing.
  const before = grid.data.slice()
  blendTrendByDistance(grid.data, grid.dist!, grid.w, grid.h, cell, 0)
  assert.deepEqual(grid.data, before)
})

test("timings", () => {
  const points = meander(1000)
  const time = (label: string, run: () => void) => { const t0 = performance.now(); run(); console.log(`  ${label}: ${(performance.now() - t0).toFixed(0)} ms`) }
  const idw = createTrendGrid(EXTENT, 256)
  time("IDW 256, k 60", () => fillTrendRows(idw, points, { power: 1, neighbors: 60, method: "idw" }))
  const scan = createTrendGrid(EXTENT, 256)
  time("scanned nearest 256", () => fillTrendRows(scan, points, { power: 1, neighbors: 0, method: "nearest" }))
  for (const size of process.env.BENCH ? [256, 512, 1024, 2048] : [256, 512]) {
    const grid = createTrendGrid(EXTENT, size)
    let seeds!: Int32Array, labels!: Int32Array
    time(`EDT ${size}: burn`, () => { seeds = burnCenterline(grid, points) })
    time(`EDT ${size}: transform`, () => { labels = labelNearestSeed(seeds, grid.w, grid.h) })
    time(`EDT ${size}: refine`, () => refineNearest(grid, points, labels))
    time(`blend ${size}`, () => blendTrendByDistance(grid.data, grid.dist!, grid.w, grid.h, (EXTENT.y1 - EXTENT.y0) / (grid.h - 1), 0.5))
  }
})
