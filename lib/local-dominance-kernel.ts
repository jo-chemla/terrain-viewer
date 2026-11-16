// The per-pixel loop of Local Dominance (lib/local-dominance-protocol.ts fetches
// the grids). Import-free so it also runs in lib/raster-compute-worker.ts.

export interface LocalDominanceLevel {
  padded: Float32Array
  stride: number
  scale: number
  xOffsetTiles: number
  yOffsetTiles: number
  /** 1 / ground distance of a one-coarse-pixel step at this level (m). */
  invDist: number
}

export interface LocalDominanceKernelInput {
  /** The tile's own native elevations (observer heights). */
  center: Float32Array
  centerWidth: number
  n: number
  levels: LocalDominanceLevel[]
}

const OBSERVER_HEIGHT_M = 1.6
const RAD_TO_DEG = 180 / Math.PI
// 8 compass directions as (dRow, dCol) unit vectors. Fewer than a native-radius
// version would want, because octave sampling already contributes several
// independent rings (one per pyramid level) to the average.
const DIR_COUNT = 8
const DIR_ROWS = Float64Array.from({ length: DIR_COUNT }, (_, i) => Math.sin((2 * Math.PI * i) / DIR_COUNT))
const DIR_COLS = Float64Array.from({ length: DIR_COUNT }, (_, i) => Math.cos((2 * Math.PI * i) / DIR_COUNT))

/** Fills rows [row0, row1) of `out` (n x n RGBA, Terrarium-encoded degrees). */
export function computeLocalDominanceRows(input: LocalDominanceKernelInput, row0: number, row1: number, out: Uint8ClampedArray): void {
  const { center, centerWidth, n, levels } = input
  const levelCount = levels.length
  for (let row = row0; row < row1; row++) {
    for (let col = 0; col < n; col++) {
      const observerElev = center[row * centerWidth + col] + OBSERVER_HEIGHT_M
      let sum = 0
      for (let li = 0; li < levelCount; li++) {
        const level = levels[li]
        // Fine (row,col) → this level's coarse pixel coordinate (ancestor pixel
        // i is the box-average of fine pixels centered at i+0.5, hence +0.5/−0.5).
        const pcx = (level.xOffsetTiles * n + col + 0.5) / level.scale - 0.5
        const pcy = (level.yOffsetTiles * n + row + 0.5) / level.scale - 0.5
        const { padded, stride, invDist } = level
        const max = stride - 1
        for (let d = 0; d < DIR_COUNT; d++) {
          // bilinearSamplePadded, inlined (same arithmetic and clamps).
          const gx = pcx + DIR_COLS[d] + 1
          const gy = pcy + DIR_ROWS[d] + 1
          const x0 = Math.floor(gx), y0 = Math.floor(gy)
          const fx = gx - x0, fy = gy - y0
          const x0c = x0 < 0 ? 0 : x0 > max ? max : x0
          const x1c = x0 + 1 < 0 ? 0 : x0 + 1 > max ? max : x0 + 1
          const y0c = y0 < 0 ? 0 : y0 > max ? max : y0
          const y1c = y0 + 1 < 0 ? 0 : y0 + 1 > max ? max : y0 + 1
          const terrain = padded[y0c * stride + x0c] * (1 - fx) * (1 - fy) + padded[y0c * stride + x1c] * fx * (1 - fy)
            + padded[y1c * stride + x0c] * (1 - fx) * fy + padded[y1c * stride + x1c] * fx * fy
          // atan (not atan2): dist is always positive, so a single-argument atan
          // of the signed height-over-distance ratio gives the right signed angle.
          sum += Math.atan((observerElev - terrain) * invDist)
        }
      }
      const count = levelCount * DIR_COUNT
      const value = count > 0 ? (sum / count) * RAD_TO_DEG : 0
      // Terrarium, same arithmetic as elevationToTerrarium.
      const v = value + 32768
      const idx = (row * n + col) * 4
      out[idx] = Math.floor(v / 256)
      out[idx + 1] = Math.floor(v % 256)
      out[idx + 2] = Math.floor((v - Math.floor(v)) * 256)
      out[idx + 3] = 255
    }
  }
}
