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

const lru = new Map<string, Uint8Array>()
let totalBytes = 0
let enabled = true

/** Diagnostic counters — entries/bytes held plus lifetime hit/miss totals. */
export function getTileResultCacheStats() {
  return { enabled, entries: lru.size, totalBytes, hits, misses }
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

export function setTileResultCacheEnabled(on: boolean) {
  enabled = on
  // Disabling also frees everything already held — the point of turning it
  // off is reclaiming memory, not just stopping new inserts.
  if (!on) {
    lru.clear()
    totalBytes = 0
  }
}

function put(key: string, data: Uint8Array) {
  if (data.byteLength > MAX_BYTES / 4) return
  const prev = lru.get(key)
  if (prev) {
    totalBytes -= prev.byteLength
    lru.delete(key)
  }
  lru.set(key, data)
  totalBytes += data.byteLength
  while (totalBytes > MAX_BYTES) {
    const oldest = lru.keys().next().value as string
    totalBytes -= lru.get(oldest)!.byteLength
    lru.delete(oldest)
  }
}

/** Wraps a maplibre custom-protocol handler with the finished-result LRU.
 *  Failures and aborts are never cached (the inner promise rejects), and the
 *  passthrough returns the inner result untouched so extra response fields
 *  (cacheControl etc.) survive on a miss. */
export function withTileResultCache<
  T extends (params: { url: string }, abortController: AbortController) => Promise<{ data: Uint8Array }>,
>(inner: T): T {
  const wrapped = async (params: { url: string }, abortController: AbortController) => {
    if (!enabled) return inner(params, abortController)
    const hit = lru.get(params.url)
    if (hit) {
      hits++
      // Re-insert to refresh LRU recency.
      lru.delete(params.url)
      lru.set(params.url, hit)
      return { data: hit }
    }
    misses++
    const result = await inner(params, abortController)
    if (result?.data instanceof Uint8Array) put(params.url, result.data)
    return result
  }
  return wrapped as T
}
