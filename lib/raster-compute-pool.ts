import type { RasterComputeRequest, RasterComputeResponse, RasterKernel, RasterKernelInputs } from "./raster-compute-worker"

/**
 * Raster Compute in a Worker (Settings, Streaming; off by default).
 *
 * The heavy viz-mode kernels (Sky View Factor, Openness, Local Dominance) run in a
 * small pool of dedicated workers instead of the main thread. Only the pixel
 * loop moves: the protocol handler still fetches and decodes the DEM on the
 * main thread (its tile caches and every custom scheme live there), sends the
 * elevation grids (copied, not transferred: they may sit in a cache) and gets
 * the RGBA pixels back (transferred).
 *
 * MapLibre loads raster tiles from the main thread, so a protocol registered
 * inside MapLibre's own workers (the Contours in a Worker route) would never be
 * called for these layers: hence a pool of our own.
 *
 * TerrainViewer.tsx mirrors rasterComputeWorkerAtom into setRasterComputeInWorker.
 */
let enabled = false
export function setRasterComputeInWorker(on: boolean): void { enabled = on }
export function rasterComputeInWorker(): boolean { return enabled && typeof Worker !== "undefined" }

interface Slot { worker: Worker; busy: number }
const slots: Slot[] = []
const pending = new Map<number, { resolve: (p: Uint8ClampedArray<ArrayBuffer>) => void; reject: (e: Error) => void; slot: Slot }>()
let nextId = 1

function poolSize(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4
  return Math.max(1, Math.min(4, cores - 2))
}

function pickSlot(): Slot {
  if (slots.length < poolSize()) {
    const worker = new Worker(new URL("./raster-compute-worker.ts", import.meta.url), { type: "module" })
    const slot: Slot = { worker, busy: 0 }
    worker.onmessage = (e: MessageEvent<RasterComputeResponse>) => {
      const entry = pending.get(e.data.id)
      if (!entry) return
      pending.delete(e.data.id)
      entry.slot.busy--
      if (e.data.pixels) entry.resolve(e.data.pixels)
      else entry.reject(new Error(e.data.error ?? "raster compute failed"))
    }
    slots.push(slot)
    // A fresh worker is idle: use it now rather than queueing on a busy one.
    return slot
  }
  return slots.reduce((a, b) => (b.busy < a.busy ? b : a))
}

/** Runs a whole tile of a kernel (horizon: SVF and Openness; localDominance) in a worker. */
export function computeInWorker<K extends RasterKernel>(kind: K, input: RasterKernelInputs[K]): Promise<Uint8ClampedArray<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const slot = pickSlot()
    const id = nextId++
    slot.busy++
    pending.set(id, { resolve, reject, slot })
    slot.worker.postMessage({ id, kind, input } as RasterComputeRequest)
  })
}
