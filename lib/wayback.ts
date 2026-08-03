// Thin wrapper around @esri/wayback-core, the SDK behind the Esri World
// Imagery Wayback app (https://github.com/Esri/wayback-core) — every World
// Imagery "release" is a full, independently-addressable WMTS tile pyramid
// for the whole world on a given date; this module exposes the release
// catalog and per-location "real change" dates as React hooks, plus the one
// URL-template fixup MapLibre needs.

import { useEffect, useState } from "react"
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
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      getWaybackItemsWithLocalChanges(
        { latitude, longitude },
        Math.round(zoom),
        {
          signal: controller.signal,
          // Trades a small chance of missing a genuinely-unique-but-same-
          // tile-size release for a much cheaper check (no image data fetch
          // per candidate) — worth it for a query that reruns on every pan.
          onlyUseSizeToFilterDuplicates: true,
        },
      )
        .then((result) => { if (!cancelled) { setItems(result); setLoading(false) } })
        .catch(() => { if (!cancelled) setLoading(false) })
    }, LOCAL_CHANGES_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
  }, [latitude, longitude, zoom])

  return { items, loading }
}

// Module-level cache for per-tick tooltip lookups (historical-timeline-
// panel.tsx hovers a tick and wants its real capture date without refetching
// every time the same tick is re-hovered in a session). Keyed coarsely (3
// decimal places / rounded zoom) since a release's imagery doesn't vary at
// that granularity.
const captureLabelCache = new Map<string, string | null>()

/** Plain (non-hook) fetch + cache, used both by useWaybackCaptureDate below
 *  and by a tick tooltip's lazy on-hover fetch. */
export async function fetchWaybackCaptureLabel(latitude: number, longitude: number, zoom: number, releaseNumber: number): Promise<string | null> {
  const key = `${releaseNumber}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(zoom)}`
  if (captureLabelCache.has(key)) return captureLabelCache.get(key)!
  try {
    const meta = await getMetadata({ latitude, longitude }, Math.round(zoom), releaseNumber)
    const label = meta ? new Date(meta.date).toISOString().slice(0, 10) : null
    captureLabelCache.set(key, label)
    return label
  } catch {
    return null
  }
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

/** getWaybackItems/getWaybackItemsWithLocalChanges both return newest-first
 *  (per their own doc comments) — timeline ticks read left-to-right as
 *  oldest-to-newest, so this is the one re-sort every consumer needs. */
export function sortByDateAscending(items: WaybackItem[]): WaybackItem[] {
  return [...items].sort((a, b) => a.releaseDatetime - b.releaseDatetime)
}
