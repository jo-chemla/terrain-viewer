// Registers a `cog-contour://` maplibre protocol that generates contour
// vector tiles directly from a local/BYOD COG file — see
// lib/cog-contour-worker.ts for why this needs its own dedicated Worker
// rather than reusing maplibre-contour's own DemSource/worker path (its
// worker config travels over postMessage, which can't carry a custom fetch
// function at all).
//
// This file is the thin main-thread half: parse the tile request out of the
// URL, hand it to the worker, resolve with whatever comes back. All the
// actual DEM/contour work happens in the worker — this never blocks the
// main thread beyond the cost of a postMessage round trip.
import type { CogContourRequest, CogContourResponse } from "./cog-contour-worker"

export interface CogContourOptions {
  /** Zoom -> [minor, major] elevation intervals — same shape as maplibre-contour's own GlobalContourTileOptions.thresholds. */
  thresholds: Record<number, number[]>
  multiplier?: number
  extent?: number
  buffer?: number
  overzoom?: number
  contourLayer?: string
  elevationKey?: string
  levelKey?: string
  subsampleBelow?: number
}

let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, { resolve: (data: ArrayBuffer) => void; reject: (err: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./cog-contour-worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (e: MessageEvent<CogContourResponse>) => {
      const entry = pending.get(e.data.id)
      if (!entry) return
      pending.delete(e.data.id)
      if (e.data.error) entry.reject(new Error(e.data.error))
      else entry.resolve(e.data.data!)
    }
  }
  return worker
}

/** Registered once in TerrainViewer.tsx alongside this app's other custom
 *  protocols (cog, float32dem, slope, ...). Same `(params, abortController) =>
 *  Promise<{data}>` shape as float32demProtocol/the geomatico cogProtocol. */
export async function cogContourProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: ArrayBuffer }> {
  // URL, not a path template: `cog-contour://tile?cogUrl=<enc>&options=<enc>&z=..&x=..&y=..`
  // — maplibre substitutes the literal "{z}"/"{x}"/"{y}" text anywhere it
  // appears in the template string, query string included, so plain query
  // params work exactly like path placeholders would.
  const url = new URL(params.url)
  const cogUrl = decodeURIComponent(url.searchParams.get("cogUrl") || "")
  const options: CogContourOptions = JSON.parse(decodeURIComponent(url.searchParams.get("options") || "{}"))
  const z = Number(url.searchParams.get("z"))
  const x = Number(url.searchParams.get("x"))
  const y = Number(url.searchParams.get("y"))

  const id = nextRequestId++
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id)
      reject(new Error("aborted"))
    }
    abortController.signal.addEventListener("abort", onAbort, { once: true })
    pending.set(id, {
      resolve: (d) => { abortController.signal.removeEventListener("abort", onAbort); resolve(d) },
      reject: (e) => { abortController.signal.removeEventListener("abort", onAbort); reject(e) },
    })
    const req: CogContourRequest = {
      id, cogUrl, z, x, y,
      thresholds: options.thresholds,
      multiplier: options.multiplier ?? 1,
      extent: options.extent ?? 4096,
      buffer: options.buffer ?? 1,
      overzoom: options.overzoom ?? 1,
      contourLayer: options.contourLayer ?? "contours",
      elevationKey: options.elevationKey ?? "ele",
      levelKey: options.levelKey ?? "level",
      subsampleBelow: options.subsampleBelow ?? 100,
    }
    getWorker().postMessage(req)
  })
  return { data }
}

/** Builds the `cog-contour://` tile URL template for a maplibre vector source's `tiles` array. */
export function buildCogContourUrl(cogUrl: string, options: CogContourOptions): string {
  const encodedCogUrl = encodeURIComponent(cogUrl)
  const encodedOptions = encodeURIComponent(JSON.stringify(options))
  return `cog-contour://tile?cogUrl=${encodedCogUrl}&options=${encodedOptions}&z={z}&x={x}&y={y}`
}
