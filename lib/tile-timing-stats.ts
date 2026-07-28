// Tracks per-tile compute time and viewport-loading progress for the slow,
// ray-marched relief-visualization modes (SVF/Openness/Local Dominance) —
// each an order of magnitude more per-pixel work than the fixed 3x3/5x5-window
// modes (see normal-derived-protocol.ts's header). Surfaced in their options
// sections as a "computing… ~Ns remaining" indicator (slow-tile-progress.tsx).
//
// Protocol handlers run outside React (registered once via maplibregl.
// addProtocol), so this uses jotai's getDefaultStore() rather than a hook —
// the same "read/write an atom from outside a component" pattern
// tile-result-cache.ts's cache-enabled flag would use if it needed React
// state instead of a plain module-level variable.

import { atom, getDefaultStore } from "jotai"

export type SlowVizMode = "svf" | "openness" | "local-dominance"

export interface SlowModeStats {
  /** Rolling average compute time (ms) for a cache-MISS tile — null until at
   *  least one real (non-cached) tile has finished, so the UI can show
   *  "estimating…" instead of a bogus 0s. */
  avgMs: number | null
  /** Tiles maplibre has asked this protocol for since the viewport last
   *  started moving (reset on movestart/zoomstart — see resetSlowTileProgress). */
  requestedCount: number
  /** Of those, how many have actually resolved (cache hit or real compute). */
  completedCount: number
  /** Highest "requested minus completed" seen so far this session — an
   *  empirical stand-in for how many tiles this browser/endpoint actually
   *  processes at once (maplibre issues several tile requests concurrently;
   *  each protocol call awaits network I/O rather than blocking a thread, so
   *  many are genuinely in flight together even though the CPU-bound part of
   *  each still executes one at a time on the main thread). Estimating
   *  remaining time as `pending * avgMs` — i.e. as if every tile were
   *  processed strictly one after another — is exactly why the estimate ran
   *  too conservative; dividing by this instead accounts for the real
   *  overlap. Kept as a running max (not reset per-viewport) since it's a
   *  property of the browser/endpoint's own concurrency, not of any one view. */
  maxConcurrency: number
}

const EMPTY_STATS: SlowModeStats = { avgMs: null, requestedCount: 0, completedCount: 0, maxConcurrency: 1 }

export const slowTileStatsAtom = atom<Record<SlowVizMode, SlowModeStats>>({
  svf: { ...EMPTY_STATS },
  openness: { ...EMPTY_STATS },
  "local-dominance": { ...EMPTY_STATS },
})

// Rolling window, not a lifetime average — so the estimate adapts if the
// endpoint's real latency shifts (e.g. its own server warms up, or a
// different, larger radius setting is picked mid-session).
const ROLLING_WINDOW = 15
const samples: Record<SlowVizMode, number[]> = { svf: [], openness: [], "local-dominance": [] }

function patchStats(mode: SlowVizMode, patch: Partial<SlowModeStats>) {
  const store = getDefaultStore()
  const current = store.get(slowTileStatsAtom)
  store.set(slowTileStatsAtom, { ...current, [mode]: { ...current[mode], ...patch } })
}

/** Wraps a maplibre custom-protocol handler to record its real compute time
 *  and viewport-progress counts. Compose OUTSIDE withTileResultCache (i.e.
 *  `withTileResultCache(withSlowTileStats("svf", svfProtocol))`) so timing
 *  measures the actual ray-marching cost, not a cache hit — a hit still
 *  counts toward completedCount (that tile IS done, just near-instantly),
 *  just not toward the avgMs sample (it would otherwise drag the estimate
 *  down to near-zero and make "time remaining" meaningless).
 *
 *  Parallelization / "thread count" note: maxConcurrency is NOT a real
 *  worker/thread count — the actual per-tile compute in these modes is
 *  single-threaded on the main thread; only the network fetch overlaps.
 *  It's instead an empirical measurement: at every tile request we compute
 *  requestedCount − completedCount (how many are genuinely in flight right
 *  now) and keep a running max of that. slow-tile-progress.tsx's "time
 *  remaining" estimate divides pending tiles by this observed concurrency
 *  instead of assuming everything is strictly sequential — that's what
 *  fixed the estimate being too conservative. */
export function withSlowTileStats<
  T extends (params: { url: string }, abortController: AbortController) => Promise<{ data: Uint8Array }>,
>(mode: SlowVizMode, inner: T): T {
  const wrapped = async (params: { url: string }, abortController: AbortController) => {
    const store = getDefaultStore()
    const beforeStart = store.get(slowTileStatsAtom)[mode]
    const requestedCount = beforeStart.requestedCount + 1
    const inFlight = requestedCount - beforeStart.completedCount
    patchStats(mode, { requestedCount, maxConcurrency: Math.max(beforeStart.maxConcurrency, inFlight) })
    const start = performance.now()
    try {
      const result = await inner(params, abortController)
      const arr = samples[mode]
      arr.push(performance.now() - start)
      if (arr.length > ROLLING_WINDOW) arr.shift()
      const avgMs = arr.reduce((a, b) => a + b, 0) / arr.length
      patchStats(mode, { avgMs, completedCount: store.get(slowTileStatsAtom)[mode].completedCount + 1 })
      return result
    } catch (err) {
      // Aborted (pan/zoom moved on before this tile finished) or genuinely
      // failed — neither is a real completed compute, and neither should
      // count against the viewport's pending total either.
      patchStats(mode, { requestedCount: Math.max(0, store.get(slowTileStatsAtom)[mode].requestedCount - 1) })
      throw err
    }
  }
  return wrapped as T
}

/** Called on movestart/zoomstart — a new viewport needs a fresh count of how
 *  many tiles it requires; the rolling avgMs is left untouched since it's a
 *  session-wide "how fast is this endpoint" estimate, not viewport-specific. */
export function resetSlowTileProgress(mode?: SlowVizMode) {
  const store = getDefaultStore()
  const current = store.get(slowTileStatsAtom)
  const modes: SlowVizMode[] = mode ? [mode] : ["svf", "openness", "local-dominance"]
  const next = { ...current }
  for (const m of modes) next[m] = { ...current[m], requestedCount: 0, completedCount: 0 }
  store.set(slowTileStatsAtom, next)
}
