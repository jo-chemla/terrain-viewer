// Threshold outline tiles, registered as the `threshold://` protocol: the
// upstream DEM tile re-encoded as a two-level Terrarium raster, 500 where
// the elevation is below the value (or nodata) and 1500 where it is at or
// above it. Fed to maplibre-contour with a single 1000 m interval, the only
// isoline is the boundary between the two plateaus: the outline of
// everything above the threshold. On an nDSM at 1.5 m that is canopy and
// buildings; on a DEM it is a flood or a lake level. The contour engine then
// does what it already does (simplification, vector tiles, GeoJSON export),
// so nothing new is drawn here. Neither plateau sits on a level (0, 1000,
// 2000): a plateau exactly at a level gave degenerate "ele 0" features.
import { elevationToTerrarium } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile, buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"

const THRESHOLD_URL_RE = /^threshold:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?v=(-?[\d.]+)$/

/** The contour interval that puts the only isoline between the two plateaus. */
export const THRESHOLD_CONTOUR_INTERVAL = 1000
const BELOW = 500
const ABOVE = 1500

export function buildThresholdProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, value: number,
): string {
  return `${buildProtocolUrl("threshold", upstreamTileTemplate, encoding, tileSize)}?v=${Number.isFinite(value) ? value : 0}`
}

export async function thresholdProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(THRESHOLD_URL_RE)
  if (!match) throw new Error(`Invalid threshold protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, vStr] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const value = parseFloat(vStr)
  const upstreamUrl = decodeURIComponent(encodedTemplate).replace("{z}", zStr).replace("{x}", xStr).replace("{y}", yStr)
  const tile = await fetchDecodedTile(sharedTileCache, upstreamUrl, encoding, abortController.signal)
  const [r0, g0, b0] = elevationToTerrarium(BELOW)
  const [r1, g1, b1] = elevationToTerrarium(ABOVE)
  const out = new Uint8ClampedArray(n * n * 4)
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
    out[o] = above ? r1 : r0; out[o + 1] = above ? g1 : g0; out[o + 2] = above ? b1 : b0; out[o + 3] = 255
  }
  return { data: await toTileImage(out, n) }
}

/** `getTile` for maplibre-contour's LocalDemManager: a `threshold://` URL is
 *  not fetchable, so the protocol runs as a plain function (same shape as
 *  lrmFetchTileBlob). */
export async function thresholdFetchTileBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort())
  }
  const { data } = await thresholdProtocol({ url }, controller)
  if (data instanceof ImageBitmap) {
    const canvas = new OffscreenCanvas(data.width, data.height)
    canvas.getContext("2d")!.drawImage(data, 0, 0)
    return canvas.convertToBlob({ type: "image/png" })
  }
  return new Blob([data as BlobPart], { type: "image/png" })
}
