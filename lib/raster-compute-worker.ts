// Worker side of lib/raster-compute-pool.ts: runs a viz-mode pixel kernel on
// grids the main thread already fetched and decoded, returns the RGBA pixels.
import { computeHorizonRows, type HorizonKernelInput } from "./horizon-kernel"

export type RasterComputeRequest = { id: number; kind: "horizon"; input: HorizonKernelInput }
export type RasterComputeResponse = { id: number; pixels?: Uint8ClampedArray<ArrayBuffer>; error?: string }

self.onmessage = (e: MessageEvent<RasterComputeRequest>) => {
  const { id, kind, input } = e.data
  try {
    if (kind !== "horizon") throw new Error(`Unknown raster kernel ${kind}`)
    const pixels = new Uint8ClampedArray(input.n * input.n * 4)
    computeHorizonRows(input, 0, input.n, pixels)
    ;(self as unknown as Worker).postMessage({ id, pixels } satisfies RasterComputeResponse, [pixels.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) } satisfies RasterComputeResponse)
  }
}
