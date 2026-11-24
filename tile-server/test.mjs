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
  assert.match(xml, /<ServerUrl>http:\/\/t\/tiles\/\$\{z\}\/\$\{x\}\/\$\{y\}\.tif\?modes=slope&amp;terrainSource=x&amp;a=1<\/ServerUrl>/)
  assert.match(xml, /<TileLevel>17<\/TileLevel>.*<DataType>Float32<\/DataType>/)
  const project = qgisProjectXml("http://t", { ...(await readView({}, new URLSearchParams(), null)), valueLevel: 16 })
  assert.match(project, /<layer-tree-group name="Values \(Float32, for analysis\)" checked="Qt::Unchecked" expanded="0">/)
  assert.equal([...project.matchAll(/<provider>gdal<\/provider>/g)].length, 15)
}

console.log("ok")
// The bundled app code (colour ramps) keeps a handle open.
process.exit(0)
