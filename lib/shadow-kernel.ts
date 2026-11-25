// The pixel kernel of Hard Shadows (lib/shadow-protocol.ts fetches the grid).
// Import-free so it also runs in lib/raster-compute-worker.ts and in Node
// (scripts/bench-shadow.mjs, lib/shadow-kernel.test.ts).
//
// Two kernels, same question: is anything within `radiusPx` toward the sun
// above the line from this pixel to the sun?
//  - computeShadowTile, the one the tiles use (2026-11-25): a shadow-height
//    sweep. Cost per pixel no longer grows with the radius (one interpolated
//    look-up and three comparisons per pixel of the swept band), so the
//    default radius went from 32 to 256 px for about the old cost.
//  - computeShadowRowsMarch, the per-pixel ray march it replaced, kept as the
//    reference (test, benchmark).
// Measured against each other in docs/content/docs/dev/shadow-renderers.mdx.

export interface ShadowKernelInput {
  /** Elevations padded by `radiusPx` on every side. */
  padded: Float32Array
  stride: number
  n: number
  /** Search radius in pixels (Euclidean, along the sun direction), also the
   *  padding of `padded`. */
  radiusPx: number
  /** Unit step toward the sun, in (row, col) pixels. */
  dRow: number
  dCol: number
  groundResM: number
  altitudeRad: number
}

/** A large finite stand-in for "no obstruction": -Infinity * 0 in a lerp
 *  weight would be NaN. */
const NONE = -1e30

/** Fills `out` (n x n RGBA, zero-filled: a fresh array is) with plain dark,
 *  fully opaque in shadow and transparent when lit; the raster layer's paint
 *  opacity sets how dark it reads.
 *
 *  The sweep. Take the dominant axis of the sun direction ("major": rows or
 *  columns); one step toward the sun is one major pixel and `b` minor pixels
 *  (|b| <= 1), Euclidean length hypot(1, b). Shear the grid along the minor
 *  axis so the lines toward the sun become columns: column c at major
 *  distance t samples the elevation at minor position c + b t (linear between
 *  the two pixels). Along one such line, pixel u is in shadow when some
 *  sample t in (u, u + J] has hs(t) - (t - u) drop > h(u), drop being the
 *  sun's rise over one step; i.e. when max(hs(t) - t drop) over the window,
 *  plus u drop, is above h(u). That window maximum is a sliding maximum of
 *  fixed width J, computed for every u with van Herk / Gil-Werman (a prefix
 *  and a suffix maximum per block of J): O(1) per sample whatever J. A tile
 *  pixel lies between two sheared columns; its value is interpolated between
 *  them (exact on planes, so no self-shadowing on sunlit slopes) and compared
 *  with its own, unsheared elevation.
 *
 *  The reach is J = floor(radius / hypot(1, b)) steps, i.e. the same
 *  Euclidean radius as the march and the same for every pixel: tiles agree at
 *  their seams. And it stops early, exactly, where nothing can be higher: a
 *  sample t steps away can only shadow a pixel if it is more than t drop
 *  above it, so with `top` the padded grid's highest point and `low` the
 *  tile's lowest, J never needs to exceed (top - low) / drop. High sun or
 *  gentle relief: few steps, and a tile with no relief at all costs a scan.
 *
 *  Versus the march: it samples the line by linear interpolation instead of
 *  rounding each step to the nearest pixel, and interpolates the window
 *  maximum between two lines (a maximum of interpolations would be exact; an
 *  interpolation of maxima is the same or slightly higher), so shadow edges
 *  can move by about a pixel. Measured on real tiles and checked on a cone
 *  and a step in lib/shadow-kernel.test.ts. */
export function computeShadowTile(input: ShadowKernelInput, out: Uint8ClampedArray): void {
  const { padded, stride, n, radiusPx: halo, dRow, dCol, groundResM, altitudeRad } = input
  if (altitudeRad >= Math.PI / 2) return
  const rowMajor = Math.abs(dRow) >= Math.abs(dCol)
  const a = rowMajor ? dRow : dCol
  if (a === 0) return
  const sa = a > 0 ? 1 : -1
  const b = (rowMajor ? dCol : dRow) / Math.abs(a)
  const stepLen = Math.hypot(1, b)
  const drop = stepLen * groundResM * Math.tan(altitudeRad)
  let J = Math.floor(halo / stepLen + 1e-9)
  // Strides of one major and one minor pixel in `padded`.
  const majS = rowMajor ? stride : 1, minS = rowMajor ? 1 : stride

  // Exact early exit: no sample farther than (top - low) / drop can be above
  // the line to the sun. `top` over the box the samples can reach (the tile
  // and the tile moved by the radius toward the sun), `low` over the tile.
  if (drop > 0) {
    let top = -Infinity, low = Infinity
    const reachR = Math.ceil(halo * Math.abs(dRow)), reachC = Math.ceil(halo * Math.abs(dCol))
    const r0 = dRow < 0 ? halo - reachR : halo, r1 = dRow < 0 ? halo + n : halo + n + reachR
    const c0 = dCol < 0 ? halo - reachC : halo, c1 = dCol < 0 ? halo + n : halo + n + reachC
    for (let r = Math.max(0, r0 - 1); r < Math.min(stride, r1 + 1); r++) {
      for (let i = r * stride + Math.max(0, c0 - 1), e = r * stride + Math.min(stride, c1 + 1); i < e; i++) { const v = padded[i]; if (v > top) top = v }
    }
    for (let r = 0; r < n; r++) {
      for (let i = (r + halo) * stride + halo, e = i + n; i < e; i++) { const v = padded[i]; if (v < low) low = v }
    }
    if (!(top > low)) return // flat (or empty) tile: lit
    J = Math.min(J, Math.floor((top - low) / drop))
  }
  if (J <= 0) {
    // No step at all: a flat horizon, angle 0 (the march's radius 0 rule).
    if (altitudeRad < 0) for (let i = 3; i < out.length; i += 4) out[i] = 255
    return
  }

  // u = major distance from the tile's downsun edge; major index of u.
  const iDown = sa > 0 ? halo : halo + n - 1
  // Sheared columns c (minor position at u = 0) that tile pixels read.
  const span = -b * (n - 1)
  const cMin = Math.floor(halo + Math.min(0, span))
  const cMax = Math.floor(halo + n - 1 + Math.max(0, span)) + 1
  const nCols = cMax - cMin + 1
  // The tile rows [uLo, uHi] that read column c: floor(M - b u) is c or c - 1
  // for some tile minor index M in [halo, halo + n - 1]. Its samples are
  // t in [uLo + 1, uHi + J]; elsewhere the column is not computed.
  const tLo = new Int32Array(nCols), tHi = new Int32Array(nCols)
  for (let j = 0; j < nCols; j++) {
    const c = cMin + j
    let uLo = 0, uHi = n - 1
    if (b !== 0) {
      const e0 = (halo - c - 1) / b, e1 = (halo + n - c) / b
      uLo = Math.max(0, Math.floor(Math.min(e0, e1)))
      uHi = Math.min(n - 1, Math.ceil(Math.max(e0, e1)))
    }
    tLo[j] = uLo + 1
    tHi[j] = uLo > uHi ? -1 : uHi + J
  }

  // The sliding maximum of g(t) = hs(t) - t drop over t in (u, u + J], for
  // every column at once, row by row (contiguous in memory): van Herk /
  // Gil-Werman with blocks of J starting at t = 1. Window (u, u + J] is
  // max(suffix(u + 1), prefix(u + J)): the suffix runs from u + 1 to its
  // block's end, the prefix from the next block's start to u + J, both inside
  // the window, so the uncomputed parts of a column are never read.
  // Forward pass: g and its prefix maximum.
  const T = n - 1 + J // samples t = 1 .. T, row k = t - 1
  const g = new Float32Array(T * nCols), pre = new Float32Array(T * nCols)
  const lastMinor = stride - 1
  for (let t = 1; t <= T; t++) {
    const k = t - 1, row = k * nCols, blockStart = k % J === 0
    const majBase = (iDown + sa * t) * majS
    const s = b * t, fl = Math.floor(s), f = s - fl
    const sub = t * drop
    for (let j = 0; j < nCols; j++) {
      if (t < tLo[j] || t > tHi[j]) continue
      let m0 = cMin + j + fl, m1 = m0 + 1
      if (m0 < 0) m0 = m1 = 0
      else if (m1 > lastMinor) { m1 = lastMinor; if (m0 > lastMinor) m0 = lastMinor }
      const h0 = padded[majBase + m0 * minS]
      const v = h0 + (padded[majBase + m1 * minS] - h0) * f - sub
      g[row + j] = v
      const p = blockStart ? v : pre[row - nCols + j]
      pre[row + j] = v > p ? v : p
    }
  }
  // Backward pass: the suffix maximum (one running row); at k = u < n the
  // window maximum of tile row u, from suffix(u + 1) (row u) and prefix(u + J)
  // (row u + J - 1), then that row's pixels: the window maximum between their
  // two sheared columns, plus u drop, against their own elevation.
  const suf = new Float32Array(nCols), win = new Float32Array(nCols)
  for (let k = T - 1; k >= 0; k--) {
    const row = k * nCols, blockEnd = k === T - 1 || k % J === J - 1
    for (let j = 0; j < nCols; j++) {
      const v = g[row + j]
      suf[j] = blockEnd || v > suf[j] ? v : suf[j]
    }
    if (k >= n) continue
    const u = k, pRow = (u + J - 1) * nCols
    for (let j = 0; j < nCols; j++) {
      if (u + 1 < tLo[j] || u + J > tHi[j]) { win[j] = NONE; continue }
      const p = pre[pRow + j], q = suf[j]
      win[j] = p > q ? p : q
    }
    const p = sa > 0 ? u : n - 1 - u
    const s = -b * u, f0 = Math.floor(s), f = s - f0
    const wBase = halo + f0 - cMin
    const rise = u * drop
    const majBase = (halo + p) * majS
    for (let q = 0; q < n; q++) {
      const w0 = win[wBase + q]
      const cast = w0 + (win[wBase + q + 1] - w0) * f + rise
      if (cast > padded[majBase + (halo + q) * minS]) out[(rowMajor ? p * n + q : q * n + p) * 4 + 3] = 255
    }
  }
}

// ---------- the reference: per-pixel ray march ----------

export interface ShadowRay { offsets: Int32Array; invDist: Float64Array; rise: Float64Array; tanAltitude: number; flatInShadow: boolean }

/** The ray toward the sun is the same for every pixel of the tile: its index
 *  offsets and 1/distance are built once. A pixel is in shadow when any step
 *  rises above the sun, i.e. when elevDiff / dist > tan(altitude) (atan is
 *  increasing and every distance is positive), so no atan per step and the
 *  march stops at the first obstruction. */
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
  const tanAltitude = altitudeRad >= Math.PI / 2 ? Infinity : Math.tan(altitudeRad)
  return {
    offsets: Int32Array.from(offsets),
    invDist: Float64Array.from(invDist),
    rise: Float64Array.from(invDist, (v) => tanAltitude / v), // dist * tan(alt)
    tanAltitude,
    // No ray at all (radius 0) means a flat horizon, angle 0.
    flatInShadow: 0 > altitudeRad,
  }
}

/** The march, rows [row0, row1) of `out`: up to `radiusPx` nearest-pixel
 *  samples per pixel, stopping at the first obstruction, or (exact, sun above
 *  the horizon) once the line to the sun is above the padded grid's highest
 *  point. */
export function computeShadowRowsMarch(input: ShadowKernelInput, ray: ShadowRay, row0: number, row1: number, out: Uint8ClampedArray): void {
  const { padded, stride, n, radiusPx } = input
  const { offsets, rise, flatInShadow } = ray
  const steps = offsets.length
  let top = Infinity
  if (ray.tanAltitude > 0) { top = -Infinity; for (let i = 0; i < padded.length; i++) if (padded[i] > top) top = padded[i] }
  for (let row = row0; row < row1; row++) {
    const pr = row + radiusPx
    for (let col = 0; col < n; col++) {
      const base = pr * stride + col + radiusPx
      const centre = padded[base]
      let inShadow = steps === 0 ? flatInShadow : false
      for (let j = 0; j < steps; j++) {
        const line = centre + rise[j]
        if (line >= top) break
        if (padded[base + offsets[j]] > line) { inShadow = true; break }
      }
      if (inShadow) out[(row * n + col) * 4 + 3] = 255
    }
  }
}
