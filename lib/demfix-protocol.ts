import { elevationToTerrainrgb } from "./elevation-encoding"

/**
 * `demfix://` - wraps a titiler Terrain-RGB tile URL and refills its nodata
 * pixels. titiler writes nodata as transparent pixels; MapLibre's DEM
 * decoder ignores alpha and the browser premultiplies it to RGB 0, which is
 * the Terrain-RGB floor, -10000 m: every nodata edge became a 10 km cliff
 * and 3D terrain a pit. Those pixels are rewritten as 0 m with alpha 254 -
 * flat for MapLibre, still flagged as holes for this app's own decoders
 * (fetchDecodedTile's validity mask), the same convention as the in-browser
 * COG reader's tiles (makeElevationColorFunction in MapSources.tsx).
 *
 * URL: demfix://<encoded titiler template>/{z}/{x}/{y}
 */
const DEMFIX_URL_RE = /^demfix:\/\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export const buildDemFixUrl = (template: string) => `demfix://${encodeURIComponent(template)}/{z}/{x}/{y}`

/** The wrapped template's real URL for a tile (for readers that decode the
 *  PNG themselves and honour alpha, e.g. fetchDecodedTile). */
export function unwrapDemFixUrl(url: string): string | null {
  const m = url.match(DEMFIX_URL_RE)
  if (!m) return null
  return decodeURIComponent(m[1]).replace("{z}", m[2]).replace("{x}", m[3]).replace("{y}", m[4])
}

const HOLE_RGB = elevationToTerrainrgb(0)

export async function demFixProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const inner = unwrapDemFixUrl(params.url)
  if (!inner) throw new Error(`Invalid demfix protocol URL: ${params.url}`)
  const response = await fetch(inner, { signal: abortController.signal })
  if (!response.ok) throw new Error(`Tile ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0)
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  const d = img.data
  let touched = false
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 255) continue
    d[i] = HOLE_RGB[0]; d[i + 1] = HOLE_RGB[1]; d[i + 2] = HOLE_RGB[2]; d[i + 3] = 254
    touched = true
  }
  if (touched) ctx.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
