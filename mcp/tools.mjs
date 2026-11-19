// The lookups behind the tools, kept apart from the MCP wiring so they can be
// tested directly.
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { buildViewUrl } from "./url.mjs"

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const UA = "terrain-viewer-mcp/0.2 (+https://terrain-viewer.iconem.com)"

let libraryCache
function library() {
  if (!libraryCache) {
    const p = here("./generated/library.json")
    if (!existsSync(p)) throw new Error("generated/library.json is missing: run `pnpm build` in mcp/")
    libraryCache = JSON.parse(readFileSync(p, "utf8"))
  }
  return libraryCache
}
let appLibPromise
/** The app's own catalog code (bundled by build.mjs). */
export function appLib() {
  if (!appLibPromise) {
    const p = here("./generated/app-lib.mjs")
    if (!existsSync(p)) throw new Error("generated/app-lib.mjs is missing: run `pnpm build` in mcp/")
    appLibPromise = import(new URL("./generated/app-lib.mjs", import.meta.url).href)
  }
  return appLibPromise
}

const inBounds = (b, lat, lng) => b && lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]
const area = (b) => (b ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) : Infinity)

/** Place name to coordinates, through OpenStreetMap's Nominatim. */
export async function geocode(query, limit = 3) {
  const u = new URL("https://nominatim.openstreetmap.org/search")
  u.searchParams.set("q", query); u.searchParams.set("format", "jsonv2"); u.searchParams.set("limit", String(limit)); u.searchParams.set("addressdetails", "1")
  const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "en" } })
  if (!r.ok) throw new Error(`Geocoder answered ${r.status}`)
  return (await r.json()).map((p) => {
    const [s, n, w, e] = (p.boundingbox ?? []).map(Number)
    const span = Number.isFinite(e - w) ? Math.max(e - w, n - s) : 0.05
    // A zoom that frames the place: 360 degrees fill the world at zoom 0.
    const zoom = Math.max(3, Math.min(16, Math.round(Math.log2(360 / Math.max(span, 0.002)) * 10) / 10))
    return { name: p.display_name, lat: Number(p.lat), lng: Number(p.lon), zoom, kind: p.type, country: p.address?.country ?? null, countryCode: (p.address?.country_code ?? "").toUpperCase() || null, bbox: Number.isFinite(w) ? [w, s, e, n] : null }
  })
}

/** Terrain datasets of the library, and catalogs of dated imagery, that cover a point. */
export async function datasetsCovering(lat, lng) {
  const lib = library()
  const hit = lib.terrain.filter((s) => inBounds(s.bounds, lat, lng))
  // Regional surveys first (smallest extent), then finest resolution.
  const regional = hit.filter((s) => area(s.bounds) < 360 * 170 * 0.5)
    .sort((a, b) => (a.resolutionM ?? 999) - (b.resolutionM ?? 999) || area(a.bounds) - area(b.bounds))
  const { TIMELINE_CATALOGS } = await appLib()
  const usable = TIMELINE_CATALOGS.filter((c) => !c.disabled)
  const catalogs = usable.filter((c) => c.bbox && inBounds(c.bbox, lat, lng)).map((c) => ({ id: c.id, label: c.label, group: c.group, note: c.note ?? "" }))
  const global = usable.filter((c) => !c.bbox).map((c) => ({ id: c.id, label: c.label, group: c.group }))
  return {
    terrain: regional.map((s) => ({ id: s.id, name: s.name, resolutionM: s.resolutionM, kind: s.type === "dem-diff" ? "difference of two surveys" : "elevation", description: s.description.slice(0, 240), infoUrl: s.infoUrl })),
    default: { id: "mapterhorn", note: "Global. National LiDAR where open (0.25 to 2 m in most of Europe, the US, Japan, New Zealand), Copernicus 30 m elsewhere.", bestResolutionMByCountryIso3: lib.mapterhornBestResolutionM },
    imageryCatalogsHere: catalogs,
    imageryCatalogsGlobal: global,
  }
}

/** Dated imagery and maps for an area, from the catalogs the app's timeline reads. */
export async function catalogItems({ bbox, catalogs, from, to, limit = 20 }) {
  const lib = await appLib()
  const known = new Set(lib.TIMELINE_CATALOGS.map((c) => c.id))
  const range = from || to ? [from ? Date.parse(from) : 0, to ? Date.parse(to) : Date.now()] : undefined
  const out = {}
  await Promise.all(catalogs.map(async (id) => {
    if (!known.has(id)) { out[id] = { error: "Unknown catalog id. Use datasets_covering to list the ids for a place." }; return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25000)
    try {
      const ticks = await lib.loadCatalogTicks(id, bbox, ctrl.signal, range)
      out[id] = {
        count: ticks.length,
        // Newest first: the question is usually "what is the latest".
        items: ticks.sort((a, b) => b.dateMs - a.dateMs).slice(0, limit).map((t) => {
          const src = lib.catalogBasemap(t.ref)
          return {
            date: new Date(t.dateMs).toISOString().slice(0, 10), label: t.label,
            gsdM: t.meta?.gsd ?? null, provider: t.meta?.provider ?? null, licence: t.meta?.licence ?? null, page: t.meta?.url ?? null,
            // What open_view's imageryUrl takes to show this item.
            imageryUrl: src?.url ?? null,
          }
        }),
      }
    } catch (e) {
      out[id] = { error: ctrl.signal.aborted ? "Timed out after 25 s" : String(e?.message ?? e) }
    } finally { clearTimeout(timer) }
  }))
  return out
}

let browserPromise
async function browser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core")
      const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars"]
      const exe = process.env.CHROME_PATH
      // An installed Chrome by default; CHROME_PATH for a container's Chromium.
      return chromium.launch(exe ? { executablePath: exe, args } : { channel: "chrome", args })
    })().catch((e) => { browserPromise = undefined; throw e })
  }
  return browserPromise
}

/** A picture of the view, rendered by the app in a headless browser. */
export async function screenshot(view, { baseUrl, width = 1024, height = 640, waitMs = 0 } = {}) {
  const url = buildViewUrl(view, { baseUrl, embed: true })
  const b = await browser()
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  // The first-visit walkthrough would cover the map.
  await ctx.addInitScript(() => { try { localStorage.setItem("hasSeenTour", "true") } catch { } })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 })
    // Tiles keep arriving for a while: wait for the network to go quiet,
    // with a ceiling, then let the map draw.
    await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => { })
    await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (b.textContent?.trim() === "Skip") b.click() }).catch(() => { })
    await page.waitForTimeout(1500 + waitMs)
    const jpeg = await page.screenshot({ type: "jpeg", quality: 80 })
    return { url: buildViewUrl(view, { baseUrl }), jpeg }
  } finally { await ctx.close() }
}

export async function closeBrowser() { if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = undefined; await b?.close() } }
