// node scripts/test-lib.mjs lib/river-rem-polish.test.ts
// The River REM parts added on 2026-11-26: the main-river ranking, the
// nearest-centerline interpolation, the smoothing of a rounded DEM, the
// Elevation display of the kernel, QLever's answer, and the centerline as a
// file.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mergeWaterways, chooseRiverLines, riverScore, buildTrendGrid, quantizationStep, dequantizeDem,
  linesToGeoJson, linesFromGeoJson, simplifyLine, encodeLinesForUrl, decodeLines, lineLengthM,
  type LngLat, type Waterway, type TrendPoints,
} from "./river-rem"
import { riverRemKernel, buildRiverRemProtocolUrl, riverRemElevationRange } from "./river-rem-protocol"
import { qleverQuery, parseWktLines, parseQleverWays, waterwayServers, fetchWaterways, OverpassError, type WaterwayServer } from "./overpass-rivers"
import { terrariumToElevation } from "./elevation-encoding"

const way = (id: number, name: string, coords: LngLat[], tagCount?: number): Waterway => ({ id, name, kind: "river", coords, tagCount })

test("the main river is not the longest: Greenville's Deer Creek against the Mississippi", () => {
  // The measured shape of it: a creek with more length in view and 4 tags,
  // the trunk river with less length and 60.
  const creek: LngLat[] = Array.from({ length: 60 }, (_, i) => [-90.9 + (i % 2) * 0.02, 33.0 + i * 0.012] as LngLat)
  const trunk: LngLat[] = [[-91.2, 33.6], [-91.15, 33.3], [-91.1, 33.0]]
  const rivers = mergeWaterways([way(1, "Deer Creek", creek, 4), way(2, "Mississippi River", trunk, 60), way(3, "", [[-91, 33], [-90, 34]], 2)])
  const byName = Object.fromEntries(rivers.map((r) => [r.name, r]))
  assert.ok(byName["Deer Creek"].lengthM > byName["Mississippi River"].lengthM)
  assert.equal(byName["Mississippi River"].tagCount, 60)
  assert.ok(riverScore(byName["Mississippi River"]) > riverScore(byName["Deer Creek"]))
  assert.equal(chooseRiverLines(rivers, "main").label, "Mississippi River")
  assert.equal(chooseRiverLines(rivers, "longest").label, "Deer Creek")
  assert.equal(chooseRiverLines(rivers, "named", "Deer Creek").label, "Deer Creek")
  // A name that is not in view falls back to the main river.
  assert.equal(chooseRiverLines(rivers, "named", "Gone").label, "Mississippi River")
  assert.equal(chooseRiverLines(rivers, "all").lines.length, 3)
})

test("ways without a tag count rank by length alone; unnamed rivers are a last resort", () => {
  const rivers = mergeWaterways([way(1, "A", [[0, 0], [0.1, 0]]), way(2, "B", [[0, 1], [0.3, 1]]), way(3, "", [[0, 2], [5, 2]])])
  assert.equal(chooseRiverLines(rivers, "main").label, "B")
  const unnamed = mergeWaterways([way(1, "", [[0, 0], [0.1, 0]], 9), way(2, "", [[0, 1], [0.3, 1]], 1)])
  assert.equal(chooseRiverLines(unnamed, "main").lines[0][1][0], 0.1)
  assert.equal(chooseRiverLines(unnamed, "longest").lines[0][1][0], 0.3)
})

test("nearest: the level of the closest place on the centerline, interpolated along the segment", () => {
  // One straight river along y = 0 from x = 0 (10 m) to x = 1000 (0 m).
  const points: TrendPoints = { x: Float64Array.from([0, 1000]), y: Float64Array.from([0, 0]), z: Float64Array.from([10, 0]), starts: Uint8Array.from([1, 0]) }
  const grid = buildTrendGrid(points, { x0: 0, y0: -500, x1: 1000, y1: 500 }, { power: 1, neighbors: 2, method: "nearest", size: 101 })
  const at = (col: number, row: number) => grid.data[row * grid.w + col]
  // Any row: the level only depends on x, linearly. IDW would not give this.
  for (const row of [0, 50, 100]) {
    assert.ok(Math.abs(at(0, row) - 10) < 1e-4)
    assert.ok(Math.abs(at(50, row) - 5) < 1e-4)
    assert.ok(Math.abs(at(25, row) - 7.5) < 1e-4)
    assert.ok(Math.abs(at(100, row)) < 1e-4)
  }
  const idw = buildTrendGrid(points, { x0: 0, y0: -500, x1: 1000, y1: 500 }, { power: 1, neighbors: 2, size: 101 })
  assert.ok(Math.abs(idw.data[25] - 7.5) > 0.5)
})

test("nearest: two lines are not joined by a segment", () => {
  // Line 1 ends at (0, 0) level 10, line 2 starts at (1000, 0) level 0: the
  // cell midway is 500 m from both ends and must take one of the two levels,
  // not the 5 m a segment across the gap would give.
  const points: TrendPoints = {
    x: Float64Array.from([-1000, 0, 1000, 2000]), y: Float64Array.from([0, 0, 0, 0]), z: Float64Array.from([10, 10, 0, 0]),
    starts: Uint8Array.from([1, 0, 1, 0]),
  }
  const grid = buildTrendGrid(points, { x0: 0, y0: -100, x1: 1000, y1: 100 }, { power: 1, neighbors: 2, method: "nearest", size: 11 })
  const mid = grid.data[5]
  assert.ok(mid === 10 || mid === 0)
  assert.equal(grid.data[2], 10)
  assert.equal(grid.data[8], 0)
})

test("a rounded DEM is recognised by its step, a float one is left alone", () => {
  const rounded = Float32Array.from({ length: 4096 }, (_, i) => 30 + Math.round((i % 64) / 16) * 0.5)
  assert.equal(quantizationStep(rounded), 0.5)
  const whole = Float32Array.from({ length: 4096 }, (_, i) => 100 + Math.floor(i / 512))
  assert.equal(quantizationStep(whole), 1)
  const float = Float32Array.from({ length: 4096 }, (_, i) => 30 + Math.sin(i) * 3)
  assert.equal(quantizationStep(float), 0)
  // Terrarium's own 1/256 m is finer than the smallest step worth smoothing.
  const fine = Float32Array.from({ length: 4096 }, (_, i) => 30 + (i % 300) / 256)
  assert.equal(quantizationStep(fine), 0)
  // Uneven ladder (30, 31, 31.3): not a rounding step.
  assert.equal(quantizationStep(Float32Array.from([30, 31, 31.3, 30, 31, 31.3]), undefined, 1), 0)
  assert.equal(quantizationStep(new Float32Array(100).fill(12)), 0)
  // Holes do not count.
  const holed = Float32Array.from([0, 30, 30.5, 31, 0, 30.5]), valid = Uint8Array.from([0, 1, 1, 1, 0, 1])
  assert.equal(quantizationStep(holed, valid, 1), 0.5)
})

test("the smoothing turns a staircase into a ramp and never leaves the half step", () => {
  // A plane rising 1 m every 40 px, rounded to whole metres.
  const w = 200, h = 64
  const truth = new Float32Array(w * h), rounded = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { truth[y * w + x] = x / 40; rounded[y * w + x] = Math.round(x / 40) }
  const smooth = Float32Array.from(rounded)
  dequantizeDem(smooth, w, h, 1)
  let worstBefore = 0, worstAfter = 0, sumBefore = 0, sumAfter = 0, levels = new Set<number>()
  for (let i = 0; i < w * h; i++) {
    assert.ok(Math.abs(smooth[i] - rounded[i]) <= 0.5 + 1e-6)
    const before = Math.abs(rounded[i] - truth[i]), after = Math.abs(smooth[i] - truth[i])
    worstBefore = Math.max(worstBefore, before); worstAfter = Math.max(worstAfter, after)
    sumBefore += before; sumAfter += after
    levels.add(Math.round(smooth[i] * 256))
  }
  // Closer to the plane on average, and many more distinct heights than 6.
  assert.ok(sumAfter < sumBefore * 0.6, `mean error ${sumAfter / (w * h)} against ${sumBefore / (w * h)}`)
  assert.ok(worstAfter <= worstBefore + 1e-6)
  assert.ok(levels.size > 100, `${levels.size} levels`)
  // A flat grid and a zero step are left untouched.
  const flat = new Float32Array(100).fill(7)
  dequantizeDem(flat, 10, 10, 1)
  assert.ok(flat.every((v) => v === 7))
  const same = Float32Array.from(rounded)
  dequantizeDem(same, w, h, 0)
  assert.deepEqual(same, rounded)
})

test("the kernel without a trend writes the elevation itself, and reports its range", () => {
  const n = 4
  const dem = Float32Array.from({ length: n * n }, (_, i) => 100 + i * 0.5)
  const valid = new Uint8Array(n * n).fill(1)
  valid[5] = 0
  const out = new Uint8ClampedArray(n * n * 4)
  const range = riverRemKernel(dem, n, n, valid, n, 10, 500, 400, null, out)
  for (let i = 0; i < n * n; i++) {
    if (i === 5) { assert.equal(out[i * 4 + 3], 254); continue }
    assert.ok(Math.abs(terrariumToElevation(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]) - dem[i]) < 1 / 256 + 1e-9)
  }
  assert.equal(range.min, 100)
  assert.equal(range.max, 107.5)
  assert.match(buildRiverRemProtocolUrl("https://x/{z}/{x}/{y}.png", "terrarium", 512, 3, true), /\?rev=3&abs=1$/)
  assert.match(buildRiverRemProtocolUrl("https://x/{z}/{x}/{y}.png", "terrarium", 512, 3), /\?rev=3$/)
  assert.equal(riverRemElevationRange([0, 0, 1, 1]), null)
})

test("QLever: the query asks for ways in the box, the answer becomes ways with their tag count", () => {
  const q = qleverQuery([3.1, 46.2, 3.5, 46.6], "river")
  assert.match(q, /VALUES \?kind \{ "river" \}/)
  assert.match(q, /rdf:type osm:way/)
  assert.match(q, /POLYGON\(\(3\.10000 46\.20000,3\.50000 46\.20000,3\.50000 46\.60000,3\.10000 46\.60000,3\.10000 46\.20000\)\)/)
  assert.match(qleverQuery([0, 0, 1, 1], "all"), /"river" "stream" "canal"/)
  assert.deepEqual(parseWktLines("LINESTRING(3.3 46.3,3.31 46.4, 3.32 46.5)"), [[[3.3, 46.3], [3.31, 46.4], [3.32, 46.5]]])
  assert.equal(parseWktLines("MULTILINESTRING((0 0,1 1),(2 2,3 3))").length, 2)
  assert.deepEqual(parseWktLines("POLYGON((0 0,1 1,1 0,0 0))"), [])
  assert.deepEqual(parseWktLines("GEOMETRYCOLLECTION(LINESTRING(0 0,1 1))"), [])
  const ways = parseQleverWays({ results: { bindings: [
    { way: { value: "https://www.openstreetmap.org/way/42" }, kind: { value: "river" }, name: { value: "Mississippi River" }, facts: { value: "60" }, wkt: { value: "LINESTRING(-91.1 33.3,-91.2 33.2)" } },
    { way: { value: "https://www.openstreetmap.org/way/43" }, kind: { value: "stream" }, wkt: { value: "LINESTRING(1 2,3 4)" } },
    { way: { value: "https://www.openstreetmap.org/way/44" }, wkt: { value: "POINT(1 2)" } },
  ] } })
  assert.deepEqual(ways, [
    { id: 42, name: "Mississippi River", kind: "river", coords: [[-91.1, 33.3], [-91.2, 33.2]], tagCount: 60 },
    { id: 43, name: "", kind: "stream", coords: [[1, 2], [3, 4]], tagCount: 1 },
  ])
  assert.deepEqual(parseQleverWays({ exception: "boom" }), [])
  const servers = waterwayServers([0, 0, 1, 1], "river")
  assert.equal(servers[0].name, "QLever")
  assert.ok(servers.slice(1).every((s) => s.name === "Overpass"))
  assert.match(String(servers[0].request().init.body), /^query=PREFIX/)
})

test("a server that refuses hands over to the next; all refusing reports the most telling error", async () => {
  const asked: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    asked.push(url)
    if (url === "https://a/") return new Response("busy", { status: 504 })
    if (url === "https://b/") return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response("no", { status: 400 })
  }) as typeof fetch
  try {
    const server = (name: string, url: string): WaterwayServer => ({ name, request: () => ({ url, init: { method: "POST" } }), parse: () => [{ id: 1, name, kind: "river", coords: [[0, 0], [1, 1]] }] })
    const ways = await fetchWaterways([10, 10, 10.5, 10.5], "river", { servers: [server("A", "https://a/"), server("B", "https://b/")], hedgeMs: 5000 })
    assert.deepEqual(asked, ["https://a/", "https://b/"])
    assert.equal(ways[0].name, "B")
    await assert.rejects(
      fetchWaterways([20, 20, 20.5, 20.5], "river", { servers: [server("A", "https://a/"), server("C", "https://c/")] }),
      (error: unknown) => error instanceof OverpassError && error.kind === "busy",
    )
    await assert.rejects(fetchWaterways([0, 0, 3, 3], "river"), (error: unknown) => error instanceof OverpassError && error.kind === "too-large")
  } finally {
    globalThis.fetch = realFetch
  }
})

test("the centerline goes out as GeoJSON and comes back from any GeoJSON shape", () => {
  const lines: LngLat[][] = [[[3.3, 46.3], [3.31, 46.4]], [[3.4, 46.3], [3.41, 46.4], [3.42, 46.5]]]
  const out = linesToGeoJson(lines, { name: "Allier" })
  assert.equal(out.type, "FeatureCollection")
  assert.equal(out.features.length, 2)
  assert.equal(out.features[0].geometry.type, "LineString")
  assert.equal(out.features[1].properties.name, "Allier")
  assert.equal(out.features[1].properties.part, 2)
  assert.equal(out.features[0].properties.lengthM, Math.round(lineLengthM(lines[0])))
  assert.deepEqual(linesFromGeoJson(JSON.parse(JSON.stringify(out))), lines)
  // A KML read by togeojson: heights on the vertices, points and polygons beside the line.
  const mixed = { type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1, 2] } },
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[1, 2, 30], [3, 4, 31]] } },
    { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[5, 6], [7, 8]], [[9, 10]]] } },
    { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { type: "Feature", properties: {}, geometry: { type: "GeometryCollection", geometries: [{ type: "LineString", coordinates: [[11, 12], [13, 14]] }] } },
    { type: "Feature", properties: {}, geometry: null },
  ] }
  assert.deepEqual(linesFromGeoJson(mixed), [[[1, 2], [3, 4]], [[5, 6], [7, 8]], [[11, 12], [13, 14]]])
  assert.deepEqual(linesFromGeoJson({ type: "LineString", coordinates: [[0, 0], [500, 0], [1, 1]] }), [[[0, 0], [1, 1]]])
  assert.deepEqual(linesFromGeoJson(null), [])
  assert.deepEqual(linesFromGeoJson("x"), [])
})

test("a long imported line is simplified until it fits in a link", () => {
  // Collinear vertices go first; a real bend stays.
  assert.deepEqual(simplifyLine([[0, 0], [0.5, 0], [1, 0], [1, 1]], 1e-6), [[0, 0], [1, 0], [1, 1]])
  assert.deepEqual(simplifyLine([[0, 0], [1, 1]], 1), [[0, 0], [1, 1]])
  const survey: LngLat[] = Array.from({ length: 20000 }, (_, i) => [3 + i * 2e-5, 46 + Math.sin(i / 300) * 0.01 + Math.sin(i * 1.7) * 2e-6] as LngLat)
  const { text, simplified } = encodeLinesForUrl([survey])
  assert.ok(simplified)
  assert.ok(text.length <= 6000, `${text.length} characters`)
  const back = decodeLines(text)[0]
  assert.ok(back.length < survey.length / 10)
  // Same ends, same length within 1 %.
  assert.ok(Math.abs(back[0][0] - survey[0][0]) < 1e-5 && Math.abs(back[back.length - 1][0] - survey[survey.length - 1][0]) < 1e-5)
  assert.ok(Math.abs(lineLengthM(back) / lineLengthM(survey) - 1) < 0.01)
  const short = encodeLinesForUrl([[[3.3, 46.3], [3.31, 46.4]]])
  assert.equal(short.simplified, false)
})
