// End-to-end check over stdio: the server starts, lists its tool with the
// UI link, answers open_view and serves the view page.
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { buildViewUrl } from "./url.mjs"
import { readFileSync } from "node:fs"
import { blockOf, viewOf } from "./tile-server.mjs"
import { DOCS_COPY, docsCopyText } from "./tile-openapi.mjs"
import { viewToQuery, queryToView } from "./url.mjs"
import { plan } from "./direct.mjs"

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
  assert.match((await plan({ terrainSource: "nope" }, new URLSearchParams())).why, /unknown terrain source/)
  assert.match((await plan({ modes: ["hillshade"], viewMode: "3d" }, new URLSearchParams())).why, /3D/)
  assert.match((await plan({ modes: ["basemap"] }, new URLSearchParams())).why, /imagery/)
  assert.equal((await plan({ terrainSource: '{"url":"https://x/{z}/{x}/{y}.png","type":"terrainrgb"}' }, new URLSearchParams())).dem.encoding, "mapbox")
  assert.equal(readFileSync(DOCS_COPY, "utf8").replaceAll(String.fromCharCode(13), ""), docsCopyText(), "docs/public/tile-service-openapi.json is stale: run `node tile-openapi.mjs` in mcp/")
}

// The link builder alone.
assert.equal(
  buildViewUrl({ lat: 45.9763, lng: 7.6586, zoom: 15, viewMode: "3d", modes: ["hillshade", "slope"], place: "Matterhorn" }),
  "https://terrain-viewer.iconem.com/?viewMode=3d&zoom=13&lat=45.9763&lng=7.6586&pitch=55&showTerrainAnalysis=true&showSlope=true&place=Matterhorn",
)
assert.match(buildViewUrl({ lat: 1, lng: 2, modes: ["lrm"] }), /showHillshade=false&showReliefVisualization=true&showLrm=true/)
assert.match(buildViewUrl({ lat: 1, lng: 2, terrainSourceB: "aws", place: "A b" }, { embed: true }), /terrainSourceB=aws&splitStyle=side-by-side&place=A%20b&sidebarCollapsed=true$/)
assert.throws(() => buildViewUrl({ lat: 1, lng: 2, modes: ["nope"] }), /Unknown mode/)

const client = new Client({ name: "tv-test", version: "0.0.0" })
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["server.mjs", "--stdio"] }))

const { tools } = await client.listTools()
const tool = tools.find((t) => t.name === "open_view")
assert.ok(tool, "open_view is listed")
assert.equal(tool._meta?.ui?.resourceUri, "ui://terrain-viewer/view.html")

const res = await client.callTool({ name: "open_view", arguments: { lat: 52.2, lng: 5.85, zoom: 14, modes: ["hillshade", "lrm", "moundDetector"], terrainSource: "custom-nl-ahn-dtm", place: "Veluwe" } })
assert.ok(!res.isError, JSON.stringify(res))
assert.match(res.structuredContent.url, /terrainSourceA=custom-nl-ahn-dtm/)
assert.match(res.structuredContent.embedUrl, /sidebarCollapsed=true/)
console.log(res.content[0].text)

const bad = await client.callTool({ name: "open_view", arguments: { lat: 0, lng: 0, modes: ["nope"] } }).catch((e) => ({ isError: true, thrown: String(e.message) }))
assert.ok(bad.isError, "an unknown mode is refused")

const page = await client.readResource({ uri: "ui://terrain-viewer/view.html" })
const item = page.contents[0]
assert.equal(item.mimeType, "text/html;profile=mcp-app")
assert.deepEqual(item._meta.ui.csp.frameDomains, ["https://terrain-viewer.iconem.com"])
assert.ok(item.text.includes("const App = "), "the client library is inlined")
assert.ok(!item.text.includes("/*__APP_BUNDLE__*/"))
console.log(`view page: ${(item.text.length / 1024).toFixed(0)} KB`)

// The lookups (network): a place, the datasets there, dated imagery, a picture.
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }, { timeout: 90000 }); assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`); return r }
const names = tools.map((t) => t.name).sort().join(",")
assert.equal(names, "catalog_items,compare_sources,datasets_covering,elevation,export_geotiff,geocode,imagery_dates,open_view,screenshot,search_stac")

const geo = (await call("geocode", { query: "Matterhorn" })).structuredContent.places[0]
assert.ok(Math.abs(geo.lat - 45.976) < 0.05 && Math.abs(geo.lng - 7.658) < 0.05, JSON.stringify(geo))
console.log(`geocode: ${geo.name.slice(0, 50)} z${geo.zoom}`)

const ds = (await call("datasets_covering", { lat: 52.2, lng: 5.85 })).structuredContent
assert.ok(ds.terrain.some((d) => d.id === "custom-nl-ahn-dtm"), "AHN covers the Veluwe")
console.log(`datasets_covering Veluwe: ${ds.terrain.length} terrain (${ds.terrain.slice(0, 3).map((d) => d.id + " " + d.resolutionM + "m").join(", ")}), ${ds.imageryCatalogsHere.length} local catalogs, ${ds.imageryCatalogsGlobal.length} global`)

const cat = (await call("catalog_items", { lat: 36.2, lng: 36.16, radiusKm: 4, catalogs: ["cat-oam", "cat-maxar", "nope"], limit: 3 })).structuredContent.catalogs
assert.ok(cat["cat-oam"].count > 0 && cat.nope.error, JSON.stringify(cat).slice(0, 300))
console.log(`catalog_items Antakya: OAM ${cat["cat-oam"].count}, Maxar ${cat["cat-maxar"].count ?? cat["cat-maxar"].error}; first ${JSON.stringify(cat["cat-oam"].items[0]).slice(0, 260)}`)

// Numbers and files.
const A = { lat: 45.9763, lng: 7.6586 }, B = { lat: 46.0207, lng: 7.7491 }
const ele = (await call("elevation", { points: [A, B], sources: ["mapterhorn", "aws", "esri", "nope"] })).structuredContent
assert.ok(Math.abs(ele.mapterhorn.points[0].elevationM - 4450) < 60, JSON.stringify(ele.mapterhorn))
assert.ok(Math.abs(ele.esri.points[0].elevationM - 4450) < 80, `the LERC reader: ${JSON.stringify(ele.esri)}`)
assert.ok(ele.nope.error, "an unknown source is refused with a reason")
const prof = (await call("elevation", { points: [A, B], profile: true, samples: 32 })).structuredContent.mapterhorn
assert.ok(prof.samples.length === 32 && prof.lengthM > 8000 && prof.lossM > 2500, JSON.stringify(prof).slice(0, 200))
console.log(`elevation: Matterhorn ${ele.mapterhorn.points[0].elevationM} m (Mapterhorn), ${ele.aws.points[0].elevationM} m (AWS); profile ${prof.lengthM} m, ${prof.minM} to ${prof.maxM} m`)

const tif = (await call("export_geotiff", { west: 7.62, south: 45.96, east: 7.70, north: 46.0, maxSide: 500 })).structuredContent
const { fromFile } = await import("geotiff")
const img = await (await fromFile(tif.file)).getImage()
const [band] = await img.readRasters()
assert.equal(img.getWidth(), tif.widthPx)
assert.equal(img.getGeoKeys().ProjectedCSTypeGeoKey, 3857)
assert.ok(band.reduce((m, v) => (v > m ? v : m), -Infinity) > 4300, "the summit is in the raster")
console.log(`export_geotiff: ${tif.widthPx} x ${tif.heightPx} px, ${tif.groundResolutionM} m, ${tif.minM} to ${tif.maxM} m, EPSG:${img.getGeoKeys().ProjectedCSTypeGeoKey}, origin ${img.getOrigin().slice(0, 2).map(Math.round)}`)

const stac = (await call("search_stac", { endpoint: "https://earth-search.aws.element84.com/v1", collection: "sentinel-2-l2a", lat: 36.2, lng: 36.16, from: "2023-02-01", to: "2023-02-20", limit: 2 })).structuredContent
assert.ok(stac.count > 0 && stac.items[0].imageryUrl, JSON.stringify(stac).slice(0, 200))
console.log(`search_stac: ${stac.count} Sentinel-2 items, newest ${stac.items[0].date}`)

const dates = (await call("imagery_dates", { lat: 36.2, lng: 36.16 })).structuredContent
assert.ok(dates["ge-historical"].dates?.length > 5, JSON.stringify(dates["ge-historical"]).slice(0, 200))
console.log(`imagery_dates Antakya: Google Earth ${dates["ge-historical"].dates.length} dates (newest ${dates["ge-historical"].dates[0]}), Wayback ${dates.wayback.dates?.length ?? dates.wayback.error}`)

const cmp = (await call("compare_sources", { lat: 36.2, lng: 36.16, zoom: 16, place: "Antakya", a: { imagerySource: "wayback", imageryDate: "2022-12-08" }, b: { imagerySource: "wayback", imageryDate: "2023-04-26" } })).structuredContent
assert.ok(cmp.url.includes("historicalActiveSourceB=wayback") && cmp.url.includes("dateA=") && cmp.url.includes("splitStyle=side-by-side"), cmp.url)
const exact = (await call("open_view", { lat: 45.9763, lng: 7.6586, viewMode: "3d", modes: ["hillshade", "basemap"] })).structuredContent
assert.ok(exact.app?.js?.startsWith("https://") && exact.app.css.some((u) => u.includes("maplibre-gl-geocoder")) && exact.app.origins.includes("https://unpkg.com"), JSON.stringify(exact.app))
assert.equal(exact.map, undefined)
console.log(`compare_sources: ${cmp.label}`)

if (!process.env.NO_SCREENSHOT) {
  const shot = await call("screenshot", { lat: 45.9763, lng: 7.6586, zoom: 12, modes: ["hillshade", "slope"], width: 800, height: 500 })
  const img = shot.content.find((c) => c.type === "image")
  assert.ok(img && img.data.length > 20000, "a picture came back")
  const { writeFileSync } = await import("node:fs")
  writeFileSync(new URL("./generated/test-shot.jpg", import.meta.url), Buffer.from(img.data, "base64"))
  console.log(`screenshot: ${(img.data.length * 0.75 / 1024).toFixed(0)} KB -> generated/test-shot.jpg`)
}

await client.close()
console.log("ok")
// The bundled app code (colour ramps) keeps a handle open.
process.exit(0)
