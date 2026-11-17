// The per-pixel loop of Hard Shadows (lib/shadow-protocol.ts fetches the
// grid). Import-free so it also runs in lib/raster-compute-worker.ts.

export interface ShadowKernelInput {
  /** Elevations padded by `radiusPx` on every side. */
  padded: Float32Array
  stride: number
  n: number
  radiusPx: number
  /** Unit step toward the sun, in (row, col) pixels. */
  dRow: number
  dCol: number
  groundResM: number
  altitudeRad: number
}

export interface ShadowRay { offsets: Int32Array; invDist: Float64Array; tanAltitude: number; flatInShadow: boolean }

/** The ray toward the sun is the same for every pixel of the tile: its index
 *  offsets and 1/distance are built once. A pixel is in shadow when any step
 *  rises above the sun, i.e. when elevDiff / dist > tan(altitude) (atan is
 *  increasing and every distance is positive), so no atan per step and the
 *  march stops at the first obstruction. Same result as the old per-step
 *  atan2 loop, about 10x faster (2026-11-16 timing). */
export function buildShadowRay(input: ShadowKernelInput): ShadowRay {
  const { radiusPx, dRow, dCol, stride, groundResM, altitudeRad } = input
  const offsets: number[] = []
  const invDist: number[] = []
  for (let r = 1; r <= radiusPx; r++) {
    const rr = Math.round(r * dRow)
    const rc = Math.round(r * dCol)
    const dist = Math.sqrt(rr * rr + rc * rc) * groundResM
    if (dist === 0) continue
    offsets.push(rr * stride + rc)
    invDist.push(1 / dist)
  }
  return {
    offsets: Int32Array.from(offsets),
    invDist: Float64Array.from(invDist),
    tanAltitude: altitudeRad >= Math.PI / 2 ? Infinity : Math.tan(altitudeRad),
    // No ray at all (radius 0) means a flat horizon, angle 0, as before.
    flatInShadow: 0 > altitudeRad,
  }
}

/** Fills rows [row0, row1) of `out` (n x n RGBA): plain dark, fully opaque in
 *  shadow, fully transparent when lit. The raster layer's own paint opacity
 *  (state.shadowOpacity) controls how dark shadows read on screen. `out` must
 *  be zero-filled (a fresh array is). */
export function computeShadowRows(input: ShadowKernelInput, ray: ShadowRay, row0: number, row1: number, out: Uint8ClampedArray): void {
  const { padded, stride, n, radiusPx } = input
  const { offsets, invDist, tanAltitude, flatInShadow } = ray
  const steps = offsets.length
  for (let row = row0; row < row1; row++) {
    const pr = row + radiusPx
    for (let col = 0; col < n; col++) {
      const base = pr * stride + col + radiusPx
      const centerElevation = padded[base]
      let inShadow = steps === 0 ? flatInShadow : false
      for (let j = 0; j < steps; j++) {
        if ((padded[base + offsets[j]] - centerElevation) * invDist[j] > tanAltitude) { inShadow = true; break }
      }
      if (inShadow) out[(row * n + col) * 4 + 3] = 255
    }
  }
}
