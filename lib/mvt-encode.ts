// Minimal Mapbox Vector Tile (v2) protobuf encoder, purpose-built for
// lib/cog-contour-worker.ts's needs: one layer, LineString/MultiLineString
// features, a handful of scalar properties. Mirrors the input shape
// maplibre-contour's own (internal, non-exported) vtpbf module takes —
// {extent, layers: {[name]: {features}}} — so callers read the same as
// maplibre-contour's own reference implementation.
//
// Written against the `pbf` package directly (already a transitive
// dependency here, via maplibre-gl/geotiff) rather than pulling in
// `@mapbox/vt-pbf`, whose API expects geojson-vt's own tile-index object
// shape (point-pair geometry, a `tags` dictionary, etc.) — adapting to that
// would trade one translation layer for another with no real safety
// benefit, whereas the MVT wire format itself (below) is a stable, fully
// public spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
import Pbf from "pbf"

export const enum GeomType {
  UNKNOWN = 0,
  POINT = 1,
  LINESTRING = 2,
  POLYGON = 3,
}

export type PropertyValue = string | boolean | number

export interface VectorTileFeature {
  type: GeomType
  properties: Record<string, PropertyValue>
  /** One entry per line part (a feature can be a MultiLineString); each part
   *  is a flat `[x1, y1, x2, y2, ...]` list in tile-local pixel coordinates
   *  (0..extent), matching generateIsolines' own output shape. */
  geometry: number[][]
}

export interface VectorTileLayer {
  features: VectorTileFeature[]
  extent?: number
}

export interface VectorTileInput {
  extent?: number
  layers: Record<string, VectorTileLayer>
}

const DEFAULT_EXTENT = 4096
const LAYER_VERSION = 2

// MVT geometry commands are packed integers: (id & 0x7) | (count << 3), with
// id 1 = MoveTo and 2 = LineTo. Parameters are coordinate DELTAS from the
// previous cursor position, manually zigzag-encoded by the application (not
// protobuf's own sint32 wire-type zigzag) before being written as plain
// (unsigned) packed varints — this is the part of the spec that's easy to
// get subtly wrong, so it's isolated here and exercised by a lightweight
// round-trip check in lib/cog-contour-worker.ts during development.
function zigzag(n: number): number {
  return (n << 1) ^ (n >> 31)
}

function encodeLineGeometry(parts: number[][]): number[] {
  const commands: number[] = []
  let x = 0
  let y = 0
  for (const part of parts) {
    if (part.length < 4) continue // fewer than 2 points isn't a line
    const dx0 = Math.round(part[0]) - x
    const dy0 = Math.round(part[1]) - y
    x += dx0
    y += dy0
    commands.push((1 & 0x7) | (1 << 3), zigzag(dx0), zigzag(dy0)) // MoveTo x1
    const lineToCount = part.length / 2 - 1
    commands.push((2 & 0x7) | (lineToCount << 3)) // LineTo xN
    for (let i = 2; i < part.length; i += 2) {
      const dx = Math.round(part[i]) - x
      const dy = Math.round(part[i + 1]) - y
      x += dx
      y += dy
      commands.push(zigzag(dx), zigzag(dy))
    }
  }
  return commands
}

function writeValueMessage(value: PropertyValue, pbf: Pbf) {
  if (typeof value === "string") pbf.writeStringField(1, value)
  else if (typeof value === "boolean") pbf.writeBooleanField(7, value)
  else if (Number.isInteger(value)) pbf.writeSVarintField(6, value) // sint_value — zigzag, handles negative elevations
  else pbf.writeDoubleField(3, value)
}

function writeFeatureMessage(
  ctx: { feature: VectorTileFeature; keys: string[]; keyIndex: Map<string, number>; values: PropertyValue[]; valueIndex: Map<string, number> },
  pbf: Pbf,
) {
  const { feature, keys, keyIndex, values, valueIndex } = ctx
  pbf.writeVarintField(3, feature.type)
  const tags: number[] = []
  for (const [key, value] of Object.entries(feature.properties)) {
    let ki = keyIndex.get(key)
    if (ki === undefined) {
      ki = keys.length
      keys.push(key)
      keyIndex.set(key, ki)
    }
    const valueKey = `${typeof value}:${value}`
    let vi = valueIndex.get(valueKey)
    if (vi === undefined) {
      vi = values.length
      values.push(value)
      valueIndex.set(valueKey, vi)
    }
    tags.push(ki, vi)
  }
  pbf.writePackedVarint(2, tags)
  pbf.writePackedVarint(4, encodeLineGeometry(feature.geometry))
}

function writeLayerMessage(ctx: { name: string; layer: VectorTileLayer; defaultExtent: number }, pbf: Pbf) {
  const { name, layer, defaultExtent } = ctx
  pbf.writeVarintField(15, LAYER_VERSION)
  pbf.writeStringField(1, name)

  const keys: string[] = []
  const keyIndex = new Map<string, number>()
  const values: PropertyValue[] = []
  const valueIndex = new Map<string, number>()

  // Field write order doesn't matter to any spec-compliant decoder (repeated
  // fields just accumulate) — features are written first even though they
  // reference key/value table indices assigned while writing them, since the
  // whole layer message is buffered by pbf.writeMessage below before being
  // embedded in the parent Tile message.
  for (const feature of layer.features) {
    pbf.writeMessage(2, writeFeatureMessage, { feature, keys, keyIndex, values, valueIndex })
  }
  for (const key of keys) pbf.writeStringField(3, key)
  for (const value of values) pbf.writeMessage(4, writeValueMessage, value)
  pbf.writeVarintField(5, layer.extent ?? defaultExtent)
}

export function encodeVectorTile(tile: VectorTileInput): Uint8Array {
  const pbf = new Pbf()
  const defaultExtent = tile.extent ?? DEFAULT_EXTENT
  for (const [name, layer] of Object.entries(tile.layers)) {
    pbf.writeMessage(3, writeLayerMessage, { name, layer, defaultExtent })
  }
  return pbf.finish()
}
