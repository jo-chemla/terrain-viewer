// The tile service described as an OpenAPI 3.1 document, served by the
// service at /openapi.json and browsed at /docs (Scalar). The docs site
// shows the same document: `node tile-openapi.mjs` writes
// docs/public/tile-service-openapi.json, and test.mjs fails when that copy
// is stale.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MODE_NAMES, IMAGERY_SOURCES } from "./url.mjs"

const q = (name, schema, description, extra = {}) => ({ name, in: "query", required: false, schema, description, ...extra })

// What a tile and a viewport share: the source and the modes.
const VIEW_PARAMS = [
  q("terrainSource", { type: "string", examples: ["mapterhorn", "custom-nl-ahn-dtm"] }, "The elevation source: a built-in id (`mapterhorn`, `esri`, `aws`), a library id, or the address of XYZ elevation tiles or of a COG. Unset: the app's default. `url` is read as the same parameter."),
  q("modes", { type: "array", items: { type: "string", enum: MODE_NAMES } }, "The modes to draw, comma-separated. Unset: hillshade. Given without `hillshade`, the hillshade is off. `algorithm` is read as the same parameter.", { style: "form", explode: false }),
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

export function openapi(server = "http://localhost:3400") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Terrain Viewer tile service",
      version: "0.1.0",
      description: "What Terrain Viewer draws, as map tiles and as pictures of a viewport. The app itself renders them in a headless browser, so every source it reads and every mode it computes comes out as in the app. A tile is drawn with the 2048 px block around it and the block is kept a week: the first tile of a block takes seconds, its neighbours milliseconds. Web Mercator only.",
      license: { name: "MIT", url: "https://github.com/Iconem/terrain-viewer" },
    },
    externalDocs: { description: "Documentation", url: "https://terrain-viewer.iconem.com/docs/dev/tile-service" },
    servers: [{ url: server }],
    tags: [{ name: "Tiles" }, { name: "Viewport" }, { name: "titiler addresses", description: "The same answers at the addresses titiler uses." }, { name: "Service" }],
    paths: {
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
          description: "The tile address for the given parameters, as a TileJSON document a map library can load. `tile_format` (png, jpg) and `tile_scale` (1, 2) choose the tiles; every other parameter is kept in the tile address.",
          parameters: [q("tile_format", { type: "string", enum: ["png", "jpg"], default: "png" }, "Tile format."), q("tile_scale", { type: "integer", enum: [1, 2], default: 1 }, "2 for 512 px tiles."), ...VIEW_PARAMS],
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
<script id="api-reference" data-url="./openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.130"></script>
</body>
</html>
`

export const DOCS_COPY = fileURLToPath(new URL("../docs/public/tile-service-openapi.json", import.meta.url))
export const docsCopyText = () => JSON.stringify(openapi(), null, 2) + "\n"

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(DOCS_COPY, docsCopyText())
  console.log("wrote", DOCS_COPY)
}
