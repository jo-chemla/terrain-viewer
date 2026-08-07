// Thin wrapper around @esri/wayback-core, the SDK behind the Esri World
// Imagery Wayback app (https://github.com/Esri/wayback-core) — every World
// Imagery "release" is a full, independently-addressable WMTS tile pyramid
// for the whole world on a given date; this module exposes the release
// catalog and per-location "real change" dates as React hooks, plus the one
// URL-template fixup MapLibre needs.

import { useEffect, useMemo, useState } from "react"
import { getWaybackItems, getWaybackItemsWithLocalChanges, getMetadata, type WaybackItem } from "@esri/wayback-core"

export type { WaybackItem }

// The release catalog is a global, slowly-changing list (new releases land
// every few weeks) — not per-location — so it's fetched once per app session
// via a module-level cached promise, not once per component instance. Every
// caller of useWaybackItems (sidebar list, timeline panel, both map A/B
// RasterBasemapSource instances) shares this same in-flight/resolved promise.
let cachedItemsPromise: Promise<WaybackItem[]> | null = null

export function useWaybackItems(): { items: WaybackItem[]; loading: boolean } {
  const [items, setItems] = useState<WaybackItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!cachedItemsPromise) cachedItemsPromise = getWaybackItems()
    cachedItemsPromise
      .then((result) => { if (!cancelled) { setItems(result); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { items, loading }
}

// Matches the app's own viewStateUpdateTimer cadence for settling lat/lng/zoom
// (see TerrainViewer.tsx) — avoids firing a new network request on every
// intermediate frame of a pan/zoom, only once the view has actually settled.
const LOCAL_CHANGES_DEBOUNCE_MS = 400

// Local-changes detection is per-(lat,lng,zoom) and genuinely expensive (it
// compares candidate tiles across the whole release catalog at this exact
// spot) — shared across every caller at the same rounded location/zoom via a
// keyed cache of in-flight/resolved promises, the same idea as
// cachedItemsPromise above. This matters because MORE than one thing needs
// this now: the timeline panel (to draw ticks) AND each side's own
// RasterBasemapSource (to resolve state.dateA/dateB to an actual release
// number, see useResolvedWaybackRelease below) — without sharing, dual-mode
// with both sides on Wayback would trigger this same expensive scan 3x over
// for one location.
const localChangesPromiseCache = new Map<string, Promise<WaybackItem[]>>()
function getCachedLocalChanges(latitude: number, longitude: number, zoom: number): Promise<WaybackItem[]> {
  const key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`
  let promise = localChangesPromiseCache.get(key)
  if (!promise) {
    promise = getWaybackItemsWithLocalChanges(
      { latitude, longitude },
      Math.round(zoom),
      // Trades a small chance of missing a genuinely-unique-but-same-tile-
      // size release for a much cheaper check (no image data fetch per
      // candidate) — worth it for a query that reruns on every pan.
      { onlyUseSizeToFilterDuplicates: true },
    )
    localChangesPromiseCache.set(key, promise)
    // Don't cache a failure — a transient network error shouldn't poison
    // this location for the rest of the session.
    promise.catch(() => localChangesPromiseCache.delete(key))
  }
  return promise
}

/**
 * Releases with a REAL, distinct tile at this exact location — a small
 * subset of the full release catalog, since most releases repeat the same
 * imagery as their neighbor at any given spot. This is what the timeline's
 * ticks are built from (real imagery dates, not "the layer exists" dates).
 */
export function useWaybackItemsWithLocalChanges(latitude: number, longitude: number, zoom: number): { items: WaybackItem[]; loading: boolean } {
  const [items, setItems] = useState<WaybackItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      getCachedLocalChanges(latitude, longitude, zoom)
        .then((result) => { if (!cancelled) { setItems(result); setLoading(false) } })
        .catch(() => { if (!cancelled) setLoading(false) })
    }, LOCAL_CHANGES_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude, zoom])

  return { items, loading }
}

// Module-level cache for per-tick real-capture-date lookups — both the
// timeline's tick POSITIONS (every release at this location, fetched once
// per location settle — see useWaybackRealCaptureDates below) and a tick
// tooltip's lazy on-hover fetch share this. Keyed coarsely (3 decimal
// places / rounded zoom) since a release's imagery doesn't vary at that
// granularity.
const captureMetaCache = new Map<string, { dateMs: number; label: string } | null>()

/** Plain (non-hook) fetch + cache of the REAL per-tile capture date/label for
 *  one release at one location. */
async function fetchWaybackCaptureMeta(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<{ dateMs: number; label: string } | null> {
  const key = `${releaseNumber}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`
  if (captureMetaCache.has(key)) return captureMetaCache.get(key)!
  try {
    const meta = await getMetadata({ latitude, longitude }, Math.round(zoom), releaseNumber)
    const result = meta ? { dateMs: meta.date, label: new Date(meta.date).toISOString().slice(0, 10) } : null
    captureMetaCache.set(key, result)
    return result
  } catch {
    return null
  }
}

/** Plain (non-hook) fetch + cache, used by useWaybackCaptureDate below and by
 *  a tick tooltip's lazy on-hover fetch — just the label half of
 *  fetchWaybackCaptureMeta. */
export async function fetchWaybackCaptureLabel(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<string | null> {
  const meta = await fetchWaybackCaptureMeta(latitude, longitude, zoom, releaseNumber)
  return meta?.label ?? null
}

/**
 * REAL per-tile capture dates for EVERY release in `items` at this location,
 * fetched in parallel and cached — used to position timeline ticks at the
 * date the imagery was actually taken, not each release's own catalog-wide
 * publish date (releaseDatetime/releaseDateLabel). Releases whose real date
 * hasn't resolved yet (or failed) fall back to their own releaseDatetime so
 * a tick still has SOME position rather than being dropped.
 *
 * `resolved` is updated INCREMENTALLY, one release at a time, as each of its
 * own getMetadata() calls completes — not batched behind Promise.all. A
 * single slow/laggy response from Esri's metadata service (which does
 * happen — this is what makes Wayback loading feel occasionally slow)
 * previously blocked every OTHER already-resolved release from showing too,
 * since Promise.all only settles once its slowest member does. The caller
 * (historical-timeline-panel.tsx) renders whatever's in `resolved` so far,
 * so ticks now populate progressively as each one's real date actually
 * arrives, instead of all-or-nothing.
 *
 * Debounced (same LOCAL_CHANGES_DEBOUNCE_MS window as the rest of this file)
 * — @esri/wayback-core's getMetadata has no AbortSignal/cancellation option
 * at all, so an in-flight request genuinely can't be aborted once started;
 * debouncing is the closest practical equivalent, making sure a quick
 * "zoom out to the world, zoom back into a location" never actually STARTS
 * a batch of requests for the transient in-between viewport.
 */
export function useWaybackRealCaptureDates(items: WaybackItem[], latitude: number, longitude: number, zoom: number): { resolved: Record<number, { dateMs: number; label: string }>; loading: boolean } {
  const [resolved, setResolved] = useState<Record<number, { dateMs: number; label: string }>>({})
  const [loading, setLoading] = useState(false)
  // Same coarse "has the view actually moved somewhere new" granularity as
  // every other cache key in this file (captureMetaCache, getCachedLocalChanges
  // above) — this effect used to depend on raw (continuous) latitude/
  // longitude/zoom, so it re-ran (and wiped `resolved` below to {}, see its
  // own comment) on every single pan tick, not just when the view actually
  // settled somewhere meaningfully different. While `resolved` sat empty,
  // useResolvedWaybackRelease's own nearest-release search fell back to each
  // release's catalog-wide releaseDatetime instead of its real per-tile
  // date, which could — even though the user changed nothing — briefly pick
  // a DIFFERENT release as "nearest" and unmount/remount the raster source
  // for it, reading as an unprompted reload mid-pan.
  const coarseKey = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`

  useEffect(() => {
    if (!items.length) { setResolved({}); setLoading(false); return }
    let cancelled = false
    // Deliberately NOT reset to {} here — the release a timeline handle is
    // currently sitting on needs to stay resolved (and its tick stay on the
    // timeline) through a reload, rather than vanishing the instant the view
    // settles somewhere new and only reappearing once its OWN real date
    // happens to re-resolve. Stale entries are pruned below, but only once
    // every release in the fresh candidate set has actually reported back,
    // and only ones that turn out to genuinely not be part of that fresh set
    // at all — never merely because a fetch is still in flight.
    setLoading(true)
    const freshReleaseNums = new Set(items.map((i) => i.releaseNum))
    const timer = setTimeout(() => {
      let remaining = items.length
      for (const item of items) {
        fetchWaybackCaptureMeta(latitude, longitude, zoom, item.releaseNum).then((meta) => {
          if (cancelled) return
          if (meta) setResolved((prev) => ({ ...prev, [item.releaseNum]: meta }))
          remaining -= 1
          if (remaining === 0) {
            setLoading(false)
            setResolved((prev) => {
              let changed = false
              const next: Record<number, { dateMs: number; label: string }> = {}
              for (const [key, value] of Object.entries(prev)) {
                const releaseNum = Number(key)
                if (freshReleaseNums.has(releaseNum)) next[releaseNum] = value
                else changed = true
              }
              return changed ? next : prev
            })
          }
        })
      }
    }, LOCAL_CHANGES_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
    // items is a fresh array identity every render of its own caller — keying
    // off coarseKey (which only changes once the view settles somewhere
    // genuinely new) plus items.length (a new release appearing/
    // disappearing) is enough to refetch exactly when the real candidate set
    // changes, without needing items itself (or the raw lat/lng/zoom) in the
    // dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coarseKey, items.length])

  return { resolved, loading }
}

/**
 * The REAL per-tile acquisition date for one release at one location — a
 * release's own releaseDateLabel is a catalog-wide publish date, not
 * necessarily when that specific tile's imagery was actually captured (a
 * single release mosaics tiles captured at many different times). Queried
 * once for the current view center + selected release only (never per-tile
 * in bulk), same "tile center, not per-pixel" constraint as the historical-
 * satellite repo's own getEsriViewportDate.
 */
export function useWaybackCaptureDate(latitude: number, longitude: number, zoom: number, releaseNumber: number): { label: string | null } {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!releaseNumber) { setLabel(null); return }
    let cancelled = false
    const timer = setTimeout(() => {
      fetchWaybackCaptureLabel(latitude, longitude, zoom, releaseNumber)
        .then((result) => { if (!cancelled) setLabel(result) })
    }, LOCAL_CHANGES_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude, zoom, releaseNumber])

  return { label }
}

/** Wayback's own itemURL uses WMTS-style {level}/{row}/{col} placeholders —
 *  MapLibre's raster source expects the standard XYZ {z}/{x}/{y} convention
 *  (same fixup historical-satellite's own useWaybackUrl hook applies). */
export function waybackTileUrl(item: WaybackItem): string {
  return item.itemURL.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}")
}

/**
 * Resolves a plain epoch-ms date (state.dateA/dateB) to the actual Wayback
 * release whose REAL per-tile capture date is closest to it, for this
 * location. Every other historical source's date is directly usable to
 * build a tile URL — Wayback is the one exception, since its releases are
 * addressed by a release NUMBER (a foreign key into its own catalog), not a
 * timestamp. This is the one place that indirection gets resolved, so the
 * rest of the app (state, the timeline panel's tick model) can treat
 * Wayback exactly like every other source: a single date, nothing more.
 */
export function useResolvedWaybackRelease(latitude: number, longitude: number, zoom: number, targetDateMs: number): { item: WaybackItem | null; loading: boolean } {
  const { items, loading: itemsLoading } = useWaybackItemsWithLocalChanges(latitude, longitude, zoom)
  const { resolved, loading: datesLoading } = useWaybackRealCaptureDates(items, latitude, longitude, zoom)

  const item = useMemo(() => {
    if (!targetDateMs || !items.length) return null
    let best: WaybackItem | null = null
    let bestDist = Infinity
    for (const it of items) {
      const realDateMs = resolved[it.releaseNum]?.dateMs ?? it.releaseDatetime
      const dist = Math.abs(realDateMs - targetDateMs)
      if (dist < bestDist) { bestDist = dist; best = it }
    }
    return best
  }, [items, resolved, targetDateMs])

  return { item, loading: itemsLoading || datesLoading }
}

/** getWaybackItems/getWaybackItemsWithLocalChanges both return newest-first
 *  (per their own doc comments) — timeline ticks read left-to-right as
 *  oldest-to-newest, so this is the one re-sort every consumer needs. */
export function sortByDateAscending(items: WaybackItem[]): WaybackItem[] {
  return [...items].sort((a, b) => a.releaseDatetime - b.releaseDatetime)
}
