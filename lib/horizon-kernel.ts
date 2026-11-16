// The per-pixel horizon-angle loop behind Sky View Factor and Openness
// (lib/horizon-angle.ts fetches the grids, this computes the pixels). Pure and
// import-free so the same code runs on the main thread and in
// lib/raster-compute-worker.ts.
//
// Same result as the loop it replaced, much faster (2026-11-16 timing, 512 px
// tiles): the ray offsets and distances are identical for every pixel of a tile,
// so they are built once per tile; along a ray only the steepest elevation-to-
// distance ratio is tracked and atan() runs once per direction, not once per
// step (atan is increasing and every distance is positive, so the max ratio
// gives the max angle); nothing is allocated per pixel.

export type HorizonAggregate = "svf" | "openness"

/** One coarse pyramid ancestor ring of "fast" precision: see horizon-angle.ts. */
export interface HorizonFarRing {
  padded: Float32Array
  stride: number
  scale: number
  xOffsetTiles: number
  yOffsetTiles: number
  distM: number
}

export interface HorizonKernelInput {
  /** Native grid with a nearRadiusPx halo. */
  padded: Float32Array
  stride: number
  n: number
  nearRadiusPx: number
  groundResolutionM: number
  sign: 1 | -1
  /** "fast" precision: powers-of-two steps in the near field. */
  fast: boolean
  aggregate: HorizonAggregate
  farRings: HorizonFarRing[]
}

const DIRECTIONS = 8
const RAD_TO_DEG = 180 / Math.PI
/** N/NE/E/SE/S/SW/W/NW as (dRow, dCol) unit vectors. */
const DIR_VECTORS: readonly (readonly [number, number])[] = Array.from({ length: DIRECTIONS }, (_, i) => {
  const angle = (2 * Math.PI * i) / DIRECTIONS
  return [Math.sin(angle), Math.cos(angle)] as const
})
/** Far rings check each direction rotated by these spreads (radians). */
const FAR_SUB_ANGLES = [-0.3, 0, 0.3]
const FAR_DIR_OFFSETS: readonly (readonly [number, number])[][] = DIR_VECTORS.map(([dRow, dCol]) =>
  FAR_SUB_ANGLES.map((spread) => {
    const cosA = Math.cos(spread), sinA = Math.sin(spread)
    return [dRow * cosA + dCol * sinA, dCol * cosA - dRow * sinA] as const
  }),
)

function bilinear(padded: Float32Array, stride: number, px: number, py: number): number {
  const gx = px + 1
  const gy = py + 1
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const max = stride - 1
  const x0c = x0 < 0 ? 0 : x0 > max ? max : x0
  const x1c = x0 + 1 < 0 ? 0 : x0 + 1 > max ? max : x0 + 1
  const y0c = y0 < 0 ? 0 : y0 > max ? max : y0
  const y1c = y0 + 1 < 0 ? 0 : y0 + 1 > max ? max : y0 + 1
  return padded[y0c * stride + x0c] * (1 - fx) * (1 - fy) + padded[y0c * stride + x1c] * fx * (1 - fy)
    + padded[y1c * stride + x0c] * (1 - fx) * fy + padded[y1c * stride + x1c] * fx * fy
}

/** Per direction: index offsets into the padded grid and 1/distance (m). */
function buildRays(stride: number, radiusPx: number, fast: boolean, groundResolutionM: number) {
  const steps: number[] = []
  if (fast) {
    for (let r = 1; r <= radiusPx; r *= 2) steps.push(r)
    if (steps[steps.length - 1] !== radiusPx) steps.push(radiusPx)
  } else {
    for (let r = 1; r <= radiusPx; r++) steps.push(r)
  }
  return DIR_VECTORS.map(([dRow, dCol]) => {
    const offsets: number[] = []
    const invDist: number[] = []
    for (const r of steps) {
      const rr = Math.round(r * dRow)
      const rc = Math.round(r * dCol)
      const dist = Math.sqrt(rr * rr + rc * rc) * groundResolutionM
      if (dist === 0) continue
      offsets.push(rr * stride + rc)
      invDist.push(1 / dist)
    }
    return { offsets: Int32Array.from(offsets), invDist: Float64Array.from(invDist) }
  })
}

/** Fills rows [row0, row1) of `out` (n x n RGBA, Terrarium-encoded values). */
export function computeHorizonRows(input: HorizonKernelInput, row0: number, row1: number, out: Uint8ClampedArray): void {
  const { padded, stride, n, nearRadiusPx, groundResolutionM, sign, fast, aggregate, farRings } = input
  const rays = buildRays(stride, nearRadiusPx, fast, groundResolutionM)
  const angles = new Float64Array(DIRECTIONS)
  for (let row = row0; row < row1; row++) {
    const pr = row + nearRadiusPx
    for (let col = 0; col < n; col++) {
      const base = pr * stride + col + nearRadiusPx
      const center = padded[base]
      for (let i = 0; i < DIRECTIONS; i++) {
        const { offsets, invDist } = rays[i]
        let maxT = -Infinity
        for (let j = 0; j < offsets.length; j++) {
          const t = (padded[base + offsets[j]] - center) * sign * invDist[j]
          if (t > maxT) maxT = t
        }
        angles[i] = maxT === -Infinity ? 0 : Math.atan(maxT)
      }
      for (let k = 0; k < farRings.length; k++) {
        const ring = farRings[k]
        const ax = (ring.xOffsetTiles * n + col + 0.5) / ring.scale - 0.5
        const ay = (ring.yOffsetTiles * n + row + 0.5) / ring.scale - 0.5
        for (let i = 0; i < DIRECTIONS; i++) {
          const subs = FAR_DIR_OFFSETS[i]
          let maxDiff = -Infinity
          for (let j = 0; j < subs.length; j++) {
            const d = (bilinear(ring.padded, ring.stride, ax + subs[j][1], ay + subs[j][0]) - center) * sign
            if (d > maxDiff) maxDiff = d
          }
          if (maxDiff !== -Infinity) {
            const a = Math.atan(maxDiff / ring.distM)
            if (a > angles[i]) angles[i] = a
          }
        }
      }
      let value: number
      if (aggregate === "svf") {
        let s = 0
        for (let i = 0; i < DIRECTIONS; i++) s += Math.sin(angles[i] > 0 ? angles[i] : 0)
        value = (1 - s / DIRECTIONS) * 100
      } else {
        let s = 0
        for (let i = 0; i < DIRECTIONS; i++) s += angles[i]
        value = -(s / DIRECTIONS) * RAD_TO_DEG
      }
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
