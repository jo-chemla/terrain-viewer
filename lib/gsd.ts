// Ground sampling distance of a source: declared (resolutionM, a catalog's
// own number) or estimated from its max zoom, the Web Mercator pixel size
// at that zoom and latitude. Shown wherever a source is listed so the user
// knows what to expect before zooming in.

/** Metres per pixel of a Web Mercator tile at a zoom, at a latitude. */
export const gsdFromZoom = (maxzoom: number, latDeg = 0, tileSize = 256) =>
  (40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (tileSize * 2 ** maxzoom)

export interface GsdEstimate { m: number; estimated: boolean; zoom?: number }

/** The source's ground resolution, declared or from its max zoom; null when
 *  it says neither. */
export function sourceGsd(s: { resolutionM?: number; maxzoom?: number; tileSize?: number } | null | undefined, latDeg = 0): GsdEstimate | null {
  if (!s) return null
  if (Number.isFinite(s.resolutionM) && (s.resolutionM as number) > 0) return { m: s.resolutionM as number, estimated: false }
  if (Number.isFinite(s.maxzoom) && (s.maxzoom as number) > 0) return { m: gsdFromZoom(s.maxzoom as number, latDeg, s.tileSize ?? 256), estimated: true, zoom: s.maxzoom }
  return null
}

export const gsdLabel = (g: number) => (g < 1 ? `${Math.round(g * 100)} cm` : g < 10 ? `${+g.toFixed(1)} m` : `${Math.round(g)} m`)

/** "50 cm/px", or "~1.2 m/px (zoom 17)" for an estimate. */
export const gsdText = (e: GsdEstimate | null) => (e ? (e.estimated ? `~${gsdLabel(e.m)}/px (zoom ${e.zoom})` : `${gsdLabel(e.m)}/px`) : "")
