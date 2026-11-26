// node scripts/test-lib.mjs lib/vector-sources.test.ts   (offline)
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { sourceKind } from "./source-schema"
import {
  VECTOR_LIBRARY, findVectorSource, needsResolving, resolveVectorUrl, resetVectorResolvers, vectorLayerSpecs, vectorSourceSpec,
  vectorStyleOf, vectorLegend, darken, VECTOR_FOOTPRINT_MINZOOM, vectorParts, categoryExpression, hasCategories,
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
    if (s.type !== "style" && s.type !== "geojson") assert.ok(s.sourceLayers?.length, `${s.id}: source layers`)
    for (const c of s.companions ?? []) assert.ok(/^https:\/\//.test(c.url) && c.sourceLayers?.length, `${s.id}: companion`)
    for (const c of s.categories ?? []) assert.ok(/^#[0-9a-f]{6}$/.test(c.color) && c.field && c.label, `${s.id}: category ${c.label}`)
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
  assert.deepEqual(vectorLegend(vida, vectorStyleOf(vida)).map(([l]) => l), ["OpenStreetMap", "Google", "Microsoft", "other"])
  assert.equal(vectorLegend(osm, vectorStyleOf(osm)).length, 0)
  assert.ok(vectorLegend(osm, vectorStyleOf(osm, { colorBy: "height" })).length > 3)
  assert.equal(darken("#ffffff", 0.5), "#808080")
})

test("one color per origin, the same on every source", () => {
  const colorOf = (id: string, label: string) => findVectorSource(id)!.categories!.find((c) => c.label === label)!.color
  for (const label of ["OpenStreetMap", "Google", "Microsoft"]) assert.equal(colorOf("overture-buildings", label), colorOf("vida-open-buildings", label), label)
  assert.equal(findVectorSource("osm-buildings-openfreemap")!.color, colorOf("overture-buildings", "OpenStreetMap"))
})

test("categories: a value, one of several values, or any non-empty value; the first match wins", () => {
  const heritage = findVectorSource("hwai-heritage-osm")!
  const condition = findVectorSource("hwai-heritage-osm-condition")!
  assert.ok(hasCategories(heritage) && !hasCategories(osm))
  const any = JSON.stringify(categoryExpression(heritage, "#000000"))
  assert.match(any, /"!=",\["to-string",\["get","historic"\]\],""/)
  const several = JSON.stringify(categoryExpression(condition, "#000000"))
  assert.match(several, /"in",\["to-string",\["get","status"\]\],\["literal",\["demolished","razed"\]\]/)
  assert.equal(categoryExpression(osm, "#123456"), "#123456")
})

test("the shared style: flat or 3D and color by for every source, each falling back to what it has", () => {
  const heritage = findVectorSource("hwai-heritage-wikidata")!
  assert.equal(vectorStyleOf(overture, {}, { mode: "3d", colorBy: "auto" }).mode, "3d")
  assert.equal(vectorStyleOf(vida, {}, { mode: "3d", colorBy: "height" }).mode, "flat")
  assert.equal(vectorStyleOf(vida, {}, { mode: "3d", colorBy: "height" }).colorBy, "source")
  assert.equal(vectorStyleOf(overture, { colorBy: "single" }, { mode: "flat", colorBy: "auto" }).colorBy, "source")
  assert.equal(vectorStyleOf(overture, {}, { mode: "flat", colorBy: "single" }).colorBy, "single")
  assert.equal(vectorStyleOf(heritage, {}, { mode: "flat", colorBy: "height" }).colorBy, "source")
  assert.equal(vectorStyleOf(osm, {}, { mode: "flat", colorBy: "auto" }).colorBy, "single")
})

test("companions are sources of their own; a GeoJSON source has no source-layer; heritage points draw at every zoom", () => {
  const heritage = findVectorSource("hwai-heritage-osm")!
  const parts = vectorParts(heritage)
  assert.deepEqual(parts.map((p) => p.id), ["hwai-heritage-osm", "hwai-heritage-osm--1"])
  assert.match(parts[1].url, /shapes\.pmtiles$/)
  assert.deepEqual(parts[1].sourceLayers, ["shapes"])
  assert.equal(parts[1].companions, undefined)
  const points = vectorLayerSpecs(parts[0], vectorStyleOf(parts[0]), "p")
  assert.deepEqual(points.map((l) => l.type), ["circle"])
  assert.equal(points[0].minzoom, 0)
  assert.deepEqual(vectorLayerSpecs(parts[1], vectorStyleOf(parts[1]), "p").map((l) => l.type), ["fill", "line", "line"])
  const unesco = findVectorSource("unesco-world-heritage")!
  assert.equal(vectorSourceSpec(unesco, unesco.url).type, "geojson")
  assert.equal(vectorSourceSpec(unesco, unesco.url).data, unesco.url)
  const layer = vectorLayerSpecs(unesco, vectorStyleOf(unesco), "p")[0]
  assert.equal(layer["source-layer"], undefined)
  assert.equal(layer.id, "p-data-point")
})
