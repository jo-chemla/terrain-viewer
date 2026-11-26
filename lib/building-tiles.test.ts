// The building shadows' tile reader, offline: the height rules and the
// geometry on tiles written here (a tiny MVT writer), the decoder against
// @mapbox/vector-tile's own loadGeometry on two recorded z14 tiles of
// Neuschwanstein (lib/fixtures/building-tiles/, 78 kB: Overture's buildings
// release 2026-11-18.0 with 6 buildings in parts, and OpenFreeMap's planet
// tile of 2026-11-22), and the requests (one fetch a tile for two views,
// aborted when nobody wants it) on a stubbed fetch.
//
//   node scripts/test-lib.mjs lib/building-tiles.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import Pbf from "pbf"
import { VectorTile } from "@mapbox/vector-tile"
import type { VectorSourceEntry } from "./source-schema"
import { DEFAULT_HEIGHT_M, FLOOR_M, featureHeight, findVectorSource, heightExpression, propertyNumber } from "./vector-sources"
import {
  DEFAULT_BUILDING_SOURCE_ID, abortBuildingTilesExcept, buildingPolygons, buildingSourceEntry, cachedBuildingTile, decodeBuildingTile,
  isBuildingSource, openBuildingSource, requestBuildingTile, resetBuildingTiles, type BuildingTile,
} from "./building-tiles"

const overture = findVectorSource("overture-buildings")!
const osm = findVectorSource("osm-buildings-openfreemap")!
const FIX = "lib/fixtures/building-tiles/"
const Z = 14, X = 8681, Y = 5725

// ── A tiny MVT writer ───────────────────────────────────────────────────────

type Props = Record<string, string | number | boolean>
type Feature = { props?: Props; rings: [number, number][][]; type?: number }
type Layer = { name: string; extent?: number; features: Feature[] }

const zigzag = (v: number) => (v << 1) ^ (v >> 31)

function mvt(layers: Layer[]): Uint8Array {
  const pbf = new Pbf()
  for (const layer of layers) {
    pbf.writeMessage(3, (l: Layer, out: Pbf) => {
      out.writeVarintField(15, 2)
      out.writeStringField(1, l.name)
      const keys: string[] = [], values: (string | number | boolean)[] = []
      for (const f of l.features) {
        const tags: number[] = []
        for (const [k, v] of Object.entries(f.props ?? {})) {
          let ki = keys.indexOf(k); if (ki < 0) { ki = keys.length; keys.push(k) }
          let vi = values.indexOf(v); if (vi < 0) { vi = values.length; values.push(v) }
          tags.push(ki, vi)
        }
        const geometry: number[] = []
        let cx = 0, cy = 0
        for (const ring of f.rings) {
          geometry.push((1 << 3) | 1, zigzag(ring[0][0] - cx), zigzag(ring[0][1] - cy))
          cx = ring[0][0]; cy = ring[0][1]
          geometry.push(((ring.length - 1) << 3) | 2)
          for (let i = 1; i < ring.length; i++) { geometry.push(zigzag(ring[i][0] - cx), zigzag(ring[i][1] - cy)); cx = ring[i][0]; cy = ring[i][1] }
          geometry.push((1 << 3) | 7)
        }
        out.writeMessage(2, (_: unknown, o: Pbf) => {
          o.writePackedVarint(2, tags)
          o.writeVarintField(3, f.type ?? 3)
          o.writePackedVarint(4, geometry)
        }, null)
      }
      for (const k of keys) out.writeStringField(3, k)
      for (const v of values) out.writeMessage(4, (value: string | number | boolean, o: Pbf) => {
        if (typeof value === "string") o.writeStringField(1, value)
        else if (typeof value === "boolean") o.writeBooleanField(7, value)
        else o.writeDoubleField(3, value)
      }, v)
      out.writeVarintField(5, l.extent ?? 4096)
    }, layer)
  }
  return pbf.finish()
}

// Clockwise on screen (y down): an outer ring, as MVT winds them.
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const hole = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]

/** The rings of polygon p, in tile units. */
function ringsOf(tile: BuildingTile, p: number, x: number, y: number, z: number, extent = 4096): number[][][] {
  const n = 2 ** z, out: number[][][] = []
  for (let r = tile.polyStart[p]; r < tile.polyStart[p + 1]; r++) {
    const ring: number[][] = []
    for (let v = tile.ringStart[r]; v < tile.ringStart[r + 1]; v++) ring.push([Math.round((tile.coords[v * 2] * n - x) * extent), Math.round((tile.coords[v * 2 + 1] * n - y) * extent)])
    out.push(ring)
  }
  return out
}

// ── Sources ─────────────────────────────────────────────────────────────────

test("the sources with a height can cast shadows, the default is OpenFreeMap", () => {
  assert.equal(DEFAULT_BUILDING_SOURCE_ID, osm.id)
  assert.ok(isBuildingSource(overture) && isBuildingSource(osm))
  assert.ok(!isBuildingSource(findVectorSource("vida-open-buildings")), "no heights")
  assert.ok(!isBuildingSource(findVectorSource("osm-liberty-lines-labels")), "a style")
  assert.equal(buildingSourceEntry("overture-buildings").id, "overture-buildings")
  for (const id of [undefined, "", "gone", "vida-open-buildings"]) assert.equal(buildingSourceEntry(id).id, osm.id, String(id))
  const mine = { id: "vec-mine", name: "Mine", kind: "vector", type: "mvt", url: "https://example.org/{z}/{x}/{y}.pbf", sourceLayers: ["b"], heightField: "h", section: "custom" } as VectorSourceEntry
  assert.equal(buildingSourceEntry("vec-mine", [mine]), mine)
})

// ── Height rules ────────────────────────────────────────────────────────────

test("the height: the field, else floors times 3.2 m, else 4 m", () => {
  assert.equal(featureHeight(overture, { height: 31.5, num_floors: 2 }), 31.5)
  assert.equal(featureHeight(overture, { num_floors: 5 }), 5 * FLOOR_M)
  assert.equal(featureHeight(overture, { height: 0, num_floors: 0 }), DEFAULT_HEIGHT_M)
  assert.equal(featureHeight(overture, {}), DEFAULT_HEIGHT_M)
  assert.equal(featureHeight(overture, { height: "12.5" }), 12.5)
  assert.equal(featureHeight(overture, { height: "tall" }, 0), 0)
  assert.equal(featureHeight(osm, { render_height: 9 }), 9)
  assert.equal(featureHeight(osm, { num_floors: 5 }), DEFAULT_HEIGHT_M, "no floors field on this entry")
  assert.equal(propertyNumber(null), 0)
  assert.equal(propertyNumber("x"), -1)
})

test("featureHeight gives what the 3D overlay's heightExpression gives", () => {
  const fromRoot = createRequire(join(process.cwd(), "package.json"))
  const { expression } = createRequire(fromRoot.resolve("maplibre-gl/package.json"))("@maplibre/maplibre-gl-style-spec") as {
    expression: { createExpression: (e: unknown, rootKey: string) => { result: string; value: { evaluate: (g: { zoom: number }, f: { properties: Props }) => number } } }
  }
  const cases: Props[] = [{}, { height: 12 }, { height: 0 }, { height: -3, num_floors: 4 }, { num_floors: 7 }, { height: "18.4" }, { height: "n/a", num_floors: "3" }, { num_floors: 0 }, { render_height: 5 }, { height: 2.5, num_floors: 30 }]
  for (const entry of [overture, osm]) {
    for (const fallback of [DEFAULT_HEIGHT_M, -1]) {
      const compiled = expression.createExpression(heightExpression(entry, fallback), "layers[0].paint.fill-extrusion-height")
      assert.equal(compiled.result, "success")
      for (const properties of cases) {
        assert.equal(featureHeight(entry, properties, fallback), compiled.value.evaluate({ zoom: 15 }, { properties }), `${entry.id} ${JSON.stringify(properties)}`)
      }
    }
  }
})

// ── Decoding, on written tiles ──────────────────────────────────────────────

test("heights, floors, defaults and bases of a written tile", () => {
  const tile = decodeBuildingTile(mvt([{ name: "building", features: [
    { props: { height: 30 }, rings: [box(100, 100, 200, 200)] },
    { props: { num_floors: 5 }, rings: [box(300, 100, 400, 200)] },
    { props: {}, rings: [box(500, 100, 600, 200)] },
    { props: { height: 50, min_height: 20 }, rings: [box(700, 100, 800, 200)] },
    { props: { height: 10, min_height: 10 }, rings: [box(900, 100, 950, 200)] },   // no volume
    { props: { height: 80 }, rings: [box(10, 10, 20, 20)], type: 2 },             // a line
  ] }]), 3, 5, Z, overture)
  assert.equal(tile.count, 4)
  assert.deepEqual([...tile.height], [30, 16, 4, 50])
  assert.deepEqual([...tile.base], [0, 0, 0, 20])
  assert.deepEqual([tile.buildings, tile.stated, tile.floors], [5, 3, 1])
  assert.deepEqual(ringsOf(tile, 0, 3, 5, Z), [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]], "closed, in absolute Mercator")
  assert.ok(tile.coords instanceof Float64Array && tile.height instanceof Float32Array)
  assert.deepEqual([...tile.edge], [0, 0, 0, 0])
  assert.ok(tile.cut.every((c) => c === 0))
  // Without a default height, the building that states nothing is left out.
  assert.deepEqual([...decodeBuildingTile(mvt([{ name: "building", features: [{ props: {}, rings: [box(0, 0, 9, 9)] }, { props: { height: 7 }, rings: [box(20, 0, 29, 9)] }] }]), 0, 0, Z, overture, 0).height], [7])
})

test("a building with parts is replaced by its parts", () => {
  const bytes = mvt([
    { name: "building", features: [
      { props: { height: 100, has_parts: true }, rings: [box(100, 100, 300, 300)] },
      { props: { height: 12, has_parts: false }, rings: [box(500, 500, 600, 600)] },
    ] },
    { name: "building_part", features: [
      { props: { height: 20 }, rings: [box(100, 100, 300, 300)] },                    // the podium
      { props: { height: 100, min_height: 20 }, rings: [box(150, 150, 250, 250)] },   // the tower
    ] },
  ])
  const tile = decodeBuildingTile(bytes, 0, 0, Z, overture)
  assert.deepEqual([...tile.height], [12, 20, 100])
  assert.deepEqual([...tile.base], [0, 0, 20])
  assert.deepEqual([tile.buildings, tile.stated], [2, 2], "the parts are not counted as buildings")
  // An entry without part layers keeps the whole building.
  const whole = decodeBuildingTile(bytes, 0, 0, Z, { ...overture, partLayers: undefined })
  assert.deepEqual([...whole.height], [100, 12])
})

test("holes, multipolygons, dropped rings", () => {
  const tile = decodeBuildingTile(mvt([{ name: "building", features: [
    // A courtyard building and a second polygon of the same feature.
    { props: { height: 15 }, rings: [box(100, 100, 400, 400), hole(200, 200, 300, 300), box(600, 100, 700, 200)] },
    // A hole with no outer ring, a ring of two vertices, a flat ring: nothing.
    { props: { height: 15 }, rings: [hole(800, 800, 900, 900)] },
    { props: { height: 15 }, rings: [[[10, 10], [20, 20]]] },
    { props: { height: 15 }, rings: [[[10, 10], [20, 10], [30, 10]]] },
  ] }]), 0, 0, Z, overture)
  assert.equal(tile.count, 2)
  assert.deepEqual([...tile.polyStart], [0, 2, 3])
  assert.deepEqual([...tile.ringStart], [0, 5, 10, 15])
  assert.deepEqual(ringsOf(tile, 0, 0, 0, Z)[1], [[200, 200], [200, 300], [300, 300], [300, 200], [200, 200]])
  assert.deepEqual([...tile.height], [15, 15])
  // The tile service's form: the same rings as lists.
  const polygons = buildingPolygons(tile)
  assert.equal(polygons.length, 2)
  assert.equal(polygons[0].rings.length, 2)
  assert.equal(polygons[0].height, 15)
  assert.deepEqual(polygons[1].rings[0][0], [600 / 4096 / 2 ** Z, 100 / 4096 / 2 ** Z])
})

test("the cuts along the clip line are not walls", () => {
  // Clipped west at the buffer (-80 here, not OpenFreeMap's 64), and one at
  // the tile's own east line; a wall in the buffer that is not on the cut.
  const tile = decodeBuildingTile(mvt([{ name: "building", features: [
    { props: { height: 10 }, rings: [box(-80, 100, 50, 200)] },
    { props: { height: 10 }, rings: [box(4000, 300, 4096, 400)] },
    { props: { height: 10 }, rings: [box(-40, 500, 60, 600)] },
    { props: { height: 10 }, rings: [box(1000, 1000, 1100, 1100)] },
  ] }]), 7, 9, Z, overture)
  const cutsOf = (p: number) => { const r = tile.polyStart[p]; return [...tile.cut.subarray(tile.ringStart[r], tile.ringStart[r + 1])] }
  // Vertex k's flag is the edge from k-1: box = top, right, bottom, left (the closing edge).
  assert.deepEqual(cutsOf(0), [0, 0, 0, 0, 1], "the west edge, on the buffer line")
  assert.deepEqual(cutsOf(1), [0, 0, 1, 0, 0], "the east edge, on the tile line")
  assert.deepEqual(cutsOf(2), [0, 0, 0, 0, 0], "inside the buffer: a wall")
  assert.deepEqual(cutsOf(3), [0, 0, 0, 0, 0])
  assert.deepEqual([...tile.edge], [1, 1, 1, 0])
})

test("an empty tile, and a tile without the layer", () => {
  assert.equal(decodeBuildingTile(new Uint8Array(0), 0, 0, Z, overture).count, 0)
  const tile = decodeBuildingTile(mvt([{ name: "water", features: [{ rings: [box(0, 0, 9, 9)] }] }]), 0, 0, Z, overture)
  assert.deepEqual([tile.count, tile.buildings, tile.coords.length, [...tile.ringStart], [...tile.polyStart]], [0, 0, 0, [0], [0]])
})

// ── Decoding, on recorded tiles ─────────────────────────────────────────────

/** What @mapbox/vector-tile's own geometry gives, the way the decoder before
 *  this one read it: [height, base, rings in tile units] per polygon. */
function reference(bytes: Uint8Array, entry: VectorSourceEntry): [number, number, number[][][]][] {
  const vt = new VectorTile(new Pbf(bytes))
  const out: [number, number, number[][][]][] = []
  const parts = entry.partLayers ?? []
  for (const [li, name] of [...(entry.sourceLayers ?? []), ...parts].entries()) {
    const layer = vt.layers[name]
    if (!layer) continue
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      if (f.type !== 3) continue
      if (li < entry.sourceLayers!.length && parts.length && entry.hasPartsField && f.properties[entry.hasPartsField] === true) continue
      const height = featureHeight(entry, f.properties), base = entry.minHeightField ? Math.max(0, propertyNumber(f.properties[entry.minHeightField])) : 0
      if (base >= height) continue
      let polygon: number[][][] | null = null
      for (const ring of f.loadGeometry()) {
        if (ring.length < 4) continue
        let a = 0
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) a += (ring[j].x - ring[k].x) * (ring[k].y + ring[j].y)
        if (a === 0) continue
        if (a > 0) { if (polygon) out.push([height, base, polygon]); polygon = [ring.map((p) => [p.x, p.y])] }
        else polygon?.push(ring.map((p) => [p.x, p.y]))
      }
      if (polygon) out.push([height, base, polygon])
    }
  }
  return out
}

for (const [label, file, entry] of [["Overture", "overture-buildings-14-8681-5725.mvt", overture], ["OpenFreeMap", "openfreemap-14-8681-5725.pbf", osm]] as const) {
  test(`a recorded ${label} tile decodes to what loadGeometry gives`, () => {
    const bytes = new Uint8Array(readFileSync(FIX + file))
    const tile = decodeBuildingTile(bytes, X, Y, Z, entry)
    const expected = reference(bytes, entry)
    assert.ok(expected.length > 100, `${expected.length} polygons`)
    assert.equal(tile.count, expected.length)
    for (let p = 0; p < tile.count; p++) {
      assert.equal(tile.height[p], Math.fround(expected[p][0]))
      assert.equal(tile.base[p], Math.fround(expected[p][1]))
      assert.deepEqual(ringsOf(tile, p, X, Y, Z), expected[p][2], `polygon ${p}`)
    }
    assert.ok(tile.decodeMs >= 0 && tile.bytes > 0)
  })
}

test("the recorded Overture tile: buildings, heights, parts", () => {
  const tile = decodeBuildingTile(new Uint8Array(readFileSync(FIX + "overture-buildings-14-8681-5725.mvt")), X, Y, Z, overture)
  assert.deepEqual([tile.buildings, tile.stated], [113, 67])
  assert.ok(tile.base.some((b) => b > 0), "raised parts of the castle")
  // The castle's parts stand in for its outline: no polygon is as tall as
  // the outline's own height over the outline's whole footprint twice.
  const asWhole = decodeBuildingTile(new Uint8Array(readFileSync(FIX + "overture-buildings-14-8681-5725.mvt")), X, Y, Z, { ...overture, partLayers: undefined })
  assert.equal(asWhole.buildings, 113)
  assert.ok(asWhole.base.every((b) => b === 0))
  assert.ok(tile.count > asWhole.count - 6, "6 outlines out, their parts in")
})

// ── Requests ────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch
type Call = { url: string; signal?: AbortSignal }

function stubFetch(answer: (url: string, signal?: AbortSignal) => Promise<Response> | Response): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: unknown, init?: { signal?: AbortSignal }) => {
    const url = String(input)
    calls.push({ url, signal: init?.signal })
    return answer(url, init?.signal)
  }) as typeof fetch
  return calls
}

test("a TileJSON source: one request a tile for two views, the tile cached", async () => {
  resetBuildingTiles()
  const bytes = mvt([{ name: "building", features: [{ props: { render_height: 21 }, rings: [box(100, 100, 200, 200)] }] }])
  const calls = stubFetch((url) => url === osm.url
    ? new Response(JSON.stringify({ tiles: ["https://tiles.example/v1/{z}/{x}/{y}.pbf"], maxzoom: 14 }))
    : new Response(bytes.slice().buffer as ArrayBuffer))
  try {
    const source = await openBuildingSource(osm)
    assert.equal(source.zoom, 14)
    assert.equal(await openBuildingSource(osm), source, "opened once")
    const a = {}, b = {}
    const [ta, tb] = await Promise.all([requestBuildingTile(source, 5, 6, a), requestBuildingTile(source, 5, 6, b)])
    assert.equal(ta, tb)
    assert.deepEqual([...ta!.height], [21])
    assert.deepEqual(calls.map((c) => c.url), [osm.url, "https://tiles.example/v1/14/5/6.pbf"])
    assert.equal(cachedBuildingTile(source, 5, 6), ta)
    assert.equal(await requestBuildingTile(source, 5, 6, a), ta)
    assert.equal(calls.length, 2, "from the cache")
  } finally { globalThis.fetch = realFetch }
})

test("no tile there (404, 204) is an empty tile; a failure is asked again", async () => {
  resetBuildingTiles()
  const mine = { id: "vec-mine", name: "Mine", kind: "vector", type: "mvt", url: "https://example.org/{z}/{x}/{y}.pbf", maxzoom: 12, sourceLayers: ["b"], heightField: "h" } as VectorSourceEntry
  let status = 404
  const calls = stubFetch(() => new Response(null, { status }))
  const warn = console.warn
  console.warn = () => {}
  try {
    const source = await openBuildingSource(mine)
    assert.equal(source.zoom, 12, "the source's own deepest zoom")
    assert.equal((await requestBuildingTile(source, 1, 2, {}))!.count, 0)
    assert.equal(calls[0].url, "https://example.org/12/1/2.pbf")
    status = 204
    assert.equal((await requestBuildingTile(source, 1, 3, {}))!.count, 0)
    status = 500
    assert.equal(await requestBuildingTile(source, 1, 4, {}), null)
    assert.equal(cachedBuildingTile(source, 1, 4), undefined)
    status = 404
    assert.equal((await requestBuildingTile(source, 1, 4, {}))!.count, 0)
    // A source deeper than 14 is read at 14.
    assert.equal((await openBuildingSource({ ...mine, id: "vec-deep", maxzoom: 16 })).zoom, 14)
  } finally { globalThis.fetch = realFetch; console.warn = warn }
})

test("a fetch is aborted once no view wants it", async () => {
  resetBuildingTiles()
  const mine = { id: "vec-slow", name: "Slow", kind: "vector", type: "mvt", url: "https://slow.example/{z}/{x}/{y}.pbf", sourceLayers: ["b"], heightField: "h" } as VectorSourceEntry
  const calls = stubFetch((_url, signal) => new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
  }))
  try {
    const source = await openBuildingSource(mine)
    const a = {}, b = {}
    const pa = requestBuildingTile(source, 1, 1, a), pb = requestBuildingTile(source, 1, 1, b)
    const other = requestBuildingTile(source, 2, 2, a)
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(calls.length, 2)
    // View a moves on and keeps nothing: tile 2/2 was only its own.
    abortBuildingTilesExcept(a, new Set())
    assert.equal(await other, null)
    assert.equal(calls[0].signal!.aborted, false, "view b still waits for 1/1")
    abortBuildingTilesExcept(b, new Set())
    assert.equal(await pa, null)
    assert.equal(await pb, null)
    assert.equal(calls[0].signal!.aborted, true)
  } finally { globalThis.fetch = realFetch }
})
