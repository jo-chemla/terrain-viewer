// node scripts/test-lib.mjs lib/vector-sources.test.ts   (offline)
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { sourceKind } from "./source-schema"
import {
  VECTOR_LIBRARY, findVectorSource, needsResolving, resolveVectorUrl, resetVectorResolvers, vectorLayerSpecs, vectorSourceSpec,
  vectorStyleOf, vectorLegend, darken, VECTOR_FOOTPRINT_MINZOOM, vectorParts, categoryExpression, hasCategories,
  appFileUrl, isAppFile, splitAlpha, withAlpha, vectorZoomTarget, vectorLibraryGroups, vectorSearchText, VECTOR_LIBRARY_GROUPS,
} from "./vector-sources"
import { searchLibrary } from "./library-search"

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
    // An address, or a file the app serves itself (public/vector/, pulled from the dataset-indexes release).
    assert.ok(/^https:\/\//.test(s.url) || /^\/vector\/[\w-]+\.geojson$/.test(s.url), s.id)
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

test("the Library's order: heritage as the Heritage map lists it, OSM condition in the library only", () => {
  const heritage = VECTOR_LIBRARY.filter((s) => s.libraryGroup === "heritage").map((s) => s.id)
  assert.deepEqual(heritage, ["hwai-heritage-osm", "hwai-heritage-wikidata", "hwai-heritage-osm-condition", "hwai-heritage-inventories", "unesco-world-heritage", "unesco-world-heritage-components"])
  assert.deepEqual(vectorLibraryGroups().map((g) => g.key), ["buildings", "heritage", "landcover", "reference"])
  assert.deepEqual(vectorLibraryGroups().find((g) => g.key === "landcover")!.rows.map((s) => s.id), ["overture-land-cover", "overture-land-use", "ign-ocsge-couverture", "ign-ocsge-usage"])
  // Every group in use is in the registry (a title and a blurb).
  for (const s of VECTOR_LIBRARY) assert.ok(VECTOR_LIBRARY_GROUPS.some((g) => g.key === s.libraryGroup), `${s.id}: group ${s.libraryGroup}`)
  // An unknown group still gets a section, after the others.
  assert.deepEqual(vectorLibraryGroups([{ ...vida, libraryGroup: "zzz" }, overture]).map((g) => g.key), ["buildings", "zzz"])
})

test("the Library's search finds a source by its name, its keywords and its group", () => {
  const find = (q: string) => searchLibrary(VECTOR_LIBRARY, vectorSearchText, q).map((s) => s.id)
  assert.deepEqual(find("land cover"), ["overture-land-cover", "overture-land-use", "ign-ocsge-couverture", "ign-ocsge-usage"])
  assert.ok(find("unesco").includes("unesco-world-heritage") && find("unesco").includes("unesco-world-heritage-components"))
  assert.ok(find("heritage").length >= 6)
  assert.deepEqual(find("vida"), ["vida-open-buildings"])
})

test("land use and land cover: Overture's base archive through the resolver, colored by class, no outlines, drawn from a usable zoom", async () => {
  const cover = findVectorSource("overture-land-cover")!, use = findVectorSource("overture-land-use")!
  resetVectorResolvers()
  assert.equal(await resolveVectorUrl(cover, catalog("2027-03-19.0")), "https://tiles.overturemaps.org/2027-03-19.0/base.pmtiles")
  assert.equal(await resolveVectorUrl(use, catalog("2027-03-19.0")), "https://tiles.overturemaps.org/2027-03-19.0/base.pmtiles")
  for (const [entry, layer, minzoom] of [[cover, "land_cover", 9], [use, "land_use", 13]] as const) {
    const style = vectorStyleOf(entry)
    assert.equal(style.colorBy, "source", entry.id)
    assert.equal(style.outline, false, `${entry.id}: a mosaic of classes has no outlines by default`)
    assert.equal(vectorStyleOf(entry, { outline: true }).outline, true, "the user's choice wins")
    const layers = vectorLayerSpecs(entry, style, "p")
    assert.deepEqual(layers.map((l) => l.id), [`p-${layer}-fill`])
    assert.equal(layers[0].minzoom, minzoom)
    assert.equal(vectorSourceSpec(entry, "https://x/base.pmtiles").minzoom, minzoom)
    assert.ok(vectorLegend(entry, style).length >= 10)
    assert.ok(!entry.heightField, "no heights: not a building source")
  }
  const ocs = findVectorSource("ign-ocsge-couverture")!
  assert.equal(ocs.type, "mvt")
  assert.deepEqual(vectorSourceSpec(ocs, ocs.url).tiles, [ocs.url])
  assert.equal(vectorSourceSpec(ocs, ocs.url).minzoom, 13)
  // A color per class, each value once: a polygon cannot match two.
  for (const id of ["overture-land-cover", "overture-land-use", "ign-ocsge-couverture", "ign-ocsge-usage"]) {
    const values = findVectorSource(id)!.categories!.flatMap((c) => (Array.isArray(c.value) ? c.value : [c.value]))
    assert.equal(new Set(values).size, values.length, id)
  }
})

test("an entry's filter joins every layer; outlines only draws a line in the fill color and nothing else", () => {
  const inv = findVectorSource("hwai-heritage-inventories")!
  const [points, shapes] = vectorParts(inv)
  assert.equal(shapes.polygonFill, false)
  assert.equal(points.filter, undefined, "the companion's filter is its own")
  const style = vectorStyleOf(inv)
  const layers = vectorLayerSpecs(shapes, style, "p")
  assert.deepEqual(layers.map((l) => `${l.id}:${l.type}`), ["p-shapes-line:line", "p-shapes-path:line"])
  assert.ok(Array.isArray(layers[0].paint["line-color"]), "the category color, not a dark outline")
  for (const l of layers) {
    assert.equal((l.filter as unknown[])[0], "all")
    assert.match(JSON.stringify(l.filter), /EPSG:4326/)
  }
  // No fill and no extrusion whatever the style asks for.
  const forced = vectorLayerSpecs({ ...shapes, heightField: "height" }, { ...style, mode: "3d", outline: false }, "p")
  assert.ok(forced.every((l) => l.type === "line"))
  // A source without a filter keeps the plain geometry test.
  assert.equal((vectorLayerSpecs(overture, vectorStyleOf(overture), "p")[0].filter as unknown[])[0], "match")
})

test("Zoom to: the bounds of a regional source, the sample place of a worldwide one, nothing without either", () => {
  assert.deepEqual(vectorZoomTarget(findVectorSource("ign-ocsge-couverture")!), { bounds: [-5.150528, 41.324748, 9.5711517, 51.0992102] })
  assert.deepEqual(vectorZoomTarget(overture), { center: [-73.985, 40.755], zoom: 15 })
  assert.equal(vectorZoomTarget(findVectorSource("unesco-world-heritage")!), null)
  assert.equal(vectorZoomTarget(liberty), null)
  // The whole world as bounds is no place to zoom to.
  assert.equal(vectorZoomTarget({ ...vida, sample: undefined, bounds: [-180, -85, 180, 85] }), null)
  assert.deepEqual(vectorZoomTarget({ ...vida, sample: undefined, bounds: [2, 44, 6, 47] }), { bounds: [2, 44, 6, 47] })
  // A sample is at or past the zoom its layers draw from.
  for (const s of VECTOR_LIBRARY) if (s.sample) assert.ok(s.sample.zoom >= (s.minzoom ?? 0), `${s.id}: sample zoom`)
})

test("a file of the app's own origin sits under the base path; any other address is left alone", () => {
  const unesco = findVectorSource("unesco-world-heritage")!
  assert.ok(isAppFile(unesco.url) && !isAppFile("//example.com/x") && !isAppFile(vida.url))
  assert.equal(appFileUrl(unesco.url, "/"), "/vector/unesco-world-heritage.geojson")
  assert.equal(appFileUrl(unesco.url, "/terrain-viewer/"), "/terrain-viewer/vector/unesco-world-heritage.geojson")
  assert.equal(appFileUrl(unesco.url, "/terrain-viewer"), "/terrain-viewer/vector/unesco-world-heritage.geojson")
  assert.equal(appFileUrl(vida.url, "/terrain-viewer/"), vida.url)
  assert.ok(!needsResolving(unesco))
})

test("one opacity per overlay: the picker's #rrggbbaa is the color and the row's opacity", () => {
  assert.equal(withAlpha("#7ebc6f", 0.7), "#7ebc6fb3")
  assert.equal(withAlpha("#7EBC6F", 1), "#7ebc6fff")
  assert.equal(withAlpha("#7ebc6fb3", 0), "#7ebc6f00", "an alpha already there is replaced")
  assert.deepEqual(splitAlpha("#ff000080"), { color: "#ff0000", opacity: 0.5 })
  assert.deepEqual(splitAlpha("#FF0000"), { color: "#ff0000" }, "no alpha typed: the opacity is left as it is")
  assert.deepEqual(splitAlpha("#f008"), { color: "#ff0000", opacity: 0.53 })
  assert.deepEqual(splitAlpha(withAlpha("#123456", 0.7)), { color: "#123456", opacity: 0.7 })
  assert.deepEqual(splitAlpha("nonsense"), { color: "#f97316" })
})

test("a KML or GPX source hands the map its converted features in place of the address", () => {
  const kml = { id: "vec-k", name: "K", kind: "vector", section: "custom", type: "geojson", format: "kml", url: "https://example.com/a.kml", geometries: ["polygon", "line", "point"] } as const
  const spec = vectorSourceSpec(kml as never, kml.url)
  assert.equal(spec.type, "geojson")
  assert.equal(spec.data, kml.url, "the renderer replaces it with the converted collection")
  const layers = vectorLayerSpecs(kml as never, vectorStyleOf(kml as never), "p").map((l) => ({ ...l, source: "s" }))
  assert.deepEqual(validateStyleMin({ version: 8, sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } }, layers }).map((e) => e.message), [])
})
