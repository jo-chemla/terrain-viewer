// node scripts/test-lib.mjs lib/river-rem.test.ts
// The pure parts of the River REM mode: centerline merge and clipping,
// resampling, downstream cleaning, RiverREM's k estimate, the IDW trend grid,
// the riverrem:// kernel, the color stretch and the drawn line's link form.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  joinWays, clipLineToBbox, mergeWaterways, chooseRiverLines, lineLengthM, resampleLine, resolveSpacingM,
  cleanProfile, runsUphill, sinuosity, estimateNeighbors, buildTrendGrid, sampleTrend, encodeLines, decodeLines,
  lngToMercX, latToMercY, mercXToLng, mercYToLat, MERCATOR_HALF, REM_MAX_PTS, type LngLat, type Waterway, type TrendGrid,
} from "./river-rem"
import { riverRemKernel, buildRiverRemProtocolUrl } from "./river-rem-protocol"
import { buildRemColorExpression, remStretchPosition, remStretchInverse } from "./river-rem-style"
import { overpassQuery, parseOverpassWays } from "./overpass-rivers"
import { pickSampleZoom } from "./river-rem-sample"
import { terrariumToElevation } from "./elevation-encoding"

const way = (id: number, name: string, coords: LngLat[], kind = "river"): Waterway => ({ id, name, kind, coords })

test("ways sharing an end node join into one line, in flow order", () => {
  const lines = joinWays([
    [[2, 0], [3, 0]],
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
  ])
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0], [[0, 0], [1, 0], [2, 0], [3, 0]])
})

test("a gap or a side channel starts another line", () => {
  const lines = joinWays([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[1, 0], [1.5, 0.5]], // a second way leaving the same node
    [[5, 5], [6, 5]],     // not connected
  ])
  assert.equal(lines.length, 3)
  assert.equal(lines.reduce((n, l) => n + l.length, 0), 3 + 2 + 2)
})

test("rivers are grouped by name, longest first; unnamed ways stay apart", () => {
  const rivers = mergeWaterways([
    way(1, "Short", [[0, 0], [0.01, 0]]),
    way(2, "Long", [[0, 1], [0.1, 1]]),
    way(3, "Long", [[0.1, 1], [0.3, 1]]),
    way(4, "", [[0, 2], [1, 2]], "stream"),
    way(5, "", [[1, 2], [2, 2]], "stream"),
  ])
  assert.deepEqual(rivers.map((r) => r.name), ["", "", "Long", "Short"])
  const long = rivers.find((r) => r.name === "Long")!
  assert.equal(long.lines.length, 1)
  assert.equal(long.lines[0].length, 3)
  // The longest NAMED river is picked even when an unnamed way is longer.
  assert.equal(chooseRiverLines(rivers, "longest").label, "Long")
  assert.equal(chooseRiverLines(rivers, "named", "Short").label, "Short")
  assert.equal(chooseRiverLines(rivers, "named", "Gone").label, "Long")
  assert.equal(chooseRiverLines(rivers, "all").lines.length, 4)
  assert.deepEqual(chooseRiverLines([], "longest").lines, [])
})

test("a line is cut at the box, and a line leaving and re-entering gives two parts", () => {
  const parts = clipLineToBbox([[-1, 0.5], [0.5, 0.5], [0.5, 2], [0.8, 2], [0.8, 0.2]], [0, 0, 1, 1])
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[0], [[0, 0.5], [0.5, 0.5], [0.5, 1]])
  assert.deepEqual(parts[1], [[0.8, 1], [0.8, 0.2]])
  assert.deepEqual(clipLineToBbox([[2, 2], [3, 3]], [0, 0, 1, 1]), [])
  const rivers = mergeWaterways([way(1, "R", [[-1, 0.5], [2, 0.5]])], [0, 0, 1, 1])
  assert.ok(Math.abs(rivers[0].lengthM - lineLengthM([[0, 0.5], [1, 0.5]])) < 1)
})

test("resampling puts a point every spacing and keeps both ends", () => {
  const line: LngLat[] = [[0, 0], [0.01, 0], [0.01, 0.01]]
  const length = lineLengthM(line)
  const points = resampleLine(line, 100)
  assert.deepEqual(points[0], line[0])
  assert.deepEqual(points[points.length - 1], line[2])
  assert.ok(Math.abs(points.length - (Math.floor(length / 100) + 1)) <= 1)
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineLengthM([points[i - 1], points[i]])
    assert.ok(d > 60 && d < 101, `step ${i} is ${d} m`) // a corner cut shortens the chord
  }
})

test("auto spacing spreads RiverREM's 1000 points; any spacing stays under the ceiling", () => {
  assert.ok(Math.abs(resolveSpacingM(99900, 0) - 100) < 1e-9)
  assert.equal(resolveSpacingM(10000, 50), 50)
  assert.ok(resolveSpacingM(1e6, 1) >= 1e6 / (REM_MAX_PTS - 1))
})

test("running minimum: the profile never rises downstream, a bridge is ignored", () => {
  const cleaned = cleanProfile([10, 9.5, 14, 9.4, NaN, 9.6, 9, 9.2], "min")
  assert.deepEqual(Array.from(cleaned), [10, 9.5, 9.5, 9.4, NaN, 9.4, 9, 9])
})

test("monotone fit: non-increasing, and the mean is kept", () => {
  const raw = [10, 9, 11, 8, 8.5, 7]
  const fit = Array.from(cleanProfile(raw, "fit"))
  for (let i = 1; i < fit.length; i++) assert.ok(fit[i] <= fit[i - 1] + 1e-12)
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  assert.ok(Math.abs(sum(fit) - sum(raw)) < 1e-9)
  assert.deepEqual(fit.slice(0, 3), [10, 10, 10])
  assert.deepEqual(Array.from(cleanProfile([3, NaN, 4], "fit")), [3.5, NaN, 3.5])
  assert.deepEqual(Array.from(cleanProfile(raw, "none")), raw)
})

test("a line drawn upstream is detected", () => {
  assert.equal(runsUphill([1, 2, 3, 4, 5, 6]), true)
  assert.equal(runsUphill([6, 5, NaN, 4, 3, 2, 1]), false)
  assert.equal(runsUphill([NaN]), false)
})

test("k follows RiverREM's estimate", () => {
  // Straight river: 2 % of the samples.
  assert.equal(estimateNeighbors(1000, 1), 20)
  // Very sinuous: the factor tends to 5, capped at interp_pts / 10.
  assert.equal(estimateNeighbors(1000, 4), 99)
  assert.equal(estimateNeighbors(4000, 4), 100)
  // Never under 5, never over the sample count.
  assert.equal(estimateNeighbors(100, 1), 5)
  assert.equal(estimateNeighbors(3, 1), 3)
  assert.equal(sinuosity([[[0, 0], [1, 0]]]), 1)
  assert.ok(Math.abs(sinuosity([[[0, 0], [0.5, 0.5], [1, 0]]]) - Math.SQRT2) < 0.01)
})

const pointsOf = (list: [number, number, number][]) => ({
  x: Float64Array.from(list, (p) => p[0]), y: Float64Array.from(list, (p) => p[1]), z: Float64Array.from(list, (p) => p[2]),
})

test("IDW: a cell on a sample takes its level, a cell midway the mean", () => {
  const points = pointsOf([[0, 0, 10], [1000, 0, 20]])
  const grid = buildTrendGrid(points, { x0: 0, y0: -500, x1: 1000, y1: 500 }, { power: 1, neighbors: 2, size: 101 })
  assert.equal(grid.w, 101); assert.equal(grid.h, 101)
  assert.ok(Math.abs(sampleTrend(grid, 0, 0) - 10) < 0.02)
  assert.ok(Math.abs(sampleTrend(grid, 1000, 0) - 20) < 0.02)
  assert.ok(Math.abs(sampleTrend(grid, 500, 0) - 15) < 1e-6)
  // 250 m from one, 750 m from the other: weights 3:1 at power 1, 9:1 at power 2.
  assert.ok(Math.abs(sampleTrend(grid, 250, 0) - 12.5) < 1e-6)
  const squared = buildTrendGrid(points, { x0: 0, y0: -500, x1: 1000, y1: 500 }, { power: 2, neighbors: 2, size: 101 })
  assert.ok(Math.abs(sampleTrend(squared, 250, 0) - 11) < 1e-6)
  // Outside the grid: its edge.
  assert.equal(sampleTrend(grid, -5000, 0), sampleTrend(grid, 0, 0))
})

test("IDW: k nearest by heap equals a sort, and k = all equals the plain sum", () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const list: [number, number, number][] = []
  for (let i = 0; i < 300; i++) list.push([rnd() * 10000, rnd() * 10000, rnd() * 50])
  const points = pointsOf(list)
  const extent = { x0: 0, y0: 0, x1: 10000, y1: 10000 }
  const reference = (cx: number, cy: number, k: number, power: number) => {
    const d = list.map(([x, y, z]) => ({ d: Math.max(1, Math.hypot(x - cx, y - cy)), z })).sort((a, b) => a.d - b.d).slice(0, k)
    let sw = 0, swz = 0
    for (const p of d) { const w = 1 / p.d ** power; sw += w; swz += w * p.z }
    return swz / sw
  }
  for (const [k, power] of [[1, 1], [7, 1], [40, 2], [300, 1], [0, 1.5]] as const) {
    const grid = buildTrendGrid(points, extent, { power, neighbors: k, size: 9 })
    for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
      const expected = reference(col * 1250, 10000 - row * 1250, k || 300, power)
      assert.ok(Math.abs(grid.data[row * 9 + col] - expected) < 1e-3, `k=${k} power=${power} cell ${row},${col}`)
    }
  }
})

test("the grid keeps the extent's shape, north on row 0", () => {
  const grid = buildTrendGrid(pointsOf([[0, 0, 0], [0, 4000, 40]]), { x0: -1000, y0: 0, x1: 1000, y1: 4000 }, { power: 1, neighbors: 2, size: 64 })
  assert.equal(grid.h, 64); assert.equal(grid.w, 32)
  assert.ok(grid.data[0] > grid.data[(grid.h - 1) * grid.w]) // the north row is near the 40 m sample
})

test("the kernel writes elevation minus trend as Terrarium, and marks holes", () => {
  // Tile 1/0/0 at z1 covers the north-west quarter of the world.
  const n = 4
  const dem = Float32Array.from({ length: n * n }, (_, i) => 100 + i)
  const flat: TrendGrid = { data: new Float32Array(4).fill(95.5), w: 2, h: 2, x0: -MERCATOR_HALF, y0: 0, x1: 0, y1: MERCATOR_HALF }
  const out = new Uint8ClampedArray(n * n * 4)
  const valid = new Uint8Array(n * n).fill(1); valid[5] = 0
  riverRemKernel(dem, n, n, valid, n, 1, 0, 0, flat, out)
  for (let i = 0; i < n * n; i++) {
    const v = terrariumToElevation(out[i * 4], out[i * 4 + 1], out[i * 4 + 2])
    if (i === 5) { assert.equal(out[i * 4 + 3], 254); assert.equal(v, 0); continue }
    assert.equal(out[i * 4 + 3], 255)
    assert.ok(Math.abs(v - (4.5 + i)) < 1 / 256, `pixel ${i}: ${v}`)
  }
  // A trend that rises to the east: 0 at the west edge of the grid, 30 at the east.
  const sloped: TrendGrid = { data: Float32Array.from([0, 30, 0, 30]), w: 2, h: 2, x0: -MERCATOR_HALF, y0: 0, x1: 0, y1: MERCATOR_HALF }
  riverRemKernel(new Float32Array(n * n).fill(50), n, n, undefined, n, 1, 0, 0, sloped, out)
  const read = (col: number) => terrariumToElevation(out[col * 4], out[col * 4 + 1], out[col * 4 + 2])
  // Pixel centres at 1/8, 3/8, 5/8, 7/8 of the tile, which is the grid's width.
  for (let col = 0; col < n; col++) assert.ok(Math.abs(read(col) - (50 - 30 * (col + 0.5) / n)) < 1 / 128)
  // A DEM tile of another size than the output is read at the nearest pixel.
  riverRemKernel(Float32Array.from([10, 20, 30, 40]), 2, 2, undefined, n, 1, 0, 0, { ...flat, data: new Float32Array(4) }, out)
  assert.ok(Math.abs(read(0) - 10) < 0.01); assert.ok(Math.abs(read(3) - 20) < 0.01)
})

test("the tile URL carries the revision", () => {
  const a = buildRiverRemProtocolUrl("https://t/{z}/{x}/{y}.webp", "terrarium", 512, 3)
  assert.match(a, /^riverrem:\/\/terrarium\/512\/[^/]+\/\{z\}\/\{x\}\/\{y\}\?rev=3$/)
  assert.notEqual(a, buildRiverRemProtocolUrl("https://t/{z}/{x}/{y}.webp", "terrarium", 512, 4))
})

test("the log stretch is RiverREM's, and each stretch inverts", () => {
  // RiverREM: color i/254 sits at 10^(i/254 * log10(M)) - 1 for a top M - 1.
  const range = 9
  for (const u of [0, 0.25, 0.5, 1]) {
    const height = Math.pow(10, u * Math.log10(range + 1)) - 1
    assert.ok(Math.abs(remStretchPosition(height / range, "log", range, 1) - u) < 1e-12)
  }
  for (const stretch of ["log", "power", "linear"] as const) for (const t of [0, 0.1, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(remStretchInverse(remStretchPosition(t, stretch, 10, 0.5), stretch, 10, 0.5) - t) < 1e-12)
  }
  assert.equal(remStretchPosition(0.25, "power", 10, 0.5), 0.5)
})

test("the color expression spans the range, stops rising, ends on the ramp's ends", () => {
  const ramp = ["interpolate", ["linear"], ["elevation"], 0, "#ffffff", 1, "#000000"]
  const expr = buildRemColorExpression(ramp, 0, 10, "log", 0.5, false, 8) as (number | string)[]
  assert.deepEqual(expr.slice(0, 3), ["interpolate", ["linear"], ["elevation"]])
  const values = expr.slice(3).filter((_, i) => i % 2 === 0) as number[]
  const colors = expr.slice(3).filter((_, i) => i % 2 === 1) as string[]
  assert.equal(values.length, 9)
  assert.equal(values[0], 0); assert.ok(Math.abs(values[8] - 10) < 1e-9)
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1])
  // Log: half of the ramp is used under sqrt(11) - 1 = 2.3 m.
  assert.ok(Math.abs(values[4] - (Math.sqrt(11) - 1)) < 1e-9)
  assert.equal(colors[0], "rgba(255, 255, 255, 1)"); assert.equal(colors[8], "rgba(0, 0, 0, 1)")
  const inverted = buildRemColorExpression(ramp, 0, 10, "linear", 1, true, 2) as (number | string)[]
  assert.deepEqual(inverted.slice(3), [0, "rgba(0, 0, 0, 1)", 5, "rgba(128, 128, 128, 1)", 10, "rgba(255, 255, 255, 1)"])
})

test("a drawn line survives the link", () => {
  const lines: LngLat[][] = [[[-91.05123, 33.41001], [-91.06, 33.42], [-91.0, 33.5]], [[3.3, 46.5], [3.31, 46.49]]]
  const text = encodeLines(lines)
  assert.ok(!/[\s,]/.test(text))
  const back = decodeLines(text)
  assert.equal(back.length, 2)
  back.forEach((line, i) => line.forEach((c, j) => { assert.ok(Math.abs(c[0] - lines[i][j][0]) < 1e-5); assert.ok(Math.abs(c[1] - lines[i][j][1]) < 1e-5) }))
  assert.deepEqual(decodeLines(""), [])
  assert.deepEqual(decodeLines("\u0001\u0002"), [])
})

test("mercator helpers round-trip", () => {
  assert.ok(Math.abs(mercXToLng(lngToMercX(-91.05)) + 91.05) < 1e-9)
  assert.ok(Math.abs(mercYToLat(latToMercY(46.5)) - 46.5) < 1e-9)
  assert.ok(Math.abs(lngToMercX(180) - MERCATOR_HALF) < 1e-6)
})

test("Overpass: the query names the kinds and the box, the answer becomes ways", () => {
  const q = overpassQuery([3.1, 46.2, 3.5, 46.6], "river")
  assert.match(q, /way\["waterway"="river"\]\(46\.20000,3\.10000,46\.60000,3\.50000\);out tags geom;/)
  assert.match(overpassQuery([0, 0, 1, 1], "all"), /river\|stream\|canal/)
  const ways = parseOverpassWays({ elements: [
    { type: "way", id: 1, tags: { name: "Allier", waterway: "river" }, geometry: [{ lat: 46.3, lon: 3.3 }, { lat: 46.4, lon: 3.31 }] },
    { type: "way", id: 2, tags: { waterway: "stream" }, geometry: [{ lat: 1, lon: 2 }, null, { lat: 3, lon: 4 }] },
    { type: "way", id: 3, geometry: [{ lat: 1, lon: 2 }] },
    { type: "node", id: 4 },
  ] })
  assert.deepEqual(ways, [
    { id: 1, name: "Allier", kind: "river", coords: [[3.3, 46.3], [3.31, 46.4]] },
    { id: 2, name: "", kind: "stream", coords: [[2, 1], [4, 3]] },
  ])
  assert.deepEqual(parseOverpassWays(null), [])
})

test("a long river is sampled at a lower zoom", () => {
  const short: LngLat[] = [[3.3, 46.3], [3.31, 46.31]]
  const long: LngLat[] = Array.from({ length: 400 }, (_, i) => [3 + i * 0.005, 46 + i * 0.002] as LngLat)
  const source = { template: "x", encoding: "terrarium" as const, tileSize: 512, maxzoom: 17 }
  assert.equal(pickSampleZoom(short, source), 15)
  assert.ok(pickSampleZoom(long, source) < 15)
  assert.equal(pickSampleZoom(long, { ...source, minzoom: 14 }), 14)
})
