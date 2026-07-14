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
//    always clamped >= 1 pyramid level (never raw z) to avoid amplifying per-pixel
//    GLO-30 stripe/quantization noise on the fine scale.
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
  /** Real-world diameter (meters) of the mound size to search for — sets both the
   *  DoG kSmall/kLarge scale pair and the non-max-suppression search radius. */
  tellSizeMeters: number
  /** Minimum A (DoG) value, in meters of relief, for a local maximum to even be
   *  considered a candidate — filters out flat-ground noise before any of the
   *  D/C/F veto filters run. */
  minReliefMeters: number
  /** Veto: reject candidates whose structure-tensor blobness (D) is below this —
   *  i.e. require a round, dome-like bump rather than an elongated ridge/scarp. */
  blobnessMin: number
  /** Veto: reject candidates whose plan curvature (C), clipped to positive, is at
   *  or below this — i.e. require a genuinely convex, outward-diverging summit. */
  planMin: number
  /** Veto: reject candidates whose determinant-of-Hessian (F) is at or below this —
   *  i.e. require a true dome/bowl extremum rather than a saddle. */
  detHessianMin: number
}

export const TELLS_DEFAULTS: TellsOptions = {
  tellSizeMeters: 100,
  minReliefMeters: 0.3,
  blobnessMin: 5,
  planMin: 0,
  detHessianMin: 0,
}

export function buildTellsProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, opts: Partial<TellsOptions> = {},
): string {
  const o = { ...TELLS_DEFAULTS, ...opts }
  const base = buildProtocolUrl("tells", upstreamTileTemplate, encoding, tileSize)
  const params = new URLSearchParams({
    tellSize: String(o.tellSizeMeters),
    minRelief: String(o.minReliefMeters),
    blobnessMin: String(o.blobnessMin),
    planMin: String(o.planMin),
    detHessMin: String(o.detHessianMin),
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
    minReliefMeters: q.has("minRelief") ? Number(q.get("minRelief")) : TELLS_DEFAULTS.minReliefMeters,
    blobnessMin: q.has("blobnessMin") ? Number(q.get("blobnessMin")) : TELLS_DEFAULTS.blobnessMin,
    planMin: q.has("planMin") ? Number(q.get("planMin")) : TELLS_DEFAULTS.planMin,
    detHessianMin: q.has("detHessMin") ? Number(q.get("detHessMin")) : TELLS_DEFAULTS.detHessianMin,
  }

  const latDeg = tileRowToLatRad(y + 0.5, z) * RAD_TO_DEG
  const groundResM = groundResolutionM(latDeg, z, n)
  const pxForMeters = (m: number) => m / groundResM

  // DoG scale pair bracketing the target mound size — kSmall a quarter-tell-size
  // low-pass, kLarge a double-tell-size one (radiusToLevels itself clamps to
  // pyramid levels [1, 6], so kSmall is always >= 1, never raw elevation).
  const kSmallRaw = radiusToLevels(pxForMeters(opts.tellSizeMeters * 0.25))
  const kLargeRaw = radiusToLevels(pxForMeters(opts.tellSizeMeters * 2))
  const kSmall = kSmallRaw
  const kLarge = Math.min(6, Math.max(kSmall + 1, kLargeRaw))

  const nativeHalo = 2 // enough for blobness's 5x5 window and curvature's 3x3 one
  const [ancestorSmall, ancestorLarge, nativeGrid] = await Promise.all([
    fetchAncestorScale(upstreamTemplate, encoding, n, z, x, y, kSmall, signal),
    fetchAncestorScale(upstreamTemplate, encoding, n, z, x, y, kLarge, signal),
    fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal, nativeHalo),
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
  const geojsonFeatures: { type: 1; geometry: [number, number]; tags: Record<string, number> }[] = []
  const extent = 4096
  let rejectedByBlobness = 0, rejectedByPlan = 0, rejectedByDetHessian = 0

  for (const cand of accepted) {
    const pr = cand.row + nativeHalo
    const pc = cand.col + nativeHalo
    const sample = (dr: number, dc: number) => nativeGrid.padded[(pr + dr) * nativeStride + (pc + dc)]

    const blobness = computeBlobness(sample, groundResM)
    if (blobness < opts.blobnessMin) { rejectedByBlobness++; continue }

    const window: ElevationWindow = {
      a0: sample(-1, -1), a1: sample(-1, 0), a2: sample(-1, 1),
      a3: sample(0, -1), a4: sample(0, 0), a5: sample(0, 1),
      a6: sample(1, -1), a7: sample(1, 0), a8: sample(1, 1),
      invEwresXscale: invGroundRes, invNsresYscale: invGroundRes, groundResolutionM: groundResM,
    }
    const { plan } = computeProfileAndPlan(window)
    const planClipped = Math.max(0, plan)
    if (planClipped <= opts.planMin) { rejectedByPlan++; continue }

    const detHessian = computeDetHessian(window)
    if (detHessian <= opts.detHessianMin) { rejectedByDetHessian++; continue }

    const tx = Math.round(((cand.col + 0.5) / n) * extent)
    const ty = Math.round(((cand.row + 0.5) / n) * extent)
    geojsonFeatures.push({
      type: 1,
      geometry: [tx, ty],
      tags: {
        a: Math.round(cand.a * 100) / 100,
        blobness: Math.round(blobness * 100) / 100,
        plan: Math.round(planClipped * 100) / 100,
        detHessian: Math.round(detHessian * 100) / 100,
      },
    })
  }

  // eslint-disable-next-line no-console -- opt-in diagnostic for the "why are there
  // zero tell points" report; cheap (one line per tile fetch) and only fires while
  // the beta feature is actually in use, so left in rather than stripped for prod.
  console.debug(
    `[tells] z${z}/${x}/${y} groundResM=${groundResM.toFixed(2)} kSmall=${kSmall} kLarge=${kLarge} ` +
    `rawCandidates=${rawCandidateCount} afterNMS=${accepted.length} accepted=${geojsonFeatures.length} ` +
    `rejected{blobness=${rejectedByBlobness} plan=${rejectedByPlan} detHessian=${rejectedByDetHessian}} ` +
    `opts=${JSON.stringify(opts)}`,
  )

  const buffer = (vtpbf as any).fromGeojsonVt({ tells: { features: geojsonFeatures } }, { version: 2, extent })
  return { data: new Uint8Array(buffer) }
}
