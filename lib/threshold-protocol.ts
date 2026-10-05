// Threshold tiles, registered as the `threshold://` protocol: the upstream
// tile re-encoded as a two-level Terrarium raster, 500 where the measure is
// below the value (or nodata) and 1500 where it is at or above it. The
// upstream is any DEM-shaped template: the terrain itself, or one of the
// derived protocols (slope://, curvature://, svf://, …), which all write
// their measure as a Terrarium (or Terrain-RGB) scalar, so the same code
// draws an iso-slope at 30°, a sky-view factor at 0.8, a curvature at 1.5 or
// a flood level at 312 m. A colour tile (Phong, Matcap, the hard shadow) goes
// through `luma://` below first, which turns it into a Terrarium luminance.
//
// Fed to maplibre-contour with a single 1000 m interval, the only isoline is
// the boundary between the two plateaus: the outline of everything above the
// threshold. Neither plateau sits on a level (0, 1000, 2000): a plateau
// exactly at a level gave degenerate "ele 0" features. With `fill=rrggbb&a=`
// the tile is instead a raster fill: clear below, the colour above, from the
// same pixels the outline comes from, so the fill stops at the line.
import { elevationToTerrarium } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile, buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"
import { fetchTileBitmap } from "./protocol-registry"
import { toTileImage, type TileImage } from "./tile-image"

const THRESHOLD_URL_RE = /^threshold:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?v=(-?[\d.]+)(?:&fill=([0-9a-f]{6})&a=([\d.]+))?$/
const LUMA_URL_RE = /^luma:\/\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

/** The contour interval that puts the only isoline between the two plateaus. */
export const THRESHOLD_CONTOUR_INTERVAL = 1000
const BELOW = 500
const ABOVE = 1500

export function buildThresholdProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
  /** In the upstream's own encoded units (a derived protocol's scale applies). */
  value: number,
  /** A colour and opacity: the tile becomes a fill (the area above the
   *  value in that colour, clear elsewhere) instead of the two plateaus. */
  fill?: { color: string; opacity: number },
): string {
  const f = fill ? `&fill=${fill.color.replace("#", "").toLowerCase().padEnd(6, "0").slice(0, 6)}&a=${fill.opacity.toFixed(2)}` : ""
  return `${buildProtocolUrl("threshold", upstreamTileTemplate, encoding, tileSize)}?v=${Number.isFinite(value) ? value : 0}${f}`
}

export async function thresholdProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(THRESHOLD_URL_RE)
  if (!match) throw new Error(`Invalid threshold protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, vStr, fillHex, fillA] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const value = parseFloat(vStr)
  // The two plateaus for the contour engine, or a fill: clear below, the
  // colour above.
  const fill = fillHex ? { r: parseInt(fillHex.slice(0, 2), 16), g: parseInt(fillHex.slice(2, 4), 16), b: parseInt(fillHex.slice(4, 6), 16), a: Math.round(Math.max(0, Math.min(1, parseFloat(fillA))) * 255) } : null
  const [r0, g0, b0, alpha0] = fill ? [0, 0, 0, 0] : [...elevationToTerrarium(BELOW), 255]
  const [r1, g1, b1, alpha1] = fill ? [fill.r, fill.g, fill.b, fill.a] : [...elevationToTerrarium(ABOVE), 255]
  const out = new Uint8ClampedArray(n * n * 4)
  const upstreamUrl = decodeURIComponent(encodedTemplate).replace("{z}", zStr).replace("{x}", xStr).replace("{y}", yStr)
  const tile = await fetchDecodedTile(sharedTileCache, upstreamUrl, encoding, abortController.signal)
  for (let i = 0; i < n * n; i++) {
    let above = false
    if (tile) {
      // The upstream may come at another size; nearest sample.
      const sx = Math.min(tile.width - 1, Math.floor(((i % n) + 0.5) * tile.width / n))
      const sy = Math.min(tile.height - 1, Math.floor((Math.floor(i / n) + 0.5) * tile.height / n))
      const j = sy * tile.width + sx
      const e = tile.data[j]
      above = Number.isFinite(e) && (!tile.valid || tile.valid[j] !== 0) && e >= value
    }
    const o = i * 4
    out[o] = above ? r1 : r0; out[o + 1] = above ? g1 : g0; out[o + 2] = above ? b1 : b0; out[o + 3] = above ? alpha1 : alpha0
  }
  return { data: await toTileImage(out, n) }
}

/** `luma://<tileSize>/<encoded colour template>/{z}/{x}/{y}`: a colour tile
 *  (Phong, Matcap, the hard shadow — any RGBA raster) as a Terrarium scalar
 *  of its brightness, 0 to 255, so the threshold and the contour engine can
 *  trace "where the shading is brighter than" or every 32 levels of it. The
 *  lighting tiles are overlays (Phong is black or white with the alpha as
 *  the strength, the shadow black where shaded), so the pixel is composited
 *  over a mid grey first: 128 is neutral shading, 0 full shadow, 255 the
 *  brightest highlight; an opaque tile (Matcap) reads as its luminance. */
export function buildLumaProtocolUrl(colourTileTemplate: string, tileSize: number): string {
  return `luma://${tileSize}/${encodeURIComponent(colourTileTemplate)}/{z}/{x}/{y}`
}

export async function lumaProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(LUMA_URL_RE)
  if (!match) throw new Error(`Invalid luma protocol URL: ${params.url}`)
  const [, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const n = parseInt(tileSizeStr, 10)
  const upstreamUrl = decodeURIComponent(encodedTemplate).replace("{z}", zStr).replace("{x}", xStr).replace("{y}", yStr)
  const bitmap = await fetchTileBitmap(upstreamUrl, abortController.signal)
  const out = new Uint8ClampedArray(n * n * 4)
  if (bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    bitmap.close()
    for (let i = 0; i < n * n; i++) {
      const sx = Math.min(width - 1, Math.floor(((i % n) + 0.5) * width / n))
      const sy = Math.min(height - 1, Math.floor((Math.floor(i / n) + 0.5) * height / n))
      const j = (sy * width + sx) * 4
      const a = data[j + 3] / 255
      const luma = 128 * (1 - a) + (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) * a
      const [r, g, b] = elevationToTerrarium(luma)
      const o = i * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255
    }
  }
  return { data: await toTileImage(out, n) }
}
