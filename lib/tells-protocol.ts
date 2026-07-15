// Client-side archaeological "tell mound" candidate detector, registered as the
// `tells://` maplibre custom protocol. Ported from a standalone Python/GPU
// tell-detection pipeline (AI-AFG-tells-detection), reusing this app's existing
// terrain-derivative building blocks rather than re-implementing any of them:
//
//  - A (primary detector): a raster blob detector built as a Difference-of-Gaussians
//    over two Local Relief Model low-pass scales — reuses lrm-protocol.ts's own
//    ancestor-fetch/bilinear-resample machinery, called twice (kSmall, kLarge), no
//    new low-pass code needed. A tell mound is small relative to its surroundings,
//    so its elevation survives a small-radius low-pass (kSmall) but gets smoothed
//    away by a much larger-radius one (kLarge):
//      A = lowpass(kSmall) − lowpass(kLarge)
//    is positive and locally maximal right at a mound's summit — the same
//    bump-positive sign convention as a classic DoG blob detector (e.g. SIFT).
//    Note this is the *negative* of LRM(kSmall) − LRM(kLarge), since
//    LRM(k) = z − lowpass(k) makes the raw-elevation term cancel either way; the
//    lowpass-difference form is used directly here so local *maxima* (not minima)
//    are the candidates, matching the non-max-suppression pass below. kSmall is
//    fixed at 1 pyramid level (the finest denoise-only scale, never raw z, to avoid
//    amplifying per-pixel GLO-30 stripe/quantization noise) rather than derived from
//    tellSizeMeters — so A is effectively just the same LRM(kLarge) signal already
//    on screen, and growing Tell Size (the NMS merge radius below) can never also
//    shrink A's amplitude and erase a visibly obvious LRM peak.
//  - D: structure-tensor "blobness" (lib/blobness-protocol.ts) — high for round,
//    dome-like bumps, near-zero for elongated ridges/scarps. Used only as a veto:
//    an A-maximum sitting on a ridge rather than a rounded mound is rejected.
//  - C: plan curvature (lib/curvature-protocol.ts, Zevenbergen & Thorne 1987),
//    clipped to positive — positive plan curvature means flow diverges outward
//    across contours, i.e. a convex summit. Used only as a veto.
//  - F: determinant of the Hessian (lib/curvature-protocol.ts) — positive at
//    bowl/dome-shaped extrema, negative at saddles. Used only as a veto, cross-
//    confirming the point is a true dome rather than a saddle (which A's DoG
//    alone can look like a local maximum on one axis but not the other).
//
// Candidates are found by non-maximum suppression over A (a 3x3-strict-local-max
// pass, thresholded, then greedy point-wise NMS by a tell-size-derived radius) —
// D/C/F are evaluated only at surviving candidates as independent pass/reject
// filters, never blended into a weighted score, per the explicit design decision
// that A's local maxima are the primary signal and the other three only remove
// false positives.
//
// Output is an MVT (Mapbox Vector Tile) — the only way a maplibre custom protocol
// can deliver point features to a `{z}/{x}/{y}` vector source, the same mechanism
// this app's maplibre-contour dependency uses for the (also vector) contours layer.
// See components/LayersAndSources/ContoursLayer.tsx.
//
// Known limitation: since every tile is computed independently, a mound whose
// summit sits within one NMS radius of a tile boundary can be (rarely) detected
// once in each of the two neighboring tiles, or missed by both if the true peak
// falls just outside one tile's own fetched neighborhood — acceptable for this
// exploratory feature, not worth the cost of a cross-tile dedup pass.

import vtpbf from "vt-pbf"
import {
  sharedTileCache, fetchPaddedElevationGrid, bilinearSamplePadded, buildProtocolUrl,
  tileRowToLatRad, groundResolutionM, RAD_TO_DEG,
  type UpstreamEncoding, type ElevationWindow, type PaddedElevationGrid,
} from "./normal-derived-protocol"
import { radiusToLevels } from "./lrm-protocol"
import { computeProfileAndPlan, computeDetHessian } from "./curvature-protocol"
import { computeBlobness } from "./blobness-protocol"

const TELLS_PATH_RE = /^tells:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)(?:\?(.*))?$/

export interface TellsOptions {
  /** Real-world diameter (meters) of the mound size to search for — sets only the
   *  non-max-suppression merge radius (half this value): nearby local maxima of A
   *  within one mound-radius of each other collapse to the single strongest one.
   *  Deliberately does NOT affect the DoG kSmall scale (see A's header comment) —
   *  raising this should only ever merge nearby detections into fewer points, never
   *  shrink A's amplitude and suppress a real peak down to zero candidates. */
  tellSizeMeters: number
  /** Smoothing radius (in the same native-pixel units, and using the same
   *  radiusToLevels conversion, as the LRM layer's own "Smoothing Radius" control)
   *  used for kLarge, the DoG's regional-trend/background scale. Exposed directly
   *  so it can be set to match — or deliberately diverge from — whatever radius
   *  the LRM layer is currently displaying. */
  radiusPx: number
  /** Minimum A (DoG) value, in meters of relief, for a local maximum to even be
   *  considered a candidate — filters out flat-ground noise before any of the
   *  D/C/F veto filters run. */
  minReliefMeters: number
  /** Veto: reject candidates whose structure-tensor blobness (D) is below this —
   *  i.e. require a round, dome-like bump rather than an elongated ridge/scarp. */
  blobnessMin: number
  /** Veto: reject candidates whose plan curvature (C) is at or above -this (i.e.
   *  whose outward convexity, -plan clipped to positive, is at or below this) —
   *  i.e. require a genuinely convex, outward-diverging summit. Sign note: per
   *  curvature-protocol.ts's convention (positive=concave/valley, negative=
   *  convex/ridge), any point on the flank of a real mound — elevation
   *  decreasing outward from a peak — has plan <= 0 by construction (see that
   *  file's computeProfileAndPlan: for a radially-symmetric bump, plan is
   *  proportional to f'(x)/x, negative whenever f decreases outward). So the
   *  veto must threshold on -plan, not plan itself, or every real candidate is
   *  rejected the instant this is set above 0. */
  planMin: number
  /** Veto: reject candidates whose determinant-of-Hessian (F) is at or below this —
   *  i.e. require a true dome/bowl extremum rather than a saddle. */
  detHessianMin: number
  /** When true, each accepted candidate additionally gets a `scaleM` tag: the
   *  mound's estimated diameter in meters, measured by marching 8 rays outward
   *  from the peak through the already-computed DoG grid (A) until the value
   *  drops below half the peak — the median crossing distance is the mound's
   *  half-prominence radius. Purely in-memory over data the detector already
   *  built (no extra tile fetches), but off by default since it's extra
   *  per-candidate work with no effect on detection itself. Two caveats: rays
   *  clip at the tile edge (candidates near borders measure from fewer rays),
   *  and the measurable maximum is bounded by the kLarge background scale —
   *  anything wider was already subtracted out of A. */
  measureScale: boolean
  /** Which elevation grid the D/C/F veto filters sample: "fine" reads the raw,
   *  native-resolution grid (nativeGrid) at the candidate's own pixel; "coarse"
   *  bilinearly resamples the same ancestorSmall grid A's own kSmall lowpass
   *  already used, at the candidate's position. A is a local maximum of a
   *  DoG-of-lowpass signal, so it never sees per-pixel native noise — computing
   *  the vetoes on raw pixels instead means their much larger second-derivative
   *  sensitivity picks up noise the primary detector never had to deal with,
   *  which is what makes any veto threshold above the smallest values reject
   *  almost every candidate. "coarse" samples the same already-smoothed data A
   *  itself is built from, so the veto values stay well-behaved at the same
   *  positions A already found. Defaults to "coarse". */
  vetoResolution: "fine" | "coarse"
}

export const TELLS_DEFAULTS: TellsOptions = {
  tellSizeMeters: 100,
  radiusPx: 4,
  minReliefMeters: 1.5,
  blobnessMin: 0,
  planMin: 0,
  detHessianMin: 0,
  measureScale: false,
  vetoResolution: "coarse",
}

export function buildTellsProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, opts: Partial<TellsOptions> = {},
): string {
  const o = { ...TELLS_DEFAULTS, ...opts }
  const base = buildProtocolUrl("tells", upstreamTileTemplate, encoding, tileSize)
  const params = new URLSearchParams({
    tellSize: String(o.tellSizeMeters),
    radius: String(o.radiusPx),
    minRelief: String(o.minReliefMeters),
    blobnessMin: String(o.blobnessMin),
    planMin: String(o.planMin),
    detHessMin: String(o.detHessianMin),
    measureScale: o.measureScale ? "1" : "0",
    vetoRes: o.vetoResolution,
  })
  return `${base}?${params.toString()}`
}

interface AncestorScale {
  grid: PaddedElevationGrid
  scale: number
  xOffsetTiles: number
  yOffsetTiles: number
}

async function fetchAncestorScale(
  upstreamTemplate: string, encoding: UpstreamEncoding, n: number,
  z: number, x: number, y: number, k: number, signal: AbortSignal,
): Promise<AncestorScale> {
  const levels = Math.min(k, z)
  const scale = 1 << levels
  const ancestorZ = z - levels
  const ancestorX = x >> levels
  const ancestorY = y >> levels
  const xOffsetTiles = x - (ancestorX << levels)
  const yOffsetTiles = y - (ancestorY << levels)
  const grid = await fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, ancestorZ, ancestorX, ancestorY, n, signal)
  return { grid, scale, xOffsetTiles, yOffsetTiles }
}

// Same half-pixel ancestor-recentering as lrm-protocol.ts's own loop (see that
// file's header comment for why the `+0.5`/`-0.5` matters) — evaluated here at an
// arbitrary (row, col), including positions just outside the tile's own 0..n-1
// range, so the non-max-suppression pass below can compare a border pixel against
// its neighbors just across the tile edge without an extra tile fetch.
function lowpassAt(a: AncestorScale, n: number, row: number, col: number): number {
  const ancestorPxY = (a.yOffsetTiles * n + row + 0.5) / a.scale - 0.5
  const ancestorPxX = (a.xOffsetTiles * n + col + 0.5) / a.scale - 0.5
  return bilinearSamplePadded(a.grid, ancestorPxX, ancestorPxY)
}

interface Candidate { row: number; col: number; a: number }

const RAY_DIRS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
]

/** Half-prominence radius (in native pixels) of a candidate mound, by marching
 *  8 rays outward from its peak through the already-computed DoG grid until the
 *  value drops below half the peak, linearly interpolating the crossing for a
 *  sub-pixel distance. Rays that hit the grid edge before crossing are censored
 *  (dropped) rather than counted at their clipped length, which would bias the
 *  estimate low near tile borders; the median of the surviving crossings is
 *  robust to the one or two rays that wander along a connecting ridge. Returns
 *  null if no ray crossed (candidate hard against a corner). */
function measureHalfMaxRadiusPx(
  aGrid: Float32Array, strideA: number, haloA: number, cand: Candidate,
): number | null {
  const halfMax = cand.a / 2
  const pr = cand.row + haloA
  const pc = cand.col + haloA
  const crossings: number[] = []
  for (const [dr, dc] of RAY_DIRS) {
    const stepLen = Math.hypot(dr, dc)
    let prev = cand.a
    for (let s = 1; ; s++) {
      const r = pr + dr * s
      const c = pc + dc * s
      if (r < 0 || r >= strideA || c < 0 || c >= strideA) break
      const v = aGrid[r * strideA + c]
      if (v < halfMax) {
        crossings.push((s - 1 + (prev - halfMax) / (prev - v)) * stepLen)
        break
      }
      prev = v
    }
  }
  if (crossings.length === 0) return null
  crossings.sort((p, q) => p - q)
  const mid = crossings.length >> 1
  return crossings.length % 2 ? crossings[mid] : (crossings[mid - 1] + crossings[mid]) / 2
}

export async function tellsProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(TELLS_PATH_RE)
  if (!match) throw new Error(`Invalid tells protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, query] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const signal = abortController.signal

  const q = new URLSearchParams(query ?? "")
  const opts: TellsOptions = {
    tellSizeMeters: q.has("tellSize") ? Number(q.get("tellSize")) : TELLS_DEFAULTS.tellSizeMeters,
    radiusPx: q.has("radius") ? Number(q.get("radius")) : TELLS_DEFAULTS.radiusPx,
    minReliefMeters: q.has("minRelief") ? Number(q.get("minRelief")) : TELLS_DEFAULTS.minReliefMeters,
    blobnessMin: q.has("blobnessMin") ? Number(q.get("blobnessMin")) : TELLS_DEFAULTS.blobnessMin,
    planMin: q.has("planMin") ? Number(q.get("planMin")) : TELLS_DEFAULTS.planMin,
    detHessianMin: q.has("detHessMin") ? Number(q.get("detHessMin")) : TELLS_DEFAULTS.detHessianMin,
    measureScale: q.get("measureScale") === "1",
    vetoResolution: q.get("vetoRes") === "fine" ? "fine" : TELLS_DEFAULTS.vetoResolution,
  }

  const latDeg = tileRowToLatRad(y + 0.5, z) * RAD_TO_DEG
  const groundResM = groundResolutionM(latDeg, z, n)
  const pxForMeters = (m: number) => m / groundResM

  // DoG scale pair: kSmall fixed at the finest pyramid level (denoise floor only,
  // deliberately independent of tellSizeMeters — see TellsOptions.tellSizeMeters
  // and A's header comment for why), kLarge taken directly from opts.radiusPx via
  // the same radiusToLevels conversion the LRM layer itself uses on its own
  // "Smoothing Radius" control — so this can be dialed to match (or deliberately
  // diverge from) whatever radius LRM is showing.
  const kSmall = 1
  const kLargeRaw = radiusToLevels(opts.radiusPx)
  const kLarge = Math.min(6, Math.max(kSmall + 1, kLargeRaw))

  const nativeHalo = 2 // enough for blobness's 5x5 window and curvature's 3x3 one
  // Only fetched for "fine" veto resolution — "coarse" (the default) reuses
  // ancestorSmall instead, so this fetch is skipped entirely in the common case.
  const [ancestorSmall, ancestorLarge, nativeGrid] = await Promise.all([
    fetchAncestorScale(upstreamTemplate, encoding, n, z, x, y, kSmall, signal),
    fetchAncestorScale(upstreamTemplate, encoding, n, z, x, y, kLarge, signal),
    opts.vetoResolution === "fine"
      ? fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal, nativeHalo)
      : Promise.resolve(null),
  ])

  // ── A: DoG(LRM) over a 1px-haloed grid (n+2 x n+2) — just enough margin for the
  // 3x3 strict-local-max check below to see across the tile's own edge. ──────
  const haloA = 1
  const strideA = n + 2 * haloA
  const aGrid = new Float32Array(strideA * strideA)
  for (let pr = 0; pr < strideA; pr++) {
    const row = pr - haloA
    for (let pc = 0; pc < strideA; pc++) {
      const col = pc - haloA
      aGrid[pr * strideA + pc] = lowpassAt(ancestorSmall, n, row, col) - lowpassAt(ancestorLarge, n, row, col)
    }
  }

  // ── Candidate detection: strict 3x3 local maxima above the relief threshold ──
  const MAX_CANDIDATES = 2000 // defensive cap for pathologically noisy input tiles
  const candidates: Candidate[] = []
  for (let row = 0; row < n && candidates.length < MAX_CANDIDATES * 4; row++) {
    const pr = row + haloA
    for (let col = 0; col < n; col++) {
      const pc = col + haloA
      const a = aGrid[pr * strideA + pc]
      if (a < opts.minReliefMeters) continue
      let isMax = true
      for (let dr = -1; dr <= 1 && isMax; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          if (aGrid[(pr + dr) * strideA + (pc + dc)] > a) { isMax = false; break }
        }
      }
      if (isMax) candidates.push({ row, col, a })
    }
  }
  candidates.sort((p, q2) => q2.a - p.a)
  const rawCandidateCount = candidates.length
  candidates.length = Math.min(candidates.length, MAX_CANDIDATES)

  // ── Greedy point-wise non-max suppression by tell-size-derived radius ────────
  const nmsRadiusPx = Math.max(1, pxForMeters(opts.tellSizeMeters * 0.5))
  const nmsRadiusSq = nmsRadiusPx * nmsRadiusPx
  const accepted: Candidate[] = []
  for (const cand of candidates) {
    let tooClose = false
    for (const acc of accepted) {
      const dr = cand.row - acc.row, dc = cand.col - acc.col
      if (dr * dr + dc * dc < nmsRadiusSq) { tooClose = true; break }
    }
    if (!tooClose) accepted.push(cand)
  }

  // ── Veto filters: D (blobness), C (plan curvature, clipped positive), F (det
  // Hessian) — evaluated only at surviving candidates, each independently able to
  // reject (AND, not a weighted score). ────────────────────────────────────────
  const nativeStride = n + 2 * nativeHalo
  const invGroundRes = 1 / groundResM
  const geojsonFeatures: { type: 1; geometry: [[number, number]]; tags: Record<string, number> }[] = []
  const extent = 4096
  let rejectedByBlobness = 0, rejectedByPlan = 0, rejectedByDetHessian = 0

  for (const cand of accepted) {
    // "fine": raw native-resolution pixels — exact same per-pixel GLO-30 stripe/
    // quantization noise the primary detector (A) was deliberately built to avoid
    // (see kSmall's comment above), which is why D/C/F's second-derivative-based
    // formulas are far noisier here and any veto threshold above ~0 rejects nearly
    // everything. "coarse": bilinearly resample ancestorSmall — the same kSmall
    // lowpass grid A's own "mound survives here" term is built from — at the
    // candidate's position, so the veto quantities see the same denoised mound
    // shape A found, not amplified raw-pixel noise (ancestorLarge, the DoG's
    // *background* term, is deliberately not used here: at that scale the mound
    // itself has already been smoothed away, which would make every veto reject).
    const pr = cand.row + nativeHalo
    const pc = cand.col + nativeHalo
    const sample = opts.vetoResolution === "fine"
      ? (dr: number, dc: number) => nativeGrid!.padded[(pr + dr) * nativeStride + (pc + dc)]
      : (dr: number, dc: number) => lowpassAt(ancestorSmall, n, cand.row + dr, cand.col + dc)

    const blobness = computeBlobness(sample, groundResM)
    if (blobness < opts.blobnessMin) { rejectedByBlobness++; continue }

    const window: ElevationWindow = {
      a0: sample(-1, -1), a1: sample(-1, 0), a2: sample(-1, 1),
      a3: sample(0, -1), a4: sample(0, 0), a5: sample(0, 1),
      a6: sample(1, -1), a7: sample(1, 0), a8: sample(1, 1),
      invEwresXscale: invGroundRes, invNsresYscale: invGroundRes, groundResolutionM: groundResM,
    }
    // See planMin's doc comment: a real mound's flank has plan <= 0 by
    // construction (positive=concave/valley, negative=convex/ridge convention),
    // so the veto quantity is outward convexity = -plan, clipped to positive.
    const { plan } = computeProfileAndPlan(window)
    const planConvexity = Math.max(0, -plan)
    if (planConvexity < opts.planMin) { rejectedByPlan++; continue }

    const detHessian = computeDetHessian(window)
    if (detHessian < opts.detHessianMin) { rejectedByDetHessian++; continue }

    const tx = Math.round(((cand.col + 0.5) / n) * extent)
    const ty = Math.round(((cand.row + 0.5) / n) * extent)
    const tags: Record<string, number> = {
      a: Math.round(cand.a * 100) / 100,
      blobness: Math.round(blobness * 100) / 100,
      plan: Math.round(planConvexity * 100) / 100,
      // 3 decimals (not 2 like the others): the veto slider steps by 0.001, and
      // real candidate values cluster well below 0.05 — 2-decimal rounding would
      // show most of them as 0.00, uncomparable against the threshold.
      detHessian: Math.round(detHessian * 1000) / 1000,
    }
    if (opts.measureScale) {
      const halfMaxRadiusPx = measureHalfMaxRadiusPx(aGrid, strideA, haloA, cand)
      // Diameter, not radius — same real-world quantity the Tell Size control is in.
      if (halfMaxRadiusPx !== null) tags.scaleM = Math.round(2 * halfMaxRadiusPx * groundResM)
    }
    geojsonFeatures.push({
      type: 1,
      geometry: [[tx, ty]],
      tags,
    })
  }

  // eslint-disable-next-line no-console -- opt-in diagnostic for the "why are there
  // zero tell points" report; cheap (one line per tile fetch) and only fires while
  // the beta feature is actually in use, so left in rather than stripped for prod.
  // console.log (not .debug) so it shows under Chrome DevTools' default "Info"
  // filter without the user having to manually enable the Verbose level.
  console.log(
    `[tells] z${z}/${x}/${y} groundResM=${groundResM.toFixed(2)} kSmall=${kSmall} kLarge=${kLarge} ` +
    `rawCandidates=${rawCandidateCount} afterNMS=${accepted.length} accepted=${geojsonFeatures.length} ` +
    `rejected{blobness=${rejectedByBlobness} plan=${rejectedByPlan} detHessian=${rejectedByDetHessian}} ` +
    `opts=${JSON.stringify(opts)}`,
  )
  const buffer = (vtpbf as any).fromGeojsonVt({ tells: { features: geojsonFeatures } }, { version: 2, extent })
  return { data: new Uint8Array(buffer) }
}
