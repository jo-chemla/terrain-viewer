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
  /** Aborts the in-flight per-tile fetch (and rejects this call) — checked by
   *  `fetch` itself at call time, so an abort between tiles takes effect on
   *  the very next iteration without a separate `aborted` check here. */
  signal?: AbortSignal
  /** Overrides how each tile's image bytes are obtained — defaults to a plain
   *  `fetch(url, {signal})` + `.blob()`. Needed for a tileUrlTemplate whose
   *  scheme a plain `fetch()` can't resolve, e.g. `lrm://` (lib/lrm-
   *  protocol.ts): that scheme is only ever dispatched by MAPLIBRE'S OWN
   *  request pipeline via `maplibregl.addProtocol`, which does NOT intercept
   *  arbitrary `fetch()` calls made elsewhere — see lib/elevation-query.ts's
   *  LRM sampling for the caller that needs this. */
  fetchTileBlob?: (url: string, signal?: AbortSignal) => Promise<Blob>
}

// Exported so lib/rgb-tile-mosaic.ts (the RGB-band sibling used by batch
// imagery export) can share the exact same tile-grid math instead of a
// second, driftable copy.
export function lonLatToTileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878)
  const latRad = (clampedLat * Math.PI) / 180
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return [x, y]
}

export function tileXYToLonLat(x: number, y: number, z: number): [number, number] {
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
    const [x0, y0] = lonLatToTileXY(west, north, z)
    const [x1, y1] = lonLatToTileXY(east, south, z)
    // Pixel resolution the bbox actually spans at this zoom is its FRACTIONAL
    // tile-span times tileSize — not `ceil(x1) - floor(x0)` (the count of
    // whole tiles it touches), which is always >= 1 by definition. That
    // whole-tile-count version made this trivially pass at zoom 0 for ANY
    // small bbox (a single world-spanning tile at z=0 already "has" tileSize
    // pixels, e.g. 512 >= a 128px target, regardless of how little of that
    // tile the bbox occupies) — confirmed via a real ~300m elevation-profile
    // bbox always resolving to z=0 and sampling a blank/degenerate world
    // tile instead of real detail.
    const pixelWidth = Math.abs(x1 - x0) * tileSize
    const pixelHeight = Math.abs(y1 - y0) * tileSize
    if (pixelWidth >= targetWidth && pixelHeight >= targetHeight) return z
  }
  return maxZoom
}

/** Whether a fetchTileMosaic failure means "no tile at this zoom, try one
 *  lower" rather than a real/permanent error. Plain tile-mosaic fetches throw
 *  `Tile fetch failed (404): ...` (see fetchTileMosaic below). LRM sampling
 *  (lib/lrm-protocol.ts, routed through fetchTileBlob) throws two differently
 *  -shaped messages instead — both from lib/normal-derived-protocol.ts, which
 *  discards the upstream HTTP status on any failure (returns null uniformly,
 *  a design shared with every other derived-protocol mode), so neither has a
 *  "(404)" substring to match: `Failed to fetch LRM center tile at z/x/y` (the
 *  fine tile itself is missing) and the generic `Failed to fetch center tile
 *  at z/x/y` fetchPaddedElevationGrid throws when the ANCESTOR (regional-
 *  trend) tile it fetches for the low-pass side of the LRM difference is
 *  missing instead. Recognizing all three lets a zoom-fallback loop actually
 *  fall back for LRM instead of throwing on the first missing tile — whether
 *  that's the fine tile or its ancestor. Shared by lib/elevation-query.ts
 *  (point/path sampling) and lib/client-export.ts (bulk DTM export). */
export function isRetryableTileError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /\(404\)/.test(err.message) || /Failed to fetch.*center tile/.test(err.message)
}

export async function fetchTileMosaic(opts: FetchTileMosaicOptions): Promise<TileMosaicResult> {
  const { tileUrlTemplate, tileSize, bbox, zoom, decodePixel, onProgress, signal, fetchTileBlob } = opts
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

      const blob = fetchTileBlob
        ? await fetchTileBlob(url, signal)
        : await (async () => {
            const response = await fetch(url, { signal })
            if (!response.ok) throw new Error(`Tile fetch failed (${response.status}): ${url}`)
            return response.blob()
          })()
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
