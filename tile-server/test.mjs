// The tile service without a network listener: tile blocks, the query
// vocabulary, which engine draws what, every source type through the app's
// readers (network), vector tiles and symbol anchors, the docs copy of the
// OpenAPI description. `pnpm test` (builds generated/ first).
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { blockOf, viewOf, sources } from "./server.mjs"
import { DOCS_COPY, docsCopyText } from "./openapi.mjs"
import { viewToQuery, queryToView } from "./url.mjs"
import { plan } from "./direct.mjs"
import { stacItem, PROCESSING_EXT, VERSION } from "./stac.mjs"

// A JSON Schema check, the subset the vendored STAC Processing extension
// schema (schemas/stac-processing-v1.2.0.json, draft-07) uses: offline.
function schemaErrors(schema, value, root = schema, at = "$") {
  if (schema === true || schema === undefined) return []
  if (schema === false) return [`${at}: not allowed`]
  const errs = []
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o[k], root)
    errs.push(...schemaErrors(target, value, root, at))
  }
  const kind = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v)
  if (schema.type && !(kind(value) === schema.type || (schema.type === "number" && kind(value) === "integer"))) return [`${at}: ${kind(value)}, not ${schema.type}`]
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errs.push(`${at}: not ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${at}: not in enum`)
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match ${schema.pattern}`)
  if (schema.format === "date-time" && typeof value === "string" && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(value)) errs.push(`${at}: not a date-time`)
  if (schema.required && kind(value) === "object") for (const k of schema.required) if (!(k in value)) errs.push(`${at}: ${k} is required`)
  if (kind(value) === "object") {
    for (const [k, v] of Object.entries(value)) {
      let matched = false
      if (schema.properties && k in schema.properties) { matched = true; errs.push(...schemaErrors(schema.properties[k], v, root, `${at}.${k}`)) }
      for (const [re, sub] of Object.entries(schema.patternProperties ?? {})) if (new RegExp(re).test(k)) { matched = true; errs.push(...schemaErrors(sub, v, root, `${at}.${k}`)) }
      if (!matched && "additionalProperties" in schema) errs.push(...schemaErrors(schema.additionalProperties, v, root, `${at}.${k}`))
    }
  }
  if (schema.contains && kind(value) === "array" && !value.some((v) => !schemaErrors(schema.contains, v, root).length)) errs.push(`${at}: contains none`)
  if (schema.allOf) for (const sub of schema.allOf) errs.push(...schemaErrors(sub, value, root, at))
  if (schema.anyOf && !schema.anyOf.some((sub) => !schemaErrors(sub, value, root, at).length)) errs.push(`${at}: matches none of anyOf`)
  if (schema.not && !schemaErrors(schema.not, value, root, at).length) errs.push(`${at}: matches not`)
  return errs
}
const PROCESSING_SCHEMA = JSON.parse(readFileSync(new URL("./schemas/stac-processing-v1.2.0.json", import.meta.url), "utf8"))
/** A STAC 1.1.0 Item with the Processing extension: the core fields by
 *  hand, the extension by its schema. */
function assertStacItem(item) {
  assert.equal(item.type, "Feature"); assert.equal(item.stac_version, "1.1.0")
  assert.equal(typeof item.id, "string"); assert.ok(item.id.length)
  assert.ok(Array.isArray(item.bbox) && item.bbox.length === 4 && item.bbox.every(Number.isFinite) && item.bbox[0] < item.bbox[2] && item.bbox[1] < item.bbox[3])
  assert.equal(item.geometry.type, "Polygon"); assert.equal(item.geometry.coordinates[0].length, 5)
  assert.ok(!Number.isNaN(Date.parse(item.properties.datetime)))
  assert.ok(item.links.every((l) => typeof l.href === "string" && typeof l.rel === "string"))
  assert.ok(item.links.some((l) => l.rel === "derived_from"))
  assert.ok(Object.values(item.assets).every((a) => typeof a.href === "string"))
  assert.deepEqual(schemaErrors(PROCESSING_SCHEMA, item), [])
}

// The validator rejects what the schema rejects.
{
  const item = (properties, ext = [PROCESSING_EXT]) => ({ type: "Feature", stac_extensions: ext, properties, assets: {} })
  assert.ok(schemaErrors(PROCESSING_SCHEMA, item({ datetime: "x" })).length, "no processing field")
  assert.ok(schemaErrors(PROCESSING_SCHEMA, item({ "processing:datetime": "2026-01-01T00:00:00+02:00" })).length, "not UTC")
  assert.ok(schemaErrors(PROCESSING_SCHEMA, item({ "processing:expression": { format: "x" } })).length, "expression without expression")
  assert.ok(schemaErrors(PROCESSING_SCHEMA, item({ "processing:lineage": "x" }, [])).length, "extension not declared")
  assert.ok(schemaErrors(PROCESSING_SCHEMA, item({ "processing:typo": "x", "processing:lineage": "x" })).length, "unknown processing: field")
}

// STAC Items of exports, offline: footprint, lineage, expression, keys left out.
{
  const now = new Date("2026-11-24T10:00:00Z")
  const tile = stacItem("http://h", "/terrain-tiles/13/4270/2911.tif", "?modes=slope&slopeMaxDegrees=45&mapboxKey=secret", { now, sources: () => [{ id: "mapterhorn", url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp" }] })
  assertStacItem(tile)
  assert.ok(!JSON.stringify(tile).includes("secret"), "the caller's key is left out")
  assert.ok(Math.abs(tile.bbox[0] - (4270 / 8192 * 360 - 180)) < 1e-6 && Math.abs(tile.bbox[2] - (4271 / 8192 * 360 - 180)) < 1e-6)
  assert.equal(tile.properties["processing:datetime"], "2026-11-24T10:00:00Z")
  assert.deepEqual(tile.properties["processing:software"], { "terrain-viewer tile-server": VERSION })
  assert.equal(tile.properties["processing:level"], "L3")
  assert.deepEqual(tile.properties["processing:expression"], { format: "x-tv-process", expression: { process: "slope", processes: ["slope"], endpoint: "terrain-tiles", inputs: { terrainSource: "mapterhorn", slopeMaxDegrees: "45" } } })
  assert.match(tile.properties["processing:lineage"], /mode slope .*mapterhorn.*slopeMaxDegrees=45/)
  assert.ok(tile.links.some((l) => l.rel === "derived_from" && l.href === "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"))
  assert.equal(tile.assets.data.type, "image/tiff; application=geotiff")
  assert.deepEqual(tile.assets.data.roles, ["data"])
  const box = stacItem("http://h", "/render.tif", "?modes=svf&terrainSource=https://example.com/{z}/{x}/{y}.png&bbox=7.6,45.95,7.7,46&width=800&height=600", { now })
  assertStacItem(box); assert.deepEqual(box.bbox, [7.6, 45.95, 7.7, 46])
  assert.ok(box.links.some((l) => l.rel === "derived_from" && l.href === "https://example.com/{z}/{x}/{y}.png"))
  // A picture of a box shows more than the box when the shapes differ.
  const pic = stacItem("http://h", "/render.png", "?modes=hillshade,contours&bbox=7.6,45.95,7.7,46&width=1000&height=1000", { now })
  assertStacItem(pic); assert.ok(pic.bbox[1] < 45.95 && pic.bbox[3] > 46 && Math.abs(pic.bbox[0] - 7.6) < 1e-6)
  assert.deepEqual(pic.properties["processing:expression"].expression.processes, ["hillshade", "contours"])
  assert.deepEqual(pic.assets.data.roles, ["visual"])
  const centre = stacItem("http://h", "/render.jpg", "?lat=45.83&lng=6.86&zoom=11&width=1024&height=640", { now })
  assertStacItem(centre); assert.ok(centre.bbox[0] < 6.86 && centre.bbox[2] > 6.86)
  const imagery = stacItem("http://h", "/basemap-tiles/14/8492/5792.jpg", "?imagerySource=wayback&imageryDate=2020-01-01", { now })
  assertStacItem(imagery); assert.equal(imagery.properties["processing:level"], undefined)
  assert.equal(stacItem("http://h", "/terrain-tiles/2/2/1.pbf", ""), null, "a vector tile has none")
}

// The API reference lists the processes first, then the tiles; no titiler group.
{
  const { openapi } = await import("./openapi.mjs")
  const doc = openapi()
  assert.deepEqual(doc.tags.map((t) => t.name), ["OGC API - Processes", "Terrain tiles", "Basemap tiles", "Catalogs", "Viewport", "Values", "Service"])
  const used = new Set(Object.values(doc.paths).flatMap((p) => Object.values(p).flatMap((op) => op.tags)))
  assert.deepEqual([...used].sort(), doc.tags.map((t) => t.name).sort(), "every tag used, every used tag listed")
  assert.ok(!Object.keys(doc.paths).some((p) => p.startsWith("/tiles/")), "no /tiles path documented")
}

// The tile service: a 256 px tile is drawn one MapLibre zoom lower, in a block of 8 x 8.
{
  const b = blockOf(12, 2125, 1464, 256)
  assert.deepEqual([b.per, b.side, b.zoom, b.col, b.row], [8, 2048, 11, 5, 0])
  assert.ok(Math.abs(b.lng - (2124 / 4096 * 360 - 180)) < 1e-9 && b.lat > 45 && b.lat < 47)
  assert.deepEqual([blockOf(1, 1, 0, 512).per, blockOf(1, 1, 0, 512).side, blockOf(1, 1, 0, 512).lng], [2, 1024, 0])
  assert.deepEqual(viewOf("?modes=slope,svf&terrainSource=x&slopeOpacity=0.5").view.modes, ["slope", "svf"])
  // titiler's names, and a view through the query and back.
  assert.deepEqual(viewOf("?url=x&algorithm=slope").view, { terrainSource: "x", modes: ["slope"] })
  const v = { lat: 45.8, lng: 6.9, zoom: 11, viewMode: "3d", modes: [], terrainSource: "a", params: { slopeOpacity: "0.5" } }
  const back = queryToView(viewToQuery(v))
  assert.deepEqual({ ...back.view, params: Object.fromEntries(back.rest) }, v)
  // Which engine draws what.
  assert.equal((await plan({ modes: ["hillshade", "slope", "contours"] }, new URLSearchParams("slopeOpacity=0.5"))).engine, "direct")
  for (const m of ["lrm", "svf", "phong", "matcap", "shapeIndex", "contours"]) assert.equal((await plan({ modes: [m] }, new URLSearchParams())).engine, "direct", m)
  assert.deepEqual((await plan({ modes: ["aspect"] }, new URLSearchParams())).layers, ["aspect"])
  // The overlays, in the map's order, and the dark theme.
  assert.deepEqual((await plan({ modes: ["contours", "planeSlicer", "moundDetector", "graticules", "isoline", "hillshade"] }, new URLSearchParams("contourReferenceMode=lrm&theme=dark"))).layers, ["hillshade", "isoline", "graticules", "tells", "planeSlicer", "contours"])
  assert.equal((await plan({ modes: ["isoline"] }, new URLSearchParams())).state.showContours, false, "the iso-line alone does not bring the contours")
  // A default written as a constant's name resolves from the bundle.
  {
    const { state } = await plan({ modes: ["moundDetector"] }, new URLSearchParams())
    for (const k of ["tellsScaleMultiplier", "matcapTextureId", "shapeIndexCustomStops"]) assert.ok(state[k] !== undefined && typeof state[k] !== "string" || k === "matcapTextureId" && state[k], k)
  }
  // Every source type the app reads is read here, with the app's readers.
  for (const [id, scheme] of [
    ["esri", /^lerc:\/\//],
    ["custom-np-bhotekoshi-dsm-rasuwagadhi", /^cog:\/\/https:/],
    ["custom-uk-wg-lidar-dtm1", /^https:\/\/titiler\.xyz\/cog\/tiles\//],
    ["custom-ht-cnigs-dtm15", /^vrt:\/\//],
    ["custom-us-hi-dtm1-lerc", /^lerc:\/\//],
    ["custom-ign-lidarhd-dtm-wms-raw", /^float32dem-bbox:\/\//],
    ["custom-nl-ahn-nhm", /^demdiff:\/\//],
    ["custom-ch-swisstopo-terrain3d-qm", /^quantized-mesh:\/\//],
    ["custom-global-smartmaps-gel", /^pmtiles:\/\//],
  ]) {
    const how = await plan({ terrainSource: id, modes: ["hillshade"] }, new URLSearchParams())
    assert.equal(how.engine, "direct", `${id}: ${how.why}`)
    assert.match(how.dem.tiles, scheme, id)
  }
  assert.equal((await plan({ terrainSource: "custom-ign-lidarhd-dtm-wms-raw" }, new URLSearchParams())).dem.encoding, "terrarium")
  assert.equal((await plan({ terrainSource: '{"url":"https://example.com/dem.vrt"}' }, new URLSearchParams())).engine, "browser", "a VRT that does not answer")
  assert.match((await plan({ terrainSource: "mapbox" }, new URLSearchParams())).why, /API key/)
  // With the caller's key: Mapbox and MapTiler in the address, Cesium ion's token in `t`.
  {
    const mb = await plan({ terrainSource: "mapbox" }, new URLSearchParams(), { mapboxKey: "pk.test" })
    assert.equal(mb.engine, "direct"); assert.ok(mb.dem.tiles.includes("pk.test"), mb.dem.tiles)
    const ion = await plan({ terrainSource: "cesium" }, new URLSearchParams(), { cesiumIonKey: "tok" })
    assert.equal(ion.engine, "direct"); assert.match(ion.dem.tiles, /^quantized-mesh:\/\/ion\/1\/.*[?&]t=tok/)
  }
  // Vector tiles written and read back; MapLibre's line anchors.
  {
    const { writeTile, readLayers, overzoom } = await import("./mvt.mjs")
    const layers = [{ name: "a", extent: 4096, features: [{ type: 2, properties: { ele: 100, kind: "x", on: true }, geometry: [[[0, 0], [4096, 4096]]] }, { type: 1, properties: { v: -1.5 }, geometry: [[[10, 20]]] }] }]
    const back = readLayers(writeTile(layers))
    assert.deepEqual(back[0].features.map((f) => [f.type, { ...f.properties }, f.geometry]), layers[0].features.map((f) => [f.type, f.properties, f.geometry]))
    assert.deepEqual(overzoom(back, 1, 1, 1)[0].features[0].geometry, [[[-4096, -4096], [4096, 4096]]])
    const { symbolAnchors } = await import("./symbols.mjs")
    // A line from the tile's edge: anchors every 28 px from 14 px in (16 units a px).
    assert.deepEqual(symbolAnchors([[[0, 100], [8192, 100]]], { spacingPx: 28, shapedLength: 18 }).slice(0, 3).map((a) => a.x), [224, 672, 1120])
  }
  // The dated imagery: one schema (lib/dated-imagery.ts), url.mjs's list a part of it.
  {
    const { DATED_IMAGERY_SOURCES, findDatedImagery } = await import("./generated/app-lib.mjs")
    const { IMAGERY_SOURCES } = await import("./url.mjs")
    assert.deepEqual(DATED_IMAGERY_SOURCES.map((s) => s.id), ["wayback", "hls", "ge-historical", "planet", "eox-s2", "bing"])
    for (const id of IMAGERY_SOURCES) assert.ok(findDatedImagery(id), `${id} is a dated source`)
    const eox = findDatedImagery("eox-s2"), d2020 = Date.UTC(2020, 0, 4)
    assert.match(eox.tiles({ dateMs: d2020 }).tiles[0], /s2cloudless-2020_3857/)
    assert.equal(eox.tiles({ dateMs: 0 }), null, "no date, no tiles")
    assert.ok((await eox.listDates({ lat: 0, lng: 0, zoom: 10 }, Date.UTC(2019, 0, 1), Date.UTC(2021, 11, 31), {})).length === 3)
    assert.equal(findDatedImagery("planet").tiles({ dateMs: d2020 }, { keys: {} }), null, "Planet needs its key")
    assert.equal(findDatedImagery("wayback").tiles({ dateMs: d2020 }), null, "a Wayback date names no tiles until resolved to a release")
    assert.equal(findDatedImagery("hls").realDates, false)
    assert.match(findDatedImagery("bing").tiles({ dateMs: 0 }).buildTileUrl(1, 0, 0), /tiles\/a0\.jpeg/)
    // The national and regional series, dated sources of the same schema
    // (lib/national-dated.ts): PNOA's years in Spain, PDOK's in the Netherlands.
    const { NATIONAL_DATED_SOURCES, ALL_DATED_IMAGERY_SOURCES, NATIONAL_SOURCES } = await import("./generated/app-lib.mjs")
    assert.equal(NATIONAL_DATED_SOURCES.length, NATIONAL_SOURCES.length)
    const { STAC_DATED_SOURCES } = await import("./generated/app-lib.mjs")
    assert.equal(ALL_DATED_IMAGERY_SOURCES.length, DATED_IMAGERY_SOURCES.length + NATIONAL_SOURCES.length + STAC_DATED_SOURCES.length)
    // STAC catalogs (lib/stac-dated.ts): one adapter, OpenAerialMap and Maxar among its presets.
    assert.equal(findDatedImagery("stac-oam").section, "catalog")
    assert.equal(findDatedImagery("stac-maxar").granularity, "capture")
    assert.equal(findDatedImagery("stac-oam").tiles({ dateMs: Date.UTC(2023, 1, 9) }), null, "no listing yet, no tiles")
    assert.equal(new Set(ALL_DATED_IMAGERY_SOURCES.map((s) => s.id)).size, ALL_DATED_IMAGERY_SOURCES.length, "ids are distinct")
    const madrid = { lat: 40.4168, lng: -3.7038, zoom: 14 }
    const pnoa = NATIONAL_DATED_SOURCES.find((s) => /PNOA/.test(s.name))
    const pnoaDates = await pnoa.listDates(madrid, 0, Date.now(), {})
    assert.ok(pnoaDates.length > 3, `PNOA lists years in Madrid (${pnoaDates.length})`)
    assert.match(pnoa.tiles(pnoaDates[0]).tiles[0], /\{bbox-epsg-3857\}/, "a WMS layer as a raster source")
    assert.deepEqual(await pnoa.listDates({ lat: 52.37, lng: 4.9, zoom: 14 }, 0, Date.now(), {}), [], "no PNOA in Amsterdam")
    const pdok = findDatedImagery("cat-nat-pdok") ?? NATIONAL_DATED_SOURCES.find((s) => /PDOK/.test(s.name))
    assert.ok((await pdok.listDates({ lat: 52.37, lng: 4.9, zoom: 14 }, 0, Date.now(), {})).length > 3, "PDOK years in Amsterdam")
    const gtl = findDatedImagery("cat-nat-gtimelapse")
    assert.equal(gtl.fixedDates({}).length, 39)
    assert.match(gtl.tiles({ dateMs: Date.UTC(2000, 0, 1) }).tiles[0], /year=2000/)
  }
  // One list of entries: the Worldwide Defaults first (built-ins, then GEM-15
  // from the library), keyed ones read with the caller's key, then the library.
  {
    const list = sources()
    assert.deepEqual(list.filter((s) => s.section === "defaults").map((s) => s.id), ["mapterhorn", "esri", "mapbox", "maptiler", "aws", "cesium", "custom-global-gem15-dtm"])
    assert.equal(list[0].url, "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp")
    assert.equal(list.find((s) => s.id === "mapbox").key, "mapboxKey")
    assert.equal(list.find((s) => s.id === "mapbox").url, undefined, "a keyed template is not listed as a plain pyramid")
    const gem = await plan({ terrainSource: "custom-global-gem15-dtm", modes: ["hillshade"] }, new URLSearchParams())
    assert.equal(gem.engine, "direct", gem.why); assert.match(gem.dem.tiles, /^vrt:\/\//)
    const mt = await plan({ terrainSource: "maptiler" }, new URLSearchParams(), { maptilerKey: "mtk" })
    assert.ok(mt.dem.tiles.includes("key=mtk") && mt.dem.tileSize === 512, JSON.stringify(mt.dem))
    assert.equal((await plan({ terrainSource: "mapterhorn" }, new URLSearchParams())).dem.tileSize, 512)
  }
  assert.match((await plan({ terrainSource: "nope" }, new URLSearchParams())).why, /unknown terrain source/)
  assert.match((await plan({ modes: ["hillshade"], viewMode: "3d" }, new URLSearchParams())).why, /3D/)
  assert.match((await plan({ modes: ["basemap"] }, new URLSearchParams())).why, /imagery/)
  assert.equal((await plan({ terrainSource: '{"url":"https://x/{z}/{x}/{y}.png","type":"terrainrgb"}' }, new URLSearchParams())).dem.encoding, "mapbox")
  assert.equal(readFileSync(DOCS_COPY, "utf8").replaceAll(String.fromCharCode(13), ""), docsCopyText(), "docs/public/tile-service-openapi.json is stale: run `node openapi.mjs` in tile-server/")
}

// Building shadows are drawn here now; the QGIS project of a share link.
{
  assert.equal((await plan({ modes: ["buildingShadows"] }, new URLSearchParams())).engine, "direct")
  const { activeLayers } = await import("./direct.mjs")
  const { readView, qgisProjectXml } = await import("./qgis-project.mjs")
  const { view, rest } = viewOf("?terrainSourceA=custom-nl-ahn-dtm&showTerrainAnalysis=true&slopeOpacity=0.4&terrainAnalysisOpacity=0.5&showContoursAndGraticules=true&showTellsDetector=true&showRasterBasemap=true&basemapSourceA=google&lat=52.2&lng=5.85&zoom=14")
  const read = await readView(view, rest, activeLayers)
  assert.deepEqual([...read.active].sort(), ["contours", "hillshade", "moundDetector", "slope"])
  assert.ok(read.showBasemap && !read.generic && read.basemap.get("basemapSourceA") === "google")
  assert.equal(read.keep.toString(), "terrainSource=custom-nl-ahn-dtm", "the opacities are not shared parameters")
  assert.deepEqual(read.opacity.slope, { keys: ["slopeOpacity", "terrainAnalysisOpacity"], value: 0.2 }, "a mode's opacity times its group's")
  const xml = qgisProjectXml("http://t", read)
  const checked = [...xml.matchAll(/<layer-tree-layer id="[^"]+" name="([^"]+)"[^>]*checked="Qt::Checked"/g)].map((m) => m[1])
  assert.deepEqual(checked, ["Contours", "Mound candidates", "Hillshade", "Slope", "Basemap and overlays (as in the view)"])
  assert.ok(xml.indexOf('name="Contours"') < xml.indexOf('name="Hillshade"') && xml.indexOf('name="Hillshade"') < xml.indexOf('name="Elevation Hypso"'), "the map's order")
  assert.ok(!/showSlope|showTerrainAnalysis/.test(xml), "a layer asks for its own mode only")
  // The slope layer: opaque tiles (both opacities 1 in its address), 0.2 on
  // the QGIS layer, where it can be changed.
  const slopeLayer = xml.slice(xml.indexOf("modes%3Dslope"), xml.indexOf("modes%3Dslope") + 3000)
  assert.ok(/slopeOpacity%3D1/.test(slopeLayer) && /terrainAnalysisOpacity%3D1/.test(slopeLayer), "opaque tiles")
  assert.match(xml, /<rasterrenderer type="multibandcolor" opacity="0.2"/)
  const generic = qgisProjectXml("http://t", await readView({}, new URLSearchParams(), activeLayers))
  assert.deepEqual([...generic.matchAll(/<layer-tree-layer id="[^"]+" name="([^"]+)"[^>]*checked="Qt::Checked"/g)].map((m) => m[1]), ["Google Hybrid"])
}

// The values before the colour ramp: Float32 GeoTIFF tiles in EPSG:3857,
// natural units, the elevation the source's own; a PNG packing; GDAL's
// description; the QGIS project's values group.
{
  const { valueTile, valuesOf, encodeValues } = await import("./direct.mjs")
  const { loadTile } = await import("./dem.mjs")
  const { fromArrayBuffer } = await import("geotiff")
  const { gdalWmsXml, qgisProjectXml, readView } = await import("./qgis-project.mjs")
  // Around the Matterhorn: a source tile of Mapterhorn (512 px) at zoom 12.
  const z = 12, tx = 2135, ty = 1455
  const how = await plan({ modes: ["colorRelief"] }, new URLSearchParams())
  const rect = { world: 512 * 2 ** z, x0: tx * 512, y0: ty * 512, width: 512, height: 512 }
  const tif = await fromArrayBuffer((await valueTile(how, "elevation", { ...rect, format: "tif" })).buffer.slice(0))
  const img = await tif.getImage()
  assert.equal(img.getGeoKeys().ProjectedCSTypeGeoKey, 3857)
  assert.deepEqual([img.getWidth(), img.getHeight(), img.getSampleFormat(), img.getBitsPerSample()], [512, 512, 3, 32])
  const W = 20037508.342789244, px = (2 * W) / (512 * 2 ** z)
  assert.ok(Math.abs(img.getOrigin()[0] - (-W + tx * 512 * px)) < 1e-3 && Math.abs(img.getOrigin()[1] - (W - ty * 512 * px)) < 1e-3, "the tile's corner")
  assert.ok(Math.abs(img.getResolution()[0] - px) < 1e-6, "the tile's pixel")
  const [elev] = await img.readRasters()
  // On the source's own grid the values are the source's elevations.
  const src = await loadTile(how.dem, z, tx, ty)
  let worst = 0
  for (let i = 0; i < elev.length; i++) worst = Math.max(worst, Math.abs(elev[i] - src.data[i]))
  assert.ok(worst < 1, `elevation within 1 m of the source's (worst ${worst})`)
  assert.ok(elev.reduce((a, b) => Math.max(a, b), -Infinity) > 4000, "the Matterhorn's summit in it")
  // Slope in degrees, svf a share, openness about 90 on flat ground.
  const slope = await valuesOf(await plan({ modes: ["slope"] }, new URLSearchParams()), "slope", rect)
  assert.ok(slope.every((v) => v >= 0 && v <= 90) && slope.reduce((a, b) => Math.max(a, b), 0) > 45, "slope in 0..90 degrees")
  const svf = await valuesOf(await plan({ modes: ["svf"] }, new URLSearchParams()), "svf", { ...rect, width: 64, height: 64 })
  assert.ok(svf.every((v) => v >= 0 && v <= 1), "svf in 0..1")
  await assert.rejects(valuesOf(how, "matcap", rect), /No values for matcap/)
  // Deflate with the floating-point predictor by default, lossless: the
  // same floats as the uncompressed file, in fewer bytes.
  const zipped = await encodeValues(slope, { ...rect, format: "tif" }), flat = await encodeValues(slope, { ...rect, format: "tif", compress: false })
  assert.ok(zipped.length < flat.length * 0.8, `compressed (${zipped.length} of ${flat.length} bytes)`)
  const zimg = await (await fromArrayBuffer(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.length))).getImage()
  assert.deepEqual(["Compression", "Predictor"].map((k) => zimg.getFileDirectory().getValue(k)), [8, 3])
  const [back] = await zimg.readRasters()
  assert.ok(back.every((v, i) => v === slope[i]), "compression is lossless")
  // Curvature read unencoded: not rounded to the Terrarium wire's step
  // (1/256 of 1e-5 1/m) nor clamped at its ±0.33 1/m.
  const curv = await valuesOf(await plan({ modes: ["curvature"] }, new URLSearchParams()), "curvature", { ...rect, width: 64, height: 64 })
  const offStep = curv.filter((v) => Number.isFinite(v) && Math.abs(v * 1e5 * 256 - Math.round(v * 1e5 * 256)) > 0.01).length
  assert.ok(offStep > curv.length / 2, `curvature not quantized (${offStep} of ${curv.length} off the wire's step)`)
  // A PNG packing reads back as the values.
  const sharp = (await import("sharp")).default
  const packed = await encodeValues(slope, { ...rect, format: "terrarium" })
  const { data } = await sharp(packed).raw().toBuffer({ resolveWithObject: true })
  assert.ok(Math.abs(data[0] * 256 + data[1] + data[2] / 256 - 32768 - slope[0]) < 0.01, "terrarium packing")
  const rgb = await sharp(await encodeValues(slope, { ...rect, format: "terrainrgb" })).raw().toBuffer()
  assert.ok(Math.abs(-10000 + (rgb[0] * 65536 + rgb[1] * 256 + rgb[2]) * 0.1 - slope[0]) < 0.06, "terrain-rgb packing")
  // GDAL's description and the project's values group.
  const xml = gdalWmsXml("http://t", "slope", "terrainSource=x&a=1", 17)
  assert.match(xml, /<ServerUrl>http:\/\/t\/terrain-tiles\/\$\{z\}\/\$\{x\}\/\$\{y\}\.tif\?modes=slope&amp;terrainSource=x&amp;a=1<\/ServerUrl>/)
  assert.match(xml, /<TileLevel>17<\/TileLevel>.*<DataType>Float32<\/DataType>/)
  const project = qgisProjectXml("http://t", { ...(await readView({}, new URLSearchParams(), null)), valueLevel: 16 })
  assert.match(project, /<layer-tree-group name="Values \(Float32, for analysis\)" checked="Qt::Unchecked" expanded="0">/)
  assert.equal([...project.matchAll(/<provider>gdal<\/provider>/g)].length, 15)
}

// Over HTTP: /terrain-tiles and /basemap-tiles, the old /tiles and /modes
// and titiler's addresses gone (404), the OGC API landing page,
// conformance and process descriptions.
{
  const { start } = await import("./server.mjs")
  const { activeLayers } = await import("./direct.mjs")
  const { MODE_NAMES, STACK_ORDER } = await import("./url.mjs")
  // The map's order, as /processes and the docs state it: every mode on.
  const all = await activeLayers({ modes: MODE_NAMES.filter((m) => m !== "basemap") }, new URLSearchParams("tellsMarkersVisible=true"))
  assert.deepEqual(all.layers, STACK_ORDER, "STACK_ORDER is the order layersOf draws")
  const server = start(0)
  await new Promise((ok) => server.once("listening", ok))
  const base = `http://localhost:${server.address().port}`
  const get = (path, init) => fetch(base + path, init)
  const json = async (path) => { const r = await get(path, { headers: { accept: "application/json" } }); assert.equal(r.status, 200, path); return r.json() }
  try {
    // Landing page and conformance (OGC API Common).
    const landing = await json("/")
    for (const rel of ["self", "service-desc", "service-doc", "conformance", "http://www.opengis.net/def/rel/ogc/1.0/processes"]) assert.ok(landing.links.some((l) => l.rel === rel && l.href), rel)
    assert.equal((await get("/", { redirect: "manual" })).status, 302, "a browser goes to /docs")
    assert.equal((await get("/?f=json")).status, 200)
    const { conformsTo } = await json("/conformance")
    assert.ok(conformsTo.includes("http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/ogc-process-description"))
    assert.ok(!conformsTo.includes("http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/core"), "no POST execution, so not the core class")

    // The process list: every mode, light summaries, the panel tree by id.
    const list = await json("/processes")
    assert.deepEqual(list.processes.map((p) => p.id).sort(), [...MODE_NAMES].sort())
    assert.ok(list.processes.every((p) => typeof p.id === "string" && typeof p.version === "string" && !p.inputs && p.links.some((l) => l.rel === "self")))
    const ids = (g) => [...(g.groups ?? []).flatMap(ids), ...(g.items ?? [])]
    assert.deepEqual(list["x-tv-groups"].flatMap(ids).sort(), MODE_NAMES.filter((m) => m !== "basemap").sort())
    const full = await json("/processes?expand=true")
    assert.ok(full.processes.every((p) => p.inputs && p.outputs))

    // A process description, checked against OGC 18-062r2's process.yaml:
    // id and version strings; inputs and outputs maps whose entries each
    // carry a JSON Schema; links with href and rel.
    const isProcess = (p) => {
      assert.equal(typeof p.id, "string"); assert.equal(typeof p.version, "string")
      for (const k of ["title", "description"]) if (p[k] !== undefined) assert.equal(typeof p[k], "string", k)
      if (p.keywords) assert.ok(p.keywords.every((k) => typeof k === "string"))
      if (p.jobControlOptions) assert.ok(p.jobControlOptions.every((o) => ["sync-execute", "async-execute", "dismiss"].includes(o)))
      if (p.outputTransmission) assert.ok(p.outputTransmission.every((o) => ["value", "reference"].includes(o)))
      for (const [id, d] of Object.entries(p.inputs)) {
        assert.equal(typeof d.schema, "object", `input ${id} has a schema`)
        assert.ok(d.schema.type || d.schema.oneOf || d.schema.enum, `input ${id}: a type`)
        if (d.minOccurs !== undefined) assert.ok(Number.isInteger(d.minOccurs) && d.minOccurs >= 0)
        if (d.maxOccurs !== undefined) assert.ok(d.maxOccurs === "unbounded" || Number.isInteger(d.maxOccurs))
        if (d.schema.default !== undefined && d.schema.enum) assert.ok(d.schema.enum.includes(d.schema.default), `input ${id}: default in enum`)
      }
      for (const [id, d] of Object.entries(p.outputs)) assert.equal(typeof d.schema, "object", `output ${id} has a schema`)
      assert.ok(p.links.every((l) => typeof l.href === "string" && typeof l.rel === "string"))
      for (const k of Object.keys(p)) assert.ok(["id", "version", "title", "description", "keywords", "metadata", "additionalParameters", "jobControlOptions", "outputTransmission", "inputs", "outputs", "links"].includes(k) || k.startsWith("x-tv-"), `${p.id}: ${k} is OGC's or x-tv-`)
    }
    const slope = await json("/processes/slope")
    isProcess(slope)
    assert.deepEqual(slope["x-tv-group"], ["Terrain Analysis", "Surface derivatives"])
    assert.equal(slope["x-tv-opacity-key"], "slopeOpacity")
    assert.deepEqual(slope["x-tv-group-opacity-keys"], ["terrainAnalysisOpacity"])
    assert.equal(slope["x-tv-values"].unit, "degree")
    assert.deepEqual(slope["x-tv-values"].range, [0, 60])
    assert.deepEqual(slope.inputs.slopeOpacity.schema, { type: "number", minimum: 0, maximum: 1, default: 1 })
    assert.equal(slope.inputs.slopeOpacity["x-tv-role"], "opacity")
    assert.deepEqual(slope.inputs.slopeSourceMode.schema, { type: "string", enum: ["plantopo", "client"], default: "client" })
    assert.equal(slope.inputs.slopeMaxDegrees["x-tv-url-param"], "slopeMaxDegrees")
    assert.deepEqual(slope.outputs.image.schema.oneOf.map((o) => o.contentMediaType), ["image/png", "image/jpeg"])
    assert.match(slope.outputs.values.schema.oneOf[0].contentMediaType, /^image\/tiff/)
    const run = slope.links.filter((l) => l.rel === "http://www.opengis.net/def/rel/ogc/1.0/execute")
    assert.ok(run.some((l) => l.templated && l.href === `${base}/terrain-tiles/{z}/{x}/{y}.png?modes=slope`))
    assert.ok(run.some((l) => /\/terrain-tiles\/\{z\}\/\{x\}\/\{y\}\.tif\?modes=slope$/.test(l.href)))
    const contours = await json("/processes/contours")
    isProcess(contours)
    assert.equal(contours.outputs.vectorTile.schema.contentMediaType, "application/vnd.mapbox-vector-tile")
    assert.ok(!contours["x-tv-has-values"] && !contours.outputs.values)
    const hillshade = await json("/processes/hillshade")
    isProcess(hillshade)
    assert.ok(hillshade["x-tv-shading"] && hillshade["x-tv-stack-rank"] > slope["x-tv-stack-rank"] && contours["x-tv-stack-rank"] > hillshade["x-tv-stack-rank"])
    const basemap = await json("/processes/basemap")
    isProcess(basemap)
    assert.ok(basemap.links.some((l) => l.href.includes("/basemap-tiles/{z}/{x}/{y}.jpg")))
    assert.equal((await get("/processes/nope")).status, 404)
    const exec = await get("/processes/slope/execution", { method: "POST", body: "{}" })
    assert.equal(exec.status, 501)
    assert.ok((await exec.json()).links.some((l) => l.rel.endsWith("/execute")))

    // /modes, removed on 2026-11-24: /processes and /view replace it.
    assert.equal((await get("/modes")).status, 404)
    // /view: what a share link switches on.
    const view = await json("/view?showTerrainAnalysis=true&slopeOpacity=0.5&terrainAnalysisOpacity=0.4&terrainSourceA=x")
    assert.ok(view.active.includes("slope")); assert.ok(Math.abs(view.opacity.slope - 0.2) < 1e-9); assert.equal(view.params.terrainSource, "x")

    // Tiles: the address, the old /tiles/{z}/{x}/{y} and titiler's
    // addresses gone, and the modes refused on each.
    const tilePath = "/2/2/1.png?modes=slope&background=none"
    const fresh = await get(`/terrain-tiles${tilePath}`)
    assert.equal(fresh.status, 200, await fresh.clone().text().catch(() => ""))
    assert.equal(fresh.headers.get("content-type"), "image/png")
    assert.equal(fresh.headers.get("deprecation"), null)
    assert.equal((await get(`/tiles${tilePath}`)).status, 404, "the old /tiles/{z}/{x}/{y} is removed")
    const titiler = await get(`/tiles/WebMercatorQuad${tilePath}`)
    assert.equal(titiler.status, 404, "titiler's /tiles/WebMercatorQuad is removed"); assert.match(await titiler.text(), /\/terrain-tiles\//)
    assert.equal((await get("/tiles/WebMercatorQuad/2/2/1.pbf?modes=contours")).status, 404)
    assert.equal((await get("/tiles/WebMercatorQuad/2/2/1.png.stac.json?modes=slope")).status, 404)
    const wmqTj = await get("/WebMercatorQuad/tilejson.json?modes=slope")
    assert.equal(wmqTj.status, 404); assert.match(await wmqTj.text(), /\/tilejson\.json/)
    const bboxRes = await get("/bbox/7.6,45.95,7.7,46/800x600.png?modes=slope")
    assert.equal(bboxRes.status, 404); assert.match(await bboxRes.text(), /\/render\.\{format\}\?bbox=/)
    assert.equal((await get("/bbox/7.6,45.95,7.7,46/800x600.tif.stac.json?modes=slope")).status, 404)
    // titiler's parameter names are still read.
    assert.equal((await get("/terrain-tiles/2/2/1.png?algorithm=slope")).status, 200)
    const vec = await get("/terrain-tiles/2/2/1.pbf?modes=contours")
    assert.equal(vec.status, 200); assert.equal(vec.headers.get("content-type"), "application/vnd.mapbox-vector-tile")
    assert.equal((await get("/tiles/2/2/1.pbf?modes=contours")).status, 404)
    const tif = await get("/terrain-tiles/2/2/1.tif?modes=slope")
    assert.equal(tif.status, 200); assert.equal(tif.headers.get("x-tv-value-unit"), "degree")
    assert.equal((await get("/terrain-tiles/2/2/1.png?modes=hillshade,basemap")).status, 400)
    assert.equal((await get("/basemap-tiles/2/2/1.jpg?modes=slope&imagerySource=wayback")).status, 400)
    assert.equal((await get("/basemap-tiles/2/2/1.tif")).status, 404)
    // Every raster answer names its STAC Item; the item validates.
    const link = tif.headers.get("link")
    assert.match(link, /^<.+\/terrain-tiles\/2\/2\/1\.tif\.stac\.json\?modes=slope>; rel="describedby"/)
    assert.match(fresh.headers.get("link"), /\/terrain-tiles\/2\/2\/1\.png\.stac\.json\?modes=slope&background=none>/)
    assert.match(tif.headers.get("access-control-expose-headers"), /\blink\b/)
    const itemRes = await get(link.match(/^<([^>]+)>/)[1].replace(/^https?:\/\/[^/]+/, ""))
    assert.equal(itemRes.status, 200); assert.equal(itemRes.headers.get("content-type"), "application/geo+json")
    const item = await itemRes.json()
    assertStacItem(item)
    assert.equal(item.assets.data.href, `${base}/terrain-tiles/2/2/1.tif?modes=slope`)
    assertStacItem(await (await get("/render.tif.stac.json?modes=slope&bbox=7.6,45.95,7.7,46")).json())
    assert.equal((await get("/terrain-tiles/2/2/1.pbf.stac.json")).status, 404)
    const tj = await json("/tilejson.json?modes=slope")
    assert.ok(tj.tiles[0].startsWith(`${base}/terrain-tiles/{z}/{x}/{y}.png?`))
    assert.ok((await json("/tilejson.json?modes=basemap&imagerySource=wayback")).tiles[0].startsWith(`${base}/basemap-tiles/`))
    // The QGIS project asks the new addresses only.
    const qgz = Buffer.from(await (await get("/qgis.qgz?showRasterBasemap=true&imagerySource=wayback")).arrayBuffer())
    const { inflateRawSync } = await import("node:zlib")
    const qgs = inflateRawSync(qgz.subarray(30 + qgz.readUInt16LE(26), 30 + qgz.readUInt16LE(26) + qgz.readUInt32LE(18))).toString()
    assert.ok(qgs.includes("/terrain-tiles/") && qgs.includes("/basemap-tiles/"))
    assert.ok(!/localhost:\d+\/tiles\//.test(decodeURIComponent(qgs)), "no old /tiles address in the project")
  } finally {
    server.close()
  }
}

console.log("ok")
// The bundled app code (colour ramps) keeps a handle open.
process.exit(0)
