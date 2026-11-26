// Building footprints with heights, read from a vector source by hand for
// the building shadow layer (components/LayersAndSources/BuildingShadowLayer.tsx):
// any VectorSourceEntry with a `heightField` (lib/source-schema.ts), which is
// OpenFreeMap's OSM tiles (the default, a TileJSON), Overture's buildings (a
// PMTiles archive whose address changes each month) or a source the user
// added (PMTiles, TileJSON, MVT template).
//
// Why by hand and not from the map: MapLibre loads only the tiles under the
// viewport and, past a source's maxzoom, slices its data into one clipped
// piece per overzoomed tile, so querySourceFeatures sees a building only
// once a tile over it is on screen: a tower standing one tile past the
// edge, towards the sun, cast no shadow, and a building straddling the edge
// of the loaded set cast the shadow of its loaded half, ending on the swept
// cut line. Fetching the tiles over the viewport plus the longest possible
// shadow sidesteps both. The tiles are read at the source's maxzoom (14 for
// both built-in sources, never deeper than 14), where they hold every
// building whole, clipped only at tile lines plus a buffer.
//
// A tile decodes to typed arrays (kernel performance rules: no object per
// vertex, no array per ring): footprints in absolute Web Mercator units,
// a height and a base per polygon. The height is the entry's height rule
// (featureHeight in lib/vector-sources.ts, the twin of the 3D overlay's
// heightExpression): the height field, else floors times 3.2 m, else 4 m.
// A building marked as having parts (Overture's has_parts) is replaced by
// its parts, as the 3D overlay does.
//
//   node scripts/test-lib.mjs lib/building-tiles.test.ts   (offline)
import Pbf from "pbf"
import { VectorTile } from "@mapbox/vector-tile"
import type { VectorSourceEntry } from "./source-schema"
import { DEFAULT_HEIGHT_M, featureHeight, findVectorSource, propertyNumber, resolveVectorUrl } from "./vector-sources"
import { pmtilesReader } from "./pmtiles-readers"

/** The deepest zoom tiles are read at (and the zoom of both built-in sources). */
export const BUILDING_TILE_ZOOM = 14
/** OpenFreeMap's clip buffer, as a fraction of a tile (the tile service's sweep). */
export const BUILDING_TILE_BUFFER = 64 / 4096
/** The source the shadows read when a link names none: OpenFreeMap's OSM tiles. */
export const DEFAULT_BUILDING_SOURCE_ID = "osm-buildings-openfreemap"
const CACHE_TILES = 200
// Decoded tiles kept, in bytes: an Overture tile of a dense city decodes to
// several megabytes, 200 of them would not fit.
const CACHE_BYTES = 256 * 1024 * 1024

/** The vector sources the shadows can read: tiles with a height field. */
export function isBuildingSource(entry: VectorSourceEntry | undefined): entry is VectorSourceEntry {
  return !!entry && !!entry.heightField && entry.type !== "style" && !!entry.sourceLayers?.length
}

/** The entry of a shadow source id, else the default (an id that is gone,
 *  or names a source without heights, still draws shadows). */
export function buildingSourceEntry(id: string | null | undefined, customs: readonly VectorSourceEntry[] = []): VectorSourceEntry {
  const entry = findVectorSource(id, customs)
  return isBuildingSource(entry) ? entry : findVectorSource(DEFAULT_BUILDING_SOURCE_ID)!
}

/** One decoded tile. Polygon p owns rings polyStart[p]..polyStart[p+1] (the
 *  outer ring first, then its holes); ring r owns vertices
 *  ringStart[r]..ringStart[r+1], closed (the last repeats the first). */
export interface BuildingTile {
  /** Polygons. */
  count: number
  /** x, y per vertex, absolute Web Mercator units (0..1). Float64: a street
   *  is beyond float32 there. */
  coords: Float64Array
  /** Per vertex: 1 when the edge from the ring's previous vertex to this one
   *  is a cut along the tile's clip line, not a wall. */
  cut: Uint8Array
  ringStart: Uint32Array
  polyStart: Uint32Array
  /** Metres, per polygon: the top and the base (0 on the ground). */
  height: Float32Array
  base: Float32Array
  /** Per polygon: 1 when it reaches the tile's edge or buffer, so a
   *  neighbouring tile may hold it again (whole, or its other half). */
  edge: Uint8Array
  /** Features of the building layers, and how many state a height, or only
   *  floors (the rest take the default height). */
  buildings: number
  stated: number
  floors: number
  bytes: number
  /** Milliseconds: the request and the decoding. */
  fetchMs: number
  decodeMs: number
}

// ── Decoding ────────────────────────────────────────────────────────────────

// Scratch refilled tile after tile (decoding is synchronous), doubled when full.
let sXY = new Float64Array(1 << 17)
let sCut = new Uint8Array(1 << 16)
let sRing = new Uint32Array(1 << 13)
let sPoly = new Uint32Array(1 << 12)
let sHeight = new Float32Array(1 << 12)
let sBase = new Float32Array(1 << 12)
let sEdge = new Uint8Array(1 << 12)

function grown<T extends Float64Array | Float32Array | Uint32Array | Uint8Array>(a: T, used: number, need: number): T {
  if (need <= a.length) return a
  const next = new (a.constructor as new (n: number) => T)(Math.max(a.length * 2, need))
  next.set(a.subarray(0, used) as never)
  return next
}

type RawFeature = { type: number; properties: Record<string, unknown>; _pbf?: Pbf; _geometry?: number; loadGeometry(): { x: number; y: number }[][] }

/**
 * Decodes a vector tile to the buildings of `entry`: its `sourceLayers`
 * (minus the buildings `hasPartsField` marks, when the entry has part
 * layers) and its `partLayers`. `fallback` is the height of a feature that
 * states neither a height nor floors (0 leaves it out).
 */
export function decodeBuildingTile(buf: ArrayBuffer | Uint8Array, x: number, y: number, z: number, entry: VectorSourceEntry, fallback: number = DEFAULT_HEIGHT_M): BuildingTile {
  const t0 = performance.now()
  const tile = new VectorTile(new Pbf(buf instanceof Uint8Array ? buf : new Uint8Array(buf)))
  const n = 2 ** z
  const heightField = entry.heightField, floorsField = entry.floorsField, minHeightField = entry.minHeightField
  const partLayers = entry.partLayers ?? []
  const hasPartsField = partLayers.length ? entry.hasPartsField : undefined
  let vn = 0, rn = 0, pn = 0
  let buildings = 0, stated = 0, floors = 0

  const names = [...(entry.sourceLayers ?? []), ...partLayers]
  for (let li = 0; li < names.length; li++) {
    const layer = tile.layers[names[li]]
    if (!layer) continue
    const isPart = li >= (entry.sourceLayers?.length ?? 0)
    const extent = layer.extent || 4096
    const v0 = vn, r0 = rn, p0 = pn
    // The layer's bounds in tile units: a cut runs along the lowest or the
    // highest coordinate past the tile's edge (the clip buffer, which
    // differs from one tile set to the next: 64/4096 at OpenFreeMap).
    let minX = 0, minY = 0, maxX = extent, maxY = extent
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i) as unknown as RawFeature
      if (f.type !== 3) continue
      const props = f.properties
      if (!isPart) {
        buildings++
        if (heightField && propertyNumber(props[heightField]) > 0) stated++
        else if (floorsField && propertyNumber(props[floorsField]) > 0) floors++
        // Replaced by its parts, which the part layers hold.
        if (hasPartsField && props[hasPartsField] === true) continue
      }
      const height = featureHeight(entry, props, fallback)
      const base = minHeightField ? Math.max(0, propertyNumber(props[minHeightField])) : 0
      if (!(height > 0) || base >= height) continue

      // The geometry commands read straight into the scratch (what
      // loadGeometry does, without a Point per vertex and an array per
      // ring). Raw tile units for now; made absolute once the layer is read.
      let open = false      // a polygon of this feature is being filled
      let ringFirst = vn    // first vertex of the ring being read
      let inRing = false
      const pbf = f._pbf, geometry = f._geometry
      if (pbf && typeof geometry === "number" && geometry >= 0) {
        pbf.pos = geometry
        const end = pbf.readVarint() + pbf.pos
        let cmd = 1, length = 0, px = 0, py = 0
        while (pbf.pos < end) {
          if (length <= 0) {
            const cmdLen = pbf.readVarint()
            cmd = cmdLen & 0x7
            length = cmdLen >> 3
          }
          length--
          if (cmd === 1 || cmd === 2) {
            px += pbf.readSVarint()
            py += pbf.readSVarint()
            if (cmd === 1) {
              if (inRing) {
                const kind = closeRing(ringFirst, vn, open)
                if (kind === 0) vn = ringFirst
                else { if (kind === 1) { if (open) pn++; startPolygon(pn, rn, height, base); open = true } sRing = grown(sRing, rn, rn + 2); sRing[rn++] = ringFirst }
              }
              ringFirst = vn
              inRing = true
            }
            if (inRing) {
              sXY = grown(sXY, vn * 2, vn * 2 + 2)
              sXY[vn * 2] = px; sXY[vn * 2 + 1] = py
              vn++
            }
          } else if (cmd === 7) {
            if (inRing && vn > ringFirst) {
              sXY = grown(sXY, vn * 2, vn * 2 + 2)
              sXY[vn * 2] = sXY[ringFirst * 2]; sXY[vn * 2 + 1] = sXY[ringFirst * 2 + 1]
              vn++
            }
          } else throw new Error(`unknown command ${cmd}`)
        }
      } else {
        // A decoder without the private fields: its own geometry, slower.
        for (const ring of f.loadGeometry()) {
          if (inRing) {
            const kind = closeRing(ringFirst, vn, open)
            if (kind === 0) vn = ringFirst
            else { if (kind === 1) { if (open) pn++; startPolygon(pn, rn, height, base); open = true } sRing = grown(sRing, rn, rn + 2); sRing[rn++] = ringFirst }
          }
          ringFirst = vn
          inRing = true
          sXY = grown(sXY, vn * 2, (vn + ring.length) * 2)
          for (let k = 0; k < ring.length; k++) { sXY[vn * 2] = ring[k].x; sXY[vn * 2 + 1] = ring[k].y; vn++ }
        }
      }
      if (inRing) {
        const kind = closeRing(ringFirst, vn, open)
        if (kind === 0) vn = ringFirst
        else { if (kind === 1) { if (open) pn++; startPolygon(pn, rn, height, base); open = true } sRing = grown(sRing, rn, rn + 2); sRing[rn++] = ringFirst }
      }
      if (open) pn++
    }
    for (let k = v0 * 2; k < vn * 2; k += 2) {
      const vx = sXY[k], vy = sXY[k + 1]
      if (vx < minX) minX = vx; else if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy; else if (vy > maxY) maxY = vy
    }
    // Absolute coordinates, the cut flag of each edge, the edge flag of each
    // polygon. sPoly[p0..pn) hold first rings, sRing[r0..rn) first vertices.
    sCut = grown(sCut, v0, vn)
    for (let p = p0; p < pn; p++) {
      const rEnd = p + 1 < pn ? sPoly[p + 1] : rn
      let reaches = 0
      for (let r = sPoly[p]; r < rEnd; r++) {
        const vEnd = r + 1 < rn ? sRing[r + 1] : vn
        let ax = 0, ay = 0
        for (let v = sRing[r]; v < vEnd; v++) {
          const bx = sXY[v * 2], by = sXY[v * 2 + 1]
          if (bx <= 0 || by <= 0 || bx >= extent || by >= extent) reaches = 1
          sCut[v] = v > sRing[r] && (
            (ax === bx && (bx === 0 || bx === extent || (bx < 0 && bx === minX) || (bx > extent && bx === maxX))) ||
            (ay === by && (by === 0 || by === extent || (by < 0 && by === minY) || (by > extent && by === maxY)))) ? 1 : 0
          ax = bx; ay = by
          sXY[v * 2] = (x + bx / extent) / n
          sXY[v * 2 + 1] = (y + by / extent) / n
        }
      }
      sEdge[p] = reaches
    }
  }

  const out: BuildingTile = {
    count: pn,
    coords: sXY.slice(0, vn * 2),
    cut: sCut.slice(0, vn),
    ringStart: new Uint32Array(rn + 1),
    polyStart: new Uint32Array(pn + 1),
    height: sHeight.slice(0, pn),
    base: sBase.slice(0, pn),
    edge: sEdge.slice(0, pn),
    buildings, stated, floors,
    bytes: 0, fetchMs: 0, decodeMs: 0,
  }
  out.ringStart.set(sRing.subarray(0, rn)); out.ringStart[rn] = vn
  out.polyStart.set(sPoly.subarray(0, pn)); out.polyStart[pn] = rn
  out.bytes = out.coords.byteLength + out.cut.byteLength + out.ringStart.byteLength + out.polyStart.byteLength + out.height.byteLength + out.base.byteLength + out.edge.byteLength
  out.decodeMs = performance.now() - t0
  return out
}

/** What the ring just read is: 0 to drop (under four vertices, no area, a
 *  hole with no polygon open), 1 an outer ring, 2 a hole. Signed area in
 *  tile units, y down: positive for an outer ring (MVT winding). */
function closeRing(first: number, end: number, open: boolean): 0 | 1 | 2 {
  if (end - first < 4) return 0
  let a = 0
  for (let i = first, j = end - 1; i < end; j = i++) a += (sXY[j * 2] - sXY[i * 2]) * (sXY[i * 2 + 1] + sXY[j * 2 + 1])
  if (a === 0) return 0
  if (a > 0) return 1
  return open ? 2 : 0
}

function startPolygon(p: number, ring: number, height: number, base: number): void {
  sPoly = grown(sPoly, p, p + 1); sHeight = grown(sHeight, p, p + 1); sBase = grown(sBase, p, p + 1); sEdge = grown(sEdge, p, p + 1)
  sPoly[p] = ring; sHeight[p] = height; sBase[p] = base
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** An opened source: where its tiles are and the zoom they are read at. */
export interface BuildingSource {
  /** The cache key: the entry's id and resolved address. */
  key: string
  entry: VectorSourceEntry
  zoom: number
  /** A tile's bytes, null where the source has none (no buildings there). Throws on a failed request. */
  fetchTile(x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer | Uint8Array | null>
}

const sources = new Map<string, Promise<BuildingSource>>()

const tileZoom = (maxzoom: unknown): number => {
  const m = Number(maxzoom)
  return Number.isFinite(m) && m >= 0 ? Math.min(BUILDING_TILE_ZOOM, Math.floor(m)) : BUILDING_TILE_ZOOM
}

function templateFetcher(template: string, zoom: number): BuildingSource["fetchTile"] {
  return async (x, y, signal) => {
    const res = await fetch(template.replace("{z}", String(zoom)).replace("{x}", String(x)).replace("{y}", String(y)), { signal })
    // Outside the data (an empty tile) a tile server answers 204 or 404: no buildings.
    if (res.status === 204 || res.status === 404) return null
    if (!res.ok) throw new Error(`tile ${res.status}`)
    return res.arrayBuffer()
  }
}

async function open(entry: VectorSourceEntry, key: string): Promise<BuildingSource> {
  const url = await resolveVectorUrl(entry)
  if (!url) throw new Error(`${entry.id}: no address`)
  if (entry.type === "pmtiles") {
    // One reader per archive, shared with the map's pmtiles:// protocol: the
    // header and directories are read once, then one range request a tile.
    const reader = pmtilesReader(url)
    const zoom = tileZoom(entry.maxzoom ?? (await reader.getHeader()).maxZoom)
    return { key, entry, zoom, fetchTile: async (x, y, signal) => (await reader.getZxy(zoom, x, y, signal))?.data ?? null }
  }
  if (entry.type === "tilejson") {
    // A versioned tile address behind a stable name.
    const res = await fetch(url)
    if (!res.ok) throw new Error(`TileJSON ${res.status}`)
    const json = await res.json() as { tiles?: unknown[]; maxzoom?: unknown }
    const template = json?.tiles?.[0]
    if (typeof template !== "string") throw new Error("TileJSON without tiles")
    const zoom = tileZoom(json.maxzoom ?? entry.maxzoom)
    return { key, entry, zoom, fetchTile: templateFetcher(new URL(template, url).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}"), zoom) }
  }
  if (entry.type === "mvt") {
    const zoom = tileZoom(entry.maxzoom)
    return { key, entry, zoom, fetchTile: templateFetcher(url, zoom) }
  }
  throw new Error(`${entry.id}: a ${entry.type} source has no tiles to read`)
}

/** Opens a source once (its TileJSON, its archive, its release); a failure
 *  is forgotten, so the next call asks again. */
export function openBuildingSource(entry: VectorSourceEntry): Promise<BuildingSource> {
  const key = `${entry.id}|${entry.url}`
  let source = sources.get(key)
  if (!source) {
    source = open(entry, key).catch((e) => { sources.delete(key); throw e })
    sources.set(key, source)
  }
  return source
}

// ── Tiles: cache, shared requests, aborts ───────────────────────────────────

export const tileKey = (source: BuildingSource, x: number, y: number) => `${source.key}|${source.zoom}/${x}/${y}`

// Decoded tiles, most recently used last; the oldest go past the limits.
const cache = new Map<string, BuildingTile>()
let cacheBytes = 0
// A fetch in flight, with the layers waiting for it (split views each run
// their own shadow layer): it is aborted once none wants it.
const inflight = new Map<string, { controller: AbortController; promise: Promise<BuildingTile | null>; owners: Set<object> }>()

/** The decoded tile if it is cached (and marks it recently used). */
export function cachedBuildingTile(source: BuildingSource, x: number, y: number): BuildingTile | undefined {
  const key = tileKey(source, x, y), tile = cache.get(key)
  if (tile) { cache.delete(key); cache.set(key, tile) }
  return tile
}

function store(key: string, tile: BuildingTile): void {
  cache.set(key, tile)
  cacheBytes += tile.bytes
  while (cache.size > 1 && (cache.size > CACHE_TILES || cacheBytes > CACHE_BYTES)) {
    const oldest = cache.keys().next().value!
    cacheBytes -= cache.get(oldest)!.bytes
    cache.delete(oldest)
  }
}

/**
 * Fetches and decodes a tile for `owner` (one request per tile at a time;
 * the result goes into the cache). Resolves null when the fetch was aborted
 * or failed, so a later request tries again.
 */
export function requestBuildingTile(source: BuildingSource, x: number, y: number, owner: object): Promise<BuildingTile | null> {
  const key = tileKey(source, x, y)
  const cached = cachedBuildingTile(source, x, y)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) { pending.owners.add(owner); return pending.promise }
  const controller = new AbortController()
  const promise = (async () => {
    try {
      const t0 = performance.now()
      const bytes = await source.fetchTile(x, y, controller.signal)
      const fetchMs = performance.now() - t0
      const tile = decodeBuildingTile(bytes ?? new Uint8Array(0), x, y, source.zoom, source.entry)
      tile.fetchMs = fetchMs
      store(key, tile)
      return tile
    } catch (e) {
      if (!controller.signal.aborted) console.warn(`[building-tiles] ${key}:`, e)
      return null
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, { controller, promise, owners: new Set([owner]) })
  return promise
}

/** `owner` no longer wants the fetches in flight outside `keep`: those nobody else wants are aborted. */
export function abortBuildingTilesExcept(owner: object, keep: Set<string>): void {
  for (const [key, entry] of inflight) {
    if (keep.has(key)) continue
    entry.owners.delete(owner)
    if (!entry.owners.size) entry.controller.abort()
  }
}

/** For tests: forget the opened sources and the decoded tiles. */
export function resetBuildingTiles(): void {
  sources.clear(); cache.clear(); cacheBytes = 0
  for (const entry of inflight.values()) entry.controller.abort()
  inflight.clear()
}

// ── The tile service's form ─────────────────────────────────────────────────

/** A building as the tile service's SVG sweep takes it (tile-server/direct.mjs). */
export type BuildingPolygon = {
  /** Outer ring first, then holes; each ring closed, in absolute Web Mercator units (0..1). */
  rings: [number, number][][]
  /** Metres. */
  height: number
}

/** A decoded tile as a list of polygons. */
export function buildingPolygons(tile: BuildingTile): BuildingPolygon[] {
  const out: BuildingPolygon[] = []
  for (let p = 0; p < tile.count; p++) {
    const rings: [number, number][][] = []
    for (let r = tile.polyStart[p]; r < tile.polyStart[p + 1]; r++) {
      const ring: [number, number][] = []
      for (let v = tile.ringStart[r]; v < tile.ringStart[r + 1]; v++) ring.push([tile.coords[v * 2], tile.coords[v * 2 + 1]])
      rings.push(ring)
    }
    out.push({ rings, height: tile.height[p] })
  }
  return out
}

const polygonLists = new WeakMap<BuildingTile, BuildingPolygon[]>()

/** OpenFreeMap's z14 tile as polygons, for the tile service (null when the
 *  request failed). */
export async function requestOsmBuildingPolygons(x: number, y: number, owner: object): Promise<BuildingPolygon[] | null> {
  try {
    const tile = await requestBuildingTile(await openBuildingSource(buildingSourceEntry(DEFAULT_BUILDING_SOURCE_ID)), x, y, owner)
    if (!tile) return null
    let list = polygonLists.get(tile)
    if (!list) { list = buildingPolygons(tile); polygonLists.set(tile, list) }
    return list
  } catch (e) {
    console.warn("[building-tiles]", e)
    return null
  }
}
