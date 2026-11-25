# Terrain Viewer tile service

The app's terrain modes and overlays over plain HTTP: XYZ raster tiles,
vector tiles of the overlays, pictures of a viewport, a QGIS project of
every mode. The full description is the docs page
[Tile service](../docs/content/docs/dev/tile-service.mdx) and the OpenAPI
document served at `/openapi.json` (a page to try it at `/docs`).

| Address | What it answers |
|---|---|
| `/terrain-tiles/{z}/{x}/{y}.png\|jpg` | One Web Mercator tile of the elevation modes, 256 px (`@2x` or `tilesize=512` for 512) |
| `/basemap-tiles/{z}/{x}/{y}.jpg\|png` | One tile of the imagery (`imagerySource`, `imageryDate`, `imageryUrl`, the app's basemap parameters) |
| `/terrain-tiles/{z}/{x}/{y}.pbf\|mvt` | The overlays as a vector tile: contours, iso-line, mound detector, plane slicer, graticule |
| `/render.png\|jpg` | A viewport, like a WMS GetMap |
| `/terrain-tiles/{z}/{x}/{y}.tif`, `/render.tif`, `/gdal.xml` | One mode's values before its ramp, in natural units: Float32 GeoTIFF tiles, an area (like a WCS), one GDAL raster; deflate-compressed (`compression=none` to skip); `.png?encoding=terrarium\|terrainrgb` packs them in a PNG |
| `/qgis.qgz` | A QGIS project of a view (the app's share query works as is): every layer, the view's checked |
| `<raster export>.stac.json` | The export's STAC Item (Processing extension, `stac.mjs`), also named by the answer's `Link: <…>; rel="describedby"` header |
| `/processes`, `/processes/{id}` | Each mode as an OGC API - Processes description (settings as inputs with JSON Schema, outputs, `x-tv-` panel data), read by the QGIS plugin (`../qgis-plugin/`); `/`, `/conformance` per OGC API Common; `/view?<share query>` |
| `/openapi.json`, `/docs`, `/health` | `/` redirects to `/docs` (JSON index with `Accept: application/json`); `/health`: queues and workers |

Removed, answering 404 with the address to use: `/tiles/{z}/{x}/{y}` and
`/modes` (2026-11-24), and titiler's addresses `/tiles/WebMercatorQuad/...`,
`/WebMercatorQuad/tilejson.json` and `/bbox/...` (2026-11-25; use
`/terrain-tiles`, `/tilejson.json`, `/render?bbox=…&width=…&height=…`).
titiler's parameter names `url`, `algorithm` and `tilesize` are still read.

A standalone pnpm root, like `video/` and `mcp/`: it is not part of the root
install, but its build step bundles the app's code (`lib/`), so the root
install must exist.

```bash
pnpm install             # at the repository root, once
cd tile-server && pnpm install
pnpm start               # builds generated/, then http://localhost:3400
pnpm test                # builds, then the engine checks (network)
node openapi.mjs         # rewrites docs/public/tile-service-openapi.json
node compare-engines.mjs http://localhost:3400 out/   # the two engines side by side
```

Environment: `PORT` (3400), `TV_RENDER_CONCURRENCY` (2 browser pages), `TV_DIRECT_WORKERS` (worker threads of the direct engine, the cores minus one, at most 8; 0: in the server's thread, `TV_DIRECT_CONCURRENCY` (4) at a time), `TV_QUEUE_TIMEOUT` (30 s, then 503), `TV_RENDER_TIMEOUT` (90 s, then 504), `TILE_CACHE_DIR` (rendered tiles, kept a week),
`TV_BASE_URL` (the app the browser engine opens, default
`https://terrain-viewer.iconem.com/`), `CHROME_PATH`, `TV_SOFTWARE_GL=1`,
`TV_ALLOWED_HOSTS`, `TV_MAPBOX_KEY` / `TV_MAPTILER_KEY` / `TV_CESIUM_ION_KEY` (the
service's own keys, used when a request brings none).

The MCP server (`../mcp/`) is built on this package: it imports the link
builder, the renderer, the elevation reader and the direct engine from here,
and with `TV_RENDER_URL` asks a running tile service for its pictures.

## Files

| File | Role |
|---|---|
| `server.mjs`, `openapi.mjs` | The service: the addresses above, 2048 px blocks cut into tiles, the cache; the OpenAPI document and the Scalar page. |
| `url.mjs` | A view description to the app's link and back to query parameters (`buildViewUrl`, `viewToQuery`, `queryToView`). The mode table mirrors `skills/terrain-viewer/SKILL.md`. |
| `render.mjs` | The browser engine: the app in a headless browser, waited on until its maps have drawn (`withSettledPage`). |
| `direct.mjs` | The direct engine: rebuilds the map's layer stack from the app's URL parameters and draws every 2D terrain mode and the overlays with the app's own code; the hillshade and the live Phong and matcap shaders are ported line by line. `plan()` says when a request goes to the browser instead, and why. |
| `dem.mjs` | Elevation tiles read in Node, for every source type the app reads, through the app's tile spec (`lib/terrain-tile-spec.ts`) and readers; cached. Also the MCP server's `elevation` and `export_geotiff`. |
| `contours.mjs` | Contours by maplibre-contour with the app's options: the vector tiles, and the lines and labels on a picture. |
| `symbols.mjs` | Where MapLibre puts symbols along a line (clipping, anchor spacing, bend check), ported: contour labels and cliff teeth. |
| `mvt.mjs` | Vector tiles read and written. |
| `qgis-project.mjs` | `/qgis.qgz`: every layer of the app, stacked as the map and grouped as its panel, the view's layers checked and configured, over its basemap. |
| `direct-pool.mjs`, `direct-worker.mjs` | The direct engine in worker threads: one tile per worker, a cancelled or timed-out tile ends its worker. |
| `compare-engines.mjs` | The same tiles from both engines, a table of differences and side-by-side pictures. |
| `app-lib.ts`, `app-render.ts`, `app-sources.ts`, `app-overlays.ts`, `build.mjs` | The app's catalog code, tile protocols, source readers and layer paints bundled for Node into `generated/` (not tracked), with `import.meta.env` empty so no key from `.env` can get in; plus `library.json` (the terrain library and the data hosts) and `url-params.json`. |
| `browser-shim.mjs`, `maplibre-stub.mjs` | The few browser functions the bundled code calls, done with sharp; a stand-in for maplibre-gl, which the protocols only register with. |
| `test.mjs` | The engine checks. |
| `Dockerfile`, `Dockerfile.dockerignore` | The image (Chromium included, software GL) and what is sent to the build. Published to `ghcr.io/iconem/terrain-viewer-tiles` by `.github/workflows/docker-publish.yml`; `../mcp/docker-compose.yml` runs it beside the MCP server. |
