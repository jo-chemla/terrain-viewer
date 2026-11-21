// The lookups behind the tools, kept apart from the MCP wiring so they can be
// tested directly.
import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildViewUrl } from "./url.mjs"

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const UA = "terrain-viewer-mcp/0.2 (+https://terrain-viewer.iconem.com)"

let libraryCache
export function library() {
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
    if (!known.has(id) && !lib.isStacCatalogId(id)) { out[id] = { error: "Unknown catalog id. Use datasets_covering to list the ids for a place." }; return }
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
export async function browser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core")
      // The machine's GPU when there is one (several times faster on the
      // heavy modes); TV_SOFTWARE_GL=1 forces software rendering, for a
      // container without one.
      const args = process.env.TV_SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars"] : ["--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"]
      const exe = process.env.CHROME_PATH
      // An installed Chrome by default; CHROME_PATH for a container's Chromium.
      return chromium.launch(exe ? { executablePath: exe, args } : { channel: "chrome", args })
    })().catch((e) => { browserPromise = undefined; throw e })
  }
  return browserPromise
}

// One browser context for every render: its HTTP cache keeps the app's
// bundle and the tiles, so a second picture of the same place is quick.
// Nothing else carries over, the storage is emptied before each page runs.
let contextPromise
async function context() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const ctx = await (await browser()).newContext({ deviceScaleFactor: 1 })
      // The first-visit walkthrough would cover the map.
      await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem("hasSeenTour", "true") } catch { } })
      return ctx
    })().catch((e) => { contextPromise = undefined; throw e })
  }
  return contextPromise
}

// The model looks at a view, then the page in the conversation asks for the
// same picture, and asks again each time the conversation is reopened:
// rendered once. Kept a day in memory (sixty pictures) and a week on disk,
// so a reopened conversation or a restarted server answers at once.
const pictures = new Map() // key -> { at, promise }
const PICTURE_TTL = 24 * 60 * 60 * 1000
const DISK_TTL = 7 * PICTURE_TTL
const PICTURE_DIR = process.env.PICTURE_CACHE_DIR || path.join(os.tmpdir(), "terrain-viewer-mcp-pictures")
const pictureFile = (key) => path.join(PICTURE_DIR, createHash("sha1").update(key).digest("hex") + ".jpg")

async function fromDisk(key) {
  try {
    const file = pictureFile(key)
    const stat = await fs.stat(file)
    if (Date.now() - stat.mtimeMs > DISK_TTL) return null
    return await fs.readFile(file)
  } catch { return null }
}

async function toDisk(key, jpeg) {
  try {
    await fs.mkdir(PICTURE_DIR, { recursive: true })
    await fs.writeFile(pictureFile(key), jpeg)
    // Old pictures leave when a new one arrives.
    for (const name of await fs.readdir(PICTURE_DIR)) {
      const file = path.join(PICTURE_DIR, name)
      const stat = await fs.stat(file).catch(() => null)
      if (stat && Date.now() - stat.mtimeMs > DISK_TTL) await fs.unlink(file).catch(() => { })
    }
  } catch { /* a cache: never worth failing a picture for */ }
}

/** A picture of the view, rendered by the app in a headless browser. */
export function screenshot(view, { baseUrl, width = 1024, height = 640, waitMs = 0 } = {}) {
  const key = `${buildViewUrl(view, { baseUrl, embed: true })}|${width}x${height}|${waitMs}`
  const have = pictures.get(key)
  if (have && Date.now() - have.at < PICTURE_TTL) return have.promise
  const promise = (async () => {
    const jpeg = await fromDisk(key)
    if (jpeg) return { url: buildViewUrl(view, { baseUrl }), jpeg }
    const made = await render(view, { baseUrl, width, height, waitMs })
    toDisk(key, made.jpeg)
    return made
  })()
  pictures.set(key, { at: Date.now(), promise })
  promise.catch(() => pictures.delete(key))
  for (const [k, v] of pictures) if (pictures.size > 60 || Date.now() - v.at > PICTURE_TTL) pictures.delete(k); else break
  return promise
}

async function render(view, { baseUrl, width, height, waitMs }) {
  const url = buildViewUrl(view, { baseUrl, embed: true })
  const jpeg = await withSettledPage(url, { width, height, waitMs }, (page) => page.screenshot({ type: "jpeg", quality: 80 }))
  return { url: buildViewUrl(view, { baseUrl }), jpeg }
}

/** Opens the app at `url` in a page of the given size, waits until its maps
 *  have drawn everything, hides the interface, then hands the page to `use`.
 *  `bare` hides everything but the map itself (for a tile: no scale, no
 *  credits, no pills). */
export async function withSettledPage(url, { width, height, waitMs = 0, bare = false }, use) {
  const ctx = await context()
  const page = await ctx.newPage()
  await page.setViewportSize({ width, height })
  // Done when tile and data requests have stopped for a moment. Playwright's
  // "networkidle" never comes here (long-lived requests keep it busy), so
  // every render waited out the full timeout.
  let inFlight = 0, lastActivity = Date.now()
  // Not what the picture is made of: imagery-date metadata the app polls for
  // its attribution, analytics.
  const BACKGROUND = /World_Imagery_Metadata|metadata\.maptiles|umami|plausible|analytics|sentry/i
  const counted = (r) => ["fetch", "xhr", "image"].includes(r.resourceType()) && !BACKGROUND.test(r.url())
  const tStart = Date.now()
  page.on("request", (r) => { if (counted(r)) { inFlight++; lastActivity = Date.now(); if (process.env.TV_TIMING && Date.now() - tStart > 7000) console.error("  late", Date.now() - tStart, r.url().slice(0, 110)) } })
  const done = (r) => { if (counted(r)) { inFlight = Math.max(0, inFlight - 1); lastActivity = Date.now() } }
  page.on("requestfinished", done); page.on("requestfailed", done)
  // The app says when its maps have drawn everything (window.__tvBusy and
  // __tvIdleSeen, components/TerrainViewer.tsx): then the picture is taken
  // as soon as the network has also been still for a moment. Without the
  // signal (an older deployment), a longer silence and a pause.
  const settled = () => page.evaluate(() => window.__tvIdleSeen === true && window.__tvBusy?.size === 0).catch(() => false)
  const quiet = async (idleMs = 1500, maxMs = 25000) => {
    const t0 = Date.now()
    // In-flight requests older than 6 s do not hold the picture back.
    while (Date.now() - t0 < maxMs) {
      const idle = Date.now() - lastActivity
      if (inFlight === 0 && idle >= 400 && await settled()) return true
      if ((inFlight === 0 && idle >= idleMs) || idle >= 6000) return false
      await page.waitForTimeout(100)
    }
    return false
  }
  try {
    const T = Date.now(); const lap = (n) => process.env.TV_TIMING && console.error(n, Date.now() - T, "inflight", inFlight)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); lap("goto")
    await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 }); lap("canvas")
    // Tiles keep arriving for a while: wait for the network to go quiet,
    // with a ceiling, then let the map draw.
    const exact = await quiet(); lap(exact ? "settled" : "quiet")
    await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (b.textContent?.trim() === "Skip") b.click() }).catch(() => { })
    // The picture is of the map, not of the interface: no search box, zoom,
    // compass, locate or full-screen buttons, no panel or minimap toggles,
    // no split handle. What says something about the image stays: the
    // scale, the credits, date pills, an open minimap, timeline or profile.
    await page.addStyleTag({ content: `
      .maplibregl-ctrl-top-left > *, .maplibregl-ctrl-top-right > *, [data-picture-hide], [data-snapshot-ignore],
      .rounded-md:has(> * > [data-picture-hide="minimap"]) { display: none !important }
      .maplibregl-ctrl-top-left > .maplibregl-ctrl-scale, .maplibregl-ctrl-top-right > .maplibregl-ctrl-scale { display: block !important }
    ` }).catch(() => { })
    // Two frames for the last tiles to reach the screen, or the old pause.
    if (bare) {
      // Only the largest map canvas stays visible: a child may be visible
      // inside hidden parents.
      await page.addStyleTag({ content: `body, body * { visibility: hidden !important } canvas[data-tile-shot] { visibility: visible !important }` }).catch(() => { })
      await page.evaluate(() => {
        const all = [...document.querySelectorAll("canvas.maplibregl-canvas")]
        all.sort((a, b) => b.width * b.height - a.width * a.height)
        all[0]?.setAttribute("data-tile-shot", "")
      })
    }
    await page.waitForTimeout((exact ? 250 : 1200) + waitMs)
    return await use(page, { exact })
  } finally { await page.close().catch(() => { }) }
}

export async function closeBrowser() { contextPromise = undefined; pictures.clear(); if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = undefined; await b?.close() } }
