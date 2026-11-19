// Terrain Viewer MCP server (prototype).
//
//   node server.mjs            Streamable HTTP on http://localhost:3300/mcp
//   node server.mjs --stdio    stdio, for a desktop client's config
//
// One tool for now, `open_view`: it composes a Terrain Viewer link from a
// place and a list of modes and, in a host that supports MCP Apps, shows the
// app itself in the conversation (the `ui://` resource is a page that frames
// the app; every setting of the app is in its URL).
//
// Environment: TV_BASE_URL (default https://terrain-viewer.iconem.com/),
// PORT (default 3300).
import { readFileSync } from "node:fs"
import http from "node:http"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { z } from "zod"
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { buildViewUrl, MODE_NAMES, DEFAULT_BASE_URL } from "./url.mjs"

const BASE_URL = process.env.TV_BASE_URL || DEFAULT_BASE_URL
const BASE_ORIGIN = new URL(BASE_URL).origin
const VIEW_URI = "ui://terrain-viewer/view.html"

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

const openViewInput = z.object({
  lat: z.number().min(-90).max(90).describe("Latitude of the view centre, decimal degrees"),
  lng: z.number().min(-180).max(180).describe("Longitude of the view centre, decimal degrees"),
  zoom: z.number().min(0).max(22).optional().describe("5 a country, 9 a region, 12 a mountain or valley, 15 a site. Default 12"),
  viewMode: z.enum(["2d", "3d", "globe"]).optional().describe("2d (top-down, for sites and analysis; default), 3d (landscapes; zoom is capped at 13), globe (continental scale)"),
  pitch: z.number().min(0).max(85).optional().describe("Camera tilt in degrees; 55 by default in 3d"),
  bearing: z.number().min(-180).max(360).optional().describe("Camera heading in degrees clockwise from north"),
  modes: z.array(z.enum(MODE_NAMES)).optional().describe("Visualization modes to switch on. Hillshade alone when omitted. lrm, svf and openness bring out subtle relief (archaeology, landslides); slope, aspect, curvature, tpi and roughness are terrain analysis; colorRelief colours by elevation; basemap puts satellite imagery underneath; moundDetector marks mound candidates (beta)"),
  terrainSource: z.string().optional().describe("Terrain source: 'mapterhorn' (default, global, LiDAR where open), 'aws', a library id such as 'custom-nl-ahn-dtm' (never invent one), or the URL of Terrarium tiles ({z}/{x}/{y}) or of a Cloud-Optimized GeoTIFF"),
  terrainSourceB: z.string().optional().describe("A second terrain source to compare with the first"),
  split: z.enum(["off", "side-by-side", "overlay"]).optional().describe("How two sources are compared; side-by-side when terrainSourceB is given"),
  place: z.string().optional().describe("Name of the place, shown as the view's label"),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Any other Terrain Viewer URL parameter, as is (e.g. illuminationAlt, exaggeration, drawingUrl, appMode)"),
})

function makeServer() {
  const server = new McpServer({ name: "terrain-viewer", version: "0.1.0" })

  registerAppTool(
    server,
    "open_view",
    {
      title: "Open a terrain view",
      description: "Show the terrain of a place in Terrain Viewer (hillshade, slope, local relief model, sky-view factor, contours, 3D) and return the link that opens it. Use it when someone wants to see, explore or compare the relief or elevation of a place. Geocode the place to a latitude and longitude first.",
      inputSchema: openViewInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async (args) => {
      let url, embedUrl
      try {
        url = buildViewUrl(args, { baseUrl: BASE_URL })
        embedUrl = buildViewUrl(args, { baseUrl: BASE_URL, embed: true })
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] }
      }
      const modes = args.modes?.length ? args.modes.join(", ") : "hillshade"
      const label = `${args.place ?? `${args.lat.toFixed(4)}, ${args.lng.toFixed(4)}`} · ${modes}`
      return {
        content: [{ type: "text", text: `Terrain Viewer link (${label}): ${url}` }],
        structuredContent: { url, embedUrl, label },
      }
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

  return server
}

if (process.argv.includes("--stdio")) {
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio")
  await makeServer().connect(new StdioServerTransport())
} else {
  const { toNodeHandler } = await import("@modelcontextprotocol/node")
  const port = Number(process.env.PORT || 3300)
  const handle = toNodeHandler(createMcpHandler(() => makeServer()))
  http.createServer((req, res) => {
    const path = (req.url || "").split("?")[0]
    if (path === "/mcp") return void handle(req, res)
    if (path === "/") { res.writeHead(200, { "content-type": "text/plain" }); return void res.end("Terrain Viewer MCP server. Endpoint: /mcp\n") }
    res.writeHead(404).end()
  }).listen(port, () => console.error(`terrain-viewer MCP on http://localhost:${port}/mcp (app: ${BASE_URL})`))
}
