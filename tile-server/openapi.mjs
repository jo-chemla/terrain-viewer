// The tile service described as an OpenAPI 3.1 document, served by the
// service at /openapi.json and browsed at /docs (Scalar). The docs site
// shows the same document: `node openapi.mjs` writes
// docs/public/tile-service-openapi.json, and test.mjs fails when that copy
// is stale.
import { writeFileSync } from "node:fs"
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
  q("terrainSource", { type: "string", examples: ["mapterhorn", "custom-nl-ahn-dtm", "{\"url\":\"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png\",\"type\":\"terrarium\",\"maxzoom\":15}"] }, "The elevation source: an id from `/sources`, the address of Terrarium tiles, of a COG (`.tif`) or of a VRT (`.vrt`), or a configuration as JSON with the fields of a library entry, `{\"url\": ..., \"type\": \"terrarium\" | \"terrainrgb\" | \"cog\" | \"vrt\" | \"wms-raw\" | \"lerc\" | \"quantized-mesh\" | \"tilejson\", \"maxzoom\": ...}`. Unset: Mapterhorn. `url` is read as the same parameter."),
  q("engine", { type: "string", enum: ["auto", "direct", "browser"] }, "Who draws. `direct`: computed in the server from elevation tiles, in a fraction of a second, for the modes and parameters `/algorithms` lists as direct on a source `/sources` lists as direct. `browser`: the app in a headless browser, every source and mode, seconds. `auto` (the default) takes direct when it can. The answer's `x-tv-engine` header says which drew it, `x-tv-engine-why` why not direct."),
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
  q("terrainSource", { type: "string" }, "The elevation source: an id from `/sources`, a tile address or a JSON configuration."),
  q("modes", { type: "string", enum: VALUE_MODE_NAMES }, "One mode. `elevation` is the source's elevation in metres; the units of the others are listed in `/processes/{id}` (`x-tv-values`) and in the docs: slope and aspect in degrees, TRI, TPI, roughness and LRM in metres, svf and the eigenvalue ratio a share 0..1, openness and local dominance in degrees, curvature per metre.", { required: true, example: "slope" }),
  q("appParams", { type: "object", additionalProperties: { type: "string" } }, "The mode's own URL parameters of the app (curvatureMode, lrmRadius, svfRadius, opennessMode, ...). Its ramp, range and opacity do not change the values."),
  q("mapboxKey", { type: "string" }, "Your Mapbox access token, for the `mapbox` source."),
  q("maptilerKey", { type: "string" }, "Your MapTiler key, for the `maptiler` source."),
  q("cesiumIonKey", { type: "string" }, "Your Cesium ion token, for the `cesium` source."),
]
const VALUE_HEADERS = { "x-tv-value-unit": { schema: { type: "string" }, description: "The unit of the values (m, degree, 1/m, 1/m^2, 1; ASCII)" }, "x-tv-value-scale": { schema: { type: "number" }, description: "The factor a PNG packing multiplied them by" } }
const COMPRESSION = q("compression", { type: "string", enum: ["deflate", "none"], default: "deflate" }, "Deflate with the floating-point predictor (GDAL's PREDICTOR=3), lossless: about a quarter of the size for elevation, half for slope, two thirds for curvature or svf, for 2 to 6 ms a tile. `none` for a reader without deflate.")
const TIFF_NOTE = " Browsers do not display TIFF: Scalar's test request answers \"Preview unavailable\" and offers the file to download."
const tiff = (description) => ({
  200: { description, headers: { ...VALUE_HEADERS, ...LINK_HEADER }, content: { "image/tiff": { schema: { type: "string", format: "binary" } } } },
  400: { description: "More than one mode, a mode without values, or a source the direct engine cannot read", content: { "text/plain": { schema: { type: "string" } } } },
})

export function openapi(server = "http://localhost:3400") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Terrain Viewer tile service",
      version: "0.1.0",
      description: "What Terrain Viewer draws, as map tiles and as pictures of a viewport. Two engines draw them. The direct engine computes every 2D terrain mode in the server with the app's own code, reading the elevation with the app's own readers (tile pyramids, COG, VRT, WMS and WCS, LERC, quantized mesh, PMTiles, differences), in a fraction of a second. For everything else the app itself renders them in a headless browser, so every source it reads and every mode it computes comes out as in the app: a tile is drawn with the 2048 px block around it and the block is kept a week, so the first tile of a block takes seconds and its neighbours milliseconds. Web Mercator only.\n\nThe elevation modes are at `/terrain-tiles`, the imagery at `/basemap-tiles`. Each mode is described as an OGC API - Processes process at `/processes/{id}`: its settings with their types, ranges and defaults.\n\n" + STACKING,
      license: { name: "MIT", url: "https://github.com/Iconem/terrain-viewer" },
    },
    externalDocs: { description: "Documentation", url: "https://terrain-viewer.iconem.com/docs/dev/tile-service" },
    servers: [{ url: server }],
    // Scalar lists the groups in this order: the processes first (they list
    // the modes), then the tiles they run as, then the rest.
    tags: [
      { name: "OGC API - Processes", description: "The modes as OGC API - Processes processes (OGC 18-062r2), with OGC API Common's landing page and conformance. `/processes` lists every mode with its settings; a process is run by asking for its tiles: its description links them." },
      { name: "Terrain tiles", description: "`/terrain-tiles`: the elevation modes as XYZ raster tiles, the overlays as vector tiles, a TileJSON and a QGIS project of them." },
      { name: "Basemap tiles", description: "`/basemap-tiles`: the imagery as XYZ tiles." },
      { name: "Catalogs", description: "What can be named by id: sources, colour ramps, modes, and what a share link switches on." },
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
          description: "Like a WCS GetCoverage: the values over a bounding box (exactly: `width` pixels across it, the height that keeps the pixels square in Web Mercator, at most 4096 a side) or around a centre (`lat`, `lng`, MapLibre `zoom`, `width`, `height`). `.png` with `encoding` packs them as for the tiles." + TIFF_NOTE + STAC_NOTE,
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
      "/terrain-tiles/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Terrain tiles"], operationId: "terrainTile", summary: "One XYZ tile of the elevation modes",
          description: "A 256 px Web Mercator tile of the modes computed from the elevation (every mode but `basemap`), stacked as described under `modes`. For 512 px write `{y}@2x` in the address or add `tilesize=512`. The camera is the tile's: `lat`, `lng`, `zoom`, `pitch` and `bearing` are not read. The imagery is at `/basemap-tiles`. titiler's `url` (the source) and `algorithm` (one mode) are read; its address `/tiles/WebMercatorQuad/...` was removed on 2026-11-25 (404)." + STAC_NOTE,
          parameters: [...tileXYZ(), FORMAT, q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."), ...VIEW_PARAMS],
          responses: image("The tile"),
        },
      },
      "/basemap-tiles/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Basemap tiles"], operationId: "basemapTile", summary: "One XYZ tile of the imagery",
          description: "The basemap as the app draws it: dated imagery (`imagerySource`, `imageryDate`), an XYZ or COG address (`imageryUrl`), or the app's named basemap and its overlays (`basemapSource`, `overlayBasemapIds` and the other basemap parameters of the app, at the top level of the query). Drawn by the browser engine. A terrain mode in `modes` is refused: ask `/terrain-tiles` and stack the two. `{y}@2x` or `tilesize=512` for 512 px." + STAC_NOTE,
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
          description: "Any raster export's address plus `.stac.json`, with the same query: `/terrain-tiles/{z}/{x}/{y}.png|jpg|tif.stac.json`, `/basemap-tiles/{z}/{x}/{y}.jpg.stac.json`, `/render.png|tif.stac.json`. A STAC 1.1.0 Item with the Processing extension (v1.2.0): `bbox` and `geometry` of the export, `datetime` and `processing:datetime` the time of the answer, `processing:lineage` (a sentence: the source, the modes, their parameters), `processing:software` (`terrain-viewer tile-server` and its version), `processing:level` (`L3` for a map derived from the elevation), `processing:expression` (`format: x-tv-process`, the process ids and their inputs as executed), links `derived_from` the terrain source (its `/sources/{id}` entry and its tile template, or its address) or the imagery, `related` to each `/processes/{id}`, and the export as asset `data`. Computed from the address: nothing is drawn, and the caller's API keys are left out.",
          parameters: [...tileXYZ(13, 4270, 2911), { ...FORMAT, schema: { type: "string", enum: ["png", "jpg", "tif"], default: "tif" } }, ...VIEW_PARAMS],
          responses: { 200: { description: "The STAC Item", content: { "application/geo+json": { schema: { type: "object" } } } }, 404: { description: "Not the address of a raster export" } },
        },
      },
      "/render.{format}": {
        get: {
          tags: ["Viewport"], operationId: "render", summary: "A picture of a viewport",
          description: "Like a WMS GetMap: a picture of a given size, placed by its centre and zoom or by a bounding box. Unlike a tile it keeps the scale bar and the credits, and it can be tilted or split. titiler's `/bbox/{w},{s},{e},{n}/{width}x{height}.{format}` was removed on 2026-11-25 (404): ask `/render.{format}?bbox={w},{s},{e},{n}&width={width}&height={height}`." + STAC_NOTE,
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
      "/tilejson.json": {
        get: {
          tags: ["Terrain tiles"], operationId: "tilejson", summary: "A TileJSON for a view",
          description: "The tile address for the given parameters, as a TileJSON document a map library can load. `tile_format` (png, jpg; pbf or mvt for the vector tiles, then TileJSON 3.0 with the `vector_layers` of the modes) and `tile_scale` (1, 2) choose the tiles; every other parameter is kept in the tile address, `/terrain-tiles` (`/basemap-tiles` for `modes=basemap`). titiler's `/WebMercatorQuad/tilejson.json` was removed on 2026-11-25 (404).",
          parameters: [q("tile_format", { type: "string", enum: ["png", "jpg", "pbf", "mvt"], default: "png" }, "Tile format."), q("tile_scale", { type: "integer", enum: [1, 2], default: 1 }, "2 for 512 px tiles."), ...ALL_PARAMS],
          responses: { 200: { description: "TileJSON 2.2.0", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/sources": {
        get: { tags: ["Catalogs"], operationId: "sources", summary: "The terrain sources, by id", description: "Every elevation source the app knows: the built-in ones and the library. Each with its type, its tile address when it is a plain pyramid, its zoom range and extent, and the engine that can draw it.", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/sources/{id}": {
        get: { tags: ["Catalogs"], operationId: "source", summary: "One terrain source", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "custom-jp-gsj-terrainrgb" }], responses: { 200: { description: "The source, with its description", content: { "application/json": { schema: { type: "object" } } } }, 404: { description: "No such source" } } },
      },
      "/colorramps": {
        get: { tags: ["Catalogs"], operationId: "colorramps", summary: "The colour ramps, by id", description: "The app's ramps, to name as `colorRamp` (colour relief) or `slopeColorRamp` (slope).", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/colorramps/{id}": {
        get: { tags: ["Catalogs"], operationId: "colorramp", summary: "One colour ramp", description: "Its stops, as a MapLibre expression over the value.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "slope-plantopo" }], responses: { 200: { description: "The ramp", content: { "application/json": { schema: { type: "object" } } } }, 404: { description: "No such ramp" } } },
      },
      "/terrain-tiles/{z}/{x}/{y}.{vectorFormat}": {
        get: {
          tags: ["Terrain tiles"], operationId: "vectorTile", summary: "The overlays as a vector tile",
          description: "The tile address with `.pbf` or `.mvt`: a Mapbox Vector Tile (512 px tiles, as the map loads them) with the features the app's overlays draw, one layer each: `contours` (lines with `ele` and `level`), the iso-line (`isoband` polygons and `isoline` lines at a value, `isoline-cliff` the cliff edge on a slope; `isoline` lines every interval), the mound detector (`tells` points with their measures) and the graticule (`graticule` lines, `kind` meridian or parallel, `deg`). Same parameters as the raster tiles; titiler's `/tiles/WebMercatorQuad/{z}/{x}/{y}.pbf` is the same. Past a layer's last zoom it comes from its deepest tile, scaled up. A mode drawn only as an image (hillshade, the plane slicer, ...) is refused: ask for `.png` or `.jpg`.",
          parameters: [
            { name: "z", in: "path", required: true, schema: { type: "integer" }, example: 11 }, { name: "x", in: "path", required: true, schema: { type: "integer" }, example: 1067 }, { name: "y", in: "path", required: true, schema: { type: "integer" }, example: 728 },
            { name: "vectorFormat", in: "path", required: true, schema: { type: "string", enum: ["pbf", "mvt"] }, example: "pbf" },
            q("terrainSource", { type: "string" }, "The elevation source: an id from `/sources`, a tile address or a JSON configuration."),
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
        get: { tags: ["OGC API - Processes"], operationId: "landingPage", summary: "Landing page", description: "OGC API Common's landing page: links to the API definition (`service-desc`), this page (`service-doc`), `/conformance` and `/processes`, plus the service's index of addresses. JSON when asked (`Accept: application/json` or `?f=json`); a browser is sent to `/docs`.", parameters: [q("f", { type: "string", enum: ["json"] }, "`json` for the JSON document.")], responses: { ...ogcJson("The landing page"), 302: { description: "To /docs, for a browser" } } },
      },
      "/conformance": {
        get: { tags: ["OGC API - Processes"], operationId: "conformance", summary: "Conformance classes", description: "OGC API Common core, landing page and JSON; OGC API - Processes' process description and JSON classes. Not the Processes core class: a process is run by asking for its tiles, not by POST to `/processes/{processId}/execution`.", responses: ogcJson("`conformsTo`") },
      },
      "/processes": {
        get: { tags: ["OGC API - Processes"], operationId: "processes", summary: "The modes, as OGC API - Processes processes", description: "One process per mode of the app (OGC API - Processes Part 1, OGC 18-062r2), top of the map first, then `basemap`. Each summary carries the `x-tv-` properties of its description (group, form, shading, stacking rank, values) and a link to it. `x-tv-groups` is the app's panel tree by process id. `?expand=true` gives every description in full (inputs and outputs), in one request; the QGIS plugin reads that.", parameters: [q("expand", { type: "boolean", default: false }, "Every process description in full.")], responses: ogcJson("The process list") },
      },
      "/processes/{processId}": {
        get: {
          tags: ["OGC API - Processes"], operationId: "process", summary: "One mode, as a process description",
          description: "The mode's settings as `inputs`, each with a JSON Schema (`type`, `enum`, `default`, `minimum`/`maximum` for opacities) and the app's URL parameter (`x-tv-url-param`, `x-tv-type`, `x-tv-role`: setting, opacity, group-opacity or common). `outputs`: `image` (image/png, image/jpeg), `values` for a mode with values (Float32 GeoTIFF, `x-tv-unit`, `x-tv-display-range`), `vectorTile` for an overlay. What OGC has no slot for: `x-tv-group` (its panel groups), `x-tv-form`, `x-tv-shading`, `x-tv-stack-rank`, `x-tv-opacity-key`, `x-tv-group-opacity-keys`, `x-tv-switches` (the app's show* parameters), `x-tv-has-values`, `x-tv-values` (unit, description, the typical range the QGIS plugin's grey ramp starts with).\n\n**Execution.** No jobs and no POST execution: the links with rel `http://www.opengis.net/def/rel/ogc/1.0/execute` are the mode's tile endpoints, templated (`{z}`, `{x}`, `{y}`), with the inputs as query parameters. `POST /processes/{processId}/execution` answers 501 with those links.",
          parameters: [{ name: "processId", in: "path", required: true, schema: { type: "string", enum: [...MODE_NAMES] }, example: "slope" }],
          responses: { ...ogcJson("The process description"), 404: { description: "No such process" } },
        },
      },
      "/view": {
        get: { tags: ["Catalogs"], operationId: "view", summary: "What a share link switches on", description: "Given the query of a share link, as is: the modes it switches on (`active`), each one's opacity (its own times its group's), the parameters every layer keeps (`params`, the terrain source among them) and the camera. The QGIS plugin's Open link.", parameters: [q("appParams", { type: "object", additionalProperties: { type: "string" } }, "The query of a share link, as is.", { style: "form", explode: true })], responses: ogcJson("The view") },
      },
      "/health": {
        get: { tags: ["Service"], operationId: "health", summary: "Is the service up", responses: { 200: { description: "Up, and the app it renders", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, app: { type: "string" } } } } } } } },
      },
    },
  }
}

// Scalar's reference from its CDN, over /openapi.json: "Test request" sends
// the request to this service and shows the image that comes back.
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
<script>Scalar.createApiReference("#app", { url: "./openapi.json" })</script>
</body>
</html>
`

export const DOCS_COPY = fileURLToPath(new URL("../docs/public/tile-service-openapi.json", import.meta.url))
export const docsCopyText = () => JSON.stringify(openapi(), null, 2) + "\n"

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(DOCS_COPY, docsCopyText())
  console.log("wrote", DOCS_COPY)
}
