// End-to-end check over stdio: the server starts, lists its tool with the
// UI link, answers open_view and serves the view page.
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { buildViewUrl } from "./url.mjs"

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

await client.close()
console.log("ok")
