// A STAC Item for each raster the service answers (STAC 1.1.0 with the
// Processing extension v1.2.0): the export's footprint, what it was made
// from (the terrain source, or the imagery), which modes with which
// parameters, by which software. Served beside the export, at its address
// plus `.stac.json` (same query), and named by the export's answer in a
// `Link: <...>; rel="describedby"` header. The item is computed from the
// address alone: asking for it draws nothing.
import { readFileSync } from "node:fs"
import { KEY_PARAMS } from "./dem.mjs"

export const STAC_VERSION = "1.1.0"
export const PROCESSING_EXT = "https://stac-extensions.github.io/processing/v1.2.0/schema.json"
export const SOFTWARE = "terrain-viewer tile-server"
export const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version
export const STAC_SUFFIX = ".stac.json"
const DEFAULT_SOURCE = "mapterhorn"
const DEFAULT_MODES = ["hillshade"]

const lngOf = (x, n) => (x / n) * 360 - 180
const latOf = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
const my = (la) => (1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2
const round = (v) => Math.round(v * 1e7) / 1e7

/** The raster export an address names, or null: which endpoint, its
 *  format, and its footprint where the path gives it. */
export function exportOf(pathname) {
  let m = pathname.match(/^\/terrain-tiles\/(\d+)\/(\d+)\/(\d+)(@[12]x)?\.(png|jpg|jpeg|tif|tiff)$/)
  if (m) return { endpoint: "terrain-tiles", tile: m.slice(1, 4).map(Number), ext: m[5] }
  m = pathname.match(/^\/basemap-tiles\/(\d+)\/(\d+)\/(\d+)(@[12]x)?\.(png|jpg|jpeg)$/)
  if (m) return { endpoint: "basemap-tiles", tile: m.slice(1, 4).map(Number), ext: m[5] }
  m = pathname.match(/^\/bbox\/([-\d.,]+)\/(\d+)x(\d+)\.(png|jpg|jpeg|tif|tiff)$/)
  if (m) return { endpoint: "bbox", bbox: m[1], width: Number(m[2]), height: Number(m[3]), ext: m[4] }
  m = pathname.match(/^\/render\.(png|jpg|jpeg|tif|tiff)$/)
  if (m) return { endpoint: "render", ext: m[1] }
  return null
}

/** west, south, east, north of an export, in degrees. Values over a box
 *  cover the box exactly; a picture of a box shows it whole, centred, and
 *  more on two sides when the shapes differ. A viewport is its unrotated
 *  box (pitch and bearing are not read). */
function footprint(ex, q, values) {
  if (ex.tile) {
    const [z, x, y] = ex.tile, n = 2 ** z
    return [lngOf(x, n), latOf(y + 1, n), lngOf(x + 1, n), latOf(y, n)]
  }
  const bad = (m) => Object.assign(new Error(m), { status: 400 })
  const num = (k, d) => { const v = q.get(k); if (v === null) return d; const n = Number(v); if (!Number.isFinite(n)) throw bad(`${k} is not a number`); return n }
  const min = values ? 16 : 64
  const width = Math.min(4096, Math.max(min, Math.round(ex.width ?? num("width", 1024)))), height = Math.min(4096, Math.max(min, Math.round(ex.height ?? num("height", 640))))
  const bbox = ex.bbox ?? q.get("bbox")
  let world, cx, cy
  if (bbox) {
    const b = bbox.split(",").map(Number)
    if (b.length !== 4 || !b.every(Number.isFinite) || b[2] <= b[0] || b[3] <= b[1]) throw bad("bbox is west,south,east,north in degrees")
    if (values) return b
    const [w, s, e, n] = b
    world = Math.min(width / ((e - w) / 360), height / (my(s) - my(n)))
    cx = (((w + e) / 2 + 180) / 360) * world; cy = ((my(n) + my(s)) / 2) * world
  } else {
    if (!q.has("lat") || !q.has("lng")) throw bad("lat and lng, or bbox, are required")
    world = 512 * 2 ** num("zoom", 12)
    cx = ((num("lng") + 180) / 360) * world; cy = my(num("lat")) * world
  }
  // Fractions of the world, read as one tile of zoom 0.
  return [lngOf((cx - width / 2) / world, 1), latOf((cy + height / 2) / world, 1), lngOf((cx + width / 2) / world, 1), latOf((cy - height / 2) / world, 1)]
}

const isUrl = (s) => /^https?:\/\//i.test(s)

/**
 * The STAC Item of an export.
 * @param {string} self the service's address
 * @param {string} pathname the export's path (without `.stac.json`)
 * @param {string} search its query
 * @param {{ sources?: () => Array<{ id: string, url?: string }>, now?: Date }} [o]
 */
export function stacItem(self, pathname, search, { sources = () => [], now = new Date() } = {}) {
  const ex = exportOf(pathname)
  if (!ex) return null
  const q = new URLSearchParams(search)
  // The caller's API keys stay out of the item (and of the addresses in it).
  for (const k of KEY_PARAMS) q.delete(k)
  for (const [from, to] of [["url", "terrainSource"], ["algorithm", "modes"], ["terrainSourceA", "terrainSource"]]) if (q.has(from) && !q.has(to)) { q.set(to, q.get(from)); q.delete(from) }
  const basemap = ex.endpoint === "basemap-tiles"
  const values = ex.ext.startsWith("tif") || (!basemap && q.has("encoding"))
  const [w, s, e, n] = footprint(ex, q, values).map(round)
  const modes = basemap ? ["basemap"] : (q.get("modes") ?? "").split(",").map((x) => x.trim()).filter(Boolean)
  const asked = modes.length ? modes : DEFAULT_MODES
  const source = q.get("terrainSource") ?? DEFAULT_SOURCE
  const inputs = Object.fromEntries([...q].filter(([k]) => !["modes", "bbox", "lat", "lng", "zoom", "width", "height", "tilesize", "compression", "f"].includes(k)))
  const when = now.toISOString().replace(/\.\d+Z$/, "Z")
  const queryText = q.toString()
  const href = `${self}${pathname}${queryText ? "?" + queryText : ""}`

  // What it was made from: the source's tile template where /sources has
  // one, its catalog entry, or its address; for the imagery, its address
  // or the dated source.
  const from = []
  if (basemap) {
    if (q.get("imageryUrl")) from.push({ rel: "derived_from", href: q.get("imageryUrl"), title: "The imagery" })
    if (q.get("imagerySource")) from.push({ rel: "derived_from", href: `${self}/processes/basemap`, title: `Dated imagery ${q.get("imagerySource")}${q.get("imageryDate") ? " of " + q.get("imageryDate") : ""}` })
    if (!from.length) from.push({ rel: "derived_from", href: `${self}/processes/basemap`, title: "The app's basemap" })
  } else if (isUrl(source)) {
    from.push({ rel: "derived_from", href: source, title: "The elevation source" })
  } else if (source.trim().startsWith("{")) {
    let url = null
    try { url = JSON.parse(source).url } catch {}
    from.push({ rel: "derived_from", href: isUrl(url ?? "") ? url : `${self}/sources`, title: "The elevation source (a configuration)" })
  } else {
    const known = sources().find((x) => x.id === source)
    from.push({ rel: "derived_from", href: `${self}/sources/${encodeURIComponent(source)}`, type: "application/json", title: `Terrain source ${source}` })
    if (known?.url) from.push({ rel: "derived_from", href: known.url, title: `Terrain source ${source}: its tiles` })
  }

  const what = basemap
    ? `the imagery (${q.get("imagerySource") ? q.get("imagerySource") + (q.get("imageryDate") ? " of " + q.get("imageryDate") : "") : q.get("imageryUrl") ?? "the app's basemap"})`
    : `terrain source ${source}`
  const params = Object.entries(inputs).filter(([k]) => !["terrainSource", "imageryUrl", "imagerySource", "imageryDate"].includes(k))
  const lineage = `${values ? `The values of mode ${asked[0]} (before its colour ramp)` : `Mode${asked.length > 1 ? "s" : ""} ${asked.join(", ")}${asked.length > 1 ? " stacked in the map's order" : ""}`} computed from ${what} by the Terrain Viewer tile service (${ex.endpoint}, ${ex.ext}), in EPSG:3857${params.length ? ", with " + params.map(([k, v]) => `${k}=${v}`).join(", ") : ", with the app's defaults"}.`
  const type = values ? (ex.ext.startsWith("tif") ? "image/tiff; application=geotiff" : "image/png") : ex.ext === "png" ? "image/png" : "image/jpeg"
  const id = `tv-${ex.endpoint}-${asked.join("+")}-${ex.tile ? ex.tile.join("-") : [w, s, e, n].join("_")}`

  return {
    type: "Feature",
    stac_version: STAC_VERSION,
    stac_extensions: [PROCESSING_EXT],
    id,
    bbox: [w, s, e, n],
    geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    properties: {
      datetime: when,
      title: `${values ? "Values" : "Rendering"} of ${asked.join(", ")}`,
      "processing:lineage": lineage,
      "processing:software": { [SOFTWARE]: VERSION },
      ...(basemap ? {} : { "processing:level": "L3" }),
      "processing:datetime": when,
      "processing:expression": { format: "x-tv-process", expression: { process: basemap ? "basemap" : asked.join(","), processes: asked, endpoint: ex.endpoint, inputs: { terrainSource: basemap ? undefined : source, ...inputs } } },
    },
    links: [
      { rel: "self", href: `${self}${pathname}${STAC_SUFFIX}${queryText ? "?" + queryText : ""}`, type: "application/geo+json" },
      ...from,
      ...asked.map((m) => ({ rel: "related", href: `${self}/processes/${encodeURIComponent(m)}`, type: "application/json", title: `Process ${m}` })),
    ],
    assets: {
      data: { href, type, title: values ? "Values, Float32" : "Rendering", roles: [values ? "data" : "visual"] },
    },
  }
}
