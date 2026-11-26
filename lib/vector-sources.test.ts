// node scripts/test-lib.mjs lib/vector-sources.test.ts   (offline)
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { sourceKind } from "./source-schema"
import {
  VECTOR_LIBRARY, findVectorSource, needsResolving, resolveVectorUrl, resetVectorResolvers, vectorLayerSpecs, vectorSourceSpec,
  vectorStyleOf, vectorLegend, darken, VECTOR_FOOTPRINT_MINZOOM,
} from "./vector-sources"

// The style validator MapLibre itself runs, found through maplibre-gl (it is
// not a dependency of the app by name).
const fromRoot = createRequire(join(process.cwd(), "package.json"))
const { validateStyleMin } = createRequire(fromRoot.resolve("maplibre-gl/package.json"))("@maplibre/maplibre-gl-style-spec") as { validateStyleMin: (style: unknown) => { message: string }[] }

const overture = findVectorSource("overture-buildings")!
const vida = findVectorSource("vida-open-buildings")!
const osm = findVectorSource("osm-buildings-openfreemap")!
const liberty = findVectorSource("osm-liberty-lines-labels")!
const catalog = (latest: unknown) => (async () => ({ ok: true, json: async () => ({ latest }) })) as unknown as typeof fetch

test("every library entry is a vector source with a licence and a credit", () => {
  assert.ok(VECTOR_LIBRARY.length >= 4)
  const ids = new Set<string>()
  for (const s of VECTOR_LIBRARY) {
    assert.equal(sourceKind(s), "vector", s.id)
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`); ids.add(s.id)
    assert.ok(s.licenseName && s.attribution && s.infoUrl && s.description, `${s.id}: licence, credit, page, description`)
    assert.ok(/^https:\/\//.test(s.url), s.id)
    if (s.type !== "style") assert.ok(s.sourceLayers?.length, `${s.id}: source layers`)
  }
})

test("sourceKind reads vector from its transports, and leaves the others", () => {
  assert.equal(sourceKind({ type: "pmtiles" }), "vector")
  assert.equal(sourceKind({ type: "mvt" }), "vector")
  assert.equal(sourceKind({ type: "terrarium" }), "terrain")
  assert.equal(sourceKind({ type: "tms" }), "raster")
  assert.equal(sourceKind({ type: "tilejson" }), "terrain")
})

test("Overture's address follows the catalog's latest release", async () => {
  assert.ok(needsResolving(overture) && !needsResolving(vida))
  resetVectorResolvers()
  assert.equal(await resolveVectorUrl(overture, catalog("2027-01-20.0")), "https://tiles.overturemaps.org/2027-01-20.0/buildings.pmtiles")
  assert.equal(await resolveVectorUrl(vida), vida.url)
})

test("a catalog that fails or answers nonsense falls back to the pinned release, and is asked again", async () => {
  resetVectorResolvers()
  const failing = (async () => { throw new Error("offline") }) as unknown as typeof fetch
  assert.equal(await resolveVectorUrl(overture, failing), `https://tiles.overturemaps.org/${overture.fallbackRelease}/buildings.pmtiles`)
  assert.equal(await resolveVectorUrl(overture, catalog("../evil?x=")), `https://tiles.overturemaps.org/${overture.fallbackRelease}/buildings.pmtiles`)
  assert.equal(await resolveVectorUrl(overture, catalog("2027-02-17.0")), "https://tiles.overturemaps.org/2027-02-17.0/buildings.pmtiles")
})

test("source specs: a PMTiles archive as a pmtiles:// template with the entry's zooms, a TileJSON by its address", () => {
  const spec = vectorSourceSpec(vida, vida.url)
  assert.deepEqual(spec.tiles, [`pmtiles://${vida.url}/{z}/{x}/{y}`])
  assert.equal(spec.maxzoom, 15)
  assert.ok(spec.attribution)
  const tj = vectorSourceSpec(osm, osm.url)
  assert.equal(tj.url, osm.url)
  assert.equal(tj.tiles, undefined)
})

test("styles: what an entry cannot honor is put back", () => {
  assert.equal(vectorStyleOf(vida, { mode: "3d", colorBy: "height" }).mode, "flat")
  assert.equal(vectorStyleOf(vida, { mode: "3d", colorBy: "height" }).colorBy, "source")
  assert.equal(vectorStyleOf(osm, { colorBy: "source" }).colorBy, "single")
  assert.equal(vectorStyleOf(overture).colorBy, "source")
  assert.equal(vectorStyleOf(osm).color, osm.color)
  assert.equal(vectorStyleOf(osm, { opacity: 7 }).opacity, 1)
})

test("layers: flat is fill plus line, 3D is extrusions with the parts and without the buildings that have parts", () => {
  const flat = vectorLayerSpecs(overture, vectorStyleOf(overture), "p")
  assert.deepEqual(flat.map((l) => l.id), ["p-building-fill", "p-building-line"])
  assert.ok(flat.every((l) => l.minzoom >= VECTOR_FOOTPRINT_MINZOOM))
  const noLine = vectorLayerSpecs(overture, vectorStyleOf(overture, { outline: false }), "p")
  assert.deepEqual(noLine.map((l) => l.type), ["fill"])
  const solid = vectorLayerSpecs(overture, vectorStyleOf(overture, { mode: "3d" }), "p")
  assert.deepEqual(solid.map((l) => l.id), ["p-building-line", "p-building-3d", "p-building_part-3d"])
  assert.match(JSON.stringify(solid[1].filter), /has_parts/)
  assert.doesNotMatch(JSON.stringify(solid[2].filter), /has_parts/)
  assert.deepEqual(vectorLayerSpecs(liberty, vectorStyleOf(liberty), "p"), [])
})

test("every layer of every entry and style is valid MapLibre style", () => {
  for (const entry of VECTOR_LIBRARY) {
    if (entry.type === "style") continue
    for (const mode of ["flat", "3d"] as const) for (const colorBy of ["single", "source", "height"] as const) for (const outline of [true, false]) {
      const layers = vectorLayerSpecs(entry, vectorStyleOf(entry, { mode, colorBy, outline }), "p").map((l) => ({ ...l, source: "s" }))
      const errors = validateStyleMin({ version: 8, sources: { s: vectorSourceSpec(entry, "https://example.com/a.pmtiles") }, layers })
      assert.deepEqual(errors.map((e) => e.message), [], `${entry.id} ${mode} ${colorBy}`)
    }
  }
})

test("legend and outline shade", () => {
  assert.deepEqual(vectorLegend(vida, vectorStyleOf(vida)).map(([l]) => l), ["osm", "microsoft", "google"])
  assert.equal(vectorLegend(osm, vectorStyleOf(osm)).length, 0)
  assert.ok(vectorLegend(osm, vectorStyleOf(osm, { colorBy: "height" })).length > 3)
  assert.equal(darken("#ffffff", 0.5), "#808080")
})
