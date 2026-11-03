// Thin wrapper around @esri/wayback-core, the SDK behind the Esri World
// Imagery Wayback app (https://github.com/Esri/wayback-core) — every World
// Imagery "release" is a full, independently-addressable WMTS tile pyramid
// for the whole world on a given date; this module exposes the release
// catalog and per-location "real change" dates as React hooks, plus the one
// URL-template fixup MapLibre needs.

import { useEffect, useMemo, useRef, useState } from "react"
import { getWaybackItems, getMetadata, getWaybackServiceBaseURL, long2tile, lat2tile, type WaybackItem, type WaybackMetadata } from "@esri/wayback-core"

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

function locationKey(latitude: number, longitude: number, zoom: number): string {
  return `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`
}

// What the walk and the dates found, kept between sessions: a release's imagery
// date at a place never changes, and a walk only ages when a new release comes
// out. Capped to the 300 most recent places of each, about 130 KB of the 5 MB
// or so a browser allows: a place's walk and dates
// take about 450 bytes in all. Oldest out first, by insertion order.
const STORE_KEY = "waybackDates.v1"
const STORE_MAX_PLACES = 300
type WaybackStore = {
  /** tile -> [newest release when walked, ...releases with their own imagery, newest first] */
  walks: Record<string, number[]>
  /** location -> release -> imagery date (ms) */
  dates: Record<string, Record<string, number>>
}
const store: WaybackStore = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null")
    if (parsed?.walks && parsed?.dates) return parsed
  } catch { /* unreadable or unavailable: start empty */ }
  return { walks: {}, dates: {} }
})()
let storeTimer: ReturnType<typeof setTimeout> | null = null
function saveStoreSoon() {
  if (storeTimer) return
  storeTimer = setTimeout(() => {
    storeTimer = null
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch { /* full or unavailable: this session's memory still has it */ }
  }, 1000)
}
function capPlaces(places: Record<string, unknown>) {
  const keys = Object.keys(places)
  for (let i = 0; i < keys.length - STORE_MAX_PLACES; i++) delete places[keys[i]]
}

// The walk: which releases have their own imagery at a tile. Each tilemap
// answer names the release to ask next, so it cannot run in parallel (20 to 30
// requests at 150 ms, 4 s). @esri/wayback-core's getWaybackItemsWithLocalChanges
// walks the same way but only answers at the end; this one reports each step,
// so ticks can appear while it runs and dates can start before it ends, and it
// is keyed by tile, what the answer depends on, not by the point inside it.
// Shared by every caller: the timeline panel draws ticks from it, each side's
// RasterBasemapSource resolves its date to a release number with it.
interface WaybackWalk {
  items: WaybackItem[]
  /** How many of `items` are final. The last run of same-size releases can still move to an older one. */
  settledCount: number
  done: boolean
  promise: Promise<WaybackItem[]>
  listeners: Set<() => void>
}
const walks = new Map<string, WaybackWalk>()

// Consecutive releases with a tile of the same size count as one image, kept at
// its oldest: a same-size heuristic with no image fetch per candidate, the
// SDK's onlyUseSizeToFilterDuplicates. Up to z11 it keeps them all, as the SDK does.
function distinctReleases(found: { releaseNum: number; size: number }[], level: number): { releases: number[]; settled: number } {
  if (level <= 11) return { releases: found.map((f) => f.releaseNum), settled: found.length }
  const releases: number[] = []
  found.forEach((f, i) => {
    if (i > 0 && f.size === found[i - 1].size) releases[releases.length - 1] = f.releaseNum
    else releases.push(f.releaseNum)
  })
  return { releases, settled: Math.max(0, releases.length - 1) }
}

function startWalk(latitude: number, longitude: number, zoom: number): WaybackWalk {
  const level = Math.round(zoom)
  const column = long2tile(longitude, level)
  const row = lat2tile(latitude, level)
  const tileKey = `${level}/${column}/${row}`
  const existing = walks.get(tileKey)
  if (existing) return existing
  const walk: WaybackWalk = { items: [], settledCount: 0, done: false, promise: Promise.resolve([]), listeners: new Set() }
  const report = () => { for (const listener of walk.listeners) listener() }
  walk.promise = (async () => {
    if (!cachedItemsPromise) cachedItemsPromise = getWaybackItems()
    const catalog = await cachedItemsPromise
    const byRelease = new Map(catalog.map((it) => [it.releaseNum, it]))
    const newest = catalog[0].releaseNum
    const stored = store.walks[tileKey]
    if (stored?.[0] === newest) {
      walk.items = stored.slice(1).map((n) => byRelease.get(n)).filter((it): it is WaybackItem => !!it)
    } else {
      const baseUrl = getWaybackServiceBaseURL()
      const found: { releaseNum: number; size: number }[] = []
      let next: number | undefined = newest
      while (next) {
        const r: Response = await fetch(`${baseUrl}/tilemap/${next}/${level}/${row}/${column}`)
        const j = (await r.json()) as { data: number[]; select?: number[]; size?: number[] }
        if (!j.data[0]) break
        const releaseNum: number = j.select?.[0] ? +j.select[0] : next
        found.push({ releaseNum, size: j.size?.[0] ?? 0 })
        const { releases, settled } = distinctReleases(found, level)
        walk.items = releases.map((n) => byRelease.get(n)).filter((it): it is WaybackItem => !!it)
        walk.settledCount = settled
        report()
        next = catalog[catalog.findIndex((it) => it.releaseNum === releaseNum) + 1]?.releaseNum
      }
      delete store.walks[tileKey]
      store.walks[tileKey] = [newest, ...walk.items.map((it) => it.releaseNum)]
      capPlaces(store.walks)
      saveStoreSoon()
    }
    walk.settledCount = walk.items.length
    walk.done = true
    report()
    return walk.items
  })()
  walks.set(tileKey, walk)
  // Don't cache a failure: a network blip shouldn't poison this tile for the session.
  walk.promise.catch(() => { walks.delete(tileKey); walk.done = true; report() })
  return walk
}

function getCachedLocalChanges(latitude: number, longitude: number, zoom: number): Promise<WaybackItem[]> {
  return startWalk(latitude, longitude, zoom).promise
}

/**
 * Releases with a REAL, distinct tile at this exact location — a small
 * subset of the full release catalog, since most releases repeat the same
 * imagery as their neighbor at any given spot. This is what the timeline's
 * ticks are built from (real imagery dates, not "the layer exists" dates).
 */
/** `enabled` exists because this is NOT a cheap hook: one new tile is dozens of
 *  requests to Esri's servers. It used to run unconditionally from General
 *  Settings — which is mounted in every mode — purely so the "Open in…"
 *  button could pre-resolve the latest release number for ONE of its
 *  destinations. That meant plain terrain browsing, with no historical
 *  imagery and nothing Esri anywhere on the map, kept hitting
 *  wayback.maptiles.arcgis.com on every pan. Callers that only want the
 *  release number now pass enabled=false until it is actually wanted. */
export interface WaybackLocalChanges {
  items: WaybackItem[]
  /** How many of `items` are final, and so worth a date lookup. */
  settledCount: number
  /** The location `items` belong to: the previous place's stay up until the new walk reports. */
  key: string
  loading: boolean
}
export function useWaybackItemsWithLocalChanges(latitudeRaw: number, longitudeRaw: number, zoomRaw: number, enabled = true): WaybackLocalChanges {
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
  const key = locationKey(latitude, longitude, zoom)
  const [result, setResult] = useState<WaybackLocalChanges>({ items: [], settledCount: 0, key: "", loading: true })

  useEffect(() => {
    // Drop the items too: a stale list would keep useWaybackRealCaptureDates
    // resolving dates (and its spinner spinning) after the ESRI pill is off.
    if (!enabled) { setResult({ items: [], settledCount: 0, key, loading: false }); return }
    let unsubscribe = () => {}
    setResult((prev) => (prev.loading ? prev : { ...prev, loading: true }))
    const timer = setTimeout(() => {
      const walk = startWalk(latitude, longitude, zoom)
      const update = () => {
        if (walk.items.length || walk.done) setResult({ items: walk.items, settledCount: walk.settledCount, key, loading: !walk.done })
      }
      walk.listeners.add(update)
      unsubscribe = () => walk.listeners.delete(update)
      update()
    }, LOCAL_CHANGES_DEBOUNCE_MS)
    return () => { clearTimeout(timer); unsubscribe() }
  }, [key, enabled])

  return result
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
// In-flight requests, so two callers asking for the same release at once
// (the export dialog's live count and the timeline's own ticks, say) share
// one network call instead of each firing their own.
const fullMetaInflight = new Map<string, Promise<WaybackMetadata | null>>()

// Bumped each time a release's real date lands in fullMetaCache, for
// consumers that computed something from the cache's fallbacks before every
// date was in (the export dialog's "N captures in range": a listing that
// ran while a lookup was failing or still pending counted that release at
// its catalog release date, and nothing told it to count again).
const waybackMetaListeners = new Set<() => void>()
export function subscribeWaybackMeta(listener: () => void): () => void {
  waybackMetaListeners.add(listener)
  return () => { waybackMetaListeners.delete(listener) }
}

async function fetchWaybackFullMeta(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<WaybackMetadata | null> {
  const key = `${releaseNumber}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`
  if (fullMetaCache.has(key)) return fullMetaCache.get(key)!
  const pending = fullMetaInflight.get(key)
  if (pending) return pending
  const p = (async () => {
    try {
      const meta = await getMetadata({ latitude, longitude }, Math.round(zoom), releaseNumber)
      fullMetaCache.set(key, meta)
      if (meta) for (const l of waybackMetaListeners) l()
      return meta
    } catch {
      // Not cached: a transient failure (rate limit, network blip) used to
      // pin this release to "no real date" for the whole session, so every
      // later listing fell back to its release date for good. The next
      // caller retries instead.
      return null
    } finally {
      fullMetaInflight.delete(key)
    }
  })()
  fullMetaInflight.set(key, p)
  return p
}

/** Plain (non-hook) fetch + cache of the REAL per-tile capture date/label for
 *  one release at one location. Exported (in addition to the label-only
 *  fetchWaybackCaptureLabel below) so a non-React batch consumer — export-
 *  multi's listWaybackTicksInRange — can get the dateMs half too, without
 *  needing a second network call. */
export async function fetchWaybackCaptureMeta(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<{ dateMs: number; label: string } | null> {
  const place = locationKey(latitude, longitude, zoom)
  const stored = store.dates[place]?.[releaseNumber]
  const dateMs = stored ?? (await fetchWaybackFullMeta(latitude, longitude, zoom, releaseNumber))?.date
  if (dateMs == null) return null
  if (stored == null) {
    const dates = store.dates[place] ?? {}
    delete store.dates[place]
    store.dates[place] = { ...dates, [releaseNumber]: dateMs }
    capPlaces(store.dates)
    saveStoreSoon()
  }
  return { dateMs, label: new Date(dateMs).toISOString().slice(0, 10) }
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
 * Only asks about releases of THIS place that are final. The walk's own debounce
 * already keeps a transient viewport from starting anything (getMetadata can't
 * be aborted once started), so this adds no second one, which cost 400 ms on
 * every new place. Lookups start as releases settle, alongside the walk.
 */
export function useWaybackRealCaptureDates(walk: WaybackLocalChanges, latitudeRaw: number, longitudeRaw: number, zoomRaw: number): { resolved: Record<number, { dateMs: number; label: string }>; loading: boolean } {
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
  const coarseKey = locationKey(latitude, longitude, zoom)
  const isThisPlace = walk.key === coarseKey
  const settledCount = isThisPlace ? walk.settledCount : 0

  useEffect(() => {
    const items = walk.items.slice(0, settledCount)
    if (!walk.items.length) { setResolved({}); setLoading(walk.loading); return }
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
    const walkFinished = isThisPlace && !walk.loading
    const freshReleaseNums = new Set(walk.items.map((i) => i.releaseNum))
    let remaining = items.length
    const settle = () => {
      if (remaining > 0 || !walkFinished) return
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
    for (const item of items) {
      fetchWaybackCaptureMeta(latitude, longitude, zoom, item.releaseNum).then((meta) => {
        if (cancelled) return
        if (meta) setResolved((prev) => (prev[item.releaseNum]?.dateMs === meta.dateMs ? prev : { ...prev, [item.releaseNum]: meta }))
        remaining -= 1
        settle()
      })
    }
    settle()
    return () => { cancelled = true }
    // walk.items is only new when the walk reported, and those are the three
    // values that say so: the place, how many releases are final, whether it ended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coarseKey, settledCount, isThisPlace, walk.loading, walk.items.length])

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
  const walk = useWaybackItemsWithLocalChanges(latitude, longitude, zoom)
  const { items, loading: itemsLoading } = walk
  const { resolved, loading: datesLoading } = useWaybackRealCaptureDates(walk, latitude, longitude, zoom)

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
    if (!targetDateMs) return null
    // While a new place's releases or dates load (after a pan or a zoom), the
    // imagery on screen stays up as a placeholder instead of the layer going
    // blank until the new pick is known.
    const placeholder = (itemsLoading || datesLoading) ? heldRef.current?.item ?? null : null
    if (!items.length) return placeholder
    // While dates stream in, only releases whose REAL capture date is known
    // are candidates. Guessing from the release date picked the wrong
    // imagery: at Palmyra the release of 2014-02-20 carries imagery of 2009,
    // so a view asked for 2014 showed 2009 until every date had arrived.
    // An empty view for the second or two before the first dates is better
    // than a wrong one (see MapSources.tsx's Wayback source).
    const dateOf = (it: WaybackItem) => resolved[it.releaseNum]?.dateMs ?? (datesLoading ? null : it.releaseDatetime)
    let best: WaybackItem | null = null
    let bestDist = Infinity
    for (const it of items) {
      const d = dateOf(it)
      if (d == null) continue
      const dist = Math.abs(d - targetDateMs)
      if (dist < bestDist) { bestDist = dist; best = it }
    }
    const held = heldRef.current
    if (!best) return placeholder
    if (
      datesLoading && held && held.targetDateMs === targetDateMs &&
      items.some((it) => it.releaseNum === held.item.releaseNum)
    ) {
      // Keep the held pick unless a newly dated release is clearly closer
      // (three months), so a view swaps imagery once, not with every date.
      const heldDate = dateOf(held.item)
      const heldDist = heldDate == null ? Infinity : Math.abs(heldDate - targetDateMs)
      if (!best || bestDist >= heldDist - 90 * 86400000) return held.item
    }
    heldRef.current = best ? { item: best, targetDateMs } : null
    return best
  }, [items, resolved, targetDateMs, datesLoading, itemsLoading])

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
  // One tick per CAPTURE date, not per release: the "local changes" list is
  // per release, and several consecutive releases routinely carry the same
  // imagery date at a spot (the mosaic changed nearby, not here), which
  // counted - and exported - the same pixels several times over. Keep the
  // newest release for each date, which is the one still being served.
  // The per-release metadata calls are independent: run them a few at a
  // time rather than strictly one after another, which for 15-20 releases
  // at a second or two each was the "Listing dates - wayback" stall.
  const CONCURRENCY = 6
  const metas: ({ dateMs: number; label: string } | null)[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      metas[i] = await fetchWaybackCaptureMeta(latitude, longitude, zoom, items[i].releaseNum)
    }
  }))
  const byDate = new Map<number, { dateMs: number; label: string; item: WaybackItem }>()
  items.forEach((item, i) => {
    const meta = metas[i]
    const dateMs = meta?.dateMs ?? item.releaseDatetime
    if (dateMs < startMs || dateMs > endMs) return
    const prev = byDate.get(dateMs)
    if (!prev || item.releaseNum > prev.item.releaseNum) {
      byDate.set(dateMs, { dateMs, label: meta?.label ?? new Date(dateMs).toISOString().slice(0, 10), item })
    }
  })
  return [...byDate.values()].sort((a, b) => a.dateMs - b.dateMs)
}

/** getWaybackItems/getWaybackItemsWithLocalChanges both return newest-first
 *  (per their own doc comments) — timeline ticks read left-to-right as
 *  oldest-to-newest, so this is the one re-sort every consumer needs. */
export function sortByDateAscending(items: WaybackItem[]): WaybackItem[] {
  return [...items].sort((a, b) => a.releaseDatetime - b.releaseDatetime)
}
