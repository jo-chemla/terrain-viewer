// RGB sibling of lib/tile-mosaic.ts's fetchTileMosaic — that function
// collapses each pixel to one scalar via a `decodePixel` callback (built for
// single-band elevation encodings), which can't represent a 3-band basemap/
// imagery mosaic. This keeps R/G/B (alpha dropped — GeoTIFF export writes
// plain RGB, not RGBA) per pixel in one pass instead, reusing the same tile-
// grid math (lonLatToTileXY/tileXYToLonLat) and canvas-decode approach.
import { lonLatToTileXY, tileXYToLonLat } from "./tile-mosaic"

export interface RgbTileMosaicResult {
  r: Uint8Array
  g: Uint8Array
  b: Uint8Array
  width: number
  height: number
  /** Actual tile-aligned bbox of the mosaic — usually slightly larger than
   *  the requested bbox since it snaps to whole tiles. */
  bbox: [west: number, south: number, east: number, north: number]
}

export interface FetchRgbTileMosaicOptions {
  /** Tile URL template containing literal {z}/{x}/{y} placeholders. Ignored
   *  when `buildTileUrl` is given instead (e.g. Bing's quadkey scheme, which
   *  isn't a simple positional substitution — see lib/bing.ts). */
  tileUrlTemplate?: string
  /** Overrides tileUrlTemplate's plain {z}/{x}/{y} substitution for sources
   *  whose URL isn't a simple template (quadkey-addressed tiles, etc). */
  buildTileUrl?: (z: number, x: number, y: number) => string
  tileSize: number
  /** Requested bbox in lon/lat (EPSG:4326), [west, south, east, north]. */
  bbox: [number, number, number, number]
  zoom: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export async function fetchRgbTileMosaic(opts: FetchRgbTileMosaicOptions): Promise<RgbTileMosaicResult> {
  const { tileUrlTemplate, buildTileUrl, tileSize, bbox, zoom, onProgress, signal } = opts
  if (!tileUrlTemplate && !buildTileUrl) throw new Error("fetchRgbTileMosaic needs either tileUrlTemplate or buildTileUrl")
  const [west, south, east, north] = bbox

  const [xMinF, yMinF] = lonLatToTileXY(west, north, zoom)
  const [xMaxF, yMaxF] = lonLatToTileXY(east, south, zoom)
  const xMin = Math.floor(xMinF)
  const yMin = Math.floor(yMinF)
  const xMax = Math.max(xMin, Math.ceil(xMaxF) - 1)
  const yMax = Math.max(yMin, Math.ceil(yMaxF) - 1)

  const cols = xMax - xMin + 1
  const rows = yMax - yMin + 1
  const width = cols * tileSize
  const height = rows * tileSize
  const r = new Uint8Array(width * height)
  const g = new Uint8Array(width * height)
  const b = new Uint8Array(width * height)

  let done = 0
  const total = cols * rows

  for (let ty = yMin; ty <= yMax; ty++) {
    for (let tx = xMin; tx <= xMax; tx++) {
      const url = buildTileUrl
        ? buildTileUrl(zoom, tx, ty)
        : tileUrlTemplate!.replace("{z}", String(zoom)).replace("{x}", String(tx)).replace("{y}", String(ty))

      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`Tile fetch failed (${response.status}): ${url}`)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)

      const canvas = document.createElement("canvas")
      canvas.width = tileSize
      canvas.height = tileSize
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(bitmap, 0, 0, tileSize, tileSize)
      const pixels = ctx.getImageData(0, 0, tileSize, tileSize).data
      bitmap.close()

      const ox = (tx - xMin) * tileSize
      const oy = (ty - yMin) * tileSize
      for (let py = 0; py < tileSize; py++) {
        const rowOffset = (oy + py) * width + ox
        const srcRowOffset = py * tileSize
        for (let px = 0; px < tileSize; px++) {
          const i = (srcRowOffset + px) * 4
          const outIdx = rowOffset + px
          r[outIdx] = pixels[i]
          g[outIdx] = pixels[i + 1]
          b[outIdx] = pixels[i + 2]
        }
      }

      done++
      onProgress?.(done / total)
    }
  }

  const [mosaicWest, mosaicNorth] = tileXYToLonLat(xMin, yMin, zoom)
  const [mosaicEast, mosaicSouth] = tileXYToLonLat(xMax + 1, yMax + 1, zoom)

  return { r, g, b, width, height, bbox: [mosaicWest, mosaicSouth, mosaicEast, mosaicNorth] }
}
