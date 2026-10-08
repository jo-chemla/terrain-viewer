// RGB sibling of lib/tile-mosaic.ts's fetchTileMosaic — that function
// collapses each pixel to one scalar via a `decodePixel` callback (built for
// single-band elevation encodings), which can't represent a 3-band basemap/
// imagery mosaic. This keeps R/G/B (alpha dropped — GeoTIFF export writes
// plain RGB, not RGBA) per pixel instead, reusing the same tile-grid math
// (lonLatToTileXY/tileXYToLonLat).
//
// The tiles are composited on one canvas of the OUTPUT size: each tile is
// drawn at its place (clipped to the crop window, scaled when the output is
// smaller than the native pixel grid), and the pixels are read back once.
// That is what lets the mosaic be cropped to the requested bbox and
// resampled to a requested pixel size without ever holding the full native
// tile grid in memory.
import { lonLatToTileXY, tileXYToLonLat } from "./tile-mosaic"

/** Tiles fetched at once (same figure as lib/tile-mosaic.ts). */
const MOSAIC_CONCURRENCY = 6

export interface RgbTileMosaicResult {
  r: Uint8Array
  g: Uint8Array
  b: Uint8Array
  width: number
  height: number
  /** Georeferenced extent of the pixels returned: tile-aligned when `crop`
   *  is off (usually larger than the requested bbox), the requested bbox
   *  snapped outward to the zoom's own pixel grid when it is on. */
  bbox: [west: number, south: number, east: number, north: number]
  /** Zoom the tiles were fetched at. */
  zoom: number
  /** Pixel size of the extent at that zoom before any resampling; equals
   *  width/height unless outputWidth/outputHeight asked for another size. */
  nativeWidth: number
  nativeHeight: number
  /** Top-left corner of the extent in the zoom's global pixel grid
   *  (tile x * tileSize), so a caller can map output pixels back to lon/lat. */
  originPx: [x: number, y: number]
}

export interface FetchRgbTileMosaicOptions {
  /** Tile URL template containing literal {z}/{x}/{y} placeholders. Ignored
   *  when `buildTileUrl` is given instead (e.g. Bing's quadkey scheme, which
   *  isn't a simple positional substitution — see lib/bing.ts). */
  tileUrlTemplate?: string
  /** Overrides tileUrlTemplate's plain {z}/{x}/{y} substitution for sources
   *  whose URL isn't a simple template (quadkey-addressed tiles, etc). */
  buildTileUrl?: (z: number, x: number, y: number) => string
  /** Bypasses fetch() entirely for sources that only exist behind a MapLibre
   *  custom protocol (Google Earth Historical's gehist://, which the Fetch
   *  API refuses with "URL scheme not supported"): resolves the tile bytes
   *  in-process instead. Wins over tileUrlTemplate / buildTileUrl. */
  fetchTileBlob?: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Blob>
  tileSize: number
  /** Requested bbox in lon/lat (EPSG:4326), [west, south, east, north]. */
  bbox: [number, number, number, number]
  zoom: number
  /** Crop the result to `bbox` (snapped outward to whole pixels of the
   *  zoom's grid) instead of returning every whole tile it touches. */
  crop?: boolean
  /** Resample the (cropped) extent to this size; defaults to its native
   *  pixel size at `zoom`. Only meaningful with `crop`. */
  outputWidth?: number
  outputHeight?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Pixel window [x0, y0, x1, y1) of a bbox in the zoom's global pixel grid:
 *  whole tiles when `crop` is off, whole pixels (snapped outward) when on. */
export function mosaicPixelWindow(bbox: [number, number, number, number], zoom: number, tileSize: number, crop: boolean): [number, number, number, number] {
  const [west, south, east, north] = bbox
  const [xMinF, yMinF] = lonLatToTileXY(west, north, zoom)
  const [xMaxF, yMaxF] = lonLatToTileXY(east, south, zoom)
  if (!crop) {
    const xMin = Math.floor(xMinF)
    const yMin = Math.floor(yMinF)
    const xMax = Math.max(xMin, Math.ceil(xMaxF) - 1)
    const yMax = Math.max(yMin, Math.ceil(yMaxF) - 1)
    return [xMin * tileSize, yMin * tileSize, (xMax + 1) * tileSize, (yMax + 1) * tileSize]
  }
  const x0 = Math.floor(xMinF * tileSize)
  const y0 = Math.floor(yMinF * tileSize)
  const x1 = Math.max(x0 + 1, Math.ceil(xMaxF * tileSize))
  const y1 = Math.max(y0 + 1, Math.ceil(yMaxF * tileSize))
  return [x0, y0, x1, y1]
}

export async function fetchRgbTileMosaic(opts: FetchRgbTileMosaicOptions): Promise<RgbTileMosaicResult> {
  const { tileUrlTemplate, buildTileUrl, fetchTileBlob, tileSize, bbox, zoom, crop = false, onProgress, signal } = opts
  if (!tileUrlTemplate && !buildTileUrl && !fetchTileBlob) throw new Error("fetchRgbTileMosaic needs a tileUrlTemplate, buildTileUrl or fetchTileBlob")

  const [px0, py0, px1, py1] = mosaicPixelWindow(bbox, zoom, tileSize, crop)
  const nativeWidth = px1 - px0
  const nativeHeight = py1 - py0
  const width = Math.max(1, Math.round(opts.outputWidth ?? nativeWidth))
  const height = Math.max(1, Math.round(opts.outputHeight ?? nativeHeight))
  const scaleX = width / nativeWidth
  const scaleY = height / nativeHeight

  const xMin = Math.floor(px0 / tileSize)
  const yMin = Math.floor(py0 / tileSize)
  const xMax = Math.ceil(px1 / tileSize) - 1
  const yMax = Math.ceil(py1 / tileSize) - 1
  const cols = xMax - xMin + 1
  const rows = yMax - yMin + 1

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  let done = 0
  const total = cols * rows

  const fetchOne = async (tx: number, ty: number) => {
    let blob: Blob
    if (fetchTileBlob) {
      blob = await fetchTileBlob(zoom, tx, ty, signal)
    } else {
      const url = buildTileUrl
        ? buildTileUrl(zoom, tx, ty)
        : tileUrlTemplate!.replace("{z}", String(zoom)).replace("{x}", String(tx)).replace("{y}", String(ty))
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`Tile fetch failed (${response.status}): ${url}`)
      blob = await response.blob()
    }
    const bitmap = await createImageBitmap(blob)
    // A 512 px bitmap for a 256 px tile grid (retina tiles) is scaled down
    // through the source rect, as drawImage(bitmap, 0, 0, tileSize, tileSize) did.
    const k = bitmap.width / tileSize
    // Part of this tile inside the window, in the zoom's pixel grid.
    const wx0 = Math.max(tx * tileSize, px0)
    const wy0 = Math.max(ty * tileSize, py0)
    const wx1 = Math.min((tx + 1) * tileSize, px1)
    const wy1 = Math.min((ty + 1) * tileSize, py1)
    // Destination edges rounded per tile boundary, so neighbouring tiles
    // meet on the same output column/row with no antialiased seam between
    // them (a fractional edge would leave a half-covered, half-transparent line).
    const dx0 = Math.round((wx0 - px0) * scaleX)
    const dx1 = Math.round((wx1 - px0) * scaleX)
    const dy0 = Math.round((wy0 - py0) * scaleY)
    const dy1 = Math.round((wy1 - py0) * scaleY)
    if (dx1 > dx0 && dy1 > dy0) {
      ctx.drawImage(
        bitmap,
        (wx0 - tx * tileSize) * k, (wy0 - ty * tileSize) * k, (wx1 - wx0) * k, (wy1 - wy0) * k,
        dx0, dy0, dx1 - dx0, dy1 - dy0,
      )
    }
    bitmap.close()
    done++
    onProgress?.(done / total)
  }

  // Several tiles at once (each draws its own rectangle of the canvas);
  // the first failure stops the other workers.
  const queue: [number, number][] = []
  for (let ty = yMin; ty <= yMax; ty++) for (let tx = xMin; tx <= xMax; tx++) queue.push([tx, ty])
  let failed: unknown = null
  const worker = async () => {
    while (queue.length && failed === null) {
      const [tx, ty] = queue.shift()!
      try { await fetchOne(tx, ty) } catch (e) { if (failed === null) failed = e }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MOSAIC_CONCURRENCY, queue.length) }, worker))
  if (failed !== null) throw failed

  const pixels = ctx.getImageData(0, 0, width, height).data
  const n = width * height
  const r = new Uint8Array(n)
  const g = new Uint8Array(n)
  const b = new Uint8Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    r[i] = pixels[j]
    g[i] = pixels[j + 1]
    b[i] = pixels[j + 2]
  }
  canvas.width = canvas.height = 0

  const [mosaicWest, mosaicNorth] = tileXYToLonLat(px0 / tileSize, py0 / tileSize, zoom)
  const [mosaicEast, mosaicSouth] = tileXYToLonLat(px1 / tileSize, py1 / tileSize, zoom)

  return { r, g, b, width, height, bbox: [mosaicWest, mosaicSouth, mosaicEast, mosaicNorth], zoom, nativeWidth, nativeHeight, originPx: [px0, py0] }
}
