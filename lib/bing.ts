// Real per-tile capture-date-range for Bing Aerial (already an existing plain
// basemap — see rasterBasemaps.bing in MapSources.tsx). Unlike Wayback/GE,
// Bing has no separate metadata endpoint: the date range is a response
// header (X-Ve-Tilemeta-Capturedatesrange) on the tile image itself, read
// once for the current view center — confirmed readable cross-origin by a
// direct browser fetch (2026-08-01), same "tile center, not per-pixel"
// constraint as lib/wayback.ts's useWaybackCaptureDate.
import { useEffect, useState } from "react"
import { STATIC_BASEMAP_ATTRIBUTIONS } from "./basemap-attribution"
import { quantizeLocation } from "./wayback"

/** Exported so lib/historical-export-sources.ts can build a per-tile Bing
 *  URL directly (its tile scheme isn't a plain {z}/{x}/{y} template — see
 *  fetchRgbTileMosaic's buildTileUrl escape hatch). */
export function toQuadkey(tileX: number, tileY: number, zoom: number): string {
  let quadKey = ""
  for (let i = zoom; i > 0; i--) {
    let digit = 0
    const mask = 1 << (i - 1)
    if ((tileX & mask) !== 0) digit += 1
    if ((tileY & mask) !== 0) digit += 2
    quadKey += digit.toString()
  }
  return quadKey
}

function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y }
}

const BING_DEBOUNCE_MS = 400

/** Plain (non-hook) fetch of Bing's single current capture date/range at a
 *  location — shared by useBingCaptureDate below and export-multi (lib/
 *  export-multi.ts), which has no mounted component to run a hook from.
 *  Bing has no browsable archive (see lib/historical-sources.ts) — this is
 *  always exactly one result, never a range of ticks the way the other 5
 *  historical sources produce. */
export async function fetchBingCaptureDate(latitude: number, longitude: number, zoom: number): Promise<{ label: string | null; dateMs: number | null }> {
  try {
    const z = Math.max(1, Math.min(21, Math.round(zoom)))
    const { x, y } = lngLatToTile(longitude, latitude, z)
    const quad = toQuadkey(x, y, z)
    const res = await fetch(`https://t.ssl.ak.tiles.virtualearth.net/tiles/a${quad}.jpeg?g=14603&n=z&prx=1`)
    const range = res.headers.get("X-Ve-Tilemeta-Capturedatesrange")
    if (!range) return { label: null, dateMs: null }
    const [, to] = range.split("-")
    const d = to ? new Date(to) : null
    if (d && !isNaN(d.getTime())) return { label: d.toISOString().slice(0, 10), dateMs: d.getTime() }
    return { label: range, dateMs: null }
  } catch {
    return { label: null, dateMs: null }
  }
}

export function useBingCaptureDate(latitudeRaw: number, longitudeRaw: number, zoomRaw: number): { label: string | null; dateMs: number | null; loading: boolean } {
  // Quarter-tile input quantization — same "don't re-fetch center metadata
  // for a move too small to change it" reasoning as lib/wayback.ts's
  // quantizeLocation (see its comment).
  const { latitude, longitude, zoom } = quantizeLocation(latitudeRaw, longitudeRaw, zoomRaw)
  const [label, setLabel] = useState<string | null>(null)
  const [dateMs, setDateMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const result = await fetchBingCaptureDate(latitude, longitude, zoom)
      if (cancelled) return
      setLabel(result.label)
      setDateMs(result.dateMs)
      setLoading(false)
    }, BING_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude, zoom])

  return { label, dateMs, loading }
}

/** Real per-view attribution for Bing — same X-VE-TILEMETA-CaptureDatesRange
 *  header useBingCaptureDate already reads (confirmed live: it genuinely
 *  varies by location/zoom, e.g. a low-zoom ocean tile reads "1999-2003"
 *  while central Paris at z17 reads "6/16/2021-10/8/2021" — deliberately
 *  CORS-exposed by Bing's own tile CDN, same idea as Esri/GE's real
 *  attribution just without needing a separate metadata endpoint). The tile
 *  response also carries an X-VE-TILEMETA-Product-IDs header that varies per
 *  tile too (looks like a provider/product code, the same spirit as GE's
 *  `provider` field) — but unlike Esri's public contributor feed or GE's own
 *  dbRoot provider table, there's no publicly documented mapping from that
 *  numeric id to a real provider name, so it's left unused rather than
 *  guessed at. Falls back to the generic static string while loading, on
 *  failure, or if this tile's response has no date-range header at all. */
export function useBingDynamicAttribution(latitude: number, longitude: number, zoom: number): string {
  const { label } = useBingCaptureDate(latitude, longitude, zoom)
  return label ? `Bing - imagery through ${label}` : STATIC_BASEMAP_ATTRIBUTIONS.bing
}
