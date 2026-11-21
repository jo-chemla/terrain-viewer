// Terrain Viewer MCP server.
//
//   node server.mjs            Streamable HTTP on http://localhost:3300/mcp
//   node server.mjs --stdio    stdio, for a desktop client's config
//
// Tools that show a view (an MCP Apps view in the conversation):
//   open_view          a place and modes
//   compare_sources    two terrain datasets or two imagery dates, side by side
// Tools that look something up:
//   geocode            a place name to coordinates
//   datasets_covering  which terrain datasets and imagery catalogs cover a point
//   catalog_items      dated imagery and old maps for an area
//   imagery_dates      the dates of the app's built-in dated imagery at a place
//   search_stac        items of any STAC catalog over an area
//   elevation          heights of points, or a profile along a line
//   export_geotiff     the elevation of an area as a GeoTIFF file
//   screenshot         a picture of a view, for the model to look at
//
// Environment: TV_BASE_URL (default https://terrain-viewer.iconem.com/),
// PORT (default 3300), CHROME_PATH (a Chromium for the tools that need a
// browser; an installed Chrome when unset), TV_SOFTWARE_GL=1 (no GPU),
// TV_ALLOWED_HOSTS (comma-separated host names accepted in the Host header
// when served on a public address), TV_PUBLIC_URL (the server's public
// address, for download links).
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import http from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { z } from "zod"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { buildViewUrl, MODE_NAMES, IMAGERY_SOURCES, DEFAULT_BASE_URL } from "./url.mjs"
import { geocode, datasetsCovering, catalogItems, screenshot, library } from "./tools.mjs"
import { elevation, exportGeotiff, imageryDates, searchStac, demOrigins, EXPORT_DIR_NAME } from "./data-tools.mjs"

const BASE_URL = process.env.TV_BASE_URL || DEFAULT_BASE_URL
const BASE_ORIGIN = new URL(BASE_URL).origin
const STDIO = process.argv.includes("--stdio")
const PORT = Number(process.env.PORT || 3300)
const PUBLIC_URL = (process.env.TV_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "")
const VIEW_URI = "ui://terrain-viewer/view.html"

const INSTRUCTIONS = `Terrain Viewer shows the relief of any place on Earth in the browser: hillshade, slope, local relief model, sky-view factor, contours, 3D, and dated satellite imagery.

How to answer a request to see a place:
1. geocode the place (skip it when you already know the coordinates).
2. Optionally datasets_covering, when detail matters (a site, archaeology, a building-scale question) or the user asks which data exists: it lists finer national datasets than the default.
3. open_view with the modes that answer the question (compare_sources for two datasets or two dates side by side). It shows the view in the conversation and returns the link.
4. screenshot only when you need to look at the result yourself to describe or check it.

Numbers rather than pictures: elevation gives the height of points or a profile along a line, on one or several datasets (a surface model against a ground model gives heights of buildings and trees). export_geotiff writes the elevation of an area to a file.

Change through time: imagery_dates lists the dates of the built-in dated imagery (Esri Wayback, Google Earth) at a place; catalog_items and search_stac list dated images from open catalogs. Then open_view or compare_sources with imagerySource and imageryDate, or with an item's imageryUrl.

Modes by subject:
- general relief: hillshade (default)
- subtle features (archaeology, earthworks, old field systems, landslides): lrm, svf, openness, with viewMode 2d
- mounds, barrows, pits, craters: moundDetector with lrm
- steepness, avalanche or landslide terrain: slope; orientation of slopes: aspect; ridges and valleys: curvature, tpi
- elevation as colours: colorRelief; contour lines: contours
- a landscape, a mountain, a valley: viewMode 3d (zoom 13 at most)
- continental scale: viewMode globe

In the conversation the view is the app itself, interactive, with every mode asked for, where the host lets it run, and a picture of the exact view otherwise; the link always opens the full app.

The default terrain, mapterhorn, is global: about 0.25 to 2 m where a national LiDAR survey is open, 30 m elsewhere. At 30 m a building or a small earthwork is a few pixels: say so rather than promise detail. Never invent a dataset id: use the ids datasets_covering returns.`

// The view's own script is inlined into the page: the MCP Apps client
// library (an ES module: its export list is dropped and the App class bound
// to a plain name). The app itself is loaded by the page from the app's
// address, which the resource declares.
// Hosts the app itself reads when it runs inside the view. The list is every host of the app's built-in lists (the terrain and
// raster libraries, the dated imagery and its catalogs: `origins` in
// generated/library.json, made by build.mjs) plus the ones below, which the
// scan cannot see (built at run time, or a wildcard). Still not covered: the
// files a VRT or a STAC item points to, and an address pasted by the user;
// those stay blank there and still open in the browser.
const APP_EXTRA_ORIGINS = ["https://data.geopf.fr", "https://s3-us-west-2.amazonaws.com", "https://*.maptiles.arcgis.com", "https://*.ssl.ak.tiles.virtualearth.net", "https://khmdb.google.com", "https://nominatim.openstreetmap.org", "https://unpkg.com"]

function buildViewHtml() {
  const require = createRequire(import.meta.url)
  const safe = (js) => js.replace(/<\/script/gi, "<\\/script")
  let bundle = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8")
  const local = bundle.match(/([A-Za-z0-9_$]+) as App\b/)?.[1]
  if (!local) throw new Error("ext-apps bundle: the App export was not found")
  const exportAt = bundle.lastIndexOf("export{")
  if (exportAt < 0) throw new Error("ext-apps bundle: the export list was not found")
  bundle = bundle.slice(0, exportAt) + `;const App = ${local};`
  const html = readFileSync(fileURLToPath(new URL("./view.html", import.meta.url)), "utf8")
  return html.replace("/*__APP_BUNDLE__*/", () => safe(bundle))
}
const VIEW_HTML = buildViewHtml()

const placeShape = {
  lat: z.number().min(-90).max(90).describe("Latitude of the view centre, decimal degrees"),
  lng: z.number().min(-180).max(180).describe("Longitude of the view centre, decimal degrees"),
  zoom: z.number().min(0).max(22).optional().describe("5 a country, 9 a region, 12 a mountain or valley, 15 a site. Default 12"),
  viewMode: z.enum(["2d", "3d", "globe"]).optional().describe("2d (top-down, for sites and analysis; default), 3d (landscapes; zoom is capped at 13), globe (continental scale)"),
  pitch: z.number().min(0).max(85).optional().describe("Camera tilt in degrees; 55 by default in 3d"),
  bearing: z.number().min(-180).max(360).optional().describe("Camera heading in degrees clockwise from north"),
  modes: z.array(z.enum(MODE_NAMES)).optional().describe("Visualization modes to switch on. Hillshade alone when omitted. lrm, svf and openness bring out subtle relief (archaeology, landslides); slope, aspect, curvature, tpi and roughness are terrain analysis; colorRelief colours by elevation; basemap puts satellite imagery underneath; moundDetector marks mound candidates (beta)"),
  place: z.string().optional().describe("Name of the place, shown as the view's label"),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Any other Terrain Viewer URL parameter, as is (e.g. illuminationAlt, exaggeration, drawingUrl, appMode)"),
}
const terrainDesc = "'mapterhorn' (default, global, LiDAR where open), 'aws', an id returned by datasets_covering (never invent one), or the URL of Terrarium tiles ({z}/{x}/{y}) or of a Cloud-Optimized GeoTIFF"
const imagerySourceDesc = `Dated imagery built into the app: ${IMAGERY_SOURCES.join(", ")}. Dates come from imagery_dates`
const viewShape = {
  ...placeShape,
  terrainSource: z.string().optional().describe(`Terrain source: ${terrainDesc}`),
  terrainSourceB: z.string().optional().describe("A second terrain source to compare with the first"),
  split: z.enum(["off", "side-by-side", "overlay"]).optional().describe("How two sources are compared; side-by-side when terrainSourceB is given"),
  imageryUrl: z.string().optional().describe("Imagery to show under the terrain: an imageryUrl returned by catalog_items or search_stac, XYZ tiles ({z}/{x}/{y}) or a Cloud-Optimized GeoTIFF"),
  imagerySource: z.enum(IMAGERY_SOURCES).optional().describe(imagerySourceDesc),
  imageryDate: z.string().optional().describe("Date of the imagery, YYYY-MM-DD; the newest when omitted"),
}
const sideShape = z.object({
  terrainSource: z.string().optional().describe(terrainDesc),
  imagerySource: z.enum(IMAGERY_SOURCES).optional().describe(imagerySourceDesc),
  imageryDate: z.string().optional().describe("YYYY-MM-DD"),
})
const pointShape = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
const bboxOf = (lat, lng, radiusKm) => {
  const dLat = radiusKm / 111.32, dLng = radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
}

const text = (t) => ({ content: [{ type: "text", text: t }] })
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] })
const json = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }], structuredContent: o })
const READ_ONLY = { readOnlyHint: true }

// The app's own entry script and stylesheets, read from the deployed page
// (their names change with each deploy): what the view loads to run the app
// itself in the conversation, without a frame. Kept five minutes.
let appAssetsCache = null
async function appAssets() {
  if (appAssetsCache && Date.now() - appAssetsCache.at < 5 * 60 * 1000) return appAssetsCache.value
  let value = null
  try {
    const html = await (await fetch(BASE_URL, { signal: AbortSignal.timeout(8000) })).text()
    const abs = (p) => new URL(p, BASE_URL).href
    const js = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1]
    // Every stylesheet of the page, in its order: the app's own, and the
    // ones it takes from elsewhere (MapLibre, the geocoder, the fonts).
    // Without those the map controls and the search box lose their layout.
    const css = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => /rel="stylesheet"/.test(t)).map((t) => t.match(/href="([^"]+)"/)?.[1]).filter(Boolean).map(abs)
    // Hosts those stylesheets come from, and where Google's stylesheet takes the font files.
    const origins = [...new Set(css.map((u) => new URL(u).origin).filter((o) => o !== BASE_ORIGIN))]
    if (origins.includes("https://fonts.googleapis.com")) origins.push("https://fonts.gstatic.com")
    if (js) value = { js: abs(js), css, base: new URL("./", BASE_URL).href, origins }
  } catch { /* the app display is then not offered */ }
  appAssetsCache = { at: Date.now(), value }
  return value
}

async function viewResult(view, what) {
  const url = buildViewUrl(view, { baseUrl: BASE_URL })
  const embedUrl = buildViewUrl(view, { baseUrl: BASE_URL, embed: true })
  const label = `${view.place ?? `${view.lat.toFixed(4)}, ${view.lng.toFixed(4)}`} · ${what}`
  // The page shows the picture when the app cannot run there, or when asked:
  // start rendering now, at the size it asks for, so it is ready or nearly so.
  screenshot(view, { baseUrl: BASE_URL, width: 1100, height: 780 }).catch(() => { })
  return { content: [{ type: "text", text: `Terrain Viewer link (${label}): ${url}` }], structuredContent: { url, embedUrl, label, origin: BASE_ORIGIN, view, app: await appAssets() } }
}

function makeServer() {
  const server = new McpServer({ name: "terrain-viewer", version: "0.3.0" }, { instructions: INSTRUCTIONS })

  registerAppTool(server, "open_view", {
    title: "Open a terrain view",
    description: "Show the terrain of a place in Terrain Viewer (hillshade, slope, local relief model, sky-view factor, contours, 3D, dated imagery) and return the link that opens it. Use it whenever someone wants to see or explore the relief, elevation or imagery of a place. Needs coordinates: call geocode first for a place name.",
    inputSchema: z.object(viewShape),
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: VIEW_URI } },
  }, async (args) => {
    try { return await viewResult(args, args.modes?.length ? args.modes.join(", ") : args.imagerySource ? `${args.imagerySource} ${args.imageryDate ?? ""}`.trim() : "hillshade") } catch (e) { return fail(e) }
  })

  registerAppTool(server, "compare_sources", {
    title: "Compare two datasets or two dates",
    description: "Open one place twice, side by side or as an overlay with a draggable divider: two terrain datasets (a surface model against a ground model, an old survey against a new one, a national LiDAR against the global default), or the imagery of two dates (before and after an event). Each side takes a terrain source, or dated imagery, or both.",
    inputSchema: z.object({ ...placeShape, a: sideShape.describe("The first view"), b: sideShape.describe("The second view"), split: z.enum(["side-by-side", "overlay"]).optional().describe("side-by-side by default") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: VIEW_URI } },
  }, async ({ a, b, split, ...place }) => {
    try {
      if (!b.terrainSource && !b.imagerySource) return fail("Side b needs a terrainSource or an imagerySource.")
      const view = {
        ...place, split: split ?? "side-by-side",
        terrainSource: a.terrainSource, terrainSourceB: b.terrainSource ?? a.terrainSource ?? "mapterhorn",
        imagerySource: a.imagerySource, imageryDate: a.imageryDate, imagerySourceB: b.imagerySource, imageryDateB: b.imageryDate,
      }
      const side = (s) => [s.terrainSource, s.imagerySource && `${s.imagerySource} ${s.imageryDate ?? "newest"}`].filter(Boolean).join(" + ") || "mapterhorn"
      return await viewResult(view, `${side(a)} | ${side(b)}`)
    } catch (e) { return fail(e) }
  })

  registerAppResource(server, "Terrain Viewer", VIEW_URI, { description: "Terrain Viewer, in the conversation" }, async () => {
    // What the page may reach: the tile hosts, and the app
    // itself: framed where the host frames websites, or its code loaded into
    // the page (scripts, styles and data from the app's address).
    const tileOrigins = [...demOrigins(), "https://server.arcgisonline.com"]
    const declared = [...new Set([BASE_ORIGIN, ...tileOrigins, ...APP_EXTRA_ORIGINS, ...((await appAssets())?.origins ?? []), ...(library().origins ?? [])])]
    return {
      contents: [{
        uri: VIEW_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: VIEW_HTML,
        _meta: { ui: { csp: { connectDomains: declared, resourceDomains: declared, frameDomains: [BASE_ORIGIN] }, prefersBorder: false } },
      }],
    }
  })

  server.registerTool("geocode", {
    title: "Find a place",
    description: "Coordinates of a place name (a mountain, a town, a site, an address), from OpenStreetMap. Returns up to three candidates, each with lat, lng and a zoom that frames it.",
    inputSchema: z.object({ query: z.string().min(2).describe("The place, e.g. 'Matterhorn', 'Aguada Fénix, Tabasco', 'Antakya old town'") }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ query }) => {
    try {
      const places = await geocode(query)
      return places.length ? json({ places }) : text(`Nothing found for "${query}". Try a larger place nearby, or give coordinates.`)
    } catch (e) { return fail(e) }
  })

  server.registerTool("datasets_covering", {
    title: "Datasets covering a place",
    description: "Which terrain datasets of the Terrain Viewer library cover a point (national LiDAR, regional surveys, differences between two surveys), finest first, and which catalogs of dated imagery and old maps have something there. Use it before open_view when detail matters, or to answer 'what data exists for this place'.",
    inputSchema: pointShape,
    annotations: READ_ONLY,
  }, async ({ lat, lng }) => { try { return json(await datasetsCovering(lat, lng)) } catch (e) { return fail(e) } })

  server.registerTool("catalog_items", {
    title: "Dated imagery for an area",
    description: "Dated satellite and aerial images, and old maps, that cover an area, from the catalogs Terrain Viewer's timeline reads (OpenAerialMap, Maxar and Vantor open data, national archives, old-map collections). Each item has a date, a ground resolution and an imageryUrl that open_view shows. Catalog ids come from datasets_covering; cat-oam and cat-maxar are global.",
    inputSchema: z.object({
      ...pointShape.shape,
      radiusKm: z.number().min(0.1).max(200).optional().describe("Half-width of the search box, 5 km by default"),
      catalogs: z.array(z.string()).min(1).max(8).describe("Catalog ids, e.g. ['cat-oam', 'cat-maxar']"),
      from: z.string().optional().describe("Earliest date, YYYY-MM-DD"),
      to: z.string().optional().describe("Latest date, YYYY-MM-DD"),
      limit: z.number().int().min(1).max(50).optional().describe("Items per catalog, newest first; 20 by default"),
    }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ lat, lng, radiusKm = 5, catalogs, from, to, limit }) => {
    try { const bbox = bboxOf(lat, lng, radiusKm); return json({ bbox, catalogs: await catalogItems({ bbox, catalogs, from, to, limit }) }) } catch (e) { return fail(e) }
  })

  server.registerTool("imagery_dates", {
    title: "Dates of the built-in imagery",
    description: "The dates on which the app's built-in dated imagery was captured at a place, newest first: Esri World Imagery Wayback and Google Earth historical imagery. Use it to pick a 'before' and an 'after', then show them with open_view or compare_sources (imagerySource, imageryDate). Takes 5 to 40 seconds.",
    inputSchema: z.object({ ...pointShape.shape, from: z.string().optional().describe("Earliest date, YYYY-MM-DD"), to: z.string().optional().describe("Latest date, YYYY-MM-DD") }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async (args) => { try { return json(await imageryDates(args)) } catch (e) { return fail(e) } })

  server.registerTool("search_stac", {
    title: "Search a STAC catalog",
    description: "Items of any STAC API or static STAC catalog that cover an area, with their date, ground resolution and an imageryUrl that open_view shows. For a catalog the user names or one you know (for example Earth Search, https://earth-search.aws.element84.com/v1, collection sentinel-2-l2a). The built-in catalogs are in catalog_items.",
    inputSchema: z.object({
      endpoint: z.string().url().describe("The STAC API root, or the URL of a static catalog.json"),
      collection: z.string().optional().describe("One collection id; all of them when omitted (an API may refuse that)"),
      ...pointShape.shape,
      radiusKm: z.number().min(0.1).max(200).optional().describe("Half-width of the search box, 5 km by default"),
      from: z.string().optional().describe("Earliest date, YYYY-MM-DD"),
      to: z.string().optional().describe("Latest date, YYYY-MM-DD"),
      limit: z.number().int().min(1).max(50).optional().describe("Newest first; 20 by default"),
    }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ lat, lng, radiusKm = 5, ...rest }) => { try { return json(await searchStac({ ...rest, bbox: bboxOf(lat, lng, radiusKm) })) } catch (e) { return fail(e) } })

  server.registerTool("elevation", {
    title: "Elevation of points, or a profile",
    description: "Heights in metres read from the terrain data itself. With profile false: the elevation of each point. With profile true: the elevation along the line through the points (two or more), as evenly spaced samples with the length, lowest and highest point, total climb and descent. Give several sources to compare datasets on the same points (a surface model minus a ground model is the height of what stands on the ground). Reads tile datasets only: 'mapterhorn' (default), 'aws', a Terrarium tile URL, or a library dataset of type terrarium or terrainrgb.",
    inputSchema: z.object({
      points: z.array(pointShape).min(1).max(50).describe("The points, or the vertices of the profile line"),
      profile: z.boolean().optional().describe("true for a profile along the line; false (default) for the points themselves"),
      samples: z.number().int().min(2).max(256).optional().describe("Number of samples of a profile, 64 by default"),
      sources: z.array(z.string()).max(4).optional().describe("Terrain sources to read; ['mapterhorn'] by default"),
    }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async (args) => { try { return json(await elevation(args)) } catch (e) { return fail(e) } })

  server.registerTool("export_geotiff", {
    title: "Elevation of an area as a GeoTIFF",
    description: "Write the elevation of a box to a GeoTIFF file (32-bit float, metres, EPSG:3857, nodata -9999) that opens in QGIS or any GIS. Returns where the file is, its size in pixels, its resolution and its elevation range. At most 2048 pixels a side: a larger box gets a coarser resolution. Reads tile datasets only (see elevation); the app's own Download section exports the other datasets and every visualization mode.",
    inputSchema: z.object({
      west: z.number().min(-180).max(180), south: z.number().min(-85).max(85), east: z.number().min(-180).max(180), north: z.number().min(-85).max(85),
      source: z.string().optional().describe("Terrain source; 'mapterhorn' by default"),
      maxSide: z.number().int().min(64).max(2048).optional().describe("Longest side in pixels, 1024 by default"),
    }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ west, south, east, north, source, maxSide }) => {
    try {
      const r = await exportGeotiff({ bbox: [west, south, east, north], source, maxSide })
      // A file on the computer for a local server; a download link when served over HTTP.
      const where = STDIO ? { file: r.path } : { downloadUrl: `${PUBLIC_URL}/files/${r.name}` }
      const { path, name, ...facts } = r
      return json({ ...where, ...facts })
    } catch (e) { return fail(e) }
  })

  server.registerTool("screenshot", {
    title: "Picture of a terrain view",
    description: "Render a view in a headless browser and return the picture, so you can look at the terrain yourself: to describe what is there, check that a mode shows the feature, or compare two renderings. Same arguments as open_view. Takes a few seconds. To show the view to the user, use open_view instead.",
    inputSchema: z.object({ ...viewShape, imagerySourceB: z.enum(IMAGERY_SOURCES).optional(), imageryDateB: z.string().optional(), width: z.number().int().min(320).max(1600).optional(), height: z.number().int().min(240).max(1200).optional() }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ width, height, ...view }) => {
    try {
      const { url, jpeg } = await screenshot(view, { baseUrl: BASE_URL, width, height })
      return { content: [{ type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" }, { type: "text", text: `Rendered from ${url}` }] }
    } catch (e) { return fail(`Screenshot unavailable: ${e?.message ?? e}. A Chrome or Chromium is needed on the server (CHROME_PATH).`) }
  })

  return server
}

if (STDIO) {
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio")
  await makeServer().connect(new StdioServerTransport())
} else {
  const { toNodeHandler, hostHeaderValidation } = await import("@modelcontextprotocol/node")
  const handle = toNodeHandler(createMcpHandler(() => makeServer()))
  // DNS-rebinding guard: localhost always, plus the public names it is served under.
  const allowed = ["localhost", "127.0.0.1", "[::1]", ...(process.env.TV_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)]
  const validHost = hostHeaderValidation(allowed)
  http.createServer((req, res) => {
    const path = (req.url || "").split("?")[0]
    if (path === "/mcp") { if (!validHost(req, res)) return; return void handle(req, res) }
    // The GeoTIFFs export_geotiff wrote: a plain name of that folder, nothing else.
    const file = path.match(/^\/files\/(dem-[A-Za-z0-9-]+\.tif)$/)?.[1]
    if (file) {
      const p = join(tmpdir(), EXPORT_DIR_NAME, file)
      if (!existsSync(p)) return void res.writeHead(404).end()
      res.writeHead(200, { "content-type": "image/tiff", "content-length": statSync(p).size, "content-disposition": `attachment; filename="${file}"` })
      return void createReadStream(p).pipe(res)
    }
    if (path === "/" || path === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }); return void res.end("Terrain Viewer MCP server. Endpoint: /mcp\n") }
    res.writeHead(404).end()
  }).listen(PORT, () => console.error(`terrain-viewer MCP on http://localhost:${PORT}/mcp (app: ${BASE_URL})`))
}
