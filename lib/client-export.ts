// Titiler-independent DTM export. Runs entirely in the browser: COGs are read via
// direct HTTP range requests (geotiff.js), TMS terrainrgb/terrarium sources are
// mosaicked from individually-fetched tiles (lib/tile-mosaic.ts). This bypasses
// titiler's server-side canvas/timeout limits, so it's the path to use for exports
// larger than the "maxResolution" setting the titiler pipeline is comfortable with.
//
// Deliberately narrow in scope: per-project decision, only cog/terrainrgb/terrarium
// are supported here (vrt/stac/mosaicjson need server-side GDAL mosaicking; wms-raw
// and tilejson are low-value enough to not justify a bespoke client path). Those
// types keep working through the existing titiler export in download-section.tsx.

import { regionReaderFor, fetchTileBitmap } from "./protocol-registry"
import { terrainrgbToElevation, terrariumToElevation } from "./elevation-encoding"
import { fetchTileMosaic, pickZoomForResolution, isRetryableTileError } from "./tile-mosaic"
import { terrainSources } from "./terrain-sources"
import type { TerrainSource } from "./terrain-types"
import type { CustomTerrainSource } from "./settings-atoms"
import { resolveLocalFileUrl, localFileId } from "./local-file-store"

type ClientExportableType = "cog" | "terrainrgb" | "terrarium"

export interface ClientExportSource {
  type: ClientExportableType
  url: string
  tileSize: number
  maxzoom: number
}

function isClientExportSupported(type: string | undefined): type is ClientExportableType | "cog-local" {
  return type === "cog" || type === "cog-local" || type === "terrainrgb" || type === "terrarium"
}

/** Resolves a sourceA key (built-in or custom) into the raw, un-wrapped tile/COG URL
 *  this module needs — i.e. never a `cog://` or titiler-proxied URL, since both the
 *  range-read and the tile-mosaic paths fetch the origin server directly. Returns
 *  null for a "cog-local" source that hasn't been (re-)picked this session, same
 *  "not ready" shape as an unsupported type. */
function getClientExportSourceDirect(
  sourceKey: string,
  customTerrainSources: CustomTerrainSource[],
  getTilesUrl: (key: TerrainSource) => string,
): ClientExportSource | null {
  const builtin = (terrainSources as any)[sourceKey]
  if (builtin) {
    if (!isClientExportSupported(builtin.encoding)) return null
    return {
      type: builtin.encoding,
      url: getTilesUrl(sourceKey as TerrainSource),
      tileSize: builtin.sourceConfig.tileSize || 256,
      maxzoom: builtin.sourceConfig.maxzoom || 20,
    }
  }

  const custom = customTerrainSources.find((s) => s.id === sourceKey)
  if (!custom || !isClientExportSupported(custom.type)) return null
  if (custom.type === "cog-local") {
    const resolvedUrl = resolveLocalFileUrl(localFileId(custom.url))
    if (!resolvedUrl) return null
    return { type: "cog", url: resolvedUrl, tileSize: 256, maxzoom: custom.maxzoom || 22 }
  }
  return {
    type: custom.type,
    url: custom.url,
    tileSize: 256,
    maxzoom: custom.maxzoom || (custom.type === "cog" ? 22 : 20),
  }
}

/** The upstream the viz modes read for a source - the same template MapLibre
 *  fetches for the terrain, resolved by useClientDemUpstream (MapSources.tsx). */
export interface ClientDemUpstreamLike {
  template: string
  encoding: "terrarium" | "mapbox"
  tileSize: number
  maxzoom?: number
}

/** Resolves a sourceA key into what the client-side export, 2D picker and
 *  profile fetch. Built-in and plain custom sources resolve directly; any
 *  other type (VRT, LERC, quantized mesh, a difference, WMS, TileJSON) is
 *  exported from the client upstream the viz modes already read - its
 *  template is one of our own schemes, and tile-mosaic.ts dispatches those
 *  through the protocol registry. Null only when nothing can resolve it. */
export function getClientExportSource(
  sourceKey: string,
  customTerrainSources: CustomTerrainSource[],
  getTilesUrl: (key: TerrainSource) => string,
  upstream?: ClientDemUpstreamLike | null,
): ClientExportSource | null {
  const direct = getClientExportSourceDirect(sourceKey, customTerrainSources, getTilesUrl)
  if (direct) return direct
  if (!upstream) return null
  return {
    type: upstream.encoding === "mapbox" ? "terrainrgb" : "terrarium",
    url: upstream.template,
    tileSize: upstream.tileSize,
    maxzoom: upstream.maxzoom ?? 20,
  }
}

export interface ClientExportResult {
  data: Float32Array
  width: number
  height: number
  bbox: [west: number, south: number, east: number, north: number]
  /** True when the achieved pixel dimensions fall short of the requested
   *  targetResolution — the source's tile pyramid ran out of zoom before the
   *  bbox could be covered at the requested detail (a large area against a
   *  source whose maxzoom, possibly probed down further, isn't deep enough).
   *  Always false for cog exports, which always produce exactly the
   *  requested width/height (interpolated from whatever native detail
   *  exists, never pixel-count-limited the way a tile pyramid can be). */
  resolutionLimited?: boolean
}

function lonLatToWebMercator(lon: number, lat: number): [number, number] {
  const R = 6378137
  const x = (R * (lon * Math.PI)) / 180
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return [x, y]
}

/** Converts a WGS84 lng/lat bbox into the COG's own CRS units (degrees if the
 *  raster is geographic, Web Mercator meters otherwise) — shared by both the
 *  bulk export window read below and the single-point sample in
 *  lib/elevation-query.ts. */
function reprojectBboxToRasterCrs(
  image: { getBoundingBox: () => number[] },
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const rasterBbox = image.getBoundingBox() as [number, number, number, number]
  const isGeographic = rasterBbox.every((v, i) => Math.abs(v) <= (i % 2 === 0 ? 180 : 90))
  const [west, south, east, north] = bbox
  if (isGeographic) return [west, south, east, north]
  const [minX, minY] = lonLatToWebMercator(west, south)
  const [maxX, maxY] = lonLatToWebMercator(east, north)
  return [minX, minY, maxX, maxY]
}

async function exportCogWindow(
  url: string,
  bbox: [number, number, number, number],
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<ClientExportResult> {
  const { fromUrl } = await import("geotiff")
  const tiff = await fromUrl(url, undefined, signal)
  const image = await tiff.getImage()

  // COGs store raw altitude per pixel already — no terrainrgb/terrarium decoding
  // needed, just a windowed read at the requested bbox/resolution.
  const reqBbox = reprojectBboxToRasterCrs(image, bbox)
  // bbox-mode reads (with best-overview selection) only exist on the GeoTIFF
  // container's own readRasters — GeoTIFFImage.readRasters has no `bbox`
  // support at all and silently ignores it, falling back to its `window`
  // default of the WHOLE image (confirmed against geotiffimage.js: it
  // destructures window/width/height/etc. but never bbox).
  const rasters = await tiff.readRasters({ bbox: reqBbox, width, height, resampleMethod: "bilinear", signal })
  const data = Float32Array.from(rasters[0] as ArrayLike<number>)
  return { data, width, height, bbox }
}

/** Single-pixel elevation lookup for the Elevation Picker (2D mode) — deliberately
 *  NOT built on exportCogWindow's `bbox`-mode read above. geotiff.js's `bbox` path
 *  has to compare the requested area against every IFD (including every overview
 *  level) to pick a matching resolution and compute the corresponding pixel
 *  window itself; against a real multi-overview COG (confirmed against a 1.5GB,
 *  7-level, 26679x13150 file) that comparison sent it down a pathological slow
 *  path — over 50 SECONDS to decode a single point, freezing the tab solid,
 *  versus ~70ms reading the exact same pixel through an explicit `window`.
 *  A single point always wants the base (full) resolution regardless (there's no
 *  "target resolution" to match an overview against), so this reads the base
 *  image directly and computes the pixel offset itself from its own geotransform,
 *  skipping geotiff.js's bbox-to-window resolution entirely. */
export async function sampleCogPointElevation(url: string, lng: number, lat: number): Promise<number | null> {
  const { fromUrl } = await import("geotiff")
  const tiff = await fromUrl(url)
  const image = await tiff.getImage(0)
  const [reqX, reqY] = reprojectBboxToRasterCrs(image, [lng, lat, lng, lat])

  const rasterBbox = image.getBoundingBox() as [number, number, number, number]
  const [minX, minY, maxX, maxY] = rasterBbox
  const imgWidth = image.getWidth()
  const imgHeight = image.getHeight()
  const pixelScaleX = (maxX - minX) / imgWidth
  const pixelScaleY = (maxY - minY) / imgHeight
  if (!(pixelScaleX > 0) || !(pixelScaleY > 0)) return null

  const px = Math.floor((reqX - minX) / pixelScaleX)
  // Row 0 is the raster's NORTH (max Y) edge — pixel rows increase southward.
  const py = Math.floor((maxY - reqY) / pixelScaleY)
  if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight) return null

  const rasters = await image.readRasters({ window: [px, py, px + 1, py + 1], resampleMethod: "nearest" })
  const value = (rasters[0] as ArrayLike<number>)[0]
  return Number.isFinite(value) ? value : null
}

export interface ExportElevationClientSideParams {
  source: ClientExportSource
  bbox: [number, number, number, number]
  /** Sizing hint (e.g. the existing maxResolution setting) — for tile sources this
   *  picks a zoom level whose native tile grid meets or exceeds it; for cog it's used
   *  directly as the output width/height. */
  targetResolution: number
  onProgress?: (fraction: number) => void
  /** Use this zoom instead of picking one from targetResolution: the layer
   *  export passes the zoom the map is drawing, so every tile is already in
   *  the result cache. */
  zoom?: number
  /** Resample to exactly this many pixels over exactly `bbox`, on a regular
   *  EPSG:4326 grid. Without it the result is the raw tile mosaic: larger
   *  than the bbox (whole tiles) and spaced in Web Mercator rows, which a
   *  4326 GeoTIFF then stretches slightly in latitude. */
  outputSize?: { width: number; height: number }
  /** Lets a caller cancel an in-flight export — aborts the COG range read or the
   *  tile mosaic's next per-tile fetch (see fetchTileMosaic/exportCogWindow). */
  signal?: AbortSignal
}

const R = 6378137
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Samples a Web Mercator tile mosaic onto a regular EPSG:4326 grid of
 *  exactly width x height over bbox, bilinearly. A pixel whose four
 *  neighbours include nodata takes the nearest one instead, so holes keep
 *  hard edges rather than bleeding NaN or averaging into the data. */
export function resampleMosaic(
  mosaic: { data: Float32Array; width: number; height: number; bbox: [number, number, number, number] },
  bbox: [number, number, number, number], width: number, height: number,
): { data: Float32Array; width: number; height: number; bbox: [number, number, number, number] } {
  const [mw, ms, me, mn] = mosaic.bbox
  const W = mosaic.width, H = mosaic.height
  const yTop = mercY(mn), ySpan = yTop - mercY(ms)
  const out = new Float32Array(width * height)
  const [w, s, e, n] = bbox
  const colX = new Float32Array(width)
  for (let i = 0; i < width; i++) colX[i] = ((w + ((i + 0.5) * (e - w)) / width - mw) / (me - mw)) * W - 0.5
  for (let j = 0; j < height; j++) {
    const lat = n - ((j + 0.5) * (n - s)) / height
    const y = ((yTop - mercY(lat)) / ySpan) * H - 0.5
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(y))), y1 = Math.min(H - 1, y0 + 1), fy = Math.min(1, Math.max(0, y - y0))
    for (let i = 0; i < width; i++) {
      const x = colX[i]
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), x1 = Math.min(W - 1, x0 + 1), fx = Math.min(1, Math.max(0, x - x0))
      const a = mosaic.data[y0 * W + x0], b = mosaic.data[y0 * W + x1], c = mosaic.data[y1 * W + x0], d = mosaic.data[y1 * W + x1]
      out[j * width + i] = Number.isNaN(a + b + c + d)
        ? mosaic.data[(fy < 0.5 ? y0 : y1) * W + (fx < 0.5 ? x0 : x1)]
        : (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    }
  }
  return { data: out, width, height, bbox }
}

/** Tiles covering a lon/lat bbox at a zoom. */
export function tileCountFor(bbox: [number, number, number, number], zoom: number): number {
  const n = 2 ** zoom
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n)
  const ty = (lat: number) => {
    const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  }
  const [w, s, e, nn] = bbox
  return (Math.min(n - 1, tx(e)) - Math.max(0, tx(w)) + 1) * (Math.min(n - 1, ty(s)) - Math.max(0, ty(nn)) + 1)
}

/** One template's values over exactly `bbox` at width x height, on the
 *  export's regular EPSG:4326 grid, NaN = nodata. A scheme with a region
 *  reader (WMS, VRT, difference: lib/region-readers.ts) delivers the area in
 *  a few requests; anything else is a tile mosaic at `zoom`, or the lowest
 *  zoom that meets the size, walking down on 404 where coverage stops. */
export async function readRegionGrid(
  template: string, encoding: "terrarium" | "mapbox", tileSize: number, maxzoom: number,
  bbox: [number, number, number, number], width: number, height: number,
  opts: { signal?: AbortSignal; onProgress?: (f: number) => void; zoom?: number } = {},
): Promise<{ data: Float32Array; resolutionLimited: boolean }> {
  const reader = regionReaderFor(template)
  if (reader) {
    opts.onProgress?.(0)
    const r = await reader.read(template, bbox, width, height, opts.signal)
    opts.onProgress?.(1)
    return { data: r.grid === "lonlat" ? r.data : resampleMosaic(r, bbox, width, height).data, resolutionLimited: false }
  }
  const decodeRgb = encoding === "mapbox" ? terrainrgbToElevation : terrariumToElevation
  const decodePixel = (r: number, g: number, b: number, a: number) => (a < 255 ? NaN : decodeRgb(r, g, b))
  const startZoom = opts.zoom ?? pickZoomForResolution(bbox, width, height, tileSize, maxzoom)
  let lastErr: unknown
  for (let zoom = startZoom; zoom >= Math.max(0, startZoom - 6); zoom--) {
    try {
      const mosaic = await fetchTileMosaic({ tileUrlTemplate: template, tileSize, bbox, zoom, decodePixel, onProgress: opts.onProgress, signal: opts.signal })
      const lonSpan = ((bbox[2] - bbox[0]) / (mosaic.bbox[2] - mosaic.bbox[0])) * mosaic.width
      return { data: resampleMosaic(mosaic, bbox, width, height).data, resolutionLimited: lonSpan < width * 0.99 }
    } catch (err) {
      if (!isRetryableTileError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}

/** What readRegionGrid will request, for the export dialog. */
export function describeRegionRead(
  template: string, tileSize: number, maxzoom: number,
  bbox: [number, number, number, number], width: number, height: number, zoom?: number,
): string {
  const reader = regionReaderFor(template)
  if (reader) return reader.describe(template, width, height)
  const z = zoom ?? pickZoomForResolution(bbox, width, height, tileSize, maxzoom)
  return `${tileCountFor(bbox, z)} tiles of ${tileSize} px`
}

/** RGBA tiles (matcap://, phong://, shadow://) over exactly `bbox` at
 *  width x height on the export's EPSG:4326 grid: a tile mosaic through the
 *  registry, bilinear per channel. For the lighting exports, which are
 *  colours rather than values. */
export async function readRgbaRegion(
  template: string, tileSize: number, maxzoom: number,
  bbox: [number, number, number, number], width: number, height: number,
  opts: { signal?: AbortSignal; zoom?: number } = {},
): Promise<Uint8ClampedArray> {
  const z = opts.zoom ?? pickZoomForResolution(bbox, width, height, tileSize, maxzoom)
  const n = 2 ** z
  const fx = (lon: number) => ((lon + 180) / 360) * n
  const fy = (lat: number) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n }
  const x0 = Math.floor(fx(bbox[0])), x1 = Math.floor(fx(bbox[2])), y0 = Math.floor(fy(bbox[3])), y1 = Math.floor(fy(bbox[1]))
  const cols = x1 - x0 + 1, rows = y1 - y0 + 1
  const MW = cols * tileSize, MH = rows * tileSize
  const mosaic = new Uint8ClampedArray(MW * MH * 4)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = tileSize
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  const jobs: [number, number][] = []
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty])
  let failed: unknown = null
  const worker = async () => {
    while (jobs.length && failed === null) {
      const [tx, ty] = jobs.shift()!
      try {
        const bitmap = await fetchTileBitmap(template.replace("{z}", String(z)).replace("{x}", String(tx)).replace("{y}", String(ty)), opts.signal)
        if (!bitmap) continue
        ctx.clearRect(0, 0, tileSize, tileSize)
        ctx.drawImage(bitmap, 0, 0, tileSize, tileSize)
        bitmap.close()
        const px = ctx.getImageData(0, 0, tileSize, tileSize).data
        const ox = (tx - x0) * tileSize, oy = (ty - y0) * tileSize
        for (let r = 0; r < tileSize; r++) mosaic.set(px.subarray(r * tileSize * 4, (r + 1) * tileSize * 4), ((oy + r) * MW + ox) * 4)
      } catch (e) { if (failed === null) failed = e }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker))
  if (failed !== null) throw failed
  // Output pixel centres -> mosaic pixels (Web Mercator rows), bilinear.
  const out = new Uint8ClampedArray(width * height * 4)
  const [w, s, e, nn] = bbox
  for (let j = 0; j < height; j++) {
    const lat = nn - ((j + 0.5) * (nn - s)) / height
    const my = (fy(lat) - y0) * tileSize - 0.5
    const r0 = Math.max(0, Math.min(MH - 1, Math.floor(my))), r1 = Math.min(MH - 1, r0 + 1), ty = Math.min(1, Math.max(0, my - r0))
    for (let i = 0; i < width; i++) {
      const lon = w + ((i + 0.5) * (e - w)) / width
      const mx = (fx(lon) - x0) * tileSize - 0.5
      const c0 = Math.max(0, Math.min(MW - 1, Math.floor(mx))), c1 = Math.min(MW - 1, c0 + 1), tx = Math.min(1, Math.max(0, mx - c0))
      const a = (r0 * MW + c0) * 4, b = (r0 * MW + c1) * 4, c = (r1 * MW + c0) * 4, d = (r1 * MW + c1) * 4
      const o = (j * width + i) * 4
      for (let k = 0; k < 4; k++) out[o + k] = (mosaic[a + k] * (1 - tx) + mosaic[b + k] * tx) * (1 - ty) + (mosaic[c + k] * (1 - tx) + mosaic[d + k] * tx) * ty
    }
  }
  return out
}

export async function exportElevationClientSide(
  params: ExportElevationClientSideParams,
): Promise<ClientExportResult> {
  const { source, bbox, targetResolution, onProgress, signal } = params

  if (source.type === "cog") {
    onProgress?.(0)
    // Used to read targetResolution x targetResolution whatever the view's
    // shape, so every COG export came out square.
    const size = params.outputSize ?? { width: targetResolution, height: targetResolution }
    const result = await exportCogWindow(source.url, bbox, size.width, size.height, signal)
    onProgress?.(1)
    return result
  }

  // An exact output size goes through readRegionGrid: a region reader when
  // the scheme has one (a WMS source is then a few GetMaps, not a tile per
  // 256 px), else tiles at the zoom that meets the size in both directions.
  if (params.outputSize) {
    const { width, height } = params.outputSize
    const r = await readRegionGrid(source.url, source.type === "terrainrgb" ? "mapbox" : "terrarium", source.tileSize, source.maxzoom, bbox, width, height, { signal, onProgress, zoom: params.zoom })
    return { data: r.data, width, height, bbox, resolutionLimited: r.resolutionLimited }
  }

  const startZoom = params.zoom ?? pickZoomForResolution(bbox, targetResolution, targetResolution, source.tileSize, source.maxzoom)
  const decodeRgb = source.type === "terrainrgb" ? terrainrgbToElevation : terrariumToElevation
  // A pixel that is not fully opaque is nodata: titiler writes holes with
  // alpha 0, our own protocols with 254 (lib/vrt-protocol.ts, demdiff). It
  // used to be decoded like any other pixel, so a hole exported as a real
  // value (0 m, or -10 000 m in Terrain-RGB).
  const decodePixel = (r: number, g: number, b: number, a: number) => (a < 255 ? NaN : decodeRgb(r, g, b))

  // A source's declared maxzoom isn't always backed by 100% coverage across
  // the whole export bbox (e.g. Mapterhorn declares 18 but plenty of real
  // locations only go to 17) — walk down the pyramid on 404, same fallback
  // lib/elevation-query.ts's point/path sampling already does, so a coverage
  // gap at the exact maxzoom doesn't hard-fail the whole export.
  let lastErr: unknown
  for (let zoom = startZoom; zoom >= Math.max(0, startZoom - 6); zoom--) {
    try {
      const mosaic = await fetchTileMosaic({ tileUrlTemplate: source.url, tileSize: source.tileSize, bbox, zoom, decodePixel, onProgress, signal })
      return { ...mosaic, resolutionLimited: mosaic.width < targetResolution || mosaic.height < targetResolution }
    } catch (err) {
      if (!isRetryableTileError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}
