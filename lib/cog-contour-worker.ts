// Dedicated Worker that turns a local/BYOD COG file directly into contour
// vector tiles, without ever touching the main thread for the actual DEM
// read + isoline generation. Exists because maplibre-contour's own DemSource
// can't do this itself: its worker path (RemoteDemManager) configures its
// worker via postMessage, which can't carry a custom fetch function (functions
// aren't structured-cloneable) — a custom `getTile` is only ever accepted by
// LocalDemManager, the *non*-worker path, which would put both the DEM
// decode and the isoline math on the main thread.
//
// Instead of reimplementing COG windowed reads, this reuses
// @geomatico/maplibre-cog-protocol's own `cogProtocol` function directly —
// it's a pure, DOM-free async function (confirmed by reading its source: no
// `document`/`window` reference anywhere in the package), not something that
// only works through maplibregl.addProtocol's dispatch. Called here with a
// `#dem`-suffixed URL, it returns an ImageBitmap encoded with the exact same
// "mapbox" terrain-rgb convention maplibre-contour's own decoder already
// natively understands — so no bespoke encode/decode format is needed
// either, just the standard decodeParsedImage(w,h,"mapbox",rgba) call.
//
// The neighbor-fetch / resample / isoline pipeline below mirrors
// maplibre-contour's own (non-exported) LocalDemManager.fetchContourTile
// algorithm as closely as possible, built entirely from its PUBLIC exports
// (HeightTile, generateIsolines, decodeParsedImage) — deliberately not
// reaching for any non-exported internal (e.g. its own vtpbf encoder, which
// isn't part of the package's exports map at all), to avoid depending on
// unstable internals that could silently break across versions.
import { cogProtocol, getCogMetadata } from "@geomatico/maplibre-cog-protocol"
import mlcontour from "maplibre-contour"
import { encodeVectorTile, GeomType } from "./mvt-encode"

const { HeightTile, generateIsolines, decodeParsedImage } = mlcontour as any

const TILE_SIZE = 256

export interface CogContourRequest {
  id: number
  cogUrl: string
  z: number
  x: number
  y: number
  /** Zoom -> [minor, major] (or [major] alone below the zoom where minor lines start) — same shape as GlobalContourTileOptions.thresholds. */
  thresholds: Record<number, number[]>
  multiplier: number
  extent: number
  buffer: number
  overzoom: number
  contourLayer: string
  elevationKey: string
  levelKey: string
  subsampleBelow: number
}

export interface CogContourResponse {
  id: number
  data?: ArrayBuffer
  error?: string
}

// ── DemTile fetch + decode ───────────────────────────────────────────────

let offscreenCanvas: OffscreenCanvas | null = null
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null

async function fetchAndDecodeRawTile(cogUrl: string, z: number, x: number, y: number) {
  // cogProtocol is designed to be called by maplibre's addProtocol dispatch
  // (which always passes `type`), so we replicate that shape ourselves —
  // it's a plain, unregistered function call, no maplibregl involved.
  const result = await cogProtocol({
    type: "image",
    url: `cog://${cogUrl}#dem/${z}/${x}/${y}`,
  } as any)
  const imageBitmap = result.data as ImageBitmap

  if (!offscreenCanvas) {
    offscreenCanvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
    offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true })
  }
  offscreenCanvas.width = imageBitmap.width
  offscreenCanvas.height = imageBitmap.height
  if (!offscreenCtx) throw new Error("Failed to get OffscreenCanvas 2D context")
  offscreenCtx.drawImage(imageBitmap, 0, 0)
  const { data } = offscreenCtx.getImageData(0, 0, imageBitmap.width, imageBitmap.height)
  // renderTerrain (geomatico) always encodes with the mapbox terrain-rgb
  // formula (height = -10000 + (R*256*256 + G*256 + B) * 0.1) — verified by
  // reading its source, not assumed.
  return decodeParsedImage(imageBitmap.width, imageBitmap.height, "mapbox", data)
}

// Small in-worker caches: cogProtocol's own CogReader already caches parsed
// TIFF handles/metadata/raw-tile reads (module-level QuickLRUs, keyed by
// url+z/x/y), so this only needs to cache the two steps *above* that layer —
// the decoded DemTile (skips re-running the OffscreenCanvas decode) and the
// final encoded contour tile (skips re-running isoline generation) — for
// whichever neighbor tiles get requested repeatedly across adjacent contour
// tile requests.
const MAX_CACHE_ENTRIES = 512
function makeCache<V>() {
  const map = new Map<string, Promise<V>>()
  return {
    get(key: string, compute: () => Promise<V>): Promise<V> {
      let entry = map.get(key)
      if (entry) return entry
      entry = compute()
      map.set(key, entry)
      if (map.size > MAX_CACHE_ENTRIES) {
        const oldest = map.keys().next().value
        if (oldest !== undefined) map.delete(oldest)
      }
      return entry
    },
  }
}
const demTileCache = makeCache<any>()
const contourTileCache = makeCache<ArrayBuffer>()
const maxzoomCache = new Map<string, Promise<number>>()

async function getMaxzoom(cogUrl: string): Promise<number> {
  let entry = maxzoomCache.get(cogUrl)
  if (!entry) {
    entry = getCogMetadata(cogUrl)
      .then((meta: any) => Math.round(Math.max(...meta.images.map((i: any) => i.zoom))))
      .catch(() => 18)
    maxzoomCache.set(cogUrl, entry)
  }
  return entry
}

// Mirrors LocalDemManager.fetchDem: overzoom fetches a lower-zoom tile once
// (cheaper, and re-used across the `1<<subZ` grid of tiles that crop out of
// it) rather than the exact requested zoom every time.
async function fetchDem(cogUrl: string, z: number, x: number, y: number, overzoom: number, maxzoom: number) {
  const zoom = Math.min(z - overzoom, maxzoom)
  const subZ = z - zoom
  const div = 1 << subZ
  const newX = Math.floor(x / div)
  const newY = Math.floor(y / div)
  const key = `${cogUrl}|${zoom}|${newX}|${newY}`
  const raw = await demTileCache.get(key, () => fetchAndDecodeRawTile(cogUrl, zoom, newX, newY))
  return HeightTile.fromRawDem(raw).split(subZ, x % div, y % div)
}

// Zoom -> applicable [minor, major, ...] levels, matching
// GlobalContourTileOptions.thresholds semantics: "Contour lines without an
// entry use the threshold for the next lower zoom."
function levelsForZoom(thresholds: Record<number, number[]>, zoom: number): number[] {
  let levels: number[] = []
  for (const key of Object.keys(thresholds).map(Number).sort((a, b) => a - b)) {
    if (key <= zoom) levels = thresholds[key]
  }
  return levels
}

export async function fetchContourTile(req: CogContourRequest): Promise<ArrayBuffer> {
  const { cogUrl, z, x, y, thresholds, multiplier, extent, buffer, overzoom, contourLayer, elevationKey, levelKey, subsampleBelow } = req
  const levels = levelsForZoom(thresholds, z)
  if (levels.length === 0) return new ArrayBuffer(0)

  const cacheKey = `${cogUrl}|${z}|${x}|${y}|${levels.join(",")}|${multiplier}|${extent}|${buffer}|${overzoom}`
  return contourTileCache.get(cacheKey, async () => {
    const maxzoom = await getMaxzoom(cogUrl)
    const max = 1 << z
    const neighborPromises: Array<Promise<any> | undefined> = []
    for (let iy = y - 1; iy <= y + 1; iy++) {
      for (let ix = x - 1; ix <= x + 1; ix++) {
        neighborPromises.push(
          iy < 0 || iy >= max
            ? undefined
            : fetchDem(cogUrl, z, (ix + max) % max, iy, overzoom, maxzoom),
        )
      }
    }
    const neighbors = await Promise.all(neighborPromises)
    let virtualTile = HeightTile.combineNeighbors(neighbors)
    if (!virtualTile) return new ArrayBuffer(0)

    if (virtualTile.width >= subsampleBelow) {
      virtualTile = virtualTile.materialize(2)
    } else {
      while (virtualTile.width < subsampleBelow) {
        virtualTile = virtualTile.subsamplePixelCenters(2).materialize(2)
      }
    }
    virtualTile = virtualTile.averagePixelCentersToGrid().scaleElevation(multiplier).materialize(1)

    const isolines = generateIsolines(levels[0], virtualTile, extent, buffer)

    const features = Object.entries(isolines).map(([eleString, geom]) => {
      const ele = Number(eleString)
      return {
        type: GeomType.LINESTRING,
        geometry: geom as number[][],
        properties: {
          [elevationKey]: ele,
          [levelKey]: Math.max(...levels.map((l, i) => (ele % l === 0 ? i : 0))),
        },
      }
    })

    return encodeVectorTile({ extent, layers: { [contourLayer]: { features } } }).buffer as ArrayBuffer
  })
}

self.onmessage = async (e: MessageEvent<CogContourRequest>) => {
  const req = e.data
  try {
    const data = await fetchContourTile(req)
    ;(self as any).postMessage({ id: req.id, data } satisfies CogContourResponse, [data])
  } catch (err) {
    ;(self as any).postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies CogContourResponse)
  }
}
