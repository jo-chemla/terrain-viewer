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
//
// Second pass (2026-11-25, 512 px tiles, the same Terrarium bytes on every
// bench tile): duplicate ray steps dropped; the near rays swept a row at a
// time; the far rings' bilinear taps made per column and per row; the
// tangents compared and the atan taken once per direction, the far rings
// included; sky view factor's sin(atan(t)) as t / sqrt(1 + t²). Sky view
// factor r = 8 about 2x, openness with far rings about 1.35x.

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
      // A step on a pixel already in the ray (the diagonals round r = 1
      // and 2 to the same pixel): same pixel, same distance, so the maximum
      // cannot change (the QGIS port's `seen` set).
      if (offsets.includes(rr * stride + rc)) continue
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
  const svf = aggregate === "svf"
  // The steepest ratio of every pixel of the row, direction after direction:
  // a ray step is one pass along the row (contiguous reads, a multiply and a
  // compare a pixel) instead of a short loop per pixel and direction. Same
  // ratios (sign is ±1, so sign * invDist is exact), same maxima.
  const best = new Float64Array(DIRECTIONS * n)
  const center = new Float64Array(n)
  // The far rings' bilinear taps: a sample's column depends on the column
  // only and its row on the row only, so the floors, clamps and weights are
  // made once per column (per ring, direction and spread) and once per row,
  // not per pixel. bilinear()'s arithmetic, in its order.
  const S = FAR_SUB_ANGLES.length
  const far = farRings.map((ring) => {
    const max = ring.stride - 1, m = DIRECTIONS * S
    const X0 = new Int32Array(m * n), X1 = new Int32Array(m * n), FX = new Float64Array(m * n)
    for (let q = 0; q < m; q++) {
      const sub = FAR_DIR_OFFSETS[(q / S) | 0][q % S]
      for (let col = 0; col < n; col++) {
        const ax = (ring.xOffsetTiles * n + col + 0.5) / ring.scale - 0.5
        const gx = ax + sub[1] + 1
        const x0 = Math.floor(gx)
        FX[q * n + col] = gx - x0
        X0[q * n + col] = x0 < 0 ? 0 : x0 > max ? max : x0
        X1[q * n + col] = x0 + 1 < 0 ? 0 : x0 + 1 > max ? max : x0 + 1
      }
    }
    return { X0, X1, FX, R0: new Int32Array(m), R1: new Int32Array(m), FY: new Float64Array(m), max }
  })
  for (let row = row0; row < row1; row++) {
    const rowBase = (row + nearRadiusPx) * stride + nearRadiusPx
    for (let col = 0; col < n; col++) center[col] = padded[rowBase + col]
    best.fill(-Infinity)
    for (let i = 0; i < DIRECTIONS; i++) {
      const { offsets, invDist } = rays[i]
      const b0 = i * n
      for (let j = 0; j < offsets.length; j++) {
        const off = rowBase + offsets[j], k = sign * invDist[j]
        for (let col = 0; col < n; col++) {
          const t = (padded[off + col] - center[col]) * k
          if (t > best[b0 + col]) best[b0 + col] = t
        }
      }
    }
    for (let r = 0; r < far.length; r++) {
      const ring = farRings[r], f = far[r], max = f.max
      const ay = (ring.yOffsetTiles * n + row + 0.5) / ring.scale - 0.5
      for (let q = 0; q < DIRECTIONS * S; q++) {
        const gy = ay + FAR_DIR_OFFSETS[(q / S) | 0][q % S][0] + 1
        const y0 = Math.floor(gy)
        f.FY[q] = gy - y0
        f.R0[q] = (y0 < 0 ? 0 : y0 > max ? max : y0) * ring.stride
        f.R1[q] = (y0 + 1 < 0 ? 0 : y0 + 1 > max ? max : y0 + 1) * ring.stride
      }
    }
    for (let col = 0; col < n; col++) {
      const c = center[col]
      // The steepest tangent per direction, the far rings' included, and the
      // angle taken once at the end: atan is non-decreasing, so the atan of
      // the largest tangent is the largest of their atans (the same angle,
      // bit for bit): one atan a direction instead of one a direction and
      // ring. A ray with no step reads as horizontal (tangent 0, angle 0).
      for (let i = 0; i < DIRECTIONS; i++) {
        const maxT = best[i * n + col]
        angles[i] = maxT === -Infinity ? 0 : maxT
      }
      for (let r = 0; r < far.length; r++) {
        const ring = farRings[r], P = ring.padded, { X0, X1, FX, R0, R1, FY } = far[r]
        for (let i = 0; i < DIRECTIONS; i++) {
          let maxDiff = -Infinity
          for (let j = 0; j < S; j++) {
            const q = i * S + j, p = q * n + col
            const fx = FX[p], fy = FY[q], x0c = X0[p], x1c = X1[p], r0 = R0[q], r1 = R1[q]
            const sample = P[r0 + x0c] * (1 - fx) * (1 - fy) + P[r0 + x1c] * fx * (1 - fy)
              + P[r1 + x0c] * (1 - fx) * fy + P[r1 + x1c] * fx * fy
            const d = (sample - c) * sign
            if (d > maxDiff) maxDiff = d
          }
          if (maxDiff !== -Infinity) {
            const t = maxDiff / ring.distM
            if (t > angles[i]) angles[i] = t
          }
        }
      }
      let value: number
      if (svf) {
        // sin(atan(t)) as t / sqrt(1 + t²), the QGIS port's form: no atan
        // and no sin. Not the same bits as Math.sin(Math.atan(t)) (an ulp
        // or so of a value scaled to 0-100); the same Terrarium bytes on
        // every tile of tile-server/bench-direct.mjs.
        let s = 0
        for (let i = 0; i < DIRECTIONS; i++) { const t = angles[i]; if (t > 0) s += t / Math.sqrt(1 + t * t) }
        value = (1 - s / DIRECTIONS) * 100
      } else {
        let s = 0
        for (let i = 0; i < DIRECTIONS; i++) s += Math.atan(angles[i])
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
