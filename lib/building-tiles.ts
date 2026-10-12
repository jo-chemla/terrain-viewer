// OpenFreeMap's z14 building tiles, fetched and decoded by hand for the
// building shadow layer (components/LayersAndSources/BuildingShadowLayer.tsx).
//
// MapLibre loads only the tiles under the viewport and, past the planet
// set's maxzoom (14), slices the z14 data into one clipped piece per
// overzoomed tile, so querySourceFeatures sees a building only once a
// tile over it is on screen: a tower standing one tile past the edge,
// towards the sun, cast no shadow, and a building straddling the edge of
// the loaded set cast the shadow of its loaded half, ending on the swept
// cut line. Fetching the z14 tiles over the viewport plus the longest
// possible shadow sidesteps both. z14 is the planet set's maxzoom, so it
// holds every building whole (clipped only at z14 tile lines plus a 64/4096
// buffer, see BUILDING_TILE_BUFFER); a tile decodes to its buildings'
// footprints in absolute Web Mercator units with their render_height.
import Pbf from "pbf"
import { VectorTile } from "@mapbox/vector-tile"

/** The planet set's maxzoom: the tiles hold every building whole. */
export const BUILDING_TILE_ZOOM = 14
/** The clip buffer of these tiles, as a fraction of a tile (coordinates span -64..4160 of 4096). */
export const BUILDING_TILE_BUFFER = 64 / 4096
/** OpenFreeMap's TileJSON: a versioned tile URL behind a stable name. */
export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet"
const CACHE_SIZE = 200

export type BuildingPolygon = {
  /** Outer ring first, then holes; each ring closed, in absolute Web Mercator units (0..1). */
  rings: [number, number][][]
  /** OpenMapTiles render_height, metres. */
  height: number
}

export const tileKey = (x: number, y: number) => `${BUILDING_TILE_ZOOM}/${x}/${y}`

// Decoded tiles, most recently used last; the oldest goes past CACHE_SIZE.
const cache = new Map<string, BuildingPolygon[]>()
// A fetch in flight, with the layers waiting for it (split views each run
// their own shadow layer): it is aborted once none wants it.
const inflight = new Map<string, { controller: AbortController; promise: Promise<BuildingPolygon[] | null>; owners: Set<object> }>()
let tileUrl: Promise<string> | null = null

/** The decoded tile if it is cached (and marks it recently used). */
export function cachedBuildingTile(x: number, y: number): BuildingPolygon[] | undefined {
  const key = tileKey(x, y), tile = cache.get(key)
  if (tile) { cache.delete(key); cache.set(key, tile) }
  return tile
}

/**
 * Fetches and decodes a tile for `owner` (one request per tile at a time;
 * the result goes into the cache). Resolves null when the fetch was aborted
 * or failed, so a later request tries again.
 */
export function requestBuildingTile(x: number, y: number, owner: object): Promise<BuildingPolygon[] | null> {
  const key = tileKey(x, y)
  const cached = cachedBuildingTile(x, y)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) { pending.owners.add(owner); return pending.promise }
  const controller = new AbortController()
  const promise = (async () => {
    try {
      const template = await (tileUrl ??= fetch(OPENFREEMAP_TILEJSON).then(async (r) => {
        if (!r.ok) throw new Error(`TileJSON ${r.status}`)
        const url = (await r.json())?.tiles?.[0]
        if (typeof url !== "string") throw new Error("TileJSON without tiles")
        return url
      }).catch((e) => { tileUrl = null; throw e }))
      const url = template.replace("{z}", String(BUILDING_TILE_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y))
      const res = await fetch(url, { signal: controller.signal })
      // Outside the data (an empty tile) OpenFreeMap answers 204 or 404: no buildings.
      const buildings = res.ok && res.status !== 204 ? decodeTile(await res.arrayBuffer(), x, y) : res.status === 404 || res.status === 204 ? [] : null
      if (buildings) {
        cache.set(key, buildings)
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      }
      return buildings
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

// Signed area in tile units, y down: positive for an outer ring (MVT winding).
function signedArea(ring: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[i].y + ring[j].y)
  return a / 2
}

function decodeTile(buf: ArrayBuffer, x: number, y: number): BuildingPolygon[] {
  const out: BuildingPolygon[] = []
  const layer = new VectorTile(new Pbf(new Uint8Array(buf))).layers.building
  if (!layer) return out
  const n = 2 ** BUILDING_TILE_ZOOM
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    if (f.type !== 3) continue
    const height = Number(f.properties?.render_height ?? 0)
    if (!(height > 0)) continue
    const extent = f.extent || layer.extent || 4096
    const toMercator = (ring: { x: number; y: number }[]) => ring.map((p) => [(x + p.x / extent) / n, (y + p.y / extent) / n] as [number, number])
    // Outer rings have positive area; the holes that follow one belong to it.
    let polygon: [number, number][][] | null = null
    for (const ring of f.loadGeometry()) {
      if (ring.length < 4) continue
      const area = signedArea(ring)
      if (area === 0) continue
      if (area > 0) { if (polygon) out.push({ rings: polygon, height }); polygon = [toMercator(ring)] }
      else polygon?.push(toMercator(ring))
    }
    if (polygon) out.push({ rings: polygon, height })
  }
  return out
}
