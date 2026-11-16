import { getGlobalDispatcher, importScriptInWorkers } from "maplibre-gl"
// maplibre-contour's UMD build, as text: it defines self.mlcontour
// (LocalDemManager, decodeParsedImage) in the worker. Relative path because the
// package's "exports" map does not expose dist/ subpaths.
import mlcontourUmd from "../node_modules/maplibre-contour/dist/index.min.js?raw"
import workerBody from "./contour-worker-body.js?raw"
import { loadTileBitmap } from "./normal-derived-protocol"

/**
 * Contours in MapLibre's workers (Settings, Streaming, "Contours in a worker").
 *
 * Off (the default), ContoursLayer.tsx uses maplibre-contour's DemSource: its
 * own worker for plain http(s) DEMs, but the MAIN thread for every custom
 * scheme (vrt://, lerc://, demdiff://, lrm://, ...), because that worker's
 * fetch() cannot reach the app's protocol handlers.
 *
 * On, the route HarelM described on maplibre-style-spec#1374:
 * - importScriptInWorkers loads maplibre-contour plus contour-worker-body.js
 *   into MapLibre's own workers, where it registers a `tv-contour://` protocol.
 *   The contour vector source asks for those URLs, MapLibre loads vector
 *   tiles in its workers, so isolines and vector-tile encoding run there.
 * - The worker reads the DEM: plain http(s) by itself, everything else by a
 *   `tv-contour-tile` message to the main thread, answered below with
 *   loadTileBitmap (the same loader every derived mode uses, so every scheme
 *   it knows works). The bitmap is transferred back, not copied.
 *
 * The DEM decode of a custom scheme (a VRT reprojection, a LERC inflate)
 * still runs on the main thread: that is where its handler is registered.
 */
let ready: Promise<void> | null = null

export function ensureContourWorker(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    const dispatcher = getGlobalDispatcher()
    // Main-thread side: resolve any DEM tile URL a worker asks for.
    dispatcher.registerMessageHandler("tv-contour-tile" as never, (async (_mapId: string, params: { url: string }, abortController: AbortController) => {
      return loadTileBitmap(params.url, abortController.signal)
    }) as never)
    const blob = new Blob([mlcontourUmd, "\n;\n", workerBody], { type: "text/javascript" })
    // Kept alive for the session: workers the pool spawns later never exist
    // (the global pool is fixed-size and already created by this call).
    await importScriptInWorkers(URL.createObjectURL(blob))
  })()
  ready.catch(() => { ready = null })
  return ready
}

let counter = 0

/** Sends a DEM to every worker; returns the key its contour URLs carry. A
 *  new configuration for the same prefix replaces the old one. */
export async function configureContourWorker(
  prefix: string,
  dem: { demUrlPattern: string; encoding: string; maxzoom: number },
): Promise<string> {
  await ensureContourWorker()
  const key = `${prefix}-${++counter}`
  await getGlobalDispatcher().broadcast("tv-contour-config" as never, { prefix, key, ...dem } as never)
  return key
}

/** Same options object as maplibre-contour's contourProtocolUrl. */
export function workerContourUrl(key: string, options: Record<string, unknown>): string {
  return `tv-contour://${key}/{z}/{x}/{y}?o=${encodeURIComponent(JSON.stringify(options))}`
}
