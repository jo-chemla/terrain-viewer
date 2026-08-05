// Real per-tile capture-date-range for Bing Aerial (already an existing plain
// basemap — see rasterBasemaps.bing in MapSources.tsx). Unlike Wayback/GE,
// Bing has no separate metadata endpoint: the date range is a response
// header (X-Ve-Tilemeta-Capturedatesrange) on the tile image itself, read
// once for the current view center — confirmed readable cross-origin by a
// direct browser fetch (2026-08-01), same "tile center, not per-pixel"
// constraint as lib/wayback.ts's useWaybackCaptureDate.
import { useEffect, useState } from "react"

function toQuadkey(tileX: number, tileY: number, zoom: number): string {
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

export function useBingCaptureDate(latitude: number, longitude: number, zoom: number): { label: string | null; dateMs: number | null; loading: boolean } {
  const [label, setLabel] = useState<string | null>(null)
  const [dateMs, setDateMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const z = Math.max(1, Math.min(21, Math.round(zoom)))
        const { x, y } = lngLatToTile(longitude, latitude, z)
        const quad = toQuadkey(x, y, z)
        const res = await fetch(`https://t.ssl.ak.tiles.virtualearth.net/tiles/a${quad}.jpeg?g=14603&n=z&prx=1`)
        const range = res.headers.get("X-Ve-Tilemeta-Capturedatesrange")
        if (cancelled) return
        if (!range) { setLabel(null); setDateMs(null); return }
        const [, to] = range.split("-")
        const d = to ? new Date(to) : null
        if (d && !isNaN(d.getTime())) {
          setLabel(d.toISOString().slice(0, 10))
          setDateMs(d.getTime())
        } else {
          setLabel(range)
          setDateMs(null)
        }
      } catch {
        if (!cancelled) { setLabel(null); setDateMs(null) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, BING_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude, zoom])

  return { label, dateMs, loading }
}
