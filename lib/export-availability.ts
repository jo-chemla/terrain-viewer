// Availability check before a historical export: is the zoom the requested
// GSD needs actually served by each source at each target? A source's
// declared maxzoom is a ceiling, not a promise (Esri World Imagery stops
// at z17 over much of the world, an older Wayback release at z16 where the
// current one reaches z19), and a tile beyond that answers 404, or a blank
// or placeholder image. One tile request at the target's centre per source
// and target, at the zoom pickExportZoom chooses, through the same URL
// builder the mosaic uses; on a miss, step down (at most MAX_STEP_DOWN
// zooms) until a tile answers. The export then starts at that zoom
// (ExportMultiOptions.zoomHints) instead of fetching 404s.
import { listExportTicks, EXPORT_SOURCE_LABELS, type ExportSourceId, type ExportSourceKeys, type ExportTick } from "./historical-export-sources"
import { pickExportZoom, nativeGsdAt, fetchZoomFor, zoomHintKey, type ExportResolutionSpec, type ExportTarget } from "./export-multi"
import { lonLatToTileXY } from "./tile-mosaic"

/** Zooms stepped down below the wanted one before giving up. */
export const MAX_STEP_DOWN = 4
/** Highest zoom probed, whatever a source declares (same as the mosaic's). */
const MAX_FETCH_ZOOM = 22

export type AvailabilityStatus =
  /** The wanted zoom is served. */
  | "ok"
  /** Only a coarser zoom is served (bestZoom). */
  | "coarser"
  /** Nothing within MAX_STEP_DOWN zooms of the wanted one. */
  | "none"
  /** No capture in the date range at this target, nothing to probe. */
  | "no-capture"
  /** The listing or the probe itself failed (network, key). */
  | "error"

export interface AvailabilityResult {
  target: string
  source: ExportSourceId
  status: AvailabilityStatus
  /** The zoom the resolution asks for (the source's maxzoom applied). */
  wantedZoom: number
  /** The finest zoom a tile answered at, when one did. */
  bestZoom: number | null
  /** Native GSD of one tile pixel at bestZoom, metres, at the target's latitude. */
  bestGsd: number | null
  /** Capture the probe used (the latest in range). */
  date?: string
  message: string
}

export interface AvailabilityOptions {
  targets: ExportTarget[]
  sourceIds: ExportSourceId[]
  resolution: ExportResolutionSpec
  startMs: number
  endMs: number
  planetKey?: string
  keys?: ExportSourceKeys
  /** Zoom to list the captures at (default: the fetch zoom). */
  listingZoom?: number
  signal?: AbortSignal
}

/** Whether a decoded tile holds anything: a fully transparent image or one
 *  flat colour is a "no data" placeholder (Esri's grey, Wayback's blank,
 *  Google's beyond-coverage tiles), decided on a 16x16 downsample. */
async function tileHasContent(blob: Blob): Promise<boolean> {
  if (blob.size < 200) return false
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(blob) } catch { return false }
  const n = 16
  const canvas = document.createElement("canvas")
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, n, n)
  bitmap.close()
  const px = ctx.getImageData(0, 0, n, n).data
  let opaque = 0
  let min = 255, max = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue
    opaque++
    for (let c = 0; c < 3; c++) {
      const v = px[i + c]
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (opaque < (n * n) / 4) return false
  return max - min > 6
}

/** One tile at (z, x, y) through the tick's URL builder: true when it
 *  answers with an image that has content. */
export async function probeTile(spec: ExportTick["tileSpec"], z: number, x: number, y: number, signal?: AbortSignal): Promise<boolean> {
  let blob: Blob
  if (spec.fetchTileBlob) {
    try { blob = await spec.fetchTileBlob(z, x, y, signal) } catch (err) { if (isAbort(err)) throw err; return false }
  } else {
    const url = spec.buildTileUrl
      ? spec.buildTileUrl(z, x, y)
      : spec.tileUrlTemplate!.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
    let response: Response
    try { response = await fetch(url, { signal }) } catch (err) { if (isAbort(err)) throw err; return false }
    if (!response.ok) return false
    blob = await response.blob()
  }
  return tileHasContent(blob)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

function gsdText(m: number): string {
  return m >= 10 ? `${m.toFixed(1)} m/px` : m >= 1 ? `${m.toFixed(2)} m/px` : `${(m * 100).toFixed(0)} cm/px`
}

/** Probe one source at one target. */
async function checkOne(target: ExportTarget, source: ExportSourceId, opts: AvailabilityOptions): Promise<AvailabilityResult> {
  const label = EXPORT_SOURCE_LABELS[source]
  const { centerLat: lat, centerLng: lng } = target
  const listingZoom = opts.listingZoom ?? fetchZoomFor(target.paddedBbox, 0, opts.resolution)
  let ticks: ExportTick[]
  try {
    ticks = await listExportTicks(source, lat, lng, listingZoom, opts.startMs, opts.endMs, opts.planetKey, opts.keys)
  } catch (err) {
    if (isAbort(err)) throw err
    return { target: target.label, source, status: "error", wantedZoom: 0, bestZoom: null, bestGsd: null, message: `${label}: ${err instanceof Error ? err.message : "listing failed"}` }
  }
  if (!ticks.length) {
    return { target: target.label, source, status: "no-capture", wantedZoom: 0, bestZoom: null, bestGsd: null, message: `${label}: no capture in the date range here` }
  }
  // The latest capture stands for the source: the current mosaic is the
  // one most likely to reach the deepest zoom.
  const tick = ticks.reduce((a, b) => (b.dateMs > a.dateMs ? b : a))
  const { tileSize, maxzoom } = tick.tileSpec
  const wantedZoom = Math.min(maxzoom, MAX_FETCH_ZOOM, pickExportZoom(target.paddedBbox, opts.resolution, tileSize, MAX_FETCH_ZOOM))
  let bestZoom: number | null = null
  for (let z = wantedZoom; z >= Math.max(1, wantedZoom - MAX_STEP_DOWN); z--) {
    if (opts.signal?.aborted) throw new DOMException("Check cancelled", "AbortError")
    const [tx, ty] = lonLatToTileXY(lng, lat, z)
    if (await probeTile(tick.tileSpec, z, Math.floor(tx), Math.floor(ty), opts.signal)) { bestZoom = z; break }
  }
  const bestGsd = bestZoom === null ? null : nativeGsdAt(lat, bestZoom, tileSize)
  const date = tick.label
  if (bestZoom === wantedZoom) {
    return { target: target.label, source, status: "ok", wantedZoom, bestZoom, bestGsd, date, message: `${label}: zoom ${wantedZoom} served (${gsdText(bestGsd!)})` }
  }
  if (bestZoom !== null) {
    return { target: target.label, source, status: "coarser", wantedZoom, bestZoom, bestGsd, date, message: `${label}: no zoom ${wantedZoom} here, best zoom ${bestZoom} (${gsdText(bestGsd!)})` }
  }
  return { target: target.label, source, status: "none", wantedZoom, bestZoom: null, bestGsd: null, date, message: `${label}: no tile at zoom ${wantedZoom} down to ${Math.max(1, wantedZoom - MAX_STEP_DOWN)} here` }
}

/**
 * One probe per selected source and target, all in flight at once (a
 * source's step-down is sequential). Rejects with AbortError when the
 * signal fires; any other failure lands in the result's status.
 */
export async function checkExportAvailability(opts: AvailabilityOptions): Promise<AvailabilityResult[]> {
  const jobs: Promise<AvailabilityResult>[] = []
  for (const target of opts.targets) for (const source of opts.sourceIds) jobs.push(checkOne(target, source, opts))
  return Promise.all(jobs)
}

/** The zoom hints an export should start from, from a check's results. */
export function zoomHintsFrom(results: AvailabilityResult[]): Record<string, number> {
  const hints: Record<string, number> = {}
  for (const r of results) if (r.bestZoom !== null) hints[zoomHintKey(r.target, r.source)] = r.bestZoom
  return hints
}
