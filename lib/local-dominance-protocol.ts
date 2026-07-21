// Client-side Local Dominance tile computation, registered as the
// `local-dominance://` maplibre custom protocol. See lib/normal-derived-protocol.ts
// for the shared windowed tile-fetch pipeline this builds on — same family as
// svf-protocol.ts / openness-protocol.ts (multi-direction ray sampling), but a
// different quantity.
//
// Local Dominance (Hesse 2016, "Local Dominance / LD"; also RVT's "Local dominance"
// mode) measures how much an observer standing at each pixel looks DOWN on the
// surrounding terrain, averaged over directions and over an annulus of viewing
// distances [minRadius, maxRadius]. For an observer of eye height `oh` above the
// surface at the center pixel, the vertical view angle to the terrain at
// horizontal distance d in some direction is atan((zObserver − zTerrain) / d):
// positive when the observer stands above what they're looking at. Averaging that
// angle over many directions and radii gives a single "dominance" value —
// high on local highs (mounds, ridges, tells) that look down on everything around
// them, low/negative in enclosed depressions that are looked down upon. It
// complements Openness (which is about sky exposure): LD specifically isolates
// closed mounds and depressions rather than general convexity/concavity.
//
// Simplest-viable version, matching the horizon-angle family's philosophy:
// 16 fixed compass directions, integer-pixel ray steps, a fixed observer height,
// and a plain unweighted mean of the per-sample angles (no distance weighting).
// Output is the mean angle in degrees (signed), re-encoded as pseudo-elevation
// for maplibre's color-relief paint the same way every other mode in this family is.

import {
  sharedTileCache, runWindowedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"
import { RAD_TO_DEG } from "./horizon-angle"

const LD_URL_RE = /^local-dominance:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?rmin=(\d+)&rmax=(\d+)$/

// Eye height of the virtual observer, in metres above the surface. Fixed rather
// than a user control — it only sets the baseline "flat ground" angle (small and
// positive) and isn't what the mode is really about; the terrain differences over
// the [minRadius, maxRadius] annulus dominate the result. 1.6 m ≈ human eye level,
// the conventional default (RVT uses the same).
const OBSERVER_HEIGHT_M = 1.6

// 16 compass directions as (dRow, dCol) unit vectors — twice horizon-angle.ts's 8,
// since LD averages (rather than takes a per-direction max) so more directions
// smooth the result meaningfully rather than just refining a single horizon.
const LD_DIRECTIONS = 16
const DIR_VECTORS: readonly (readonly [number, number])[] = Array.from(
  { length: LD_DIRECTIONS },
  (_, i) => {
    const angle = (2 * Math.PI * i) / LD_DIRECTIONS
    return [Math.sin(angle), Math.cos(angle)] as const
  },
)

// `minRadiusPx`/`maxRadiusPx` are the inner/outer edges of the viewing annulus,
// in same-zoom pixels (bare pixel counts, like SVF/Openness — LD needs the true
// local elevation profile along each ray, not a smoothed ancestor tile). Baked
// into the tile URL so a change forces a fresh Source/tile cache (see the
// keySuffix on LocalDominanceSource in MapSources.tsx).
export function buildLocalDominanceProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
  minRadiusPx = 10, maxRadiusPx = 20,
): string {
  return `${buildProtocolUrl("local-dominance", upstreamTileTemplate, encoding, tileSize)}?rmin=${minRadiusPx}&rmax=${maxRadiusPx}`
}

export function computeLocalDominance(
  sample: (dr: number, dc: number) => number,
  groundResolutionM: number,
  minRadiusPx: number,
  maxRadiusPx: number,
): number {
  const observerElev = sample(0, 0) + OBSERVER_HEIGHT_M
  let sum = 0
  let count = 0
  for (const [dRow, dCol] of DIR_VECTORS) {
    for (let r = minRadiusPx; r <= maxRadiusPx; r++) {
      const rr = Math.round(r * dRow)
      const rc = Math.round(r * dCol)
      const dist = Math.sqrt(rr * rr + rc * rc) * groundResolutionM
      if (dist === 0) continue
      const dz = observerElev - sample(rr, rc)
      sum += Math.atan2(dz, dist)
      count++
    }
  }
  return count > 0 ? (sum / count) * RAD_TO_DEG : 0
}

export async function localDominanceProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(LD_URL_RE)
  const minRadiusPx = match ? parseInt(match[7], 10) : 10
  const maxRadiusPx = match ? parseInt(match[8], 10) : 20

  return runWindowedProtocol({
    url: params.url,
    urlRegex: LD_URL_RE,
    abortController,
    cache: sharedTileCache,
    halo: maxRadiusPx,
    computeValue: (sample, groundResolutionM) =>
      computeLocalDominance(sample, groundResolutionM, minRadiusPx, maxRadiusPx),
  })
}
