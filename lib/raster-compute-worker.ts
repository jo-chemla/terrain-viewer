// Worker side of lib/raster-compute-pool.ts: runs a viz-mode pixel kernel on
// grids the main thread already fetched and decoded, returns the RGBA pixels.
import { computeHorizonRows, type HorizonKernelInput } from "./horizon-kernel"
import { computeLocalDominanceRows, type LocalDominanceKernelInput } from "./local-dominance-kernel"

export type RasterKernelInputs = {
  horizon: HorizonKernelInput
  localDominance: LocalDominanceKernelInput
}
export type RasterKernel = keyof RasterKernelInputs
export type RasterComputeRequest = { [K in RasterKernel]: { id: number; kind: K; input: RasterKernelInputs[K] } }[RasterKernel]
export type RasterComputeResponse = { id: number; pixels?: Uint8ClampedArray<ArrayBuffer>; error?: string }

self.onmessage = (e: MessageEvent<RasterComputeRequest>) => {
  const req = e.data
  try {
    const n = req.input.n
    const pixels = new Uint8ClampedArray(n * n * 4)
    if (req.kind === "horizon") computeHorizonRows(req.input, 0, n, pixels)
    else if (req.kind === "localDominance") computeLocalDominanceRows(req.input, 0, n, pixels)
    else throw new Error(`Unknown raster kernel ${(req as { kind: string }).kind}`)
    ;(self as unknown as Worker).postMessage({ id: req.id, pixels } satisfies RasterComputeResponse, [pixels.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: req.id, error: String(err) } satisfies RasterComputeResponse)
  }
}
