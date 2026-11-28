// The nDSM / DEM difference visualization mode: a view's own terrain minus a
// second terrain source (the subtrahend), drawn as a colored layer over the
// view. The view keeps its terrain, so hillshade, contours and the 3D relief
// stay those of the real surface, where the difference *source*
// (Add Terrain -> Difference of two sources) replaces the terrain itself.
//
// The tiles are demdiff:// ones (lib/demdiff-protocol.ts): the same reader,
// ancestor-tile upsampling, nodata rule and offset as the difference source,
// so there is no second implementation. Pure: the map
// (components/LayersAndSources/MapSources.tsx, NdsmSource) and the tile
// service (tile-server/direct.mjs) build the mode's tile template here.
import { buildDemDiffUrl } from "./demdiff-protocol"
import customSources from "./custom-sources.json"
import { findTerrainSource } from "./terrain-catalog"
import type { TerrainSourceEntry } from "./source-schema"

/** The list to look the subtrahend up in: the user's sources (the Worldwide
 *  Defaults are found through findTerrainSource), plus the terrain library's
 *  entry of that id when the user has not added it, so a shared link naming a
 *  library source as subtrahend draws without a visit to the library. The
 *  same array when nothing is added (React dependencies stay stable). */
export function withNdsmSubtrahend<T extends TerrainSourceEntry>(customs: T[], subtrahendId: string | null | undefined): T[] {
  if (!subtrahendId || findTerrainSource(subtrahendId, customs)) return customs
  const entry = (customSources.SAMPLE_TERRAIN_SOURCES as unknown as T[]).find((e) => e.id === subtrahendId)
  return entry ? [...customs, entry] : customs
}

/** One operand: the fields of a resolved terrain tile spec that matter here. */
export interface NdsmOperand {
  template: string
  encoding: "terrarium" | "mapbox"
  tileSize: number
  minzoom?: number
  maxzoom?: number
}

export interface NdsmTileSpec {
  /** A demdiff:// template, {z}/{x}/{y} left in. Terrain-RGB. */
  template: string
  encoding: "mapbox"
  tileSize: number
  minzoom?: number
  maxzoom?: number
}

/**
 * The mode's tiles: `terrain` minus `subtrahend`, or with `invert` the
 * subtrahend minus the terrain, plus `offsetM` metres. Tiles are cut on the
 * view terrain's own grid (its tile size), so the layer lines up with the
 * terrain under it whatever the subtrahend's tiles are.
 *
 * Zoom range: the floor is the higher of the two (below it one side has
 * nothing), the ceiling the finer operand's, as for the difference source:
 * the coarser side is upsampled from its ancestor tiles.
 */
export function ndsmTileSpec(terrain: NdsmOperand, subtrahend: NdsmOperand, opts: { invert?: boolean; offsetM?: number } = {}): NdsmTileSpec {
  const n = terrain.tileSize
  // Zooms in the output's own tiles: an operand with 512 px tiles at z14 has
  // the pixels of a 256 px one at z15.
  const shift = (op: NdsmOperand) => Math.round(Math.log2(op.tileSize / n))
  const zooms = (key: "minzoom" | "maxzoom") => [terrain, subtrahend].filter((op) => typeof op[key] === "number").map((op) => op[key]! + shift(op))
  const mins = zooms("minzoom"), maxs = zooms("maxzoom")
  const [a, b] = opts.invert ? [subtrahend, terrain] : [terrain, subtrahend]
  const offset = Number.isFinite(opts.offsetM) ? Math.round(opts.offsetM! * 100) / 100 : 0
  return {
    template: buildDemDiffUrl(a, b, n, offset),
    encoding: "mapbox",
    tileSize: n,
    ...(mins.length ? { minzoom: Math.max(0, ...mins) } : {}),
    ...(maxs.length ? { maxzoom: Math.max(...maxs) } : {}),
  }
}

/** The two looks the mode's settings offer in one click: heights above
 *  ground (DSM minus DTM, 0 to 30 m, the ground left untinted) and change
 *  between two dates (diverging, symmetric around 0). */
export const NDSM_PRESETS = {
  heights: { ndsmColorRamp: "ndsm-heights", ndsmMin: 0, ndsmMax: 30, ndsmSymmetric: false, ndsmInvertColorRamp: false },
  change: { ndsmColorRamp: "diverging-blue-transparent-red", ndsmMin: -10, ndsmMax: 10, ndsmSymmetric: true, ndsmInvertColorRamp: false },
} as const
