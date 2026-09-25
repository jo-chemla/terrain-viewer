// LRU of finished protocol tile outputs (PNG or MVT bytes), keyed by the full
// protocol URL. The URL already encodes the upstream template, encoding, tile
// size, every mode parameter and the tile coordinate (see buildProtocolUrl),
// so a parameter change can never serve a stale tile — it's a different key.
//
// Why this exists: maplibre releases a source's tiles when the layer using it
// goes visibility:none (sub-mode checkboxes) and when the source unmounts
// entirely (the master "Slope and More" viz-mode toggle). Re-showing a mode
// therefore re-runs the whole per-pixel computation for every visible tile,
// even though the decoded upstream DEM is already in sharedTileCache — no
// network, but measured ~1.2s of recompute for LRM over a z13 viewport.
// Caching the finished bytes makes re-toggling near-instant. Gated by the
// "Cache computed viz-mode tiles" switch in Settings (cacheVizTilesAtom),
// synced here via setTileResultCacheEnabled.

const MAX_BYTES = 96 * 1024 * 1024

// An entry is whatever the protocol produced: raw PNG bytes, or - the normal
// case now - an ImageBitmap (see lib/tile-image.ts for why the PNG encode was
// dropped). Bitmaps are held as OUR OWN clone and handed out as further
// clones, for the same ownership reason the byte path calls .slice().
type CacheEntry = Uint8Array | ImageBitmap
const isBitmap = (v: CacheEntry): v is ImageBitmap => typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap
const sizeOf = (v: CacheEntry) => (isBitmap(v) ? v.width * v.height * 4 : v.byteLength)

const lru = new Map<string, CacheEntry>()
let totalBytes = 0
let enabled = true

/** Diagnostic counters — entries/bytes held plus lifetime hit/miss totals. */
function getTileResultCacheStats() {
  return { enabled, entries: lru.size, totalBytes, hits, misses, shared, inflight: inflight.size, inflightUrls: [...inflight.keys()].map((u) => u.slice(0, 50)) }
}

// Dev-only console hook: window.__tileResultCacheStats() — dynamic import of
// this module from the console gets a different (HMR-versioned) instance, so a
// global is the only reliable way to inspect the live cache.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite/client types aren't in this tsconfig
if (typeof window !== "undefined" && (import.meta as any).env?.DEV) {
  ;(window as any).__tileResultCacheStats = getTileResultCacheStats
}

let hits = 0
let misses = 0
// Requests answered from another caller's in-flight run of the same URL.
let shared = 0

// One handler run per URL at a time. MapLibre asks for a tile once per
// source that carries the template - terrainSource and hillshadeSource are
// the same URL, and every derived mode over the same upstream lands at the
// same moment - so without this a VRT tile was reprojected twice and a LERC
// tile decoded twice, side by side. The leader's run resolves to the copy the
// LRU retains; every caller, leader included, gets its own clone of it.
type Flight = { promise: Promise<{ result: { data: unknown }; retained: CacheEntry | null }>; waiters: number }
const inflight = new Map<string, Flight>()

async function cloneEntry(v: CacheEntry): Promise<CacheEntry> {
  return isBitmap(v) ? createImageBitmap(v) : v.slice()
}

export function setTileResultCacheEnabled(on: boolean) {
  enabled = on
  // Disabling also frees everything already held — the point of turning it
  // off is reclaiming memory, not just stopping new inserts.
  if (!on) {
    for (const v of lru.values()) if (isBitmap(v)) v.close()
    lru.clear()
    totalBytes = 0
  }
}

function put(key: string, data: CacheEntry) {
  const bytes = sizeOf(data)
  if (bytes > MAX_BYTES / 4) return
  const prev = lru.get(key)
  if (prev) {
    totalBytes -= sizeOf(prev)
    if (isBitmap(prev)) prev.close()
    lru.delete(key)
  }
  lru.set(key, data)
  totalBytes += bytes
  while (totalBytes > MAX_BYTES) {
    const oldest = lru.keys().next().value as string
    const evicted = lru.get(oldest)!
    totalBytes -= sizeOf(evicted)
    // A bitmap holds memory the GC cannot see, so eviction has to say so
    // explicitly or the budget is fiction.
    if (isBitmap(evicted)) evicted.close()
    lru.delete(oldest)
  }
}

/** Wraps a maplibre custom-protocol handler with the finished-result LRU.
 *  Failures and aborts are never cached (the inner promise rejects), and the
 *  passthrough returns the inner result untouched so extra response fields
 *  (cacheControl etc.) survive on a miss. */
export function withTileResultCache<
  T extends (params: { url: string }, abortController: AbortController) => Promise<{ data: Uint8Array | ImageBitmap }>,
>(inner: T): T {
  const wrapped = async (params: { url: string }, abortController: AbortController) => {
    if (!enabled) return inner(params, abortController)
    const url = params.url
    const hit = lru.get(url)
    if (hit) {
      hits++
      // Re-insert to refresh LRU recency.
      lru.delete(url)
      lru.set(url, hit)
      // maplibre transfers a protocol response's ArrayBuffer to its worker
      // (detaching it) — handing out the cache's own retained buffer would
      // detach OUR copy too, so the next hit on this key tries to transfer
      // an already-detached buffer ("DataCloneError: ArrayBuffer ... already
      // detached"). .slice() hands over an independent copy every time.
      // A bitmap is the same story: maplibre may close what it is given, so
      // every hit gets its own clone and the cache keeps the original.
      return { data: await cloneEntry(hit) }
    }
    const flight = inflight.get(url)
    if (flight) {
      flight.waiters++
      try {
        const { retained } = await flight.promise
        if (retained) {
          shared++
          return { data: await cloneEntry(retained) }
        }
      } catch {
        // The leader failed or was aborted (its caller's tile left the
        // viewport): run our own request below instead of inheriting that.
      }
    }
    misses++
    const own: Flight = { waiters: 0, promise: null as unknown as Flight["promise"] }
    own.promise = (async () => {
      const result = await inner(params, abortController)
      // The LRU must retain its own independent copy rather than the object
      // about to be returned to maplibre (and transferred/detached) — or the
      // very first future hit on this key would already be dead.
      const d = result?.data
      const retained: CacheEntry | null = d instanceof Uint8Array ? d.slice() : d && isBitmap(d) ? await createImageBitmap(d) : null
      if (retained) put(url, retained)
      return { result, retained }
    })()
    inflight.set(url, own)
    try {
      return (await own.promise).result
    } finally {
      if (inflight.get(url) === own) inflight.delete(url)
    }
  }
  return wrapped as T
}
