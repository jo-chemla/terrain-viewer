// Thin wrapper around @esri/wayback-core, the SDK behind the Esri World
// Imagery Wayback app (https://github.com/Esri/wayback-core) — every World
// Imagery "release" is a full, independently-addressable WMTS tile pyramid
// for the whole world on a given date; this module exposes the release
// catalog and per-location "real change" dates as React hooks, plus the one
// URL-template fixup MapLibre needs.

import { useEffect, useMemo, useRef, useState } from "react"
import { getWaybackItems, getWaybackItemsWithLocalChanges, getMetadata, type WaybackItem, type WaybackMetadata } from "@esri/wayback-core"

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

/** Zoom-relative location quantization for every per-location hook in this
 *  file (and bing.ts/ge-historical.ts): imagery metadata at the view center
 *  can't change within a fraction of the tile that covers it, so snap the
 *  hook INPUTS to a quarter-tile grid before they ever reach an effect
 *  dependency array. At z15 that's ~0.003° (~300 m — comparable to the
 *  fixed 3-decimal rounding the caches already used); at z3 it's ~11°.
 *  Previously only the CACHES were coarse — the effects themselves depended
 *  on the raw continuous lat/lng, so every map settle re-ran them, and any
 *  pan bigger than ~110 m minted a fresh cache key and a fresh network scan
 *  even at world-view zooms where the imagery couldn't possibly differ. */
export function quantizeLocation(latitude: number, longitude: number, zoom: number): { latitude: number; longitude: number; zoom: number } {
  const qZoom = Math.round(zoom)
  const step = 360 / Math.pow(2, qZoom) / 4
  return {
    latitude: Math.round(latitude / step) * step,
    longitude: Math.round(longitude / step) * step,
    zoom: qZoom,
  }
}

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
export function useWaybackItemsWithLocalChanges(latitudeRaw: number, longitudeRaw: number, zoomRaw: number): { items: WaybackItem[]; loading: boolean } {
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
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

// Module-level cache for per-tick real-capture-metadata lookups — both the
// timeline's tick POSITIONS (every release at this location, fetched once
// per location settle — see useWaybackRealCaptureDates below) and a tick
// tooltip's lazy on-hover fetch share this. Keyed coarsely (3 decimal
// places / rounded zoom) since a release's imagery doesn't vary at that
// granularity. Holds the FULL WaybackMetadata (date, provider, source,
// resolution, accuracy), not just date/label — fetchWaybackCaptureMeta below
// and useWaybackDynamicAttribution (real per-release source attribution)
// both derive their own narrower shape from this one shared cache/network
// call instead of each fetching separately.
const fullMetaCache = new Map<string, WaybackMetadata | null>()

async function fetchWaybackFullMeta(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<WaybackMetadata | null> {
  const key = `${releaseNumber}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`
  if (fullMetaCache.has(key)) return fullMetaCache.get(key)!
  try {
    const meta = await getMetadata({ latitude, longitude }, Math.round(zoom), releaseNumber)
    fullMetaCache.set(key, meta)
    return meta
  } catch {
    fullMetaCache.set(key, null)
    return null
  }
}

/** Plain (non-hook) fetch + cache of the REAL per-tile capture date/label for
 *  one release at one location. Exported (in addition to the label-only
 *  fetchWaybackCaptureLabel below) so a non-React batch consumer — export-
 *  multi's listWaybackTicksInRange — can get the dateMs half too, without
 *  needing a second network call. */
export async function fetchWaybackCaptureMeta(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<{ dateMs: number; label: string } | null> {
  const meta = await fetchWaybackFullMeta(latitude, longitude, zoom, releaseNumber)
  return meta ? { dateMs: meta.date, label: new Date(meta.date).toISOString().slice(0, 10) } : null
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
export function useWaybackRealCaptureDates(items: WaybackItem[], latitudeRaw: number, longitudeRaw: number, zoomRaw: number): { resolved: Record<number, { dateMs: number; label: string }>; loading: boolean } {
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
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
export function useWaybackCaptureDate(latitudeRaw: number, longitudeRaw: number, zoomRaw: number, releaseNumber: number): { label: string | null } {
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
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

  // The last pick, held STABLE while the real capture dates are still
  // streaming in: useWaybackRealCaptureDates resolves each release's real
  // per-tile date progressively, so mid-resolution the pool below is a mix
  // of real dates and catalog-wide releaseDatetime fallbacks — and every
  // newly-arrived date can flip which release is "nearest" to the target,
  // each flip unmounting/remounting the raster source (a visible imagery
  // swap the user never asked for, source A/B hopping releases while
  // metadata loads). The held pick is only abandoned mid-resolution when
  // it can't stand at all: no pick yet (first paint — a provisional pick
  // beats a blank basemap until the batch settles), the held release no
  // longer in the fresh candidate set (view moved somewhere new), or the
  // target date itself changed (a user scrub must respond immediately).
  // Once datesLoading settles, the definitive nearest-match wins.
  const heldRef = useRef<{ item: WaybackItem; targetDateMs: number } | null>(null)

  const item = useMemo(() => {
    if (!targetDateMs || !items.length) return null
    const held = heldRef.current
    if (
      datesLoading && held && held.targetDateMs === targetDateMs &&
      items.some((it) => it.releaseNum === held.item.releaseNum)
    ) return held.item
    let best: WaybackItem | null = null
    let bestDist = Infinity
    for (const it of items) {
      const realDateMs = resolved[it.releaseNum]?.dateMs ?? it.releaseDatetime
      const dist = Math.abs(realDateMs - targetDateMs)
      if (dist < bestDist) { bestDist = dist; best = it }
    }
    heldRef.current = best ? { item: best, targetDateMs } : null
    return best
  }, [items, resolved, targetDateMs, datesLoading])

  return { item, loading: itemsLoading || datesLoading }
}

/**
 * The plain, LIVE "ESRI World Imagery" basemap (id "esri", as opposed to the
 * user-scrubbable "wayback" historical source) has no stored date field of
 * its own to show in the capture-date pill — but it's not actually dateless,
 * it's just always showing whichever Wayback release is CURRENTLY newest at
 * this location (Wayback's own newest release IS the live World Imagery
 * basemap, republished under its own catalog). getWaybackItems/
 * getWaybackItemsWithLocalChanges both return newest-first (see
 * sortByDateAscending's own comment), so `items[0]` here is exactly that
 * release; this resolves its real per-tile capture date the same way every
 * Wayback tick already does, just always pinned to the newest one rather
 * than a user-picked date.
 */
export function useEsriLiveCaptureDate(latitudeRaw: number, longitudeRaw: number, zoomRaw: number): { dateMs: number | null; label: string | null } {
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
  const { items } = useWaybackItemsWithLocalChanges(latitude, longitude, zoom)
  const [result, setResult] = useState<{ dateMs: number | null; label: string | null }>({ dateMs: null, label: null })

  useEffect(() => {
    const newest = items[0]
    if (!newest) { setResult({ dateMs: null, label: null }); return }
    let cancelled = false
    fetchWaybackCaptureMeta(latitude, longitude, zoom, newest.releaseNum).then((meta) => {
      if (cancelled) return
      setResult(meta ? { dateMs: meta.dateMs, label: meta.label } : { dateMs: null, label: null })
    })
    return () => { cancelled = true }
  }, [items, latitude, longitude, zoom])

  return result
}

const WAYBACK_ATTRIBUTION_FALLBACK = { srcDesc: "Esri, Maxar, Earthstar Geographics", niceDesc: "Esri, Maxar, Earthstar Geographics" }

/**
 * Real, per-RELEASE source attribution for ESRI Wayback — @esri/wayback-core's
 * own getMetadata (already used for the real capture date above) also
 * returns `provider`/`source`/`resolution`/`accuracy` for the exact tile at
 * this location+release, which used to be discarded (see fetchWaybackMeta's
 * narrower {dateMs,label} shape). Composed into the same two-field shape
 * Esri's own World_Imagery MapServer identify operation returns for a
 * clicked point (SRC_DESC — the short "provider (source)" code — and
 * NICE_DESC — the full descriptive sentence) so this reads the same way a
 * literal Wayback Machine click would, instead of the generic "who covers
 * this region today" contributor-coverage feed (useEsriDynamicAttribution)
 * previously shared between the live basemap AND every dated Wayback tick —
 * which is why Wayback attribution always resolved to whichever provider
 * covers the region TODAY (e.g. "Vantor") regardless of which historical
 * date was actually picked.
 */
export function useWaybackDynamicAttribution(latitudeRaw: number, longitudeRaw: number, zoomRaw: number, targetDateMs: number): { srcDesc: string; niceDesc: string } {
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
  const { item } = useResolvedWaybackRelease(latitude, longitude, zoom, targetDateMs)
  const [attribution, setAttribution] = useState(WAYBACK_ATTRIBUTION_FALLBACK)

  useEffect(() => {
    if (!item) { setAttribution(WAYBACK_ATTRIBUTION_FALLBACK); return }
    let cancelled = false
    fetchWaybackFullMeta(latitude, longitude, zoom, item.releaseNum).then((meta) => {
      if (cancelled || !meta) return
      const srcDesc = `${meta.provider} (${meta.source})`
      const captureLabel = new Date(meta.date).toISOString().slice(0, 10)
      // Esri's own metadata service returns these as float32-precision values
      // (e.g. 0.30000001192092896 for a nominal 0.3m) — round for display,
      // same rounding a real MapServer identify's NICE_DESC string already
      // bakes in server-side.
      const resolutionM = Math.round(meta.resolution * 100) / 100
      const accuracyM = Math.round(meta.accuracy * 100) / 100
      const niceDesc = `${srcDesc} image captured on ${captureLabel} as shown in the ${item.releaseDateLabel} version of the World Imagery map. Resolution: Pixels in the source image represent a ground distance of ${resolutionM} meters. Accuracy: Objects displayed in this image are within ${accuracyM} meters of true location.`
      setAttribution({ srcDesc, niceDesc })
    })
    return () => { cancelled = true }
  }, [item, latitude, longitude, zoom])

  return attribution
}

/**
 * Plain (non-hook) equivalent of useWaybackItemsWithLocalChanges +
 * useWaybackRealCaptureDates combined, filtered to a date range — used by
 * export-multi (lib/export-multi.ts) to enumerate every real Wayback capture
 * within [startMs, endMs] at a location, outside of a mounted component.
 * Resolves each candidate release's real date SEQUENTIALLY (not in
 * parallel like the hook does) — export-multi already fans out per feature/
 * source/date itself, so this favors going easy on Esri's metadata endpoint
 * over raw speed here.
 */
export async function listWaybackTicksInRange(
  latitude: number, longitude: number, zoom: number, startMs: number, endMs: number,
): Promise<{ dateMs: number; label: string; item: WaybackItem }[]> {
  const items = await getCachedLocalChanges(latitude, longitude, zoom)
  const out: { dateMs: number; label: string; item: WaybackItem }[] = []
  for (const item of items) {
    const meta = await fetchWaybackCaptureMeta(latitude, longitude, zoom, item.releaseNum)
    const dateMs = meta?.dateMs ?? item.releaseDatetime
    if (dateMs < startMs || dateMs > endMs) continue
    out.push({ dateMs, label: meta?.label ?? new Date(dateMs).toISOString().slice(0, 10), item })
  }
  return out.sort((a, b) => a.dateMs - b.dateMs)
}

/** getWaybackItems/getWaybackItemsWithLocalChanges both return newest-first
 *  (per their own doc comments) — timeline ticks read left-to-right as
 *  oldest-to-newest, so this is the one re-sort every consumer needs. */
export function sortByDateAscending(items: WaybackItem[]): WaybackItem[] {
  return [...items].sort((a, b) => a.releaseDatetime - b.releaseDatetime)
}
