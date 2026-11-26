// Where the building shadows take their footprints and heights from
// (direct.mjs buildingShadowSvg): the app's `buildingShadowSource`, read here
// as the app reads it and a little wider, since a tile address has no user
// list to look an id up in.
//
//   buildingShadowSource=<id>          a vector source of the Library that has heights
//                                      (GET /building-sources lists them; unset: OpenFreeMap's
//                                      OSM buildings; an id that is none of them: the default too,
//                                      as in the app)
//   buildingShadowSource=<https address>
//                                      a PMTiles archive (.pmtiles), an MVT template
//                                      ({z}/{x}/{y}) or a TileJSON (anything else), with
//     buildingShadowLayer=a,b            its polygon layers (unset: every layer a PMTiles
//                                        archive or a TileJSON lists; "building" for a template)
//     buildingShadowHeightField=height   the property holding metres (default "height")
//     buildingShadowFloorsField=levels   floors, for a feature with no height (x 3.2 m)
//     buildingShadowMinHeightField=...   the base of a raised part
//     buildingShadowType=pmtiles|tilejson|mvt   when the address does not say
//   buildingShadowSource={"url": ..., "type": ..., "sourceLayers": [...], "heightField": ...}
//                                      the same as one JSON value (a Library entry's fields)
//   buildingShadowSource=file:<id>     a GeoJSON file of this machine registered with
//                                      POST /files (files.mjs): polygons in longitude and
//                                      latitude, heights in buildingShadowHeightField
//                                      (default "height"). The QGIS plugin sends a vector
//                                      layer of the project this way.
//
// Tiles are read by the app's own reader (lib/building-tiles.ts): at the
// source's deepest zoom, 14 at most, a height per polygon (the field, else
// floors, else 4 m), a building marked as having parts replaced by its
// parts, the clip lines of a tile flagged so they are not swept as walls.
import { createHash } from "node:crypto"
import fs from "node:fs"
import { lookupFile, SOURCE_RE } from "./files.mjs"

const refuse = (message, status = 400) => Object.assign(new Error(message), { status })
const OWNER = {}
/** The z14 tiles one picture may ask for (a longer shadow is not drawn). */
const MAX_TILES = 64
const FILE_FIELDS = ["buildingShadowLayer", "buildingShadowHeightField", "buildingShadowFloorsField", "buildingShadowMinHeightField", "buildingShadowType"]
/** The service's own parameters of the building shadows (direct.mjs stateFor reads them from the query). */
export const BUILDING_PARAMS = FILE_FIELDS

const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean)
const field = (v) => { const t = String(v ?? "").trim(); return /^[\w .:@-]{1,80}$/.test(t) ? t : undefined }

function transportOf(url, given) {
  if (["pmtiles", "tilejson", "mvt"].includes(given)) return given
  if (given) throw refuse(`buildingShadowType "${String(given).slice(0, 20)}": pmtiles, tilejson or mvt`)
  const bare = url.split(/[?#]/)[0]
  if (/\.pmtiles$/i.test(bare)) return "pmtiles"
  return /\{z\}/.test(url) ? "mvt" : "tilejson"
}

/** The Library's vector sources the shadows can read, as /building-sources lists them. */
export function buildingSources(A) {
  return A.VECTOR_LIBRARY.filter(A.isBuildingSource).map((e) => ({
    id: e.id, name: e.name, ...(e.shortName ? { shortName: e.shortName } : {}), type: e.type, url: e.url,
    ...(e.resolver ? { resolver: e.resolver, fallbackRelease: e.fallbackRelease } : {}),
    sourceLayers: e.sourceLayers, ...(e.partLayers ? { partLayers: e.partLayers, hasPartsField: e.hasPartsField } : {}),
    heightField: e.heightField, ...(e.floorsField ? { floorsField: e.floorsField } : {}), ...(e.minHeightField ? { minHeightField: e.minHeightField } : {}),
    ...(e.minzoom != null ? { minzoom: e.minzoom } : {}), ...(e.maxzoom != null ? { maxzoom: e.maxzoom } : {}),
    ...(e.bounds ? { bounds: e.bounds } : {}), default: e.id === A.DEFAULT_BUILDING_SOURCE_ID,
    description: e.description ?? "", attribution: e.shortAttribution ?? e.attribution ?? "",
  }))
}

/** What `s.buildingShadowSource` (and its companions) names: `{ entry }`, a
 *  vector source entry of the app's schema, or `{ file, heightField, ... }`,
 *  a registered GeoJSON. Throws an error with `status` 400 for an address or
 *  a file it cannot take. */
export function describeBuildingSource(A, s) {
  let given = s.buildingShadowSource
  if (typeof given === "string") given = given.trim()
  const extra = {
    sourceLayers: list(s.buildingShadowLayer), heightField: field(s.buildingShadowHeightField), floorsField: field(s.buildingShadowFloorsField),
    minHeightField: field(s.buildingShadowMinHeightField), type: s.buildingShadowType || undefined,
  }
  const fileId = SOURCE_RE.exec(String(given ?? ""))?.[1]
  if (fileId) {
    const e = lookupFile(fileId)
    if (!e) throw refuse(`buildingShadowSource ${given}: not registered, or the file changed since (POST /files again)`, 404)
    if (e.type !== "geojson") throw refuse(`buildingShadowSource ${given}: ${e.name} is not a GeoJSON file`)
    return { file: fileId, path: e.files["0.geojson"].path, name: e.name, heightField: extra.heightField ?? "height", minHeightField: extra.minHeightField ?? "min_height", floorsField: extra.floorsField }
  }
  let config = null
  if (given && typeof given === "object") config = given
  else if (typeof given === "string" && given.startsWith("{")) { try { config = JSON.parse(given) } catch { throw refuse("buildingShadowSource is not valid JSON") } }
  else if (typeof given === "string" && /^[a-z][a-z0-9+.-]*:/i.test(given)) config = { url: given }
  if (!config) return { entry: A.buildingSourceEntry(given || A.DEFAULT_BUILDING_SOURCE_ID) }
  const url = String(config.url ?? "").replace(/^pmtiles:\/\//, "")
  if (!/^https:\/\//i.test(url)) throw refuse("buildingShadowSource: an id of /building-sources, file:<id>, or an https address (a .pmtiles archive, a {z}/{x}/{y} template, a TileJSON)")
  const type = transportOf(url, config.type ?? extra.type)
  const layers = list(config.sourceLayers ?? config.layer ?? config.layers)
  const entry = {
    kind: "vector", section: "custom", name: "Custom buildings", type, url,
    sourceLayers: layers.length ? layers : extra.sourceLayers,
    partLayers: list(config.partLayers), hasPartsField: field(config.hasPartsField),
    heightField: field(config.heightField) ?? extra.heightField ?? "height",
    floorsField: field(config.floorsField) ?? extra.floorsField,
    minHeightField: field(config.minHeightField) ?? extra.minHeightField,
    ...(Number.isFinite(Number(config.maxzoom)) && config.maxzoom !== null && config.maxzoom !== "" ? { maxzoom: Number(config.maxzoom) } : {}),
  }
  if (!entry.partLayers.length) { delete entry.partLayers; delete entry.hasPartsField }
  // The reader keys its opened sources and its decoded tiles by id and
  // address: the layers and fields are part of what a tile decodes to.
  entry.id = "custom-" + createHash("sha1").update(JSON.stringify(entry)).digest("hex").slice(0, 16)
  return { entry }
}

/** The layers of a custom source that names none: every layer its PMTiles
 *  metadata or its TileJSON lists (only polygons are read), "building" for
 *  a bare template. Asked once per address. */
const listedLayers = new Map()
async function layersOf(A, entry) {
  if (entry.sourceLayers?.length) return entry.sourceLayers
  const key = `${entry.type}|${entry.url}`
  if (!listedLayers.has(key)) {
    listedLayers.set(key, (async () => {
      try {
        const meta = entry.type === "pmtiles" ? await A.pmtilesReader(entry.url).getMetadata()
          : entry.type === "tilejson" ? await (await fetch(entry.url)).json() : null
        const ids = (meta?.vector_layers ?? []).map((l) => l?.id).filter((id) => typeof id === "string")
        return ids.length ? ids : ["building"]
      } catch { return ["building"] }
    })().catch(() => ["building"]))
    if (listedLayers.size > 50) listedLayers.delete(listedLayers.keys().next().value)
  }
  return listedLayers.get(key)
}

// ── Tiles as polygons ───────────────────────────────────────────────────────

const polygonLists = new WeakMap()
/** A decoded tile (lib/building-tiles.ts BuildingTile) as the sweep takes
 *  it: `{ rings, cuts, height, base, box }` per polygon; `cuts[r][v]` is 1
 *  when the edge ending at vertex v runs along the tile's clip line. */
function polygonsOf(tile) {
  let out = polygonLists.get(tile)
  if (out) return out
  out = []
  for (let p = 0; p < tile.count; p++) {
    const rings = [], cuts = []
    for (let r = tile.polyStart[p]; r < tile.polyStart[p + 1]; r++) {
      const ring = []
      for (let v = tile.ringStart[r]; v < tile.ringStart[r + 1]; v++) ring.push([tile.coords[v * 2], tile.coords[v * 2 + 1]])
      rings.push(ring)
      cuts.push(tile.cut.subarray(tile.ringStart[r], tile.ringStart[r + 1]))
    }
    out.push({ rings, cuts, height: tile.height[p], base: tile.base[p] })
  }
  polygonLists.set(tile, out)
  return out
}

// ── A registered GeoJSON ────────────────────────────────────────────────────

const files = new Map()
const MAX_FILES = 4
const mercX = (lng) => (lng + 180) / 360
const mercY = (lat) => { const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
const num = (v) => { const n = typeof v === "number" ? v : v === null || v === undefined || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : NaN }

/** The polygons of a registered GeoJSON, parsed once per file (and per
 *  height field): rings in Web Mercator units, outer rings wound as a
 *  vector tile's (positive area, y down), holes the other way. */
function filePolygons(src) {
  const key = `${src.file}|${src.heightField}|${src.floorsField ?? ""}|${src.minHeightField}`
  let out = files.get(key)
  if (out) { files.delete(key); files.set(key, out); return out }
  let json
  try { json = JSON.parse(fs.readFileSync(src.path, "utf8")) } catch (e) { throw refuse(`${src.name}: not read as GeoJSON (${e.message})`, 422) }
  const features = json?.type === "FeatureCollection" ? json.features ?? [] : json?.type === "Feature" ? [json] : []
  out = []
  const area = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1]); return a }
  for (const f of features) {
    const g = f?.geometry, props = f?.properties ?? {}
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : null
    if (!polys) continue
    let height = num(props[src.heightField])
    if (!(height > 0) && src.floorsField) { const floors = num(props[src.floorsField]); if (floors > 0) height = floors * 3.2 }
    if (!(height > 0)) continue
    const base = Math.max(0, num(props[src.minHeightField]) || 0)
    if (base >= height) continue
    for (const poly of polys) {
      const rings = []
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let r = 0; r < (poly?.length ?? 0); r++) {
        const ring = []
        for (const c of poly[r] ?? []) { const x = mercX(Number(c[0])), y = mercY(Number(c[1])); if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]) }
        if (ring.length < 3) { if (r === 0) break; continue }
        const a = ring[0], b = ring[ring.length - 1]
        if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]])
        const outer = area(ring) > 0
        if (outer !== (r === 0)) ring.reverse()
        if (r === 0) for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
        rings.push(ring)
      }
      if (rings.length) out.push({ rings, height, base, box: [x0, y0, x1, y1] })
    }
  }
  files.set(key, out)
  while (files.size > MAX_FILES) files.delete(files.keys().next().value)
  return out
}

// ── What the sweep asks ─────────────────────────────────────────────────────

/**
 * The buildings that can shade a rectangle: `source.polygons(x0, y0, x1, y1)`
 * (Web Mercator units, 0..1, the rectangle already widened by the longest
 * shadow) answers the polygons to sweep, or null when the rectangle is too
 * wide to read (more than 64 tiles). `cuts` is absent for a GeoJSON file:
 * its polygons are whole.
 */
export async function openBuildings(A, s) {
  const what = describeBuildingSource(A, s)
  if (what.file) {
    const all = filePolygons(what)
    return { id: `file:${what.file}`, polygons: async (x0, y0, x1, y1) => all.filter((p) => p.box[2] >= x0 && p.box[0] <= x1 && p.box[3] >= y0 && p.box[1] <= y1) }
  }
  const entry = { ...what.entry, sourceLayers: await layersOf(A, what.entry) }
  const source = await A.openBuildingSource(entry)
  const n = 2 ** source.zoom
  const clamp = (v) => Math.min(n - 1, Math.max(0, v))
  return {
    id: entry.id, zoom: source.zoom,
    polygons: async (x0, y0, x1, y1) => {
      const tx0 = clamp(Math.floor(x0 * n)), tx1 = clamp(Math.floor(x1 * n)), ty0 = clamp(Math.floor(y0 * n)), ty1 = clamp(Math.floor(y1 * n))
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES) return null
      const jobs = []
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(A.requestBuildingSourceTile(source, tx, ty, OWNER))
      return (await Promise.all(jobs)).filter(Boolean).flatMap(polygonsOf)
    },
  }
}
