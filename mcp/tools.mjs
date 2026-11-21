// The lookups behind the tools, kept apart from the MCP wiring so they can be
// tested directly.
import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildViewUrl, viewToQuery } from "./url.mjs"
import { browser, withSettledPage, closeBrowser as closeRenderer } from "./render.mjs"
import { library } from "./dem.mjs"
import { plan, drawViewport, flatView } from "./direct.mjs"

export { browser, library }

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const UA = "terrain-viewer-mcp/0.2 (+https://terrain-viewer.iconem.com)"

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

// TV_RENDER_URL: the address of the tile service (tile-server.mjs). When
// set, the pictures are asked from it and this process starts no browser
// for them.
const RENDER_URL = (process.env.TV_RENDER_URL || "").replace(/\/$/, "")

async function render(view, { baseUrl, width, height, waitMs }) {
  // A flat view of the modes the direct engine draws: computed here, in a
  // fraction of a second, with no browser (direct.mjs).
  if (flatView(view)) {
    const how = await plan(view, new URLSearchParams(Object.entries(view.params ?? {}).map(([k, v]) => [k, String(v)]))).catch(() => null)
    if (how?.engine === "direct") return { url: buildViewUrl(view, { baseUrl }), jpeg: await drawViewport(how, { lat: view.lat, lng: view.lng, zoom: view.zoom ?? 12, width, height, format: "jpg", baseUrl }), engine: "direct" }
  }
  if (RENDER_URL) {
    const q = viewToQuery(view)
    q.set("width", String(width)); q.set("height", String(height))
    const res = await fetch(`${RENDER_URL}/render.jpg?${q}`, { signal: AbortSignal.timeout(90000) })
    if (!res.ok) throw new Error(`The tile service answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return { url: buildViewUrl(view, { baseUrl }), jpeg: Buffer.from(await res.arrayBuffer()) }
  }
  const url = buildViewUrl(view, { baseUrl, embed: true })
  const jpeg = await withSettledPage(url, { width, height, waitMs }, (page) => page.screenshot({ type: "jpeg", quality: 80 }))
  return { url: buildViewUrl(view, { baseUrl }), jpeg }
}

export async function closeBrowser() { pictures.clear(); await closeRenderer() }
