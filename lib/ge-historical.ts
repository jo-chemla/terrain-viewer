// Thin wrapper around the local Google Earth "Time Machine" historical
// imagery library (lib/ge-timemachine/ge-historical.js — Iconem's own
// reverse-engineered client, https://github.com/Iconem/GE_TimeMachine),
// mirroring the shape of lib/wayback.ts and lib/hls.ts so it slots into the
// same RasterBasemapSource / historical-timeline-panel pattern.
//
// Unlike Wayback's global release catalog or HLS's synthetic monthly ticks,
// GE genuinely has one real per-tile capture-date list (Google's own
// IMAGERY_HISTORY quadtree layer) — no separate "local changes" query needed.
//
// GE_TimeMachine's own docs assume khmdb.google.com/kh.google.com need a CORS
// proxy, but a direct browser fetch() against both (confirmed 2026-08-01,
// including a full dbRoot+tile round-trip) succeeds — they already send a
// permissive Access-Control-Allow-Origin. No proxy needed, in dev OR
// production, so none is used here.
import { useEffect, useState } from "react"
import maplibregl from "maplibre-gl"
import { registerGEHistorical } from "./ge-timemachine/ge-historical.js"

let geInstance: ReturnType<typeof registerGEHistorical> | null = null

/** Registers the `gehist://` MapLibre protocol exactly once, module-wide —
 *  mirrors the other in-house protocols' single addProtocol registration
 *  (see TerrainViewer.tsx), just lazily on first use instead of on mount. */
function getGe() {
  if (!geInstance) {
    geInstance = registerGEHistorical(maplibregl, {})
  }
  return geInstance
}

export function geHistoricalTileSource(dateMs: number): { tiles: string[]; tileSize: number; maxzoom: number; attribution: string } {
  const ge = getGe()
  const d = new Date(dateMs)
  const spec = ge.makeRasterSource({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() })
  // A constant pointer, not makeRasterSource's own generic "Imagery ©
  // Google" — the REAL per-tile provider (e.g. "Google Earth - CNES /
  // Airbus", resolved from Google's own dbRoot, see
  // useGeHistoricalDynamicAttribution below) can only show in the sidebar's
  // Source Info section, not here: a <Source>'s `attribution` prop can never
  // be live-updated post-mount (react-map-gl's updateSource has no case for
  // it), so a value that changes per tile/date could never reach the map
  // through this prop regardless.
  return { tiles: spec.tiles, tileSize: spec.tileSize, maxzoom: spec.maxzoom, attribution: "Google, see dynamic attribution in source panel" }
}

const LOCAL_DATES_DEBOUNCE_MS = 400

/** Real per-location capture dates from Google's own IMAGERY_HISTORY layer
 *  for the Keyhole tile at (latitude, longitude, zoom) — not synthetic,
 *  unlike lib/hls.ts's placeholder ticks. */
export function useGeHistoricalDates(latitude: number, longitude: number, zoom: number): { items: { dateMs: number; label: string }[]; loading: boolean } {
  const [items, setItems] = useState<{ dateMs: number; label: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const ge = getGe()
        await ge.ready()
        const level = Math.max(1, Math.min(23, Math.round(zoom)))
        const { path } = ge.keyholePathAtLngLat(longitude, latitude, level)
        const dated = await ge.getDatesForPath(path)
        if (cancelled) return
        // packed === 0 is the "current default imagery, no history" sentinel
        // (see ge-historical.js's _computeDatesForPath) — not a real date.
        const mapped = dated
          .filter((d: any) => d.packed)
          .map((d: any) => ({
            dateMs: Date.UTC(d.year, d.month - 1, d.day),
            label: `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`,
          }))
          .sort((a: any, b: any) => a.dateMs - b.dateMs)
        setItems(mapped)
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }, LOCAL_DATES_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude, zoom])

  return { items, loading }
}

/**
 * Plain (non-hook) equivalent of useGeHistoricalDates, filtered to a date
 * range — used by export-multi (lib/export-multi.ts) to enumerate every
 * real GE Historical capture within [startMs, endMs] at a location, outside
 * of a mounted component.
 */
export async function listGeHistoricalTicksInRange(
  latitude: number, longitude: number, zoom: number, startMs: number, endMs: number,
): Promise<{ dateMs: number; label: string }[]> {
  const ge = getGe()
  await ge.ready()
  const level = Math.max(1, Math.min(23, Math.round(zoom)))
  const { path } = ge.keyholePathAtLngLat(longitude, latitude, level)
  const dated = await ge.getDatesForPath(path)
  return dated
    .filter((d: any) => d.packed)
    .map((d: any) => ({
      dateMs: Date.UTC(d.year, d.month - 1, d.day),
      label: `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`,
    }))
    .filter((t: { dateMs: number }) => t.dateMs >= startMs && t.dateMs <= endMs)
    .sort((a: { dateMs: number }, b: { dateMs: number }) => a.dateMs - b.dateMs)
}

const GE_FALLBACK_ATTRIBUTION = "Imagery © Google"

/** Real, current-tile attribution for GE Historical — Google's own dbRoot
 *  ships a providerId → copyright table (see registerGEHistorical's
 *  getProviderCopyright, reverse-engineered from Open GEE's own
 *  dbroot_v2.proto/CesiumJS's GoogleEarthEnterpriseMetadata, both of which
 *  confirm this exact field), and each dated tile from getDatesForPath
 *  already carries which provider id captured IT specifically — so unlike
 *  the generic static "Imagery © Google" previously used everywhere, this
 *  resolves to the real capturing provider (e.g. "Google Earth - CNES /
 *  Airbus") for the tile actually on screen, and updates as the view pans
 *  or a different historical date is picked. Falls back to the generic
 *  string while loading, on any failure, or if this particular tile/date
 *  has no provider info (dbRoot doesn't cover every provider it lists a
 *  historical tile for). */
export function useGeHistoricalDynamicAttribution(latitude: number, longitude: number, zoom: number, dateMs: number): string {
  const [attribution, setAttribution] = useState(GE_FALLBACK_ATTRIBUTION)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const ge = getGe()
        await ge.ready()
        const level = Math.max(1, Math.min(23, Math.round(zoom)))
        const { path } = ge.keyholePathAtLngLat(longitude, latitude, level)
        const dated = await ge.getDatesForPath(path)
        if (cancelled || !dated.length) return
        // dated is newest-first (see _computeDatesForPath) — a fine default
        // when dateMs isn't known yet; otherwise pick the closest packed
        // (real) date, same nearest-match spirit as useResolvedWaybackRelease.
        let best = dated[0]
        if (dateMs) {
          let bestDist = Infinity
          for (const d of dated) {
            if (!d.packed) continue
            const dist = Math.abs(Date.UTC(d.year, d.month - 1, d.day) - dateMs)
            if (dist < bestDist) { bestDist = dist; best = d }
          }
        }
        const copyright = best.provider ? ge.getProviderCopyright(best.provider) : null
        if (!cancelled) setAttribution(copyright ? `Google Earth - ${copyright}` : GE_FALLBACK_ATTRIBUTION)
      } catch {
        if (!cancelled) setAttribution(GE_FALLBACK_ATTRIBUTION)
      }
    }, LOCAL_DATES_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude, zoom, dateMs])

  return attribution
}
