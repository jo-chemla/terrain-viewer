// Generic XYZ tile fetcher + mosaicker — deliberately not terrain-specific, so it can
// back a raster-imagery (basemap) export the same way it backs a DTM export today.
// Callers supply `decodePixel` to turn each tile's RGBA into whatever scalar/vector
// they need (e.g. elevation via lib/elevation-encoding.ts's terrainrgbToElevation).

export interface TileMosaicResult {
  data: Float32Array
  width: number
  height: number
  /** Actual tile-aligned bbox of the mosaic — usually slightly larger than the
   *  requested bbox since it snaps to whole tiles. */
  bbox: [west: number, south: number, east: number, north: number]
}

export interface FetchTileMosaicOptions {
  /** Tile URL template containing literal {z}/{x}/{y} placeholders. */
  tileUrlTemplate: string
  tileSize: number
  /** Requested bbox in lon/lat (EPSG:4326), [west, south, east, north]. */
  bbox: [number, number, number, number]
  zoom: number
  decodePixel: (r: number, g: number, b: number, a: number) => number
  onProgress?: (fraction: number) => void
}

function lonLatToTileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878)
  const latRad = (clampedLat * Math.PI) / 180
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return [x, y]
}

function tileXYToLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z
  const lon = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  const lat = (latRad * 180) / Math.PI
  return [lon, lat]
}

/** Picks the smallest zoom level (up to maxZoom) whose tile grid resolution meets or
 *  exceeds the requested output size for the given bbox. */
export function pickZoomForResolution(
  bbox: [number, number, number, number],
  targetWidth: number,
  targetHeight: number,
  tileSize: number,
  maxZoom = 20,
): number {
  const [west, south, east, north] = bbox
  for (let z = 0; z <= maxZoom; z++) {
    const [x0] = lonLatToTileXY(west, north, z)
    const [x1] = lonLatToTileXY(east, south, z)
    const cols = Math.max(1, Math.ceil(x1) - Math.floor(x0))
    if (cols * tileSize >= targetWidth) {
      const [, y0] = lonLatToTileXY(west, north, z)
      const [, y1] = lonLatToTileXY(east, south, z)
      const rows = Math.max(1, Math.ceil(y1) - Math.floor(y0))
      if (rows * tileSize >= targetHeight) return z
    }
  }
  return maxZoom
}

export async function fetchTileMosaic(opts: FetchTileMosaicOptions): Promise<TileMosaicResult> {
  const { tileUrlTemplate, tileSize, bbox, zoom, decodePixel, onProgress } = opts
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
  const data = new Float32Array(width * height)

  let done = 0
  const total = cols * rows

  for (let ty = yMin; ty <= yMax; ty++) {
    for (let tx = xMin; tx <= xMax; tx++) {
      const url = tileUrlTemplate
        .replace("{z}", String(zoom))
        .replace("{x}", String(tx))
        .replace("{y}", String(ty))

      const response = await fetch(url)
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
          data[rowOffset + px] = decodePixel(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])
        }
      }

      done++
      onProgress?.(done / total)
    }
  }

  const [mosaicWest, mosaicNorth] = tileXYToLonLat(xMin, yMin, zoom)
  const [mosaicEast, mosaicSouth] = tileXYToLonLat(xMax + 1, yMax + 1, zoom)

  return { data, width, height, bbox: [mosaicWest, mosaicSouth, mosaicEast, mosaicNorth] }
}
