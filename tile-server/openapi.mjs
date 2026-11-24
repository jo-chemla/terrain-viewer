// The tile service described as an OpenAPI 3.1 document, served by the
// service at /openapi.json and browsed at /docs (Scalar). The docs site
// shows the same document: `node openapi.mjs` writes
// docs/public/tile-service-openapi.json, and test.mjs fails when that copy
// is stale.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MODE_NAMES, IMAGERY_SOURCES } from "./url.mjs"

const q = (name, schema, description, extra = {}) => ({ name, in: "query", required: false, schema, description, ...extra })

// What a tile and a viewport share: the source and the modes.
const VIEW_PARAMS = [
  q("terrainSource", { type: "string", examples: ["mapterhorn", "custom-nl-ahn-dtm", "{\"url\":\"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png\",\"type\":\"terrarium\",\"maxzoom\":15}"] }, "The elevation source: an id from `/sources`, the address of Terrarium tiles, of a COG (`.tif`) or of a VRT (`.vrt`), or a configuration as JSON with the fields of a library entry, `{\"url\": ..., \"type\": \"terrarium\" | \"terrainrgb\" | \"cog\" | \"vrt\" | \"wms-raw\" | \"lerc\" | \"quantized-mesh\" | \"tilejson\", \"maxzoom\": ...}`. Unset: Mapterhorn. `url` is read as the same parameter."),
  q("engine", { type: "string", enum: ["auto", "direct", "browser"] }, "Who draws. `direct`: computed in the server from elevation tiles, in a fraction of a second, for the modes and parameters `/algorithms` lists as direct on a source `/sources` lists as direct. `browser`: the app in a headless browser, every source and mode, seconds. `auto` (the default) takes direct when it can. The answer's `x-tv-engine` header says which drew it, `x-tv-engine-why` why not direct."),
  q("background", { type: "string", enum: ["map", "none"], default: "map" }, "`none`: no white (or black) map background, a transparent PNG to stack layers in a GIS. Direct engine only; the browser's tiles keep the map's background."),
  q("modes", { type: "array", items: { type: "string", enum: MODE_NAMES } }, "The modes to draw, comma-separated. Unset: hillshade. Given without `hillshade`, the hillshade is off. `algorithm` is read as the same parameter.", { style: "form", explode: false }),
  q("mapboxKey", { type: "string" }, "Your Mapbox access token, for the `mapbox` source. Read by the server's readers and given to the app as a setting, never put in the app's address; a tile drawn with a key is cached apart from one without."),
  q("maptilerKey", { type: "string" }, "Your MapTiler key, for the `maptiler` source."),
  q("cesiumIonKey", { type: "string" }, "Your Cesium ion token, for the `cesium` source and other ion assets."),
  q("imageryUrl", { type: "string" }, "Imagery under the terrain: XYZ tiles (`{z}/{x}/{y}`) or a COG. Shown with the mode `basemap`."),
  q("imagerySource", { type: "string", enum: IMAGERY_SOURCES }, "Dated imagery built into the app, with `imageryDate`."),
  q("imageryDate", { type: "string", format: "date" }, "The date of `imagerySource`, YYYY-MM-DD."),
  q("appParams", { type: "object", additionalProperties: { type: "string" } }, "Any other URL parameter of the app, given as it is at the top level of the query (for example `slopeOpacity=0.6`): ramps, opacities, light direction, contour interval. The list is the app's URL reference.", { style: "form", explode: true }),
]

const image = (description) => ({
  200: { description, content: { "image/png": { schema: { type: "string", format: "binary" } }, "image/jpeg": { schema: { type: "string", format: "binary" } } } },
  400: { description: "A parameter is wrong; the body says which", content: { "text/plain": { schema: { type: "string" } } } },
  500: { description: "The app could not be rendered; the body says why", content: { "text/plain": { schema: { type: "string" } } } },
})
const FORMAT = { name: "format", in: "path", required: true, schema: { type: "string", enum: ["png", "jpg"], default: "png" } }

// A mode's values, before the colour ramp (direct.mjs VALUE_MODES).
const VALUE_MODE_NAMES = ["elevation", "colorRelief", "slope", "aspect", "tri", "tpi", "roughness", "curvature", "shapeIndex", "blobness", "eigenRatio", "orientation", "lrm", "svf", "openness", "localDominance"]
const VALUE_PARAMS = [
  q("terrainSource", { type: "string" }, "The elevation source: an id from `/sources`, a tile address or a JSON configuration."),
  q("modes", { type: "string", enum: VALUE_MODE_NAMES }, "One mode. `elevation` is the source's elevation in metres; the units of the others are listed in `/modes` (`values`) and in the docs: slope and aspect in degrees, TRI, TPI, roughness and LRM in metres, svf and the eigenvalue ratio a share 0..1, openness and local dominance in degrees, curvature per metre.", { required: true, example: "slope" }),
  q("appParams", { type: "object", additionalProperties: { type: "string" } }, "The mode's own URL parameters of the app (curvatureMode, lrmRadius, svfRadius, opennessMode, ...). Its ramp, range and opacity do not change the values."),
  q("mapboxKey", { type: "string" }, "Your Mapbox access token, for the `mapbox` source."),
  q("maptilerKey", { type: "string" }, "Your MapTiler key, for the `maptiler` source."),
  q("cesiumIonKey", { type: "string" }, "Your Cesium ion token, for the `cesium` source."),
]
const VALUE_HEADERS = { "x-tv-value-unit": { schema: { type: "string" }, description: "The unit of the values (m, degree, 1/m, 1/m^2, 1; ASCII)" }, "x-tv-value-scale": { schema: { type: "number" }, description: "The factor a PNG packing multiplied them by" } }
const COMPRESSION = q("compression", { type: "string", enum: ["deflate", "none"], default: "deflate" }, "Deflate with the floating-point predictor (GDAL's PREDICTOR=3), lossless: about a quarter of the size for elevation, half for slope, two thirds for curvature or svf, for 2 to 6 ms a tile. `none` for a reader without deflate.")
const TIFF_NOTE = " Browsers do not display TIFF: Scalar's test request answers \"Preview unavailable\" and offers the file to download."
const tiff = (description) => ({
  200: { description, headers: VALUE_HEADERS, content: { "image/tiff": { schema: { type: "string", format: "binary" } } } },
  400: { description: "More than one mode, a mode without values, or a source the direct engine cannot read", content: { "text/plain": { schema: { type: "string" } } } },
})

export function openapi(server = "http://localhost:3400") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Terrain Viewer tile service",
      version: "0.1.0",
      description: "What Terrain Viewer draws, as map tiles and as pictures of a viewport. Two engines draw them. The direct engine computes every 2D terrain mode in the server with the app's own code, reading the elevation with the app's own readers (tile pyramids, COG, VRT, WMS and WCS, LERC, quantized mesh, PMTiles, differences), in a fraction of a second. For everything else the app itself renders them in a headless browser, so every source it reads and every mode it computes comes out as in the app: a tile is drawn with the 2048 px block around it and the block is kept a week, so the first tile of a block takes seconds and its neighbours milliseconds. Web Mercator only.",
      license: { name: "MIT", url: "https://github.com/Iconem/terrain-viewer" },
    },
    externalDocs: { description: "Documentation", url: "https://terrain-viewer.iconem.com/docs/dev/tile-service" },
    servers: [{ url: server }],
    tags: [{ name: "Tiles" }, { name: "Viewport" }, { name: "Values", description: "A mode's numbers before the colour ramp, in natural units: Float32 GeoTIFF for analysis (GDAL, QGIS, rasterio, numpy), or packed in a PNG for a web map." }, { name: "titiler addresses", description: "The same answers at the addresses titiler uses." }, { name: "Catalogs", description: "What can be named by id: sources, colour ramps, modes." }, { name: "Service" }],
    paths: {
      "/tiles/{z}/{x}/{y}.tif": {
        get: {
          tags: ["Values"], operationId: "valueTile", summary: "A mode's values as a Float32 GeoTIFF tile",
          description: "One band of 32-bit floats, EPSG:3857, georeferenced, NaN where there is no data: the values the app colours, before its ramp, in natural units (the unit in the `x-tv-value-unit` header and in `/modes`). 256 px; `{y}@2x` or `tilesize=512` for 512. The same tile as a PNG for a web map: `.png?modes=slope&encoding=terrarium` (or `terrainrgb`), the values multiplied by `valueScale` (default 1) and packed as an elevation, so MapLibre's raster-dem or a few lines of numpy read them back; `valueScale` keeps small values (curvature) above the packing's step (Terrarium 1/256, Terrain-RGB 0.1). Computed by the direct engine only." + TIFF_NOTE,
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
          description: "Like a WCS GetCoverage: the values over a bounding box (exactly: `width` pixels across it, the height that keeps the pixels square in Web Mercator, at most 4096 a side) or around a centre (`lat`, `lng`, MapLibre `zoom`, `width`, `height`). `/bbox/{bbox}/{width}x{height}.tif` is the same with a box. `.png` with `encoding` packs them as for the tiles." + TIFF_NOTE,
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
      "/tiles/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["Tiles"], operationId: "tile", summary: "One XYZ tile",
          description: "A 256 px Web Mercator tile. For 512 px write `{y}@2x` in the address or add `tilesize=512`. The camera is the tile's: `lat`, `lng`, `zoom`, `pitch` and `bearing` are not read.",
          parameters: [
            { name: "z", in: "path", required: true, schema: { type: "integer", minimum: 0, maximum: 22 }, example: 12 },
            { name: "x", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: 2125 },
            { name: "y", in: "path", required: true, schema: { type: "integer", minimum: 0 }, example: 1464 },
            FORMAT,
            q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."),
            ...VIEW_PARAMS,
          ],
          responses: image("The tile"),
        },
      },
      "/render.{format}": {
        get: {
          tags: ["Viewport"], operationId: "render", summary: "A picture of a viewport",
          description: "Like a WMS GetMap: a picture of a given size, placed by its centre and zoom or by a bounding box. Unlike a tile it keeps the scale bar and the credits, and it can be tilted or split.",
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
            ...VIEW_PARAMS,
          ],
          responses: image("The picture"),
        },
      },
      "/tiles/WebMercatorQuad/{z}/{x}/{y}.{format}": {
        get: {
          tags: ["titiler addresses"], operationId: "titilerTile", summary: "One tile, at titiler's address",
          description: "The same as `/tiles/{z}/{x}/{y}`. `url` is the source and `algorithm` one mode; `@2x` after `{y}` and `tilesize` work the same. titiler's `rescale`, `colormap_name`, `bidx`, `expression` and `nodata` are not read.",
          parameters: [
            { name: "z", in: "path", required: true, schema: { type: "integer" } }, { name: "x", in: "path", required: true, schema: { type: "integer" } }, { name: "y", in: "path", required: true, schema: { type: "integer" } }, FORMAT,
            q("url", { type: "string" }, "The elevation source (as `terrainSource`)."),
            q("algorithm", { type: "string", enum: MODE_NAMES }, "One mode (as `modes`)."),
            q("tilesize", { type: "integer", enum: [256, 512], default: 256 }, "The side of the tile in pixels."),
          ],
          responses: image("The tile"),
        },
      },
      "/WebMercatorQuad/tilejson.json": {
        get: {
          tags: ["titiler addresses"], operationId: "tilejson", summary: "A TileJSON for a view",
          description: "The tile address for the given parameters, as a TileJSON document a map library can load. `tile_format` (png, jpg; pbf or mvt for the vector tiles, then TileJSON 3.0 with the `vector_layers` of the modes) and `tile_scale` (1, 2) choose the tiles; every other parameter is kept in the tile address. `/tilejson.json` is the same.",
          parameters: [q("tile_format", { type: "string", enum: ["png", "jpg", "pbf", "mvt"], default: "png" }, "Tile format."), q("tile_scale", { type: "integer", enum: [1, 2], default: 1 }, "2 for 512 px tiles."), ...VIEW_PARAMS],
          responses: { 200: { description: "TileJSON 2.2.0", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/bbox/{bbox}/{width}x{height}.{format}": {
        get: {
          tags: ["titiler addresses"], operationId: "bbox", summary: "A picture of a bounding box, at titiler's address",
          description: "The same as `/render` with `bbox`, `width` and `height`.",
          parameters: [
            { name: "bbox", in: "path", required: true, schema: { type: "string" }, description: "west,south,east,north in degrees", example: "6.7,45.75,7.0,45.95" },
            { name: "width", in: "path", required: true, schema: { type: "integer" }, example: 800 },
            { name: "height", in: "path", required: true, schema: { type: "integer" }, example: 600 },
            FORMAT, ...VIEW_PARAMS,
          ],
          responses: image("The picture"),
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
      "/tiles/{z}/{x}/{y}.{vectorFormat}": {
        get: {
          tags: ["Tiles"], operationId: "vectorTile", summary: "The overlays as a vector tile",
          description: "The tile address with `.pbf` or `.mvt`: a Mapbox Vector Tile (512 px tiles, as the map loads them) with the features the app's overlays draw, one layer each: `contours` (lines with `ele` and `level`), the iso-line (`isoband` polygons and `isoline` lines at a value, `isoline-cliff` the cliff edge on a slope; `isoline` lines every interval), the mound detector (`tells` points with their measures) and the graticule (`graticule` lines, `kind` meridian or parallel, `deg`). Same parameters as the raster tiles; `/tiles/WebMercatorQuad/...` is the same. Past a layer's last zoom it comes from its deepest tile, scaled up. A mode drawn only as an image (hillshade, the plane slicer, ...) is refused: ask for `.png` or `.jpg`.",
          parameters: [
            { name: "z", in: "path", required: true, schema: { type: "integer" }, example: 11 }, { name: "x", in: "path", required: true, schema: { type: "integer" }, example: 1067 }, { name: "y", in: "path", required: true, schema: { type: "integer" }, example: 728 },
            { name: "vectorFormat", in: "path", required: true, schema: { type: "string", enum: ["pbf", "mvt"] }, example: "pbf" },
            q("terrainSource", { type: "string" }, "The elevation source: an id from `/sources`, a tile address or a JSON configuration."),
            q("modes", { type: "array", items: { type: "string", enum: ["contours", "isoline", "moundDetector", "graticules"] } }, "The layers, comma-separated. Unset: contours."),
            q("appParams", { type: "object", additionalProperties: { type: "string" } }, "The app's parameters of these layers, as for the raster tiles (contourMinor, isolineValue, tellSize, graticuleDensity, ...)."),
          ],
          responses: { 200: { description: "The vector tile", content: { "application/vnd.mapbox-vector-tile": { schema: { type: "string", format: "binary" } } } }, 400: { description: "A mode is not served as vector tiles, or the source cannot be read by the direct engine" } },
        },
      },
      "/qgis.qgz": {
        get: { tags: ["Tiles"], operationId: "qgis", summary: "A QGIS project of a view", description: "Every layer of the app as an XYZ layer (transparent tiles, `background=none`), stacked as the map stacks them and grouped as its panel where that order allows: the overlays on top (contours, plane slicer, mound candidates, graticule, iso-line, each also as vector tiles), the lighting effects, the hillshade, relief visualization, terrain analysis, the colour relief, then the basemap (as the app draws it, with its overlays; a plain XYZ basemap as such too; Google hybrid), and a closed, unchecked group of each mode's values as a Float32 raster read by GDAL (`/gdal.xml`), for analysis. The layers the view switches on start checked, and every layer's address carries the view's settings. The query is the view, in the service's names (terrainSource, modes, imageryUrl...) or the app's own: the query of a share link works as is (terrainSourceA, show* switches, ramps, basemapSource, overlayBasemapIds...). lat, lng and zoom set the project's extent. Without a query: every layer unchecked but the Google hybrid basemap.", parameters: [q("terrainSource", { type: "string" }, "The elevation source of every layer (or terrainSourceA, the app's name)."), q("modes", { type: "string" }, "The layers to check, comma-separated; or the app's show* parameters."), q("appParams", { type: "object", additionalProperties: { type: "string" } }, "Any of the app's URL parameters, kept in every layer's address.")], responses: { 200: { description: "The project", content: { "application/zip": { schema: { type: "string", format: "binary" } } } } } },
      },
      "/algorithms": {
        get: { tags: ["Catalogs"], operationId: "algorithms", summary: "The modes, and which engine draws them", description: "Each mode with `direct` or `browser`.", responses: { 200: { description: "The list", content: { "application/json": { schema: { type: "object" } } } } } },
      },
      "/modes": {
        get: { tags: ["Catalogs"], operationId: "modes", summary: "The modes with their settings, grouped as the app's panel", description: "What the QGIS plugin builds its panel from: the app's panel groups, top drawn on top; for each mode its form (`raster`, `vector` or `both`), whether it is shading (opaque tiles, multiplied over the layers under it), the parameter of its opacity, its settings (the app's URL parameters, with type, allowed values and default) and, for a mode with values, their unit, description and typical range (`values`; also listed at the top level, with `elevation`). Given a view's query (a share link's, as is), `view` lists the modes it switches on, their opacities, the parameters every layer keeps and the camera.", parameters: [q("appParams", { type: "object", additionalProperties: { type: "string" } }, "A view: the query of a share link, as is.")], responses: { 200: { description: "The modes", content: { "application/json": { schema: { type: "object" } } } } } },
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
