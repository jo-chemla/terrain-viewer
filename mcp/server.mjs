// Terrain Viewer MCP server.
//
//   node server.mjs            Streamable HTTP on http://localhost:3300/mcp
//   node server.mjs --stdio    stdio, for a desktop client's config
//
// Tools:
//   open_view          a place and modes to a Terrain Viewer link, shown in
//                      the conversation by hosts that support MCP Apps
//   geocode            a place name to coordinates
//   datasets_covering  which terrain datasets and imagery catalogs cover a point
//   catalog_items      dated imagery and old maps for an area
//   screenshot         a picture of a view, for the model to look at
//
// Environment: TV_BASE_URL (default https://terrain-viewer.iconem.com/),
// PORT (default 3300), CHROME_PATH (a Chromium for `screenshot`; an installed
// Chrome is used when unset), TV_ALLOWED_HOSTS (comma-separated host names
// allowed in the Host header when served on a public address).
import { readFileSync } from "node:fs"
import http from "node:http"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { z } from "zod"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { buildViewUrl, MODE_NAMES, DEFAULT_BASE_URL } from "./url.mjs"
import { geocode, datasetsCovering, catalogItems, screenshot } from "./tools.mjs"

const BASE_URL = process.env.TV_BASE_URL || DEFAULT_BASE_URL
const BASE_ORIGIN = new URL(BASE_URL).origin
const VIEW_URI = "ui://terrain-viewer/view.html"

const INSTRUCTIONS = `Terrain Viewer shows the relief of any place on Earth in the browser: hillshade, slope, local relief model, sky-view factor, contours, 3D, and dated satellite imagery.

How to answer a request to see a place:
1. geocode the place (skip it when you already know the coordinates).
2. Optionally datasets_covering, when detail matters (a site, archaeology, a building-scale question) or the user asks which data exists: it lists finer national datasets than the default.
3. open_view with the modes that answer the question. It shows the app in the conversation and returns the link.
4. screenshot only when you need to look at the result yourself to describe or check it.

Modes by subject:
- general relief: hillshade (default)
- subtle features (archaeology, earthworks, old field systems, landslides): lrm, svf, openness, with viewMode 2d
- mounds, barrows, pits, craters: moundDetector with lrm
- steepness, avalanche or landslide terrain: slope; orientation of slopes: aspect; ridges and valleys: curvature, tpi
- elevation as colours: colorRelief; contour lines: contours
- a landscape, a mountain, a valley: viewMode 3d (zoom 13 at most)
- continental scale: viewMode globe
- before and after, damage, change through time: catalog_items for dated imagery, then open_view with imageryUrl
- comparing two elevation datasets: terrainSource and terrainSourceB

The default terrain, mapterhorn, is global: about 0.25 to 2 m where a national LiDAR survey is open, 30 m elsewhere. At 30 m a building or a small earthwork is a few pixels: say so rather than promise detail. Never invent a dataset id: use the ids datasets_covering returns.`

// The view runs in a sandbox whose CSP blocks scripts from the network, so
// the MCP Apps client library is inlined into the page. The published bundle
// is an ES module: its export list is dropped and the App class bound to a
// plain name for the page's own code.
function buildViewHtml() {
  const require = createRequire(import.meta.url)
  const bundlePath = require.resolve("@modelcontextprotocol/ext-apps/app-with-deps")
  let bundle = readFileSync(bundlePath, "utf8")
  const local = bundle.match(/([A-Za-z0-9_$]+) as App\b/)?.[1]
  if (!local) throw new Error("ext-apps bundle: the App export was not found")
  const exportAt = bundle.lastIndexOf("export{")
  if (exportAt < 0) throw new Error("ext-apps bundle: the export list was not found")
  bundle = bundle.slice(0, exportAt) + `;const App = ${local};`
  // A literal "</script" inside the bundle would end the inline script.
  bundle = bundle.replace(/<\/script/gi, "<\\/script")
  const html = readFileSync(fileURLToPath(new URL("./view.html", import.meta.url)), "utf8")
  return html.replace("/*__APP_BUNDLE__*/", () => bundle)
}
const VIEW_HTML = buildViewHtml()

const viewShape = {
  lat: z.number().min(-90).max(90).describe("Latitude of the view centre, decimal degrees"),
  lng: z.number().min(-180).max(180).describe("Longitude of the view centre, decimal degrees"),
  zoom: z.number().min(0).max(22).optional().describe("5 a country, 9 a region, 12 a mountain or valley, 15 a site. Default 12"),
  viewMode: z.enum(["2d", "3d", "globe"]).optional().describe("2d (top-down, for sites and analysis; default), 3d (landscapes; zoom is capped at 13), globe (continental scale)"),
  pitch: z.number().min(0).max(85).optional().describe("Camera tilt in degrees; 55 by default in 3d"),
  bearing: z.number().min(-180).max(360).optional().describe("Camera heading in degrees clockwise from north"),
  modes: z.array(z.enum(MODE_NAMES)).optional().describe("Visualization modes to switch on. Hillshade alone when omitted. lrm, svf and openness bring out subtle relief (archaeology, landslides); slope, aspect, curvature, tpi and roughness are terrain analysis; colorRelief colours by elevation; basemap puts satellite imagery underneath; moundDetector marks mound candidates (beta)"),
  terrainSource: z.string().optional().describe("Terrain source: 'mapterhorn' (default, global, LiDAR where open), 'aws', an id returned by datasets_covering (never invent one), or the URL of Terrarium tiles ({z}/{x}/{y}) or of a Cloud-Optimized GeoTIFF"),
  terrainSourceB: z.string().optional().describe("A second terrain source to compare with the first"),
  split: z.enum(["off", "side-by-side", "overlay"]).optional().describe("How two sources are compared; side-by-side when terrainSourceB is given"),
  imageryUrl: z.string().optional().describe("Imagery to show under the terrain: an imageryUrl returned by catalog_items, XYZ tiles ({z}/{x}/{y}) or a Cloud-Optimized GeoTIFF"),
  place: z.string().optional().describe("Name of the place, shown as the view's label"),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Any other Terrain Viewer URL parameter, as is (e.g. illuminationAlt, exaggeration, drawingUrl, appMode)"),
}
const openViewInput = z.object(viewShape)

const text = (t) => ({ content: [{ type: "text", text: t }] })
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] })
const json = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }], structuredContent: o })
const READ_ONLY = { readOnlyHint: true }

function makeServer() {
  const server = new McpServer({ name: "terrain-viewer", version: "0.2.0" }, { instructions: INSTRUCTIONS })

  registerAppTool(
    server,
    "open_view",
    {
      title: "Open a terrain view",
      description: "Show the terrain of a place in Terrain Viewer (hillshade, slope, local relief model, sky-view factor, contours, 3D, dated imagery) and return the link that opens it. Use it whenever someone wants to see, explore or compare the relief, elevation or imagery of a place. Needs coordinates: call geocode first for a place name.",
      inputSchema: openViewInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async (args) => {
      try {
        const url = buildViewUrl(args, { baseUrl: BASE_URL })
        const embedUrl = buildViewUrl(args, { baseUrl: BASE_URL, embed: true })
        const modes = args.modes?.length ? args.modes.join(", ") : "hillshade"
        const label = `${args.place ?? `${args.lat.toFixed(4)}, ${args.lng.toFixed(4)}`} · ${modes}`
        return { content: [{ type: "text", text: `Terrain Viewer link (${label}): ${url}` }], structuredContent: { url, embedUrl, label, origin: BASE_ORIGIN, view: args } }
      } catch (e) { return fail(e) }
    },
  )

  registerAppResource(
    server,
    "Terrain Viewer",
    VIEW_URI,
    { description: "Terrain Viewer, framed in the conversation" },
    async () => ({
      contents: [{
        uri: VIEW_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: VIEW_HTML,
        // The page only frames the app: no script, style or request of its
        // own leaves the sandbox.
        _meta: { ui: { csp: { frameDomains: [BASE_ORIGIN] }, prefersBorder: false } },
      }],
    }),
  )

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
    inputSchema: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
    annotations: READ_ONLY,
  }, async ({ lat, lng }) => { try { return json(await datasetsCovering(lat, lng)) } catch (e) { return fail(e) } })

  server.registerTool("catalog_items", {
    title: "Dated imagery for an area",
    description: "Dated satellite and aerial images, and old maps, that cover an area, from the catalogs Terrain Viewer's timeline reads (OpenAerialMap, Maxar and Vantor open data, national archives, old-map collections). Each item has a date, a ground resolution and an imageryUrl that open_view shows. Catalog ids come from datasets_covering; cat-oam and cat-maxar are global.",
    inputSchema: z.object({
      lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
      radiusKm: z.number().min(0.1).max(200).optional().describe("Half-width of the search box, 5 km by default"),
      catalogs: z.array(z.string()).min(1).max(8).describe("Catalog ids, e.g. ['cat-oam', 'cat-maxar']"),
      from: z.string().optional().describe("Earliest date, YYYY-MM-DD"),
      to: z.string().optional().describe("Latest date, YYYY-MM-DD"),
      limit: z.number().int().min(1).max(50).optional().describe("Items per catalog, newest first; 20 by default"),
    }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ lat, lng, radiusKm = 5, catalogs, from, to, limit }) => {
    try {
      const dLat = radiusKm / 111.32, dLng = radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
      const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
      return json({ bbox, catalogs: await catalogItems({ bbox, catalogs, from, to, limit }) })
    } catch (e) { return fail(e) }
  })

  server.registerTool("screenshot", {
    title: "Picture of a terrain view",
    description: "Render a view in a headless browser and return the picture, so you can look at the terrain yourself: to describe what is there, check that a mode shows the feature, or compare two renderings. Same arguments as open_view. Takes 10 to 30 seconds. To show the view to the user, use open_view instead.",
    inputSchema: z.object({ ...viewShape, width: z.number().int().min(320).max(1600).optional(), height: z.number().int().min(240).max(1200).optional() }),
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ width, height, ...view }) => {
    try {
      const { url, jpeg } = await screenshot(view, { baseUrl: BASE_URL, width, height })
      return { content: [{ type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" }, { type: "text", text: `Rendered from ${url}` }] }
    } catch (e) { return fail(`Screenshot unavailable: ${e?.message ?? e}. A Chrome or Chromium is needed on the server (CHROME_PATH).`) }
  })

  return server
}

if (process.argv.includes("--stdio")) {
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio")
  await makeServer().connect(new StdioServerTransport())
} else {
  const { toNodeHandler, hostHeaderValidation } = await import("@modelcontextprotocol/node")
  const port = Number(process.env.PORT || 3300)
  const handle = toNodeHandler(createMcpHandler(() => makeServer()))
  // DNS-rebinding guard: localhost always, plus the public names it is served under.
  const allowed = ["localhost", "127.0.0.1", "[::1]", ...(process.env.TV_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)]
  const validHost = hostHeaderValidation(allowed)
  http.createServer((req, res) => {
    const path = (req.url || "").split("?")[0]
    if (path === "/mcp") { if (!validHost(req, res)) return; return void handle(req, res) }
    if (path === "/" || path === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }); return void res.end("Terrain Viewer MCP server. Endpoint: /mcp\n") }
    res.writeHead(404).end()
  }).listen(port, () => console.error(`terrain-viewer MCP on http://localhost:${port}/mcp (app: ${BASE_URL})`))
}
