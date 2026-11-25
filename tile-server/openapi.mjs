// The tile service described as an OpenAPI 3.1 document, served by the
// service at /openapi.json and browsed at /docs (Scalar). The docs site
// shows the same document: `node openapi.mjs` writes
// docs/public/tile-service-openapi.json, and test.mjs fails when that copy
// is stale.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MODE_NAMES, IMAGERY_SOURCES, STACK_ORDER } from "./url.mjs"

// How several modes of one `modes=` combine into a tile: shown on the
// parameter and in the API's description.
export const STACKING = [
  "**How several modes stack.** `modes=a,b,c` draws them in one tile, in the map's order, never in the order written: bottom to top, " + STACK_ORDER.map((m) => "`" + m + "`").join(", ") + ". The last is on top (the contours over everything, the colour relief at the bottom). `/processes/{id}` gives each mode's place as `x-tv-stack-rank` (0 at the bottom).",
  "**Opacity.** A mode's opacity is its own parameter (`slopeOpacity`, `svfOpacity`, `phongOpacity`, ... named in `x-tv-opacity-key`) times its panel group's (`terrainAnalysisOpacity`, `reliefVisualizationOpacity`, `lightingEffectsOpacity`, listed in `x-tv-group-opacity-keys`), each 0 to 1: `slopeOpacity=0.5&terrainAnalysisOpacity=0.4` draws the slope at 0.2. The group's opacity scales every mode of the group, each one separately (not the group flattened first).",
  "**Blending.** Over the map's background (white, black with `theme=dark`, transparent with `background=none`), each layer is drawn source-over with that opacity. The shading layers are different: the hillshade is a half-transparent dark and light layer drawn over what is under it; Phong and matcap multiply the colours under them and add their highlight; the terrain and building shadows darken. In a GIS, stack them with a multiply blend (the QGIS project does). The overlays (contours, iso-line, graticule, mound markers, plane slicer) are lines and areas over everything.",
  "**Defaults.** Without `modes`, the hillshade alone. Given without `hillshade`, the hillshade is off. A mode's group switch does not bring the group's default mode with it (asking for `aspect` does not also draw `slope`).",
  "**Refused together.** `basemap` with a terrain mode on `/terrain-tiles` (400: ask `/basemap-tiles` for the imagery and stack the two in the client; `/render` draws them in one picture). Any terrain mode on `/basemap-tiles` (400). On `.pbf`/`.mvt`, any mode that is only a picture: only `contours`, `isoline`, `moundDetector`, `graticules` and `planeSlicer` are vector (400). On `.tif` and `encoding=`, more than one mode, or a mode without values (400). `engine=direct` with a mode or source only the browser draws (400). Otherwise any set of modes stacks.",
].join("\n\n")

const q = (name, schema, description, extra = {}) => ({ name, in: "query", required: false, schema, description, ...extra })

// What a tile and a viewport share: the source and the modes.
const VIEW_PARAMS = [
  q("terrainSource", { type: "string", examples: ["mapterhorn", "custom-nl-ahn-dtm", "{\"url\":\"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png\",\"type\":\"terrarium\",\"maxzoom\":15}"] }, "The elevation source: an id from `/terrain-sources`, the address of Terrarium tiles, of a COG (`.tif`) or of a VRT (`.vrt`), or a configuration as JSON with the fields of a library entry, `{\"url\": ..., \"type\": \"terrarium\" | \"terrainrgb\" | \"cog\" | \"vrt\" | \"wms-raw\" | \"lerc\" | \"quantized-mesh\" | \"tilejson\", \"maxzoom\": ...}`. Unset: Mapterhorn. `url` is read as the same parameter."),
  q("engine", { type: "string", enum: ["auto", "direct", "browser"] }, "Who draws. `direct`: computed in the server from elevation tiles, in a fraction of a second, for the modes and parameters `/algorithms` lists as direct on a source `/terrain-sources` lists as direct. `browser`: the app in a headless browser, every source and mode, seconds. `auto` (the default) takes direct when it can. The answer's `x-tv-engine` header says which drew it, `x-tv-engine-why` why not direct."),
  q("background", { type: "string", enum: ["map", "none"], default: "map" }, "`none`: no white (or black) map background, a transparent PNG to stack layers in a GIS. Direct engine only; the browser's tiles keep the map's background."),
  q("modes", { type: "array", items: { type: "string", enum: MODE_NAMES } }, "The modes to draw, comma-separated (`style: form, explode: false`). `algorithm` is read as the same parameter. Each mode is a process: `/processes/{id}` lists its settings.\n\n" + STACKING, { style: "form", explode: false }),
  q("mapboxKey", { type: "string" }, "Your Mapbox access token, for the `mapbox` source. Read by the server's readers and given to the app as a setting, never put in the app's address; a tile drawn with a key is cached apart from one without."),
  q("maptilerKey", { type: "string" }, "Your MapTiler key, for the `maptiler` source."),
  q("cesiumIonKey", { type: "string" }, "Your Cesium ion token, for the `cesium` source and other ion assets."),
  q("appParams", { type: "object", additionalProperties: { type: "string" } }, "Any other URL parameter of the app, given as it is at the top level of the query (for example `slopeOpacity=0.6`): ramps, opacities, light direction, contour interval. The list is the app's URL reference.", { style: "form", explode: true }),
]

const IMAGERY_PARAMS = [
  q("imageryUrl", { type: "string" }, "Imagery: XYZ tiles (`{z}/{x}/{y}`) or a COG."),
  q("imagerySource", { type: "string", enum: IMAGERY_SOURCES }, "Dated imagery built into the app, with `imageryDate`."),
  q("imageryDate", { type: "string", format: "date" }, "The date of `imagerySource`, YYYY-MM-DD."),
]
// A viewport can mix both: the imagery under the terrain modes (`basemap` in `modes`).
const ALL_PARAMS = [...VIEW_PARAMS, ...IMAGERY_PARAMS]
const tileXYZ = (z = 12, x = 2125, y = 1464) => [
  { name: "z", in: "path", required: true, schema: { type: "integer", minimum: 0, maximum: 22 }, example: z },
  { name: "x", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: x },
  { name: "y", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: y },
]
const ogcJson = (description) => ({ 200: { description, content: { "application/json": { schema: { type: "object" } } } } })

// Every raster answer names its STAC Item (stac.mjs) in a Link header.
const LINK_HEADER = { link: { schema: { type: "string" }, description: "`<{this address}.stac.json?{query}>; rel=\"describedby\"; type=\"application/geo+json\"`: the answer's STAC Item (Processing extension)." } }
const STAC_NOTE = " **Provenance:** the same address plus `.stac.json` (same query) answers a STAC Item of this export (STAC 1.1.0, Processing extension v1.2.0: its footprint, the source it was derived from, the process and parameters as executed, the software version), and the answer names it in a `Link: <...>; rel=\"describedby\"` header."
const image = (description) => ({
  200: { description, headers: LINK_HEADER, content: { "image/png": { schema: { type: "string", format: "binary" } }, "image/jpeg": { schema: { type: "string", format: "binary" } } } },
  400: { description: "A parameter is wrong; the body says which", content: { "text/plain": { schema: { type: "string" } } } },
  500: { description: "The app could not be rendered; the body says why", content: { "text/plain": { schema: { type: "string" } } } },
})
const FORMAT = { name: "format", in: "path", required: true, schema: { type: "string", enum: ["png", "jpg"], default: "png" } }

// A mode's values, before the colour ramp (direct.mjs VALUE_MODES).
const VALUE_MODE_NAMES = ["elevation", "colorRelief", "slope", "aspect", "tri", "tpi", "roughness", "curvature", "shapeIndex", "blobness", "eigenRatio", "orientation", "lrm", "svf", "openness", "localDominance"]
const VALUE_PARAMS = [
  q("terrainSource", { type: "string" }, "The elevation source: an id from `/terrain-sources`, a tile address or a JSON configuration."),
  q("modes", { type: "string", enum: VALUE_MODE_NAMES }, "One mode. `elevation` is the source's elevation in metres; the units of the others are listed in `/processes/{id}` (`x-tv-values`) and in the docs: slope and aspect in degrees, TRI, TPI, roughness and LRM in metres, svf and the eigenvalue ratio a share 0..1, openness and local dominance in degrees, curvature per metre.", { required: true, example: "slope" }),
  q("appParams", { type: "object", additionalProperties: { type: "string" } }, "The mode's own URL parameters of the app (curvatureMode, lrmRadius, svfRadius, opennessMode, ...). Its ramp, range and opacity do not change the values."),
  q("mapboxKey", { type: "string" }, "Your Mapbox access token, for the `mapbox` source."),
  q("maptilerKey", { type: "string" }, "Your MapTiler key, for the `maptiler` source."),
  q("cesiumIonKey", { type: "string" }, "Your Cesium ion token, for the `cesium` source."),
]
const VALUE_HEADERS = { "x-tv-value-unit": { schema: { type: "string" }, description: "The unit of the values (m, degree, 1/m, 1/m^2, 1; ASCII)" }, "x-tv-value-scale": { schema: { type: "number" }, description: "The factor a PNG packing multiplied them by" } }
const COMPRESSION = q("compression", { type: "string", enum: ["deflate", "none"], default: "deflate" }, "Deflate with the floating-point predictor (GDAL's PREDICTOR=3), lossless: about a quarter of the size for elevation, half for slope, two thirds for curvature or svf, for 2 to 6 ms a tile. `none` for a reader without deflate.")
const MESHER_NOTE = "`martini` (the default since 2026-11-25): a right-triangulated irregular network on the 257 x 257 grid, 5 to 15 ms a tile, about twice the triangles of delatin. `delatin`: Delaunay refinement, about 45% fewer triangles and bytes for the same error, 20 to 55 ms a tile (three times slower): for a scene where bytes matter more than the time to make them."
const HEIGHTS_NOTE = "The vertical datum of the heights. `ellipsoidal` (the default): above the WGS84 ellipsoid, what quantized-mesh means and what CesiumJS, Cesium for Unreal and Unity and Cesium World Terrain use; the sources give heights above sea level (orthometric), so the EGM96 geoid's height N is added (h = H + N: about +45 m in Paris, +51 m in the Alps, from -106 m south of India to +85 m in New Guinea). Without it the ground sits N metres too low under 3D Tiles, photogrammetry and GNSS data. `orthometric`: the source's own heights above sea level, for a client that places everything on the geoid (a local scene in metres above sea level). An ellipsoidal source (`cesium`) is not shifted again: with `orthometric` it has N taken off. EGM96 15' grid, bilinear (NGA, public domain), shipped with the service."
const TIFF_NOTE = " Browsers do not display TIFF: Scalar's test request answers \"Preview unavailable\" and offers the file to download."
const tiff = (description) => ({
  200: { description, headers: { ...VALUE_HEADERS, ...LINK_HEADER }, content: { "image/tiff": { schema: { type: "string", format: "binary" } } } },
  400: { description: "More than one mode, a mode without values, or a source the direct engine cannot read", content: { "text/plain": { schema: { type: "string" } } } },
})

/** The quick start's addresses: title, path (after the base), note. */
export const QUICK_START = [
  ["Slope, Mapterhorn, XYZ tiles", "/terrain-tiles/mapterhorn/{z}/{x}/{y}.png?modes=slope", "any mode of `/processes`, several comma-separated; the source id is the path segment after `/terrain-tiles/` (`/terrain-sources` lists them)"],
  ["Sky-view factor, IGN RGE ALTI (France), XYZ tiles", "/terrain-tiles/custom-fr-ign-rgealti-highres/{z}/{x}/{y}.png?modes=svf", "zoom 12 and finer; the first tiles of an area take a second or two"],
  ["A source given by its address (Terrarium tiles, a COG, a VRT, JSON)", "/terrain-tiles/{z}/{x}/{y}.png?modes=hillshade&terrainSource=https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", "the query form, for anything that is not a library id"],
  ["Cesium terrain (quantized mesh), Mapterhorn: the layer.json", "/quantized-mesh/mapterhorn/layer.json", "CesiumJS, Blender's OGC 3D Tiles add-on as a *Quantized-mesh terrain* entry; martini mesher, heights above the ellipsoid (geoid added)"],
  ["The same, meshed by delatin", "/quantized-mesh/mapterhorn/layer.json?mesher=delatin", "half the triangles, three times slower to make"],
  ["Imagery: Esri Wayback of 2020, XYZ tiles", "/basemap-tiles/wayback/{z}/{x}/{y}.jpg?imageryDate=2020-01-01", "dated imagery and the built-in basemaps by id: `/basemaps`"],
  ["A picture of a box", "/bbox/7.6,45.95,7.7,46/800x600.png?terrainSource=mapterhorn&modes=hillshade,contours", "west,south,east,north; `.tif` with one mode for its values"],
  ["A colour ramp as a picture", "/colorramps/slope-plantopo.png?width=256&height=16", "a legend; `orientation=vertical`; the ids: `/colorramps`"],
  ["The STAC Item of a tile", "/terrain-tiles/mapterhorn/12/2133/1449.png.stac.json?modes=slope", "any raster export's address plus `.stac.json`"],
  ["The terrain sources, by id", "/terrain-sources", "what `/terrain-tiles/{source}/...`, `/quantized-mesh/{source}/...` and `terrainSource` take; one with its description: `/terrain-sources/{id}`"],
  ["The modes, as OGC API - Processes", "/processes", "each mode's settings: `/processes/{id}`"],
]

/** Ready-to-copy addresses on this service: the top of the API's
 *  description, and of the docs page. Each in a code block, which the docs
 *  page (DOCS_HTML's CSS and script) wraps and gives a copy button. */
export function quickStart(base = "http://localhost:3400") {
  const fence = "```"
  const block = ([title, url, note]) => `**${title}**${note ? " (" + note + ")" : ""}\n\n${fence}text\n${base}${url}\n${fence}`
  return [
    "## Quick start",
    "Copy an address into QGIS (XYZ Tiles), MapLibre, CesiumJS or Blender. `{z}/{x}/{y}` stay as they are: the client fills them.",
    ...QUICK_START.map(block),
    "**Addresses.** A library id goes in the path, as `{source}`: `/terrain-tiles/{source}/{z}/{x}/{y}.png`, `/basemap-tiles/{source}/{z}/{x}/{y}.jpg`, `/quantized-mesh/{source}/layer.json`. Anything else (a tile address, a COG, a VRT, a JSON configuration) goes in the query: `/terrain-tiles/{z}/{x}/{y}.png?terrainSource=...`, `/basemap-tiles/{z}/{x}/{y}.jpg?imageryUrl=...`, `/quantized-mesh/custom/layer.json?terrainSource=...` (`custom` in the path means the same everywhere). Both forms answer the same tile.",
  ].join("\n\n")
}

/** The `{source}` path parameter: any string, with the known ids as the
 *  schema's `examples` (JSON Schema, OpenAPI 3.1). Scalar's request panel
 *  shows them as a list with "Add value" for any other text (checked on
 *  1.77.0); the parameter's own `examples` map gives no list there, and
 *  `anyOf: [{enum}, {type: string}]` neither. An `enum` would also give the
 *  list but declare every other id invalid. The default id first, so it
 *  stays the one filled in. */
function sourceParam(known, first, description) {
  const list = known?.length ? [...new Set([first, ...known, "custom"])] : []
  return { name: "source", in: "path", required: true, schema: { type: "string", ...(list.length ? { examples: list } : {}) }, description, example: first }
}

/** The ids `{source}` offers: the terrain library's (generated/library.json,
 *  as /terrain-sources lists them) and the basemaps' (as /basemaps lists them).
 *  Needs generated/ (node build.mjs). */
export async function sourceIds() {
  const lib = JSON.parse(readFileSync(new URL("./generated/library.json", import.meta.url), "utf8"))
  const { BUILTIN_BASEMAP_SOURCES } = await import("./generated/app-lib.mjs")
  return {
    terrain: lib.terrain.map((s) => s.id),
    basemap: [...new Set([...IMAGERY_SOURCES, ...BUILTIN_BASEMAP_SOURCES.map((s) => s.id)])],
  }
}

export function openapi(server = "http://localhost:3400", ids = {}) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Terrain Viewer tile service",
      version: "0.1.0",
      description: quickStart(server) + "\n\n## About\n\nWhat Terrain Viewer draws, as map tiles and as pictures of a viewport. Two engines draw them. The direct engine computes every 2D terrain mode in the server with the app's own code, reading the elevation with the app's own readers (tile pyramids, COG, VRT, WMS and WCS, LERC, quantized mesh, PMTiles, differences), in a fraction of a second. For everything else the app itself renders them in a headless browser, so every source it reads and every mode it computes comes out as in the app: a tile is drawn with the 2048 px block around it and the block is kept a week, so the first tile of a block takes seconds and its neighbours milliseconds. Web Mercator only.\n\nThe elevation modes are at `/terrain-tiles`, the imagery at `/basemap-tiles`, the terrain as Cesium meshes at `/quantized-mesh`. Each mode is described as an OGC API - Processes process at `/processes/{id}`: its settings with their types, ranges and defaults.\n\n" + STACKING,
      license: { name: "MIT", url: "https://github.com/Iconem/terrain-viewer" },
    },
    externalDocs: { description: "Documentation", url: "https://terrain-viewer.iconem.com/docs/dev/tile-service" },
    servers: [{ url: server }],
    // Scalar lists the groups in this order: the processes first (they list
    // the modes), then the tiles they run as, then the rest.
    tags: [
      { name: "Visualization modes (OGC API – Processes)", description: "The modes as OGC API - Processes processes (OGC 18-062r2), with OGC API Common's landing page and conformance. `/processes` lists every mode with its settings; a process is run by asking for its tiles: its description links them." },
      { name: "Terrain tiles", description: "`/terrain-tiles`: the elevation modes as XYZ raster tiles (`/terrain-sources` lists the sources by id), the overlays as vector tiles, a TileJSON and a QGIS project of them." },
      { name: "Quantized mesh", description: "`/quantized-mesh`: any direct source as Cesium terrain (quantized-mesh-1.0) for CesiumJS, Cesium for Unreal or Unity and Blender. Give the client the layer.json; it asks for the tiles." },
      { name: "Basemap tiles", description: "`/basemap-tiles`: the imagery under the terrain, as XYZ tiles, as the app draws it. Not only the historical imagery: the dated sources (Esri Wayback, Google Earth historical, Bing, HLS, EOX Sentinel-2, each with a date) and the app's built-in basemaps with a fixed address (Google, Bing Aerial, Esri, Mapbox, MapTiler, HERE), both by id in the path (`/basemaps` lists them), plus any XYZ or COG address in the query (`imageryUrl`). Drawn by the browser engine." },
      { name: "Catalogs", description: "What can be named by id: colour ramps (and pictures of them), modes, and what a share link switches on." },
      { name: "Viewport", description: "A picture of a viewport or a box, like a WMS GetMap." },
      { name: "Values", description: "A mode's numbers before the colour ramp, in natural units: Float32 GeoTIFF for analysis (GDAL, QGIS, rasterio, numpy), or packed in a PNG for a web map." },
      { name: "Service" },
    ],
    paths: {
      "/terrain-tiles/{z}/{x}/{y}.tif": {
        get: {
          tags: ["Values"], operationId: "valueTile", summary: "A mode's values as a Float32 GeoTIFF tile",
          description: "One band of 32-bit floats, EPSG:3857, georeferenced, NaN where there is no data: the values the app colours, before its ramp, in natural units (the unit in the `x-tv-value-unit` header and in `/processes/{id}`). 256 px; `{y}@2x` or `tilesize=512` for 512. The same tile as a PNG for a web map: `.png?modes=slope&encoding=terrarium` (or `terrainrgb`), the values multiplied by `valueScale` (default 1) and packed as an elevation, so MapLibre's raster-dem or a few lines of numpy read them back; `valueScale` keeps small values (curvature) above the packing's step (Terrarium 1/256, Terrain-RGB 0.1). Computed by the direct engine only." + TIFF_NOTE + STAC_NOTE,
          parameters: [
            { name: "z", in: "path", required: true, schema: { type: "integer", minimum: 0, maximum: 22 }, example: 13 },
            { name: "x", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: 4270 },
            { name: "y", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: 2911 },
            q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."),
            q("encoding", { type: "string", enum: ["terrarium", "terrainrgb"] }, "With `.png` in place of `.tif`: the values packed in a PNG as an elevation would be."),
            q("valueScale", { type: "number", default: 1 }, "With `encoding`: the factor the values are multiplied by before packing."),
            COMPRESSION,
            ...VALUE_PARAMS,
          ],
          responses: tiff("The tile"),
        },
      },
      "/render.tif": {
        get: {
          tags: ["Values"], operationId: "valueRender", summary: "A mode's values over an area, as a Float32 GeoTIFF",
          description: "Like a WCS GetCoverage: the values over a bounding box (exactly: `width` pixels across it, the height that keeps the pixels square in Web Mercator, at most 4096 a side) or around a centre (`lat`, `lng`, MapLibre `zoom`, `width`, `height`). `/bbox/{w},{s},{e},{n}/{width}x{height}.tif` is the same with a box. `.png` with `encoding` packs them as for the tiles." + TIFF_NOTE + STAC_NOTE,
          parameters: [
            q("bbox", { type: "string" }, "west,south,east,north in degrees.", { example: "7.6,45.95,7.7,46.0" }),
            q("width", { type: "integer", minimum: 16, maximum: 4096, default: 1024 }, "Width in pixels."),
            q("height", { type: "integer", minimum: 16, maximum: 4096, default: 640 }, "Height in pixels, without `bbox`."),
            q("lat", { type: "number" }, "Latitude of the centre, without `bbox`."), q("lng", { type: "number" }, "Longitude of the centre, without `bbox`."), q("zoom", { type: "number", default: 12 }, "MapLibre zoom (512 px tiles), without `bbox`."),
            COMPRESSION,
            ...VALUE_PARAMS,
          ],
          responses: tiff("The values"),
        },
      },
      "/gdal.xml": {
        get: {
          tags: ["Values"], operationId: "gdalXml", summary: "A mode's values as one GDAL raster",
          description: "A GDAL WMS description (TMS minidriver) of the mode's Float32 GeoTIFF tiles: one Float32 raster of the whole world, down to the source's deepest zoom, with overviews. GDAL opens its address as is: `gdalinfo \"http://localhost:3400/gdal.xml?modes=slope\"`, `gdal_translate -projwin ... <address> out.tif`, `rasterio.open(address)`, and QGIS (Layer > Add Raster Layer, the address as the source). The QGIS project (`/qgis.qgz`) has one such layer per mode, in its Values group.",
          parameters: VALUE_PARAMS,
          responses: { 200: { description: "The description", content: { "application/xml": { schema: { type: "string" } } } }, 400: { description: "More than one mode, a mode without values, or a source the direct engine cannot read" } },
        },
      },
      "/terrain-sources": {
        get: { tags: ["Terrain tiles"], operationId: "terrainSources", summary: "The terrain sources, by id", description: "What `/terrain-tiles/{source}/...`, `/quantized-mesh/{source}/...` and `terrainSource` take: every elevation source the app knows, the built-in ones and the library. Each with its type, its tile address when it is a plain pyramid, its zoom range and extent, and the engine that can draw it. Its old address, `/sources`, still answers.", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/terrain-sources/{id}": {
        get: { tags: ["Terrain tiles"], operationId: "terrainSource", summary: "One terrain source", description: "One entry of `/terrain-sources`, with its description. Its old address, `/sources/{id}`, still answers.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "custom-jp-gsj-terrainrgb" }], responses: { 200: { description: "The source, with its description", content: { "application/json": { schema: { type: "object" } } } }, 404: { description: "No such source" } } },
      },
      "/terrain-tiles/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Terrain tiles"], operationId: "terrainTile", summary: "One XYZ tile of the elevation modes",
          description: "A 256 px Web Mercator tile of the modes computed from the elevation (every mode but `basemap`), stacked as described under `modes`. A library source can go in the path instead: `/terrain-tiles/{source}/{z}/{x}/{y}.{format}`. For 512 px write `{y}@2x` in the address or add `tilesize=512`. The camera is the tile's: `lat`, `lng`, `zoom`, `pitch` and `bearing` are not read. The imagery is at `/basemap-tiles`. titiler's `url` (the source) and `algorithm` (one mode) are read; its address `/tiles/WebMercatorQuad/...` was removed on 2026-11-25 (404)." + STAC_NOTE,
          parameters: [...tileXYZ(), FORMAT, q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."), ...VIEW_PARAMS],
          responses: image("The tile"),
        },
      },
      "/terrain-tiles/{source}/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Terrain tiles"], operationId: "terrainTileBySource", summary: "One XYZ tile of the elevation modes, the source by id",
          description: "The same tile as `/terrain-tiles/{z}/{x}/{y}.{format}?terrainSource={source}`, with the library id in the path, as `/quantized-mesh/{source}/...`: shorter, and the source cannot be lost from a template. `.tif`, `.pbf` and `.mvt` work the same way. `custom` takes the source from the query (an address, a COG, a VRT or a JSON configuration), which is the query form. An unknown id answers 404." + STAC_NOTE,
          parameters: [
            sourceParam(ids.terrain, "mapterhorn", "An id from `/terrain-sources`, or `custom` with `terrainSource` in the query. The list offers the ids; any other text is sent as written."),
            ...tileXYZ(), FORMAT, q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."), ...VIEW_PARAMS.filter((p) => p.name !== "terrainSource"),
          ],
          responses: { ...image("The tile"), 404: { description: "No such source" } },
        },
      },
      "/basemaps": {
        get: { tags: ["Basemap tiles"], operationId: "basemaps", summary: "The basemaps, by id", description: "What `/basemap-tiles/{source}/...` takes: the dated imagery (`kind: dated`, read with `imageryDate`) and the built-in basemaps with a fixed address (`kind: static`), each with the query parameter it stands for (`imagerySource` or `basemapSource`) and the API key it needs.", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/basemap-tiles/{source}/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Basemap tiles"], operationId: "basemapTileBySource", summary: "One XYZ tile of the imagery, the source by id",
          description: "A basemap of `/basemaps` by id: a dated source (`wayback`, `ge-historical`, `bing`, `hls`, `eox-s2`) with `imageryDate`, or a built-in basemap with a fixed address (`google`, `googlesat`, `bing`, `esri`, `mapbox`, `maptiler`, `here`). `bing` is both: dated with an `imageryDate`, Bing Aerial without. The same tile as the query form `/basemap-tiles/{z}/{x}/{y}.{format}?imagerySource=...` (or `basemapSource=...`); `custom` takes the imagery from the query. An unknown id answers 404." + STAC_NOTE,
          parameters: [
            sourceParam(ids.basemap, "wayback", "An id from `/basemaps`, or `custom`. The list offers the ids; any other text is sent as written."),
            ...tileXYZ(14, 8492, 5792), { ...FORMAT, schema: { type: "string", enum: ["jpg", "png"], default: "jpg" } },
            q("imageryDate", { type: "string", format: "date" }, "For a dated source: the date, YYYY-MM-DD (the nearest image the source has).", { example: "2020-01-01" }),
            q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."),
            q("mapboxKey", { type: "string" }, "Your Mapbox token, for `mapbox`."),
            q("maptilerKey", { type: "string" }, "Your MapTiler key, for `maptiler`."),
          ],
          responses: { ...image("The tile"), 404: { description: "No such basemap" } },
        },
      },
      "/basemap-tiles/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Basemap tiles"], operationId: "basemapTile", summary: "One XYZ tile of the imagery",
          description: "The basemap as the app draws it: dated imagery (`imagerySource`, `imageryDate`), an XYZ or COG address (`imageryUrl`), or the app's named basemap and its overlays (`basemapSource`, `overlayBasemapIds` and the other basemap parameters of the app, at the top level of the query). A source of `/basemaps` can go in the path instead: `/basemap-tiles/{source}/{z}/{x}/{y}.{format}`. Drawn by the browser engine. A terrain mode in `modes` is refused: ask `/terrain-tiles` and stack the two. `{y}@2x` or `tilesize=512` for 512 px." + STAC_NOTE,
          parameters: [
            ...tileXYZ(14, 8492, 5792), { ...FORMAT, schema: { type: "string", enum: ["jpg", "png"], default: "jpg" } },
            q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."),
            ...IMAGERY_PARAMS,
            q("basemapSource", { type: "string" }, "The app's basemap: an id of its list or an address."),
            q("overlayBasemapIds", { type: "string" }, "The app's basemap overlays, comma-separated."),
            q("mapboxKey", { type: "string" }, "Your Mapbox token, for Mapbox imagery."),
            q("appParams", { type: "object", additionalProperties: { type: "string" } }, "Any other basemap parameter of the app.", { style: "form", explode: true }),
          ],
          responses: image("The tile"),
        },
      },
      "/terrain-tiles/{z}/{x}/{y}.{format}.stac.json": {
        get: {
          tags: ["Terrain tiles"], operationId: "stacItem", summary: "The STAC Item of an export",
          description: "Any raster export's address plus `.stac.json`, with the same query: `/terrain-tiles/{z}/{x}/{y}.png|jpg|tif.stac.json`, `/basemap-tiles/{z}/{x}/{y}.jpg.stac.json`, `/render.png|tif.stac.json`, `/bbox/{w},{s},{e},{n}/{width}x{height}.tif.stac.json`. A STAC 1.1.0 Item with the Processing extension (v1.2.0): `bbox` and `geometry` of the export, `datetime` and `processing:datetime` the time of the answer, `processing:lineage` (a sentence: the source, the modes, their parameters), `processing:software` (`terrain-viewer tile-server` and its version), `processing:level` (`L3` for a map derived from the elevation), `processing:expression` (`format: x-tv-process`, the process ids and their inputs as executed), links `derived_from` the terrain source (its `/terrain-sources/{id}` entry and its tile template, or its address) or the imagery, `related` to each `/processes/{id}`, and the export as asset `data`. Computed from the address: nothing is drawn, and the caller's API keys are left out.",
          parameters: [...tileXYZ(13, 4270, 2911), { ...FORMAT, schema: { type: "string", enum: ["png", "jpg", "tif"], default: "tif" } }, ...VIEW_PARAMS],
          responses: { 200: { description: "The STAC Item", content: { "application/geo+json": { schema: { type: "object" } } } }, 404: { description: "Not the address of a raster export" } },
        },
      },
      "/render.{format}": {
        get: {
          tags: ["Viewport"], operationId: "render", summary: "A picture of a viewport",
          description: "Like a WMS GetMap: a picture of a given size, placed by its centre and zoom or by a bounding box. Unlike a tile it keeps the scale bar and the credits, and it can be tilted or split. `/bbox/{w},{s},{e},{n}/{width}x{height}.{format}` is the same with the box and the size in the address." + STAC_NOTE,
          parameters: [
            FORMAT,
            q("lat", { type: "number", minimum: -85, maximum: 85 }, "Latitude of the centre. Required unless `bbox` is given.", { example: 45.83 }),
            q("lng", { type: "number", minimum: -180, maximum: 180 }, "Longitude of the centre. Required unless `bbox` is given.", { example: 6.86 }),
            q("zoom", { type: "number", minimum: 0, maximum: 22, default: 12 }, "MapLibre zoom (512 px tiles)."),
            q("bbox", { type: "string", pattern: "^-?[\\d.]+,-?[\\d.]+,-?[\\d.]+,-?[\\d.]+$" }, "west,south,east,north in degrees, in place of `lat`, `lng` and `zoom`. The whole box is inside the picture; when its shape differs from the picture's, more is shown on two sides."),
            q("width", { type: "integer", minimum: 64, maximum: 4096, default: 1024 }, "Width in pixels."),
            q("height", { type: "integer", minimum: 64, maximum: 4096, default: 640 }, "Height in pixels."),
            q("viewMode", { type: "string", enum: ["2d", "3d", "globe"], default: "2d" }, "Flat, tilted over the relief, or the globe."),
            q("pitch", { type: "number", minimum: 0, maximum: 85 }, "Tilt in degrees; 55 by default in 3D."),
            q("bearing", { type: "number" }, "Rotation in degrees, clockwise from north."),
            q("split", { type: "string", enum: ["off", "side-by-side", "overlay"] }, "Two views in one picture, with `terrainSourceB`."),
            q("terrainSourceB", { type: "string" }, "The second view's elevation source."),
            ...ALL_PARAMS,
          ],
          responses: image("The picture"),
        },
      },
      "/bbox/{bbox}/{width}x{height}.{format}": {
        get: {
          tags: ["Viewport"], operationId: "bbox", summary: "A picture (or values) of a box",
          description: "The answer of `/render.{format}?bbox={bbox}&width={width}&height={height}`, with the box and the size in the address (titiler's form): the whole box inside the picture, more shown on two sides when the shapes differ. `.tif` (or `.png` with `encoding`) gives one mode's values over the box, exactly: `width` pixels across it, the height that keeps the pixels square in Web Mercator. Every other parameter of `/render` is read the same; `lat`, `lng` and `zoom` are not." + STAC_NOTE,
          parameters: [
            { name: "bbox", in: "path", required: true, schema: { type: "string", pattern: "^-?[\\d.]+,-?[\\d.]+,-?[\\d.]+,-?[\\d.]+$" }, description: "west,south,east,north in degrees.", example: "7.6,45.95,7.7,46" },
            { name: "width", in: "path", required: true, schema: { type: "integer", minimum: 64, maximum: 4096 }, example: 800 },
            { name: "height", in: "path", required: true, schema: { type: "integer", minimum: 64, maximum: 4096 }, example: 600 },
            { ...FORMAT, schema: { type: "string", enum: ["png", "jpg", "tif"], default: "png" } },
            ...ALL_PARAMS,
          ],
          responses: image("The picture"),
        },
      },
      "/quantized-mesh/{source}/layer.json": {
        get: {
          tags: ["Quantized mesh"], operationId: "quantizedMeshLayer", summary: "A source as Cesium terrain: its layer.json",
          description: "The layer.json a Cesium terrain client reads first (CesiumJS `CesiumTerrainProvider.fromUrl`, Cesium for Unreal or Unity, Blender add-ons that read Cesium terrain): TileJSON 2.1.0, `format: quantized-mesh-1.0`, `scheme: tms`, `projection: EPSG:4326` (two tiles at level 0), `available` level by level (whole at level 0, the source's bounds below), down to the level as fine as the source (its deepest 256 px Web Mercator zoom, less one), `extensions: [octvertexnormals]` and the source's attribution. The tile template keeps the query given (`mesher`, `heights`, ...). Heights are above the WGS84 ellipsoid by default, as quantized-mesh expects (see `heights`). Any source the direct engine reads (`/terrain-sources`, engine `direct`): Terrarium and Terrain-RGB pyramids, COG, VRT, WMS, LERC, PMTiles, with the same API keys as `/terrain-tiles`.",
          parameters: [
            { name: "source", in: "path", required: true, schema: { type: "string" }, description: "An id from `/terrain-sources`, or `custom` with the source in `terrainSource` (an address or a JSON configuration).", example: "mapterhorn" },
            q("terrainSource", { type: "string" }, "With `custom`: the source's address or configuration, as for `/terrain-tiles`."),
            q("error", { type: "number", exclusiveMinimum: 0, maximum: 16, default: 0.5 }, "The mesh's vertical error, as a share of Cesium's geometric error of the level (77 km at level 0, halved each level: 4.7 m at level 14, times 0.5 is 2.35 m). Smaller for a finer mesh (more triangles), larger for a lighter one."),
            q("mesher", { type: "string", enum: ["martini", "delatin"], default: "martini" }, MESHER_NOTE),
            q("heights", { type: "string", enum: ["ellipsoidal", "orthometric"], default: "ellipsoidal" }, HEIGHTS_NOTE),
            q("maxTriangles", { type: "integer", minimum: 2, maximum: 262144, default: 32768 }, "delatin only: the most triangles a tile gets. The mesh stops refining there, worst points first, even above `error`. The default only bounds noisy or very fine sources (Mapterhorn's Alps need 7,000 to 15,000 a tile); lower it to keep a 3D scene light."),
            q("extensions", { type: "string", enum: ["octvertexnormals"] }, "The extensions to write, for a client that sets no `Accept: application/vnd.quantized-mesh;extensions=octvertexnormals` header (CesiumJS sets it when asked for vertex normals)."),
            ...VIEW_PARAMS.filter((p) => /Key$/.test(p.name)),
          ],
          responses: { 200: { description: "layer.json", content: { "application/json": { schema: { type: "object" } } } }, 400: { description: "A source the direct engine cannot read, or a wrong parameter" } },
        },
      },
      "/quantized-mesh/{source}/{z}/{x}/{y}.terrain": {
        get: {
          tags: ["Quantized mesh"], operationId: "quantizedMeshTile", summary: "One quantized-mesh-1.0 terrain tile",
          description: "One tile of the geographic TMS grid (level z: 2^(z+1) x 2^z tiles, y from the south) as quantized-mesh-1.0: the source's Web Mercator pixels of the matching zoom resampled (bilinear) to a 257 x 257 grid over the tile, shifted by the geoid to ellipsoidal heights (unless `heights=orthometric`), meshed within the error asked, encoded with the header (centre, heights, bounding sphere, horizon occlusion point), zigzag-delta vertices, high-water-mark indices and the four edge lists; skirts are the client's. With `octvertexnormals` asked (Accept header or `extensions`), the oct-encoded vertex normals. Gzipped when the client accepts it. A tile with no data is flat at sea level (the geoid's height at its centre, or 0 m with `heights=orthometric`).",
          parameters: [
            { name: "source", in: "path", required: true, schema: { type: "string" }, example: "mapterhorn" },
            { name: "z", in: "path", required: true, schema: { type: "integer", minimum: 0, maximum: 21 }, example: 12 },
            { name: "x", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: 4291 },
            { name: "y", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: 3139 },
            q("terrainSource", { type: "string" }, "With `custom`: the source."),
            q("error", { type: "number", exclusiveMinimum: 0, maximum: 16, default: 0.5 }, "As for layer.json."),
            q("mesher", { type: "string", enum: ["martini", "delatin"], default: "martini" }, "As for layer.json."),
            q("heights", { type: "string", enum: ["ellipsoidal", "orthometric"], default: "ellipsoidal" }, "As for layer.json: above the WGS84 ellipsoid (the geoid added) or above sea level."),
            q("maxTriangles", { type: "integer", minimum: 2, maximum: 262144, default: 32768 }, "As for layer.json."),
            q("extensions", { type: "string", enum: ["octvertexnormals"] }, "As for layer.json."),
            ...VIEW_PARAMS.filter((p) => /Key$/.test(p.name)),
          ],
          responses: {
            200: { description: "The tile", content: { "application/vnd.quantized-mesh": { schema: { type: "string", format: "binary" } } } },
            400: { description: "A source the direct engine cannot read, or a wrong parameter" },
            404: { description: "Not a tile of the grid" },
            502: { description: "The source refused the request (an API key)" },
          },
        },
      },
      "/tilejson.json": {
        get: {
          tags: ["Terrain tiles"], operationId: "tilejson", summary: "A TileJSON for a view",
          description: "The tile address for the given parameters, as a TileJSON document a map library can load. `tile_format` (png, jpg; pbf or mvt for the vector tiles, then TileJSON 3.0 with the `vector_layers` of the modes) and `tile_scale` (1, 2) choose the tiles; every other parameter is kept in the tile address, `/terrain-tiles` (`/basemap-tiles` for `modes=basemap`). titiler's `/WebMercatorQuad/tilejson.json` was removed on 2026-11-25 (404).",
          parameters: [q("tile_format", { type: "string", enum: ["png", "jpg", "pbf", "mvt"], default: "png" }, "Tile format."), q("tile_scale", { type: "integer", enum: [1, 2], default: 1 }, "2 for 512 px tiles."), ...ALL_PARAMS],
          responses: { 200: { description: "TileJSON 2.2.0", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/sources": {
        get: { tags: ["Terrain tiles"], operationId: "sources", deprecated: true, summary: "The terrain sources (old address)", description: "The old address of `/terrain-sources`, kept for older QGIS plugins, desktop builds and scripts: the same answer.", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/sources/{id}": {
        get: { tags: ["Terrain tiles"], operationId: "source", deprecated: true, summary: "One terrain source (old address)", description: "The old address of `/terrain-sources/{id}`: the same answer.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "custom-jp-gsj-terrainrgb" }], responses: { 200: { description: "The source, with its description", content: { "application/json": { schema: { type: "object" } } } }, 404: { description: "No such source" } } },
      },
      "/colorramps": {
        get: { tags: ["Catalogs"], operationId: "colorramps", summary: "The colour ramps, by id", description: "The app's ramps, to name as `colorRamp` (colour relief) or `slopeColorRamp` (slope).", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/colorramps/{id}": {
        get: { tags: ["Catalogs"], operationId: "colorramp", summary: "One colour ramp", description: "Its stops, as a MapLibre expression over the value.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "slope-plantopo" }], responses: { 200: { description: "The ramp", content: { "application/json": { schema: { type: "object" } } } }, 404: { description: "No such ramp" } } },
      },
      "/colorramps/{id}.{format}": {
        get: {
          tags: ["Catalogs"], operationId: "colorrampImage", summary: "A colour ramp as a picture",
          description: "The ramp from its first stop to its last, coloured as the app colours the map (MapLibre's colour relief: linear between the stops, 8-bit), for a legend or a ramp picker. Horizontal by default, the lowest value on the left; `orientation=vertical` puts it at the bottom. PNG keeps the ramp's transparency (a slope ramp is transparent below its first colour); JPEG lays it on white.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "An id from `/colorramps`.", example: "slope-plantopo" },
            { name: "format", in: "path", required: true, schema: { type: "string", enum: ["png", "jpg"], default: "png" } },
            q("width", { type: "integer", minimum: 1, maximum: 4096 }, "Width in pixels: 256 horizontal, 16 vertical by default.", { example: 256 }),
            q("height", { type: "integer", minimum: 1, maximum: 4096 }, "Height in pixels: 16 horizontal, 256 vertical by default.", { example: 16 }),
            q("orientation", { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }, "Which way the values run."),
            q("reverse", { type: "boolean", default: false }, "The highest value first."),
          ],
          responses: { 200: { description: "The picture", content: { "image/png": { schema: { type: "string", format: "binary" } }, "image/jpeg": { schema: { type: "string", format: "binary" } } } }, 400: { description: "A wrong size or orientation" }, 404: { description: "No such ramp" } },
        },
      },
      "/terrain-tiles/{z}/{x}/{y}.{vectorFormat}": {
        get: {
          tags: ["Terrain tiles"], operationId: "vectorTile", summary: "The overlays as a vector tile",
          description: "The tile address with `.pbf` or `.mvt`: a Mapbox Vector Tile (512 px tiles, as the map loads them) with the features the app's overlays draw, one layer each: `contours` (lines with `ele` and `level`), the iso-line (`isoband` polygons and `isoline` lines at a value, `isoline-cliff` the cliff edge on a slope; `isoline` lines every interval), the mound detector (`tells` points with their measures) and the graticule (`graticule` lines, `kind` meridian or parallel, `deg`). Same parameters as the raster tiles; titiler's `/tiles/WebMercatorQuad/{z}/{x}/{y}.pbf` is the same. Past a layer's last zoom it comes from its deepest tile, scaled up. A mode drawn only as an image (hillshade, the plane slicer, ...) is refused: ask for `.png` or `.jpg`.",
          parameters: [
            { name: "z", in: "path", required: true, schema: { type: "integer" }, example: 11 }, { name: "x", in: "path", required: true, schema: { type: "integer" }, example: 1067 }, { name: "y", in: "path", required: true, schema: { type: "integer" }, example: 728 },
            { name: "vectorFormat", in: "path", required: true, schema: { type: "string", enum: ["pbf", "mvt"] }, example: "pbf" },
            q("terrainSource", { type: "string" }, "The elevation source: an id from `/terrain-sources`, a tile address or a JSON configuration."),
            q("modes", { type: "array", items: { type: "string", enum: ["contours", "isoline", "moundDetector", "graticules"] } }, "The layers, comma-separated. Unset: contours.", { style: "form", explode: false }),
            q("appParams", { type: "object", additionalProperties: { type: "string" } }, "The app's parameters of these layers, as for the raster tiles (contourMinor, isolineValue, tellSize, graticuleDensity, ...)."),
          ],
          responses: { 200: { description: "The vector tile", content: { "application/vnd.mapbox-vector-tile": { schema: { type: "string", format: "binary" } } } }, 400: { description: "A mode is not served as vector tiles, or the source cannot be read by the direct engine" } },
        },
      },
      "/qgis.qgz": {
        get: { tags: ["Terrain tiles"], operationId: "qgis", summary: "A QGIS project of a view", description: "Every layer of the app as an XYZ layer of `/terrain-tiles` (transparent tiles, `background=none`), stacked as the map stacks them and grouped as its panel where that order allows: the overlays on top (contours, plane slicer, mound candidates, graticule, iso-line, each also as vector tiles), the lighting effects, the hillshade, relief visualization, terrain analysis, the colour relief, then the basemap (as the app draws it, with its overlays, from `/basemap-tiles`; a plain XYZ basemap as such too; Google hybrid), and a closed, unchecked group of each mode's values as a Float32 raster read by GDAL (`/gdal.xml`), for analysis. The layers the view switches on start checked, and every layer's address carries the view's settings. The query is the view, in the service's names (terrainSource, modes, imageryUrl...) or the app's own: the query of a share link works as is (terrainSourceA, show* switches, ramps, basemapSource, overlayBasemapIds...). lat, lng and zoom set the project's extent. Without a query: every layer unchecked but the Google hybrid basemap.", parameters: [q("terrainSource", { type: "string" }, "The elevation source of every layer (or terrainSourceA, the app's name)."), q("modes", { type: "string" }, "The layers to check, comma-separated; or the app's show* parameters."), q("appParams", { type: "object", additionalProperties: { type: "string" } }, "Any of the app's URL parameters, kept in every layer's address.")], responses: { 200: { description: "The project", content: { "application/zip": { schema: { type: "string", format: "binary" } } } } } },
      },
      "/algorithms": {
        get: { tags: ["Catalogs"], operationId: "algorithms", summary: "The modes, and which engine draws them", description: "Each mode with `direct` or `browser`.", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/": {
        get: { tags: ["Visualization modes (OGC API – Processes)"], operationId: "landingPage", summary: "Landing page", description: "OGC API Common's landing page: links to the API definition (`service-desc`), this page (`service-doc`), `/conformance` and `/processes`, plus the service's index of addresses. JSON when asked (`Accept: application/json` or `?f=json`); a browser is sent to `/docs`.", parameters: [q("f", { type: "string", enum: ["json"] }, "`json` for the JSON document.")], responses: { ...ogcJson("The landing page"), 302: { description: "To /docs, for a browser" } } },
      },
      "/conformance": {
        get: { tags: ["Visualization modes (OGC API – Processes)"], operationId: "conformance", summary: "Conformance classes", description: "OGC API Common core, landing page and JSON; OGC API - Processes' process description and JSON classes. Not the Processes core class: a process is run by asking for its tiles, not by POST to `/processes/{processId}/execution`.", responses: ogcJson("`conformsTo`") },
      },
      "/processes": {
        get: { tags: ["Visualization modes (OGC API – Processes)"], operationId: "processes", summary: "The modes, as OGC API - Processes processes", description: "One process per mode of the app (OGC API - Processes Part 1, OGC 18-062r2), top of the map first, then `basemap`. Each summary carries the `x-tv-` properties of its description (group, form, shading, stacking rank, values) and a link to it. `x-tv-groups` is the app's panel tree by process id. `?expand=true` gives every description in full (inputs and outputs), in one request; the QGIS plugin reads that.", parameters: [q("expand", { type: "boolean", default: false }, "Every process description in full.")], responses: ogcJson("The process list") },
      },
      "/processes/{processId}": {
        get: {
          tags: ["Visualization modes (OGC API – Processes)"], operationId: "process", summary: "One mode, as a process description",
          description: "The mode's settings as `inputs`, each with a JSON Schema (`type`, `enum`, `default`, `minimum`/`maximum` for opacities) and the app's URL parameter (`x-tv-url-param`, `x-tv-type`, `x-tv-role`: setting, opacity, group-opacity or common). `outputs`: `image` (image/png, image/jpeg), `values` for a mode with values (Float32 GeoTIFF, `x-tv-unit`, `x-tv-display-range`), `vectorTile` for an overlay. What OGC has no slot for: `x-tv-group` (its panel groups), `x-tv-form`, `x-tv-shading`, `x-tv-stack-rank`, `x-tv-opacity-key`, `x-tv-group-opacity-keys`, `x-tv-switches` (the app's show* parameters), `x-tv-has-values`, `x-tv-values` (unit, description, the typical range the QGIS plugin's grey ramp starts with).\n\n**Execution.** No jobs and no POST execution: the links with rel `http://www.opengis.net/def/rel/ogc/1.0/execute` are the mode's tile endpoints, templated (`{z}`, `{x}`, `{y}`), with the inputs as query parameters. `POST /processes/{processId}/execution` answers 501 with those links.",
          parameters: [{ name: "processId", in: "path", required: true, schema: { type: "string", enum: [...MODE_NAMES] }, example: "slope" }],
          responses: { ...ogcJson("The process description"), 404: { description: "No such process" } },
        },
      },
      "/view": {
        get: {
          tags: ["Catalogs"], operationId: "view", summary: "Read a Terrain Viewer share link: which modes it shows",
          description: "Turns a link of the app (the address the Share dialog copies, `https://terrain-viewer.iconem.com/?...`) into what this service needs to draw the same view: the modes it switches on (`active`), every mode's opacity (`opacity`: its own times its group's), the parameters every layer keeps (`params`: the terrain source, ramps, light...), the camera (`camera`: lat, lng, zoom, when the link has them) and the tile addresses that draw it (`tiles.terrain`, an XYZ template of the active modes; `tiles.basemap` when the link shows imagery). The QGIS plugin's *Open link* reads it to add the view's layers.\n\n**Ways to ask.** Give the whole link as `url` (URL-encoded): `/view?url=https%3A%2F%2Fterrain-viewer.iconem.com%2F%3FshowTerrainAnalysis%3Dtrue%26slopeOpacity%3D0.5%26terrainSourceA%3Dmapterhorn`; `url` can also be only the link's query, with or without its `?`. Or paste the link's query (what follows `?`) after `/view?`: `/view?showTerrainAnalysis=true&slopeOpacity=0.5&terrainSourceA=mapterhorn`. Or paste the whole link after `/view?`, unencoded: `/view?https://terrain-viewer.iconem.com/?showTerrainAnalysis=true&slopeOpacity=0.5`. A `#...` is ignored; the link's values win over parameters given beside it.\n\n**What comes back** for that link (shortened): `{\"active\": [\"slope\", \"hillshade\"], \"opacity\": {\"slope\": 0.5, \"hillshade\": 1, ...}, \"params\": {\"terrainSource\": \"mapterhorn\"}, \"camera\": {}, \"tiles\": {\"terrain\": \"http://localhost:3400/terrain-tiles/mapterhorn/{z}/{x}/{y}.png?modes=slope,hillshade\"}}`. Each active mode is a process (`/processes/{id}`) with its settings.",
          parameters: [
            q("url", { type: "string" }, "A whole share link of the app, or only its query (`?zoom=...` or `zoom=...`); its query is read (other parameters given beside it are added).", { example: "https://terrain-viewer.iconem.com/?showTerrainAnalysis=true&slopeOpacity=0.5&terrainSourceA=mapterhorn" }),
            q("appParams", { type: "object", additionalProperties: { type: "string" } }, "Or the query of a share link, as is, at the top level.", { style: "form", explode: true }),
          ],
          responses: ogcJson("The view: active modes, their opacities, the parameters, the camera"),
        },
      },
      "/health": {
        get: { tags: ["Service"], operationId: "health", summary: "Is the service up", responses: { 200: { description: "Up, and the app it renders", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, app: { type: "string" } } } } } } } },
      },
    },
  }
}

// The code blocks of the descriptions (the quick start's addresses): Scalar
// gives them neither a copy button nor wrapping (checked on 1.77.0: a plain
// <pre> that scrolls sideways), so long addresses wrap here and a script adds
// the button. docs/src/components/scalar-full.tsx does the same on the docs
// site's copy of this page.
export const CODE_BLOCK_CSS = `.markdown pre{position:relative;white-space:pre-wrap;overflow-wrap:anywhere;padding-right:4.75em}
.markdown pre code{white-space:pre-wrap !important;overflow-wrap:anywhere;overflow:visible !important}
.markdown pre .tv-copy{position:absolute;top:6px;right:6px;font:inherit;font-size:12px;line-height:1;padding:5px 8px;border-radius:4px;border:1px solid var(--scalar-border-color,#ccc);background:var(--scalar-background-1,#fff);color:var(--scalar-color-1,#222);cursor:pointer;opacity:.85}
.markdown pre .tv-copy:hover,.markdown pre .tv-copy:focus-visible{opacity:1}`
const COPY_SCRIPT = `new MutationObserver(function () {
  document.querySelectorAll(".markdown pre:not([data-tv-copy])").forEach(function (pre) {
    pre.setAttribute("data-tv-copy", "")
    var b = document.createElement("button")
    b.type = "button"; b.className = "tv-copy"; b.textContent = "Copy"; b.setAttribute("aria-label", "Copy to the clipboard")
    b.onclick = function () {
      var code = pre.querySelector("code")
      navigator.clipboard.writeText((code || pre).textContent.trim()).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy" }, 1500) })
    }
    pre.appendChild(b)
  })
}).observe(document.body, { childList: true, subtree: true })`

// Scalar's reference from its CDN, over /openapi.json: "Test request" sends
// the request to this service and shows the image that comes back. Every
// tag group of the sidebar starts open.
export const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terrain Viewer tile service</title>
</head>
<body>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.77.0"></script>
<script>Scalar.createApiReference("#app", { url: "./openapi.json", defaultOpenAllTags: true, customCss: ${JSON.stringify(CODE_BLOCK_CSS)} })
${COPY_SCRIPT}</script>
</body>
</html>
`

export const DOCS_COPY = fileURLToPath(new URL("../docs/public/tile-service-openapi.json", import.meta.url))
export const docsCopyText = () => JSON.stringify(openapi(), null, 2) + "\n"

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(DOCS_COPY, await docsCopyText())
  console.log("wrote", DOCS_COPY)
}
