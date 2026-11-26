// node scripts/test-lib.mjs lib/vector-source-detect.test.ts   (offline)
import test from "node:test"
import assert from "node:assert/strict"
import { detectVectorSource, heightFieldsOf, vectorSourceId, xmlVectorFormat, type PmtilesProbe, type XmlVectorParser } from "./vector-source-detect"
import { vectorLayerSpecs, vectorSourceSpec, vectorStyleOf, findVectorSource, allVectorSources, VECTOR_LIBRARY } from "./vector-sources"

const json = (body: unknown, ok = true, status = 200) => (async () => ({ ok, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) })) as unknown as typeof fetch
const header = { tileType: 1, minZoom: 2, maxZoom: 13, minLon: 2, minLat: 44, maxLon: 6, maxLat: 47 }
const archive = (tileType = 1, metadata: unknown = { name: "Parcels", vector_layers: [{ id: "parcel", fields: { height: "Number", use: "String" } }, { id: "road", fields: {} }], attribution: '<a href="x">Ville</a>' }): PmtilesProbe =>
  async () => ({ header: { ...header, tileType }, metadata })

test("a PMTiles archive of vector tiles: layers, zooms, bounds and the height field from its metadata", async () => {
  const d = await detectVectorSource(" https://example.com/data/parcels.pmtiles ", { pmtiles: archive() })
  assert.equal(d.entry.type, "pmtiles")
  assert.equal(d.entry.kind, "vector")
  assert.equal(d.entry.section, "custom")
  assert.equal(d.entry.url, "https://example.com/data/parcels.pmtiles")
  assert.equal(d.entry.name, "Parcels")
  assert.deepEqual(d.entry.sourceLayers, ["parcel", "road"])
  assert.deepEqual([d.entry.minzoom, d.entry.maxzoom], [2, 13])
  assert.deepEqual(d.entry.bounds, [2, 44, 6, 47])
  assert.equal(d.entry.heightField, "height")
  assert.equal(d.entry.attribution, "Ville")
  assert.deepEqual(d.entry.geometries, ["polygon", "line", "point"])
})

test("pmtiles:// is read as its https address; a raster archive is refused", async () => {
  const d = await detectVectorSource("pmtiles://https://example.com/a.pmtiles", { pmtiles: archive() })
  assert.equal(d.entry.url, "https://example.com/a.pmtiles")
  await assert.rejects(detectVectorSource("https://example.com/dem.pmtiles", { pmtiles: archive(4) }), /raster/)
})

test("a tile template needs its layer names typed", async () => {
  const d = await detectVectorSource("https://tiles.example.com/v1/{z}/{x}/{y}.pbf")
  assert.equal(d.entry.type, "mvt")
  assert.equal(d.entry.sourceLayers, undefined)
  assert.match(d.note ?? "", /type their names/)
})

test("JSON behind the address: a TileJSON or a MapLibre style, anything else refused", async () => {
  const tj = await detectVectorSource("https://example.com/planet", { fetcher: json({ tilejson: "3.0.0", tiles: ["https://example.com/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14, vector_layers: [{ id: "building", fields: { render_height: "Number", render_min_height: "Number" } }] }) })
  assert.equal(tj.entry.type, "tilejson")
  assert.deepEqual(tj.entry.sourceLayers, ["building"])
  assert.equal(tj.entry.heightField, "render_height")
  assert.equal(tj.entry.minHeightField, "render_min_height")
  const style = await detectVectorSource("https://example.com/styles/bright", { fetcher: json({ version: 8, name: "Bright", sources: {}, layers: [] }) })
  assert.equal(style.entry.type, "style")
  assert.equal(style.entry.name, "Bright")
  await assert.rejects(detectVectorSource("https://example.com/x.json", { fetcher: json({ hello: 1 }) }), /neither/)
  await assert.rejects(detectVectorSource("https://example.com/x.json", { fetcher: json({}, false, 404) }), /404/)
  await assert.rejects(detectVectorSource("ftp://example.com/x"), /https address/)
  await assert.rejects(detectVectorSource("https://example.com/dem", { fetcher: json({ tiles: ["https://example.com/{z}/{x}/{y}.png"], format: "png" }) }), /raster/)
})

test("ids are stable slugs of the address; height fields follow the chosen layers", () => {
  assert.equal(vectorSourceId("https://Example.com/data/parcels.pmtiles"), "vec-example-com-data-parcels")
  assert.equal(vectorSourceId("https://t.example.com/v1/{z}/{x}/{y}.pbf"), "vec-t-example-com-v1")
  const lux = vectorSourceId("https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/by_country/country_iso=LUX/LUX.pmtiles")
  const fra = vectorSourceId("https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/by_country/country_iso=FRA/FRA.pmtiles")
  assert.notEqual(lux, fra)
  assert.ok(lux.length < 70 && /^vec-[a-z0-9-]+$/.test(lux), lux)
  assert.deepEqual(heightFieldsOf([{ id: "road", fields: ["name"] }]), {})
  assert.equal(heightFieldsOf([{ id: "b", fields: ["num_floors", "height"] }]).floorsField, "num_floors")
})

test("a source of your own: found by id beside the Library, drawn as fill, outline, lines and points from its first zoom", async () => {
  const { entry } = await detectVectorSource("https://example.com/data/parcels.pmtiles", { pmtiles: archive() })
  assert.equal(findVectorSource(entry.id, [entry]), entry)
  assert.equal(findVectorSource(entry.id), undefined)
  assert.equal(allVectorSources([entry]).length, VECTOR_LIBRARY.length + 1)
  const one = { ...entry, sourceLayers: ["parcel"] }
  const layers = vectorLayerSpecs(one, vectorStyleOf(one), "p")
  assert.deepEqual(layers.map((l) => l.id), ["p-parcel-fill", "p-parcel-line", "p-parcel-path", "p-parcel-point"])
  assert.ok(layers.every((l) => l.minzoom === 2))
  assert.deepEqual(vectorSourceSpec(one, one.url).tiles, ["pmtiles://https://example.com/data/parcels.pmtiles/{z}/{x}/{y}"])
  const solid = vectorLayerSpecs(one, vectorStyleOf(one, { mode: "3d" }), "p")
  assert.ok(solid.some((l) => l.type === "fill-extrusion"))
})

test("a GeoJSON file: read whole, capped at 10 MB, heights from its properties", async () => {
  const fc = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 48] }, properties: { name: "a", height: 12 } }] }
  const d = await detectVectorSource("https://example.com/sites.geojson", { fetcher: json(fc) })
  assert.equal(d.entry.type, "geojson")
  assert.equal(d.entry.heightField, "height")
  assert.match(d.label, /1 feature/)
  const big = (async () => ({ ok: true, status: 200, headers: { get: () => "25000000" }, json: async () => fc })) as unknown as typeof fetch
  await assert.rejects(detectVectorSource("https://example.com/big.geojson", { fetcher: big }), /capped at 10 MB/)
})

test("a KML or a GPX file: recognized by its extension or its first tag, converted, saved as GeoJSON with its format", async () => {
  const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>A</name></Placemark></Document></kml>'
  assert.equal(xmlVectorFormat("https://example.com/sites.kml", kml), "kml")
  assert.equal(xmlVectorFormat("https://example.com/download?id=3", kml), "kml")
  assert.equal(xmlVectorFormat("https://example.com/track.gpx", '<gpx version="1.1"></gpx>'), "gpx")
  assert.equal(xmlVectorFormat("https://example.com/api?f=1", ' <?xml version="1.0"?>\n<gpx version="1.1"></gpx>'), "gpx")
  assert.equal(xmlVectorFormat("https://example.com/x.kml", '{"type":"FeatureCollection","features":[]}'), null, "JSON behind a .kml name is JSON")
  assert.equal(xmlVectorFormat("https://example.com/page", "<html><body></body></html>"), null)
  const seen: string[] = []
  const xml: XmlVectorParser = async (text, format) => { seen.push(`${format}:${text.length}`); return { features: [{ properties: { name: "A", height: 12 } }, { properties: { name: "B" } }] } }
  const d = await detectVectorSource("https://example.com/data/sites.kml", { fetcher: json(kml), xml })
  assert.deepEqual(seen, [`kml:${kml.length}`])
  assert.equal(d.entry.type, "geojson")
  assert.equal(d.entry.format, "kml")
  assert.equal(d.entry.url, "https://example.com/data/sites.kml")
  assert.equal(d.entry.name, "sites (example.com)")
  assert.equal(d.entry.heightField, "height")
  assert.match(d.label, /KML file, 2 features/)
  assert.equal(vectorSourceId("https://example.com/data/sites.kml"), "vec-example-com-data-sites")
  // Drawn as any GeoJSON source: no source-layer.
  assert.equal(vectorLayerSpecs(d.entry, vectorStyleOf(d.entry), "p")[0]["source-layer"], undefined)
  await assert.rejects(detectVectorSource("https://example.com/empty.gpx", { fetcher: json("<gpx></gpx>"), xml: async () => ({ features: [] }) }), /holds no feature/)
  await assert.rejects(detectVectorSource("https://example.com/bad.kml", { fetcher: json("<kml>"), xml: async () => { throw new Error("not valid KML (XML parse error)") } }), /could not be read/)
  const big = (async () => ({ ok: true, status: 200, headers: { get: () => "25000000" }, text: async () => kml })) as unknown as typeof fetch
  await assert.rejects(detectVectorSource("https://example.com/big.kml", { fetcher: big, xml }), /capped at 10 MB/)
})
