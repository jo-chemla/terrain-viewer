// The one way a Planet monthly tile reaches the app, on the map (planettile://)
// and in the export: every one is looked up in a local cache first, every one
// that goes to Planet is counted, and past a limit none goes until the user
// allows more. A mosaic never changes once published, so a cached tile is good
// for as long as the browser keeps it, and costs no quota.
//
//   planettile://global_monthly_2024_06_mosaic/{z}/{x}/{y}
//
// The key is read here, so it is in no tile URL, map style or cache entry.
import { useSyncExternalStore } from "react"
import { getDefaultStore } from "jotai"
import { planetKeyAtom } from "./settings-atoms"

const CACHE_NAME = "planet-tiles-v1"
/** About 100 KB a tile, so some 300 MB at most. Oldest out first. */
const MAX_CACHED_TILES = 3000
const TRIM_EVERY_PUTS = 100

/** Tiles from Planet this session past which the counter turns yellow, then red. */
export const PLANET_TILES_WARN = 100
export const PLANET_TILES_HIGH = 200
/** And past which nothing more is fetched until the user allows it. */
const PLANET_TILES_STEP = 500

const USAGE_KEY = "planetTileUsage"
export interface PlanetTileUsage { fetched: number; cached: number; limit: number }
let usage: PlanetTileUsage = (() => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(USAGE_KEY) ?? "null")
    if (typeof stored?.fetched === "number") return stored
  } catch { /* unavailable: starts at zero */ }
  return { fetched: 0, cached: 0, limit: PLANET_TILES_STEP }
})()
const listeners = new Set<() => void>()
function setUsage(next: PlanetTileUsage) {
  usage = next
  try { sessionStorage.setItem(USAGE_KEY, JSON.stringify(usage)) } catch { /* the count stays in memory */ }
  for (const listener of listeners) listener()
}
export function usePlanetTileUsage(): PlanetTileUsage {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => usage)
}
export function allowMorePlanetTiles() {
  setUsage({ ...usage, limit: usage.fetched + PLANET_TILES_STEP })
}

// Absent where the Cache API is (an insecure origin, some webviews): tiles then
// rely on the HTTP cache alone, and every one counts.
const cachePromise: Promise<Cache | null> = (async () => {
  try { return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME) } catch { return null }
})()
let putsSinceTrim = 0
async function trim(cache: Cache) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_CACHED_TILES)).map((k) => cache.delete(k)))
}

export const planetProtocolUrl = (dateMs: number): string => {
  const d = new Date(dateMs)
  return `planettile://global_monthly_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}_mosaic/{z}/{x}/{y}`
}

export async function fetchPlanetTile(mosaic: string, z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const url = `https://tiles.planet.com/basemaps/v1/planet-tiles/${mosaic}/gmap/${z}/${x}/${y}.png`
  const cache = await cachePromise
  const hit = await cache?.match(url)
  if (hit) {
    setUsage({ ...usage, cached: usage.cached + 1 })
    return hit.arrayBuffer()
  }
  if (usage.fetched >= usage.limit) throw new Error(`Planet tile limit reached: ${usage.fetched} tiles fetched this session. Allow more from the timeline.`)
  const key = getDefaultStore().get(planetKeyAtom).trim()
  if (!key) throw new Error("No Planet API key")
  // Counted when it leaves, not when it lands: a tile cancelled in flight may
  // well have cost quota already.
  setUsage({ ...usage, fetched: usage.fetched + 1 })
  const res = await fetch(`${url}?api_key=${encodeURIComponent(key)}`, { signal, cache: "force-cache" })
  if (!res.ok) throw new Error(`Planet tile ${res.status}`)
  const data = await res.arrayBuffer()
  if (cache) {
    // Stored under the URL without the key.
    cache.put(url, new Response(data.slice(0), { headers: { "content-type": "image/png" } })).catch(() => {})
    if (++putsSinceTrim >= TRIM_EVERY_PUTS) { putsSinceTrim = 0; trim(cache).catch(() => {}) }
  }
  return data
}

export async function planetTileProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: ArrayBuffer }> {
  const m = /^planettile:\/\/(global_monthly_\d{4}_\d{2}_mosaic)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url)
  if (!m) throw new Error(`Invalid planettile protocol URL: ${params.url}`)
  return { data: await fetchPlanetTile(m[1], +m[2], +m[3], +m[4], abortController.signal) }
}

/** The same tile for the export: tileSpec.fetchTileBlob. */
export const planetTileBlobFetcher = (dateMs: number) => {
  const mosaic = /global_monthly_\d{4}_\d{2}_mosaic/.exec(planetProtocolUrl(dateMs))![0]
  return async (z: number, x: number, y: number, signal?: AbortSignal) =>
    new Blob([await fetchPlanetTile(mosaic, z, x, y, signal)], { type: "image/png" })
}
