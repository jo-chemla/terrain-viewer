// What a terrain source's elevation tiles are, as the app's own decoders
// read them: one tile template with {z}/{x}/{y} (an https address, or one of
// the app's schemes - cog://, vrt://, lerc://, quantized-mesh://, demdiff://,
// float32dem-bbox://, pmtiles://, epsg3395://), its RGB packing, its tile
// size and zoom range. Pure: no React, no atoms. The settings and the values
// that have to be fetched first (a COG header, a VRT index, a TileJSON
// manifest, the operands of a difference) come in `ctx`; while one is still
// missing the answer is null, as the map waits for them.
//
// Used by the live map for every source decoded in the browser (the derived
// modes, the difference source, exports, the elevation picker: see
// useClientDemUpstreamOne in components/LayersAndSources/MapSources.tsx) and
// by the tile service's direct engine in Node (tile-server/app-sources.ts). The
// raster-dem source handed to MapLibre itself (TerrainSources in the same
// file) differs on purpose in three places: titiler fills nodata flat there
// (TITILER_FLAT_NODATA in source-builder.ts), a cog:// source is declared by
// its TileJSON `url`, and wms-raw is the single float32dem:// GetMap template
// MapLibre fills the bbox of.
//
// A first step towards one schema for built-in and library sources
// (.claude/memory/terrain-source-schema-unification.md).
import { terrainSources } from "./terrain-sources"
import type { TerrainSource } from "./terrain-types"
import type { CustomTerrainSource } from "./settings-atoms"
import { buildRasterTileSource } from "./source-builder"
import { buildVrtUrl, isCellRoutedUrl, type VrtInfo } from "./vrt-protocol"
import { buildDemDiffUrl } from "./demdiff-protocol"
import { withQuantizedMeshDetail } from "./quantized-mesh-protocol"
import { appendNodataMarkers, isSentinel } from "./nodata"
import { resolveCustomEncoding } from "./elevation-encoding"

export type TerrainTileEncoding = "terrarium" | "mapbox"

export interface TerrainTileSpec {
  /** One tile, {z}/{x}/{y} left in. */
  template: string
  encoding: TerrainTileEncoding
  tileSize: number
  /** Left out where the source has no fixed pyramid (a WMS answers any scale). */
  minzoom?: number
  maxzoom?: number
  /** [west, south, east, north] in degrees, when the entry or its index says. */
  bounds?: [number, number, number, number]
  /** RGB factors of a plain pyramid that is neither Terrarium nor
   *  Terrain-RGB (MapLibre's `encoding: "custom"`), see resolveCustomEncoding. */
  customEncoding?: { redFactor: number; greenFactor: number; blueFactor: number; baseShift: number }
}

/** A TileJSON manifest's fields the app reads. */
export interface TilejsonMetadata {
  encoding?: "terrarium" | "mapbox"
  bounds?: [number, number, number, number]
  minzoom?: number
  maxzoom?: number
  /** The manifest's own tile URL template — maplibre reads this natively for the
   *  primary DEM source (it's just handed the tilejson `url`), but slope-and-more
   *  bypasses maplibre's Source machinery to fetch neighbor tiles directly, so it
   *  needs the real template itself. */
  tiles?: string[]
}

export interface TerrainTileSpecContext {
  titilerEndpoint: string
  /** The Settings switch "in-browser COG reader" (useCogProtocolVsTitilerAtom). */
  useCogProtocol: boolean
  /** cog:// tiles written as Terrarium (true) or Terrain-RGB (highResTerrainAtom). */
  highResTerrain: boolean
  cesiumDetailOffset: number
  mapboxKey?: string
  maptilerKey?: string
  /** The fetched TileJSON manifest of a "tilejson" source. */
  tilejson?: TilejsonMetadata | null
  /** The zoom range read from the COG header of a cog:// source (cog-local
   *  or a remote COG read in the browser); null while it loads. */
  cogZoomRange?: { minzoom: number; maxzoom: number } | null
  /** The parsed index of a VRT read in the browser (vrt://). */
  vrtInfo?: VrtInfo | null
  /** This session's blob: URL of a "cog-local" file, null until picked. */
  localFileUrl?: string | null
  /** The two resolved operands of a "dem-diff" source; null while they load,
   *  and for an operand that is itself a difference. */
  diffOperands?: [TerrainTileSpec, TerrainTileSpec] | null
}

/** A built-in source's first tile template, keys filled in. */
export function builtinTileUrl(key: TerrainSource, mapboxKey: string, maptilerKey: string): string {
  const config = (terrainSources as Record<string, { sourceConfig: { tiles?: string[] } }>)[key]
  if (!config) return ""
  return (config.sourceConfig.tiles?.[0] ?? "")
    .replace("{API_KEY}", key === "mapbox" ? mapboxKey : key === "maptiler" ? maptilerKey : "")
}

/** Whether a source is read in the browser over its own in-browser reader
 *  (and which asynchronous inputs it needs), per the settings. */
export function terrainTileInputs(source: CustomTerrainSource | undefined, useCogProtocol: boolean) {
  // A source pinned to titiler (cogViaTitiler: non-Mercator file, or a host
  // without CORS) stays on titiler whatever the switch.
  const useCogProtocolForSource = useCogProtocol && !source?.cogViaTitiler
  const cogRemote = source?.type === "cog" && useCogProtocolForSource
  const vrtClient = source?.type === "vrt" && (useCogProtocolForSource || isCellRoutedUrl(source.url))
  return {
    useCogProtocolForSource,
    /** A remote COG read by cog://: its header gives the zoom range. */
    cogUrl: cogRemote ? source!.url : null,
    /** A VRT read by vrt://: its index gives the zoom range and bounds. */
    vrtUrl: vrtClient ? source!.url : null,
    tilejsonUrl: source?.type === "tilejson" ? source.url : null,
    diff: source?.type === "dem-diff" ? [source.diffMinuendId ?? "", source.diffSubtrahendId ?? ""] as const : null,
  }
}

/** The elevation tiles of a terrain source: a built-in id (lib/terrain-sources.ts)
 *  with `custom` undefined, or a custom / library entry. null when the source
 *  cannot be decoded here (3D tiles, STAC, MosaicJSON) or an input in `ctx`
 *  has not arrived yet. */
export function terrainTileSpec(
  builtinId: TerrainSource | string,
  custom: CustomTerrainSource | undefined,
  ctx: TerrainTileSpecContext,
): TerrainTileSpec | null {
  const { titilerEndpoint, useCogProtocol, highResTerrain, cesiumDetailOffset } = ctx
  const { useCogProtocolForSource, cogUrl, vrtUrl } = terrainTileInputs(custom, useCogProtocol)

  if (custom?.type === "dem-diff") {
    if (!ctx.diffOperands) return null
    const [a, b] = ctx.diffOperands
    // Zooms in the difference's own 256 px tiles: an operand with
    // 1024 px tiles at z16 has the pixels of a 256 px one at z18.
    const shift = (op: { tileSize?: number }) => Math.max(0, Math.round(Math.log2((op.tileSize ?? 256) / 256)))
    const mins = [a, b].filter((op) => typeof op.minzoom === "number").map((op) => op.minzoom! + shift(op))
    const maxs = [a, b].filter((op) => typeof op.maxzoom === "number").map((op) => op.maxzoom! + shift(op))
    // maxzoom is the FINER operand's: the protocol upsamples the coarser
    // one from its ancestor tiles (see demdiff-protocol.ts), so the
    // difference keeps the detail of the finer side. With the coarser
    // maxzoom maplibre stopped requesting tiles before the fallback
    // could ever run.
    return {
      template: buildDemDiffUrl(a, b, 256, custom.diffOffsetM ?? 0),
      encoding: "mapbox",
      tileSize: 256,
      ...(mins.length ? { minzoom: Math.max(...mins) } : {}),
      ...(maxs.length ? { maxzoom: Math.max(...maxs) } : {}),
    }
  }
  if (!custom) {
    const builtin = (terrainSources as Record<string, { encoding: string; sourceConfig: { encoding?: string; tileSize: number; maxzoom?: number } }>)[builtinId]
    if (!builtin || builtin.encoding === "3dtiles") return null
    return {
      template: builtinTileUrl(builtinId as TerrainSource, ctx.mapboxKey ?? "", ctx.maptilerKey ?? ""),
      encoding: builtin.sourceConfig.encoding === "terrarium" ? "terrarium" : "mapbox",
      tileSize: builtin.sourceConfig.tileSize,
      maxzoom: builtin.sourceConfig.maxzoom,
    }
  }

  if (custom.type === "tilejson") {
    const tj = ctx.tilejson
    if (!tj?.tiles?.length) return null
    return {
      template: tj.tiles[0],
      encoding: tj.encoding === "terrarium" ? "terrarium" : tj.encoding === "mapbox" ? "mapbox" : (custom.encoding ?? "mapbox"),
      tileSize: 256,
      minzoom: tj.minzoom,
      maxzoom: tj.maxzoom,
    }
  }
  if (vrtUrl) {
    // vrt:// re-encodes to Terrain-RGB, matching what titiler's
    // algorithm=terrainrgb returns for the same mosaic, so the two
    // modes hand every client-side viz mode the same bytes.
    const info = ctx.vrtInfo
    if (!info) return null // wait for the index, as the COG path waits for metadata
    return {
      template: buildVrtUrl(custom.url, !useCogProtocolForSource),
      encoding: "mapbox",
      tileSize: 256,
      minzoom: custom.minzoom ?? info.minzoom,
      maxzoom: custom.maxzoom ?? info.maxzoom,
    }
  }
  if (custom.type === "stac" || custom.type === "mosaicjson") return null

  if (custom.type === "cog-local") {
    // Always the geomatico protocol — no titiler server could reach the
    // user's disk — same `cog://<url>/{z}/{x}/{y}` shape the "cog" case
    // below builds, just pointed at this session's blob: object URL
    // instead of a remote https:// one.
    if (!ctx.localFileUrl) return null // not (re-)picked yet this session
    if (!ctx.cogZoomRange) return null // wait for real metadata, same as the primary terrain Source
    return {
      template: `cog://${ctx.localFileUrl}/{z}/{x}/{y}`,
      encoding: highResTerrain ? "terrarium" : "mapbox",
      tileSize: 256,
      minzoom: ctx.cogZoomRange.minzoom,
      maxzoom: ctx.cogZoomRange.maxzoom,
    }
  }

  if (custom.type === "wms-raw" && useCogProtocol) {
    // No titiler in the picture — buildRasterTileSource's float32dem:// output
    // is a single GetMap template (its own {bbox-epsg-3857} placeholder, not
    // a per-tile one), so wrap it for per-tile bbox substitution instead of
    // using the built url/encoding directly. WMS serves whatever resolution
    // is requested rather than a fixed pyramid, so there's no native zoom
    // ceiling to auto-detect here — only the user-set maxzoom (custom-terrain-
    // source-modal.tsx's "Max Zoom (optional)" field) can supply one; when
    // that's also unset, MatcapSource/PhongSource fall back to a hardcoded
    // default themselves (a plain `type: "raster"` source can't take an
    // explicit `undefined` maxzoom at all).
    // The source's nodata pair rides along as it does on the display
    // path (source-builder.ts): without it a difference, a derived mode
    // or an export read the WMS's -9999 and its reprojection smear as
    // ground, and an nDSM grew spikes up to 1000 m along coverage edges.
    return {
      template: `float32dem-bbox://${encodeURIComponent(appendNodataMarkers(custom.url.replace(/^https?:\/\//, ""), custom))}/{z}/{x}/{y}`,
      encoding: "terrarium",
      tileSize: custom.tileSize ?? 512,
      maxzoom: custom.maxzoom,
    }
  }

  // Remote "cog" streamed directly via the in-browser geomatico protocol has
  // the exact same fixed-pyramid limitation as cog-local above.
  if (cogUrl && !ctx.cogZoomRange) return null

  const built = buildRasterTileSource({
    url: custom.url,
    type: custom.type as Parameters<typeof buildRasterTileSource>[0]["type"],
    useCogProtocol: useCogProtocolForSource,
    titilerEndpoint,
    isDem: true,
    nodata: custom,
    titilerNodata: custom.titilerNodata,
    // These tiles feed decoders in this app (fetchDecodedTile), which
    // read titiler's nodata mask as a validity flag.
    forClientDecode: true,
  })
  const encoding: TerrainTileEncoding = custom.type === "cog" && useCogProtocolForSource
    ? (highResTerrain ? "terrarium" : "mapbox")
    // lerc:// re-encodes the decoded floats as Terrarium (its fractional
    // byte resolves to ~4 mm, against Terrain-RGB's 10 cm step), so the
    // viz-mode decoders have to be told that rather than assuming mapbox.
    : custom.type === "terrarium" || custom.type === "lerc" || custom.type === "quantized-mesh"
      ? "terrarium"
      : "mapbox"

  if ("url" in built) {
    // cog:// (geomatico mode) — append the z/x/y placeholders maplibre would
    // otherwise supply itself via a tilejson round-trip we bypass here.
    return {
      template: `${built.url}/{z}/{x}/{y}`, encoding, tileSize: 256,
      ...(cogUrl && ctx.cogZoomRange ? { minzoom: ctx.cogZoomRange.minzoom, maxzoom: ctx.cogZoomRange.maxzoom } : {}),
    }
  }
  // A titiler-served COG/VRT/WMS has no metadata-derived pyramid here,
  // but the source's own declared zoom range still applies (a library
  // DSM at maxzoom 19); without it the difference source inherited the
  // other operand's ceiling and stopped requesting tiles too early.
  return {
    template: withQuantizedMeshDetail(built.tiles[0], cesiumDetailOffset), encoding, tileSize: 256,
    ...(custom.minzoom !== undefined ? { minzoom: custom.minzoom } : {}),
    ...(custom.maxzoom !== undefined ? { maxzoom: custom.maxzoom } : {}),
  }
}

/** The fields of a spec the map's hooks pass on (ClientDemUpstream), and the
 *  extras it leaves to other readers: bounds and a custom RGB packing. */
export function terrainTileExtras(custom: CustomTerrainSource | undefined, ctx: Pick<TerrainTileSpecContext, "tilejson" | "vrtInfo">): Pick<TerrainTileSpec, "bounds" | "customEncoding"> {
  const bounds = custom?.bounds ?? ctx.tilejson?.bounds ?? ctx.vrtInfo?.bounds
  // Custom RGB packing applies to the TMS family only: every other type
  // reaches a decoder already re-encoded by one of the app's protocols.
  const customEncoding = custom && (custom.type === "terrarium" || custom.type === "terrainrgb") ? resolveCustomEncoding(custom) : null
  return { ...(bounds ? { bounds } : {}), ...(customEncoding ? { customEncoding } : {}) }
}

// Per-pixel COG decode, registered with geomatico's setColorFunction (TerrainSources in
// components/LayersAndSources/MapSources.tsx, and tile-server/app-sources.ts) — this
// runs inside the cog:// protocol, so it IS the elevation path, not just colouring.
//
// The sentinel guard is load-bearing: `raw === noData` cannot catch a NaN
// sentinel (NaN !== NaN), and NaN is exactly what several DSMs use — the Dura
// Europos scans declare GDAL_NODATA as literally NaN and carry NaN across 12-57%
// of their pixels. Unguarded, NaN reaches elevationToTerrarium, whose components
// come out NaN, get clamped to 0 by the Uint8ClampedArray write, and decode back
// as -32768 m: a 32 km abyss around the perimeter.
//
// `nodata` (floor/fill, in metres, post scale/offset) is the optional per-source
// override from the source modal — see lib/nodata.ts.
export const makeElevationColorFunction = (
  // Writes the four bytes in place: this runs once per pixel of every COG
  // tile, and the array an encoder returned (then copied by color.set) was
  // two allocations per pixel.
  write: (out: Uint8ClampedArray, idx: number, elevation: number) => void,
  scale = 1,
  offset = 0,
  noData?: number,
  nodata?: { floor: number; fill: number } | null,
) => (pixel: any, color: any) => {
  const raw = pixel[0]
  const elevation = offset + raw * scale
  const isHole = isSentinel(raw) || raw === noData || (nodata ? elevation <= nodata.floor : false)
  if (!isHole) { write(color, 0, elevation); return }
  // A hole keeps its fill value for MapLibre (which reads RGB only: the
  // terrain stays flat there rather than dropping to the -10000 m floor),
  // but is written with alpha 254 so this app's own decoders
  // (fetchDecodedTile's validity mask) can tell it from real data - the
  // difference source (lib/demdiff-protocol.ts) used to read a local COG's
  // nodata as 0 m and subtract the other operand from nothing.
  write(color, 0, nodata?.fill ?? 0)
  color[3] = 254
}
