// The tile service without a network listener: tile blocks, the query
// vocabulary, which engine draws what, every source type through the app's
// readers (network), vector tiles and symbol anchors, the docs copy of the
// OpenAPI description. `pnpm test` (builds generated/ first).
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { blockOf, viewOf, sources, viewQuery } from "./server.mjs"
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

// /view reads a share link in every form: the params, `url` as the whole
// link, `url` as its query (with or without `?`), the link pasted unencoded.
{
  const want = { zoom: "12", lat: "45.5", terrainSourceA: "mapterhorn", showTerrainAnalysis: "true" }
  const qs = "zoom=12&lat=45.5&terrainSourceA=mapterhorn&showTerrainAnalysis=true"
  const link = "https://terrain-viewer.iconem.com/?" + qs + "#frag"
  const read = (search) => Object.fromEntries(viewQuery(search))
  for (const search of [
    "?" + qs,
    qs,
    "?url=" + encodeURIComponent(link),
    "?url=" + encodeURIComponent("?" + qs),
    "?url=" + encodeURIComponent(qs),
    "?url=" + encodeURIComponent("  " + link + "  "),
    "?" + link.replace("#frag", ""),
    "?" + encodeURIComponent(link.replace("#frag", "").split("&")[0]) + "&" + qs.split("&").slice(1).join("&"),
    "?url=" + encodeURIComponent("http://localhost:5173/terrain-viewer/?" + qs),
  ]) assert.deepEqual(read(search), want, search)
  // The link's own values win over parameters beside it; others are added.
  assert.deepEqual(read("?zoom=3&theme=dark&url=" + encodeURIComponent(link)), { ...want, theme: "dark" })
  // A link without a query: nothing switched on, and `url` is not taken as a source.
  assert.deepEqual(read("?url=" + encodeURIComponent("https://terrain-viewer.iconem.com/")), {})
}

// The API reference lists the processes first, then the tiles; no titiler group.
{
  const { openapi } = await import("./openapi.mjs")
  const doc = openapi()
  assert.deepEqual(doc.tags.map((t) => t.name), ["Visualization modes (OGC API – Processes)", "Terrain tiles", "Quantized mesh", "Basemap tiles", "Catalogs", "Viewport", "Values", "Service"])
  const used = new Set(Object.values(doc.paths).flatMap((p) => Object.values(p).flatMap((op) => op.tags)))
  assert.deepEqual([...used].sort(), doc.tags.map((t) => t.name).sort(), "every tag used, every used tag listed")
  assert.ok(!Object.keys(doc.paths).some((p) => p.startsWith("/tiles/")), "no /tiles path documented")
  // /basemaps opens the Basemap tiles group; {source} takes any string and offers the ids.
  const { sourceIds } = await import("./openapi.mjs")
  const full = openapi(undefined, await sourceIds())
  const ops = Object.entries(full.paths).flatMap(([p, o]) => Object.values(o).map((op) => [p, op]))
  assert.equal(ops.find(([, op]) => op.tags.includes("Basemap tiles"))[0], "/basemaps")
  for (const [path, first, also] of [["/terrain-tiles/{source}/{z}/{x}/{y}.{format}", "mapterhorn", "custom"], ["/basemap-tiles/{source}/{z}/{x}/{y}.{format}", "wayback", "google"]]) {
    const p = full.paths[path].get.parameters.find((x) => x.name === "source")
    assert.equal(p.schema.type, "string"); assert.equal(p.schema.enum, undefined, "any id is accepted")
    assert.equal(p.schema.examples[0], first)
    assert.ok(p.schema.examples.includes(also) && p.schema.examples.length > 5, path + " offers the ids")
  }
  // martini and ellipsoidal heights by default; the source-in-path forms documented.
  assert.equal(doc.paths["/quantized-mesh/{source}/layer.json"].get.parameters.find((x) => x.name === "mesher").schema.default, "martini")
  assert.equal(doc.paths["/quantized-mesh/{source}/layer.json"].get.parameters.find((x) => x.name === "heights").schema.default, "ellipsoidal")
  for (const path of ["/terrain-tiles/{source}/{z}/{x}/{y}.{format}", "/basemap-tiles/{source}/{z}/{x}/{y}.{format}", "/basemaps", "/colorramps/{id}.{format}"]) assert.ok(doc.paths[path], path)
  assert.ok(doc.paths["/view"].get.parameters.some((x) => x.name === "url"), "/view takes a whole link")
}

// The geoid (EGM96): N in Paris and the Alps, the extremes, and a tile's grid
// shifted by it, interpolated within a centimetre of a lookup per point.
{
  const { undulation, addUndulation } = await import("./geoid.mjs")
  assert.ok(Math.abs((await undulation(48.8566, 2.3522)) - 44.56) < 0.05, "Paris: N about +44.6 m")
  assert.ok(Math.abs((await undulation(45.83, 6.86)) - 51.52) < 0.05, "Mont Blanc: N about +51.5 m")
  assert.ok((await undulation(5, 78)) < -95, "south of India: the geoid's low, below -95 m")
  const { tileBounds } = await import("./quantized-mesh.mjs")
  const b = tileBounds(9, 533, 386)
  const g = new Float32Array(257 * 257).fill(1000); g[5] = NaN
  await addUndulation(g, 257, b, 1)
  assert.ok(Number.isNaN(g[5]), "a hole stays a hole")
  let worst = 0
  for (const [r, c] of [[0, 0], [128, 128], [256, 256], [37, 201], [255, 3]]) {
    const n = await undulation(b.north - (r / 256) * (b.north - b.south), b.west + (c / 256) * (b.east - b.west))
    worst = Math.max(worst, Math.abs(g[r * 257 + c] - 1000 - n))
  }
  assert.ok(worst < 0.01, `interpolated N within 1 cm of a lookup (worst ${worst.toFixed(4)} m)`)
  await addUndulation(g, 257, b, -1)
  assert.ok(Math.abs(g[128 * 257 + 128] - 1000) < 1e-3, "and back")
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
  assert.equal(readFileSync(DOCS_COPY, "utf8").replaceAll(String.fromCharCode(13), ""), await docsCopyText(), "docs/public/tile-service-openapi.json is stale: run `node openapi.mjs` in tile-server/")
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

// Quantized mesh, offline: a synthetic DEM (an analytic surface) served as
// Terrarium tiles by a stubbed fetch, read as any tile address, meshed and
// encoded; decoded twice (quantized-mesh.mjs and HERE's
// @here/quantized-mesh-decoder, written from the spec by others) and
// checked against the surface, the spec's invariants and each other.
{
  const sharp = (await import("sharp")).default
  const here = (await import("@here/quantized-mesh-decoder")).default.default
  const { encodeTile, decodeTile, tileBounds, levelGeometricError, layerJson, availableRanges, requestedExtensions } = await import("./quantized-mesh.mjs")
  const { quantizedMeshTile, meshLevel } = await import("./direct.mjs")
  const RAD = Math.PI / 180
  const surface = (lon, lat) => 1000 + 300 * Math.sin(lon * 2000 * RAD) * Math.cos(lat * 1500 * RAD)
  const realFetch = globalThis.fetch
  let stubbed = 0
  globalThis.fetch = async (url, init) => {
    const m = String(url).match(/^https:\/\/qm-stub\.test\/(\d+)\/(\d+)\/(\d+)\.png$/)
    if (!m) return realFetch(url, init)
    stubbed++
    const [z, x, y] = m.slice(1).map(Number), W = 256 * 2 ** z
    const rgba = Buffer.alloc(256 * 256 * 4)
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const lon = ((x * 256 + i + 0.5) / W) * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * 256 + j + 0.5)) / W))) / RAD
      const t = surface(lon, lat) + 32768, whole = Math.floor(t), o = (j * 256 + i) * 4
      rgba[o] = whole >> 8; rgba[o + 1] = whole & 255; rgba[o + 2] = Math.floor((t - whole) * 256); rgba[o + 3] = 255
    }
    return new Response(await sharp(rgba, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer(), { headers: { "content-type": "image/png" } })
  }
  try {
    const how = await plan({ terrainSource: "https://qm-stub.test/{z}/{x}/{y}.png" }, new URLSearchParams(), {})
    assert.equal(how.engine, "direct", how.why)
    assert.equal(meshLevel(how.dem), 13, "a tile address keeps z14: geographic level 13")
    const [z, x, y] = [10, 1066, 773]
    const b = tileBounds(z, x, y)
    assert.deepEqual(tileBounds(0, 1, 0), { west: 0, south: -90, east: 180, north: 90 })
    assert.ok(b.west < 7.5 && b.east > 7.5 && b.south < 46 && b.north > 46)
    const maxError = levelGeometricError(z) * 0.25
    assert.ok(Math.abs(levelGeometricError(0) - 77067.34) < 0.01, "Cesium's level-0 error for 65 samples, 2 root tiles")
    for (const mesher of ["martini", "delatin"]) {
      const bytes = await quantizedMeshTile(how, { z, x, y, normals: true, mesher, errorScale: 0.25, heights: "orthometric" })
      const d = decodeTile(bytes)
      const r = here(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const n = d.vertexCount
      // The two decoders agree on every field.
      assert.equal(r.vertexData.length, 3 * n)
      assert.deepEqual([...r.vertexData.subarray(0, n)], [...d.u]); assert.deepEqual([...r.vertexData.subarray(n, 2 * n)], [...d.v]); assert.deepEqual([...r.vertexData.subarray(2 * n)], [...d.height])
      assert.deepEqual([...r.triangleIndices], [...d.indices])
      assert.deepEqual([...r.westIndices], [...d.edges.west]); assert.deepEqual([...r.southIndices], [...d.edges.south])
      assert.deepEqual([...r.eastIndices], [...d.edges.east]); assert.deepEqual([...r.northIndices], [...d.edges.north])
      assert.deepEqual([...r.extensions.vertexNormals], [...d.extensions.vertexNormals])
      assert.equal(r.header.minHeight, d.header.minHeight); assert.equal(r.header.boundingSphereRadius, d.header.boundingSphere.radius)
      assert.equal(r.header.horizonOcclusionPointZ, d.header.horizonOcclusionPoint[2])
      // The spec's invariants: indices in range and first named in order
      // (high-water mark), counter-clockwise triangles, the edge lists the
      // vertices on each edge, the heights within the header's range.
      assert.ok(d.triangleCount > 100 && d.indices.every((i) => i < n))
      let hw = 0
      for (const i of d.indices) { assert.ok(i <= hw); if (i === hw) hw++ }
      assert.equal(hw, n, "every vertex used")
      for (let t = 0; t < d.indices.length; t += 3) {
        const [a, bb, c] = [d.indices[t], d.indices[t + 1], d.indices[t + 2]]
        assert.ok((d.u[bb] - d.u[a]) * (d.v[c] - d.v[a]) - (d.v[bb] - d.v[a]) * (d.u[c] - d.u[a]) > 0, "counter-clockwise")
      }
      const on = (test) => [...d.u.keys()].filter(test).sort((p, q2) => p - q2)
      assert.deepEqual([...d.edges.west].sort((p, q2) => p - q2), on((k) => d.u[k] === 0))
      assert.deepEqual([...d.edges.south].sort((p, q2) => p - q2), on((k) => d.v[k] === 0))
      assert.deepEqual([...d.edges.east].sort((p, q2) => p - q2), on((k) => d.u[k] === 32767))
      assert.deepEqual([...d.edges.north].sort((p, q2) => p - q2), on((k) => d.v[k] === 32767))
      assert.ok(on((k) => d.u[k] === 0 && d.v[k] === 0).length === 1 && d.edges.west.length >= 2, "the corners are vertices")
      const { minHeight: lo, maxHeight: hi } = d.header
      assert.ok(lo > 690 && lo < 710 && hi > 1290 && hi < 1310, `heights ${lo}..${hi}`)
      const hOf = (k) => lo + (d.height[k] / 32767) * (hi - lo)
      const lonOf = (k) => b.west + (d.u[k] / 32767) * (b.east - b.west), latOf = (k) => b.south + (d.v[k] / 32767) * (b.north - b.south)
      // Each vertex on the surface (resampling and quantization only).
      for (let k = 0; k < n; k++) assert.ok(Math.abs(hOf(k) - surface(lonOf(k), latOf(k))) < 0.5, `vertex ${k}`)
      // Anywhere inside: the mesh within its error of the surface.
      let worst = 0
      for (let s = 0; s < 1500; s++) {
        const pu = ((s * 7919) % 1500) / 1500 * 32767, pv = ((s * 104729) % 1499) / 1499 * 32767
        for (let t = 0; t < d.indices.length; t += 3) {
          const [a, bb, c] = [d.indices[t], d.indices[t + 1], d.indices[t + 2]]
          const det = (d.v[bb] - d.v[c]) * (d.u[a] - d.u[c]) + (d.u[c] - d.u[bb]) * (d.v[a] - d.v[c])
          const l1 = ((d.v[bb] - d.v[c]) * (pu - d.u[c]) + (d.u[c] - d.u[bb]) * (pv - d.v[c])) / det
          const l2 = ((d.v[c] - d.v[a]) * (pu - d.u[c]) + (d.u[a] - d.u[c]) * (pv - d.v[c])) / det
          if (l1 < -1e-9 || l2 < -1e-9 || 1 - l1 - l2 < -1e-9) continue
          const h = l1 * hOf(a) + l2 * hOf(bb) + (1 - l1 - l2) * hOf(c)
          worst = Math.max(worst, Math.abs(h - surface(b.west + (pu / 32767) * (b.east - b.west), b.south + (pv / 32767) * (b.north - b.south))))
          break
        }
      }
      assert.ok(worst < maxError + 1, `${mesher}: mesh within ${maxError.toFixed(1)} m of the surface (worst ${worst.toFixed(2)} m)`)
      // The bounding sphere holds every vertex; normals point up, outwards.
      const A = 6378137, E2 = 0.0066943799901413165
      const ecef = (lon, lat, h) => { const N = A / Math.sqrt(1 - E2 * Math.sin(lat * RAD) ** 2); return [(N + h) * Math.cos(lat * RAD) * Math.cos(lon * RAD), (N + h) * Math.cos(lat * RAD) * Math.sin(lon * RAD), (N * (1 - E2) + h) * Math.sin(lat * RAD)] }
      const { center, radius } = d.header.boundingSphere
      for (let k = 0; k < n; k++) { const p = ecef(lonOf(k), latOf(k), hOf(k)); assert.ok(Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) <= radius + 1e-6) }
      const oct = (bx, by) => { let nx = (bx / 255) * 2 - 1, ny = (by / 255) * 2 - 1; const nz = 1 - Math.abs(nx) - Math.abs(ny); if (nz < 0) { const ox = nx; nx = (1 - Math.abs(ny)) * Math.sign(ox); ny = (1 - Math.abs(ox)) * Math.sign(ny) } const l = Math.hypot(nx, ny, nz); return [nx / l, ny / l, nz / l] }
      const up = ecef(7.5, 46, 0).map((c) => c / A)
      for (let k = 0; k < n; k += 7) { const nn = oct(d.extensions.vertexNormals[2 * k], d.extensions.vertexNormals[2 * k + 1]); assert.ok(nn[0] * up[0] + nn[1] * up[1] + nn[2] * up[2] > 0.5, "normal outwards") }
      // The horizon occlusion point lies beyond the ellipsoid, towards the tile.
      const hop = d.header.horizonOcclusionPoint
      assert.ok(Math.hypot(...hop) > 1 && hop[0] * up[0] + hop[1] * up[1] + hop[2] * up[2] > 0)
    }
    assert.ok(stubbed > 0, "the synthetic source was read")
    // Without normals asked, no extension. By default martini, and heights
    // above the ellipsoid: the synthetic surface (above sea level) raised by
    // the geoid's height there, about +50 m.
    const dflt = decodeTile(await quantizedMeshTile(how, { z, x, y }))
    assert.deepEqual(dflt.extensions, {})
    const ortho = decodeTile(await quantizedMeshTile(how, { z, x, y, heights: "orthometric" }))
    const shift = dflt.header.minHeight - ortho.header.minHeight
    assert.ok(shift > 45 && shift < 56, `ellipsoidal heights: the geoid added (${shift.toFixed(2)} m)`)
    assert.equal(dflt.triangleCount, decodeTile(await quantizedMeshTile(how, { z, x, y, mesher: "martini" })).triangleCount, "martini by default")
    // delatin stops at maxTriangles (worst points first).
    const capped = decodeTile(await quantizedMeshTile(how, { z, x, y, errorScale: 0.01, maxTriangles: 200, mesher: "delatin" }))
    assert.ok(capped.triangleCount <= 202 && capped.triangleCount > 150, `capped at 200: ${capped.triangleCount}`)
    // Holes are grown from the data around, not pits at 0; no data at all is flat.
    const holey = new Float32Array(65 * 65).fill(500); holey[32 * 65 + 32] = NaN
    const flatHole = decodeTile(encodeTile({ heights: holey, size: 65, bounds: tileBounds(5, 3, 3), maxError: 1 }))
    assert.equal(flatHole.header.minHeight, 500); assert.equal(flatHole.triangleCount, 2)
    const none = decodeTile(encodeTile({ heights: new Float32Array(65 * 65).fill(NaN), size: 65, bounds: tileBounds(5, 3, 3), maxError: 1 }))
    assert.equal(none.header.maxHeight, 0)
    // More than 65536 vertices (the cap lifted): 32-bit indices, aligned.
    let seed = 7
    const noisy = Float32Array.from({ length: 257 * 257 }, () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 100)
    const wide = encodeTile({ heights: noisy, size: 257, bounds: tileBounds(12, 100, 100), maxError: 0, maxTriangles: Infinity })
    const wd = decodeTile(wide)
    assert.ok(wd.vertexCount > 65536, `${wd.vertexCount} vertices`)
    assert.deepEqual([...here(wide.buffer).triangleIndices.subarray(0, 300)], [...wd.indices.subarray(0, 300)])
    // layer.json, availability, the extensions asked.
    const lj = layerJson({ name: "x", tiles: ["{z}/{x}/{y}.terrain"], maxzoom: 3, bounds: [5, 45, 10, 48] })
    assert.equal(lj.format, "quantized-mesh-1.0"); assert.equal(lj.scheme, "tms"); assert.equal(lj.projection, "EPSG:4326"); assert.equal(lj.tilejson, "2.1.0")
    assert.equal(lj.available.length, 4)
    assert.deepEqual(availableRanges(1)[1], [{ startX: 0, startY: 0, endX: 3, endY: 1 }])
    assert.deepEqual(lj.available[0], [{ startX: 0, startY: 0, endX: 1, endY: 0 }], "level 0 whole")
    assert.deepEqual(lj.available[3], [{ startX: 8, startY: 6, endX: 8, endY: 6 }])
    assert.deepEqual(requestedExtensions("application/vnd.quantized-mesh;extensions=octvertexnormals-watermask,application/octet-stream;q=0.9"), ["octvertexnormals"])
    assert.deepEqual(requestedExtensions("application/vnd.quantized-mesh", "watermask"), [])
    assert.deepEqual(requestedExtensions("", "octvertexnormals"), ["octvertexnormals"])
  } finally {
    globalThis.fetch = realFetch
  }
}

// Over HTTP: /terrain-tiles and /basemap-tiles, the old /tiles and /modes
// and titiler's tile addresses gone (404), /bbox, quantized mesh, the OGC
// API landing page, conformance and process descriptions.
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
    assert.ok(landing.links.some((l) => l.rel === "help" && /quick-start/.test(l.href)), "the landing page links the quick start")
    // The reference opens on the quick start, with this server's address; the
    // quantized mesh has its own group, layer.json first.
    const spec = await json("/openapi.json")
    assert.match(spec.info.description, /^## Quick start/)
    assert.ok(spec.info.description.includes(`${base}/quantized-mesh/mapterhorn/layer.json?mesher=delatin`))
    assert.ok(spec.info.description.includes(`${base}/terrain-tiles/mapterhorn/{z}/{x}/{y}.png?modes=slope`), "the quick start names the source in the path")
    const qmOps = Object.entries(spec.paths).filter(([, v]) => v.get?.tags?.includes("Quantized mesh")).map(([k]) => k)
    assert.deepEqual(qmOps, ["/quantized-mesh/{source}/layer.json", "/quantized-mesh/{source}/{z}/{x}/{y}.terrain"])
    const docsPage = await (await get("/docs")).text()
    assert.match(docsPage, /defaultOpenAllTags: true/)
    assert.match(docsPage, /customCss: ".*white-space:pre-wrap/, "the quick start's code blocks wrap")
    assert.match(docsPage, /tv-copy/, "and get a copy button")
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
    // The whole link as `url`, and the tiles that draw it (a library id in the path).
    const link0 = "https://terrain-viewer.iconem.com/?showTerrainAnalysis=true&slopeOpacity=0.5&terrainSourceA=mapterhorn#x"
    const byUrl = await json(`/view?url=${encodeURIComponent(link0)}`)
    assert.deepEqual(byUrl.active, (await json("/view?showTerrainAnalysis=true&slopeOpacity=0.5&terrainSourceA=mapterhorn")).active)
    assert.ok(byUrl.active.includes("slope")); assert.equal(byUrl.params.terrainSource, "mapterhorn")
    assert.ok(byUrl.tiles.terrain.startsWith(`${base}/terrain-tiles/mapterhorn/{z}/{x}/{y}.png?modes=`) && /modes=[^&]*slope/.test(byUrl.tiles.terrain), byUrl.tiles.terrain)
    assert.match(view.tiles.terrain, /\/terrain-tiles\/\{z\}\/\{x\}\/\{y\}\.png\?.*terrainSource=x/, "an unknown source stays in the query")

    // A source in the path: the same tile as the query form; unknown ids 404.
    const inPath = await get("/terrain-tiles/mapterhorn/2/2/1.png?modes=slope&background=none")
    assert.equal(inPath.status, 200)
    const inQuery = await get("/terrain-tiles/2/2/1.png?modes=slope&background=none&terrainSource=mapterhorn")
    assert.ok(Buffer.from(await inPath.arrayBuffer()).equals(Buffer.from(await inQuery.arrayBuffer())), "path and query forms answer the same tile")
    assert.match(inPath.headers.get("link"), /terrainSource=mapterhorn/)
    assert.equal((await get("/terrain-tiles/custom/2/2/1.png?modes=slope&terrainSource=mapterhorn")).status, 200, "custom: the source from the query")
    assert.equal((await get("/terrain-tiles/no-such-source/2/2/1.png")).status, 404)
    assert.equal((await get("/terrain-tiles/mapterhorn/2/2/1.tif?modes=slope")).headers.get("x-tv-value-unit"), "degree")
    assert.equal((await get("/terrain-tiles/mapterhorn/2/2/1.pbf?modes=contours")).status, 200)
    assert.equal((await get("/terrain-tiles/mapterhorn/2/2/1.png.stac.json?modes=slope")).status, 200)
    assert.equal((await get("/basemap-tiles/no-such-basemap/2/2/1.jpg")).status, 404)
    const { basemaps, sourceInPath } = await import("./server.mjs")
    const bms = await basemaps()
    assert.ok(bms.some((x) => x.id === "wayback" && x.kind === "dated") && bms.some((x) => x.id === "esri" && x.kind === "static"))
    assert.equal((await json("/basemaps")).basemaps.length, bms.length)
    const bw = await sourceInPath("/basemap-tiles/wayback/2/2/1.jpg", "?imageryDate=2020-01-01")
    assert.equal(bw.pathname, "/basemap-tiles/2/2/1.jpg"); assert.equal(new URLSearchParams(bw.search).get("imagerySource"), "wayback")
    assert.equal(new URLSearchParams((await sourceInPath("/basemap-tiles/bing/2/2/1.jpg", "")).search).get("basemapSource"), "bing", "bing without a date: Bing Aerial")
    assert.equal(new URLSearchParams((await sourceInPath("/basemap-tiles/bing/2/2/1.jpg", "?imageryDate=2021-05-01")).search).get("imagerySource"), "bing", "with one: dated")
    assert.equal(new URLSearchParams((await sourceInPath("/terrain-tiles/mapterhorn/2/2/1.png", "?url=x")).search).get("terrainSource"), "mapterhorn", "the path wins")
    assert.equal(await sourceInPath("/terrain-tiles/2/2/1.png", ""), null)

    // Colour ramps as pictures: the size asked, horizontal (low on the left)
    // or vertical (low at the bottom), the ramp's colours at its ends.
    const sharpR = (await import("sharp")).default
    const rampRes = await get("/colorramps/slope-plantopo.png?width=100&height=4")
    assert.equal(rampRes.status, 200); assert.equal(rampRes.headers.get("content-type"), "image/png")
    const { data: rp, info: ri } = await sharpR(Buffer.from(await rampRes.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.deepEqual([ri.width, ri.height], [100, 4])
    assert.equal(rp[3], 0, "slope-plantopo is transparent below 29 degrees")
    assert.deepEqual([...rp.subarray(99 * 4, 99 * 4 + 4)], [216, 37, 37, 255], "its last stop at the right end")
    const vRes = await get("/colorramps/slope-plantopo.jpg?orientation=vertical")
    assert.equal(vRes.headers.get("content-type"), "image/jpeg")
    const { data: vp, info: vi } = await sharpR(Buffer.from(await vRes.arrayBuffer())).raw().toBuffer({ resolveWithObject: true })
    assert.deepEqual([vi.width, vi.height], [16, 256], "vertical: 16 x 256 by default")
    assert.ok(vp[0] > 190 && vp[1] < 70 && vp[2] < 70, "the top is the highest value (red)")
    const bottom = vp.subarray((255 * 16) * vi.channels)
    assert.ok(bottom[0] > 245 && bottom[1] > 245 && bottom[2] > 245, "the bottom is transparent, laid on white in a JPEG")
    assert.equal((await get("/colorramps/slope-plantopo.png?orientation=diagonal")).status, 400)
    assert.equal((await get("/colorramps/slope-plantopo.png?width=0")).status, 400)
    assert.equal((await get("/colorramps/no-such-ramp.png")).status, 404)
    assert.equal((await json("/colorramps/slope-plantopo")).id, "slope-plantopo", "the JSON stays")

    // Tiles: the address, the old /tiles/{z}/{x}/{y} and titiler's tile
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
    // /bbox: the answer of /render with bbox, width and height, its STAC
    // Item and Link header.
    const bboxRes = await get("/bbox/7.6,45.95,7.7,46/300x200.png?modes=slope")
    assert.equal(bboxRes.status, 200, await bboxRes.clone().text()); assert.equal(bboxRes.headers.get("content-type"), "image/png")
    const viaRender = await get("/render.png?modes=slope&bbox=7.6,45.95,7.7,46&width=300&height=200")
    assert.deepEqual(Buffer.from(await bboxRes.arrayBuffer()), Buffer.from(await viaRender.arrayBuffer()), "/bbox draws what /render?bbox draws")
    assert.match(bboxRes.headers.get("link"), /\/bbox\/7\.6,45\.95,7\.7,46\/300x200\.png\.stac\.json\?modes=slope>; rel="describedby"/)
    const bboxTif = await get("/bbox/7.6,45.95,7.7,46/200x200.tif?modes=slope")
    assert.equal(bboxTif.status, 200); assert.equal(bboxTif.headers.get("x-tv-value-unit"), "degree")
    const bboxItem = await get("/bbox/7.6,45.95,7.7,46/200x200.tif.stac.json?modes=slope")
    assert.equal(bboxItem.status, 200)
    const bi = await bboxItem.json(); assertStacItem(bi); assert.deepEqual(bi.bbox, [7.6, 45.95, 7.7, 46])
    assert.equal((await get("/bbox/7.6,45.95/300x200.png")).status, 400, "a box is four numbers")
    assert.equal((await get("/bbox/7.6,45.95,7.7,46/300.png")).status, 404)

    // Quantized mesh: layer.json and a tile of Mapterhorn, gzipped on
    // request, normals by the Accept header, the bounds of the grid.
    const layer = await json("/quantized-mesh/mapterhorn/layer.json?error=0.5")
    assert.match(layer.description, /WGS84 ellipsoid/)
    assert.match((await json("/quantized-mesh/mapterhorn/layer.json?heights=orthometric")).description, /sea level/)
    assert.equal((await get("/quantized-mesh/mapterhorn/layer.json?heights=geoid")).status, 400)
    assert.equal(layer.format, "quantized-mesh-1.0"); assert.equal(layer.scheme, "tms"); assert.deepEqual(layer.extensions, ["octvertexnormals"])
    assert.equal(layer.maxzoom, 17, "512 px tiles to z17: level 17"); assert.equal(layer.available.length, 18)
    assert.equal(layer.tiles[0], "{z}/{x}/{y}.terrain?error=0.5")
    const qmTile = await get("/quantized-mesh/mapterhorn/9/533/386.terrain", { headers: { accept: "application/vnd.quantized-mesh;extensions=octvertexnormals,application/octet-stream;q=0.9", "accept-encoding": "gzip" } })
    assert.equal(qmTile.status, 200, await qmTile.clone().text())
    assert.match(qmTile.headers.get("content-type"), /^application\/vnd\.quantized-mesh/); assert.equal(qmTile.headers.get("access-control-allow-origin"), "*")
    assert.match(qmTile.headers.get("cache-control"), /max-age/)
    const { decodeTile } = await import("./quantized-mesh.mjs")
    const alps = decodeTile(new Uint8Array(await qmTile.arrayBuffer())) // fetch has gunzipped it
    assert.ok(alps.vertexCount > 100 && alps.extensions.vertexNormals?.length === 2 * alps.vertexCount)
    assert.ok(alps.header.maxHeight > 3000 && alps.header.minHeight < 2000, `Alps ${alps.header.minHeight}..${alps.header.maxHeight}`)
    const raw = await new Promise((ok, fail) => import("node:http").then((h) => h.get(`${base}/quantized-mesh/mapterhorn/9/533/386.terrain`, { headers: { "accept-encoding": "gzip" } }, (res) => { res.resume(); ok(res) }).on("error", fail)))
    assert.equal(raw.headers["content-encoding"], "gzip"); assert.match(raw.headers.vary, /Accept-Encoding/)
    assert.equal((await get("/quantized-mesh/mapterhorn/1/4/0.terrain")).status, 404, "level 1 has 4 x 2 tiles")
    assert.equal((await get("/quantized-mesh/mapterhorn/0/0/0.terrain?mesher=nope")).status, 400)
    assert.equal((await get("/quantized-mesh/mapterhorn/0/0/0.terrain?maxTriangles=1")).status, 400)
    // Kept gzipped: a client that takes no gzip gets the tile inflated.
    const plain = await new Promise((ok, fail) => import("node:http").then((h) => h.get(`${base}/quantized-mesh/mapterhorn/9/533/386.terrain`, (res) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => ok({ res, body: Buffer.concat(c) })) }).on("error", fail)))
    assert.equal(plain.res.headers["content-encoding"], undefined)
    assert.equal(decodeTile(new Uint8Array(plain.body)).vertexCount, alps.vertexCount)
    assert.equal((await get("/quantized-mesh/mapbox/layer.json")).status, process.env.TV_MAPBOX_KEY ? 200 : 400, "a keyed source needs its key")
    assert.equal((await get("/quantized-mesh/custom/layer.json?terrainSource=https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png")).status, 200)
    assert.equal((await get("/quantized-mesh/mapterhorn/9/533/386.terrain", { method: "OPTIONS", headers: { origin: "http://x", "access-control-request-method": "GET", "access-control-request-headers": "accept" } })).status, 204)
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

// The relief modes' cost (network: Mapterhorn). A 256 px tile at z12 reads
// one quarter of a 512 px source tile: its protocol (the sky view factor's
// kernel) runs once for that source tile, not for the four the bilinear
// margin used to reach into, and the neighbour in the same source tile, or
// the same mode's values, are answered from the protocol tile cache. Until
// 2026-11-25 a tile cost four kernels (1.3 s at r = 32 on a laptop, now
// 0.35 s, the neighbour 15 ms): the times are lenient, the run counts exact.
{
  const { drawCase } = await import("./bench-direct.mjs")
  const { protocolCacheStats } = await import("./direct.mjs")
  await drawCase("hillshade", [12, 2124, 1458]) // the elevation, the code warmed up
  await drawCase("hillshade", [12, 2125, 1458])
  const before = protocolCacheStats()
  let t0 = performance.now()
  const png = await drawCase("svf32", [12, 2124, 1458])
  const first = performance.now() - t0
  assert.equal(png.subarray(1, 4).toString(), "PNG")
  assert.equal(protocolCacheStats().runs - before.runs, 1, "one kernel run for one tile")
  t0 = performance.now()
  await drawCase("svf32", [12, 2125, 1458])
  const neighbour = performance.now() - t0
  const tif = await drawCase("svf8.tif", [12, 2124, 1458])
  assert.equal(tif.readUInt16LE(2), 42, "a GeoTIFF")
  await drawCase("svf8", [12, 2124, 1458])
  assert.equal(protocolCacheStats().runs - before.runs, 2, "the neighbour from the cache; the r = 8 values and picture share one run")
  assert.ok(first < 2000, `a sky view factor tile (r = 32) took ${Math.round(first)} ms`)
  assert.ok(neighbour < 500, `its neighbour in the same source tile took ${Math.round(neighbour)} ms`)
  console.log(`sky view factor r = 32: ${Math.round(first)} ms, the neighbour ${Math.round(neighbour)} ms`)
}

console.log("ok")
// The bundled app code (colour ramps) keeps a handle open.
process.exit(0)
