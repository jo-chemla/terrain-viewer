// Shared nodata floor/fill semantics for DEM sources.
//
// DEM servers signal "no coverage here" in mutually incompatible ways, and every
// one of them decodes to a catastrophic elevation if passed through untouched:
//
//   IGN LiDAR-HD WMS   -9999 sentinel (GDAL_NODATA tag), reprojection-smeared
//                      into a continuum of intermediate garbage at tile edges
//   Dura Europos COG   NaN — and the tag itself is literally NaN, so the usual
//                      `raw === noData` equality test can never fire (NaN !== NaN)
//   terrarium tiles    RGB 0,0,0, which decodes to -32768 m
//
// A single threshold handles all of them without knowing which convention a
// given server picked, because every one of those lands far below any real
// terrain. Hence two numbers rather than a sentinel to match:
//
//   floor — at or below this (in metres, after scale/offset) = hole
//   fill  — what a hole is replaced with
//
// Non-finite is ALWAYS a hole, independently of the floor: NaN can't be compared
// and is what the COG path actually hits.
//
// Either value alone implies the other, which degenerates to a plain clamp
// ("anything under -20 becomes -20"). Supplying both decouples detection from
// appearance: floor -20 / fill 0 detects at -20 but fills at sea level, so a
// genuine cell in between keeps its own value instead of being dragged up. That
// matters — metropolitan France really does go below sea level (Les Moeres
// polders -2 m, the Etang de Lavalduc bed -5 to -10 m), so a floor set at the
// fill level would eat live data.

export const NODATA_FILL_PARAM = "__nodatafill"
export const NODATA_FLOOR_PARAM = "__nodatafloor"

export interface NodataConfig {
  /** At or below this (metres) counts as a hole. */
  nodataFloor?: number
  /** Metres a hole is replaced with. */
  nodataFill?: number
}

/**
 * Normalises the pair, applying the "either one implies the other" rule.
 * Returns null when neither is set, i.e. the source hasn't opted in and its data
 * must be passed through untouched.
 */
export function resolveNodata({ nodataFloor, nodataFill }: NodataConfig): { floor: number; fill: number } | null {
  const floor = nodataFloor ?? nodataFill
  const fill = nodataFill ?? nodataFloor
  if (floor === undefined || fill === undefined || !isFinite(floor) || !isFinite(fill)) return null
  return { floor, fill }
}

/**
 * Which source types can honour these controls. Deliberately narrow: it only
 * works where this app decodes the elevation itself, i.e. behind a client-side
 * protocol.
 *
 * - cog / cog-local via geomatico's `cog://` — per-pixel color function hook
 * - wms-raw via `float32dem://` — decodes the Float32 GeoTIFF in-process
 *
 * Excluded, and why:
 * - titiler paths (cog/vrt/wms-raw in titiler mode) decode server-side; titiler
 *   takes a `nodata=` param but matches it exactly, so it can't express a floor.
 * - terrarium / terrainrgb / tms / wms / wmts tiles are fetched by maplibre
 *   directly with no interception point. Supporting them would mean a protocol
 *   that decodes and re-encodes a PNG per tile, on sources that currently cost
 *   zero JS — not worth it. The real fix belongs upstream in maplibre.
 */
export function supportsNodataControls(type: string | undefined, useCogProtocol: boolean): boolean {
  if (type === "cog-local") return true // always goes through the cog:// protocol
  if (type === "cog" || type === "wms-raw") return useCogProtocol
  return false
}

/**
 * Serialises the pair onto a `float32dem://` GetMap URL, which is the only
 * channel that protocol has — it receives a URL and nothing else. Markers
 * already present in the URL (hand-authored) win and are left alone.
 */
export function appendNodataMarkers(url: string, config: NodataConfig): string {
  const resolved = resolveNodata(config)
  if (!resolved) return url
  let out = url
  if (!out.includes(`${NODATA_FILL_PARAM}=`)) out += `&${NODATA_FILL_PARAM}=${resolved.fill}`
  if (!out.includes(`${NODATA_FLOOR_PARAM}=`)) out += `&${NODATA_FLOOR_PARAM}=${resolved.floor}`
  return out
}
