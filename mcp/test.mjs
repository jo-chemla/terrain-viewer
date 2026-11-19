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

// The lookups (network): a place, the datasets there, dated imagery, a picture.
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }, { timeout: 90000 }); assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`); return r }
const names = tools.map((t) => t.name).sort().join(",")
assert.equal(names, "catalog_items,datasets_covering,geocode,open_view,screenshot")

const geo = (await call("geocode", { query: "Matterhorn" })).structuredContent.places[0]
assert.ok(Math.abs(geo.lat - 45.976) < 0.05 && Math.abs(geo.lng - 7.658) < 0.05, JSON.stringify(geo))
console.log(`geocode: ${geo.name.slice(0, 50)} z${geo.zoom}`)

const ds = (await call("datasets_covering", { lat: 52.2, lng: 5.85 })).structuredContent
assert.ok(ds.terrain.some((d) => d.id === "custom-nl-ahn-dtm"), "AHN covers the Veluwe")
console.log(`datasets_covering Veluwe: ${ds.terrain.length} terrain (${ds.terrain.slice(0, 3).map((d) => d.id + " " + d.resolutionM + "m").join(", ")}), ${ds.imageryCatalogsHere.length} local catalogs, ${ds.imageryCatalogsGlobal.length} global`)

const cat = (await call("catalog_items", { lat: 36.2, lng: 36.16, radiusKm: 4, catalogs: ["cat-oam", "cat-maxar", "nope"], limit: 3 })).structuredContent.catalogs
assert.ok(cat["cat-oam"].count > 0 && cat.nope.error, JSON.stringify(cat).slice(0, 300))
console.log(`catalog_items Antakya: OAM ${cat["cat-oam"].count}, Maxar ${cat["cat-maxar"].count ?? cat["cat-maxar"].error}; first ${JSON.stringify(cat["cat-oam"].items[0]).slice(0, 260)}`)

if (!process.env.NO_SCREENSHOT) {
  const shot = await call("screenshot", { lat: 45.9763, lng: 7.6586, zoom: 12, modes: ["hillshade", "slope"], width: 800, height: 500 })
  const img = shot.content.find((c) => c.type === "image")
  assert.ok(img && img.data.length > 20000, "a picture came back")
  const { writeFileSync } = await import("node:fs")
  writeFileSync(new URL("./generated/test-shot.jpg", import.meta.url), Buffer.from(img.data, "base64"))
  console.log(`screenshot: ${(img.data.length * 0.75 / 1024).toFixed(0)} KB -> generated/test-shot.jpg`)
}

await client.close()
console.log("ok")
