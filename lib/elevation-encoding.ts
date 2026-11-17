// Shared elevation <-> RGBA packing helpers, factored out of MapSources.tsx so that
// non-component modules (e.g. lib/slope-protocol.ts) can reuse them without importing
// a "use client" react-map-gl component file.
// Inspired by https://github.com/geomatico/maplibre-cog-protocol/blob/main/src/render/renderTerrain.ts

export function elevationToTerrainrgb(elevation: number): [number, number, number, number] {
  const base = -10000
  const interval = 0.1
  const v = (elevation - base) / interval
  return [
    Math.floor(v / 256 / 256) % 256,
    Math.floor(v / 256) % 256,
    Math.floor(v) % 256,
    255,
  ]
}

/** elevationToTerrarium written straight into an RGBA buffer at `idx`, for
 *  per-pixel loops: same arithmetic, no array allocated per pixel. */
export function writeTerrarium(out: Uint8ClampedArray, idx: number, elevation: number): void {
  const v = elevation + 32768
  out[idx] = Math.floor(v / 256)
  out[idx + 1] = Math.floor(v % 256)
  out[idx + 2] = Math.floor((v - Math.floor(v)) * 256)
  out[idx + 3] = 255
}

// ---------------------------------------------------------------------------
// Whole-pixel writers for per-pixel loops.
//
// Storing four numbers one by one into a Uint8ClampedArray is the slow part
// of every derived tile: each store converts a double with clamping, and the
// Terrarium green byte is a floating-point modulo. Measured on a 512 px tile
// (2026-11-17): 13.5 ms for the encode alone, against 2.9 ms for a Laplacian
// kernel feeding it. For a value inside the encoding's range the same four
// bytes are integer shifts of floor(v), written as ONE 32-bit store through
// a Uint32Array view of the same buffer: 3.9 ms, byte for byte identical.
// Out-of-range and NaN values take the old clamped path, so they still
// saturate exactly as before. The 32-bit store assumes little-endian byte
// order (every platform a browser runs on); pixelView() returns null on a
// big-endian one and callers fall back to the byte writers.

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/** A Uint32Array over an RGBA buffer, one element per pixel, or null where
 *  the fast writers cannot be used. */
export function pixelView(out: Uint8ClampedArray): Uint32Array | null {
  return LITTLE_ENDIAN ? new Uint32Array(out.buffer, out.byteOffset, out.byteLength >> 2) : null
}

/** writeTerrarium for pixel p (not byte index), with the given alpha (255,
 *  or 254 for a nodata hole). */
export function writeTerrariumPx(out: Uint8ClampedArray, out32: Uint32Array | null, p: number, elevation: number, alpha = 255): void {
  const v = elevation + 32768
  if (out32 !== null && v >= 0 && v < 65536) {
    const whole = v | 0
    out32[p] = (alpha << 24) | ((((v - whole) * 256) | 0) << 16) | ((whole & 255) << 8) | (whole >>> 8)
    return
  }
  writeTerrarium(out, p * 4, elevation)
  out[p * 4 + 3] = alpha
}

/** A whole tile of values as Terrarium RGBA, alpha 255: one tight loop with
 *  the pixel writer inlined, for kernels that fill a value grid first. */
export function terrariumTile(values: Float64Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(values.length * 4)
  const out32 = pixelView(out)
  for (let p = 0; p < values.length; p++) {
    const v = values[p] + 32768
    if (out32 !== null && v >= 0 && v < 65536) {
      const whole = v | 0
      out32[p] = 0xff000000 | ((((v - whole) * 256) | 0) << 16) | ((whole & 255) << 8) | (whole >>> 8)
    } else {
      writeTerrarium(out, p * 4, values[p])
    }
  }
  return out
}

/** elevationToTerrainrgb for pixel p, with the given alpha (255, or 254 for
 *  a nodata hole). */
export function writeTerrainrgbPx(out: Uint8ClampedArray, out32: Uint32Array | null, p: number, elevation: number, alpha = 255): void {
  const v = (elevation - -10000) / 0.1
  if (out32 !== null && v >= 0 && v < 16777216) {
    const whole = v | 0
    out32[p] = (alpha << 24) | ((whole & 255) << 16) | (whole & 0xff00) | (whole >>> 16)
    return
  }
  const idx = p * 4
  out[idx] = Math.floor(v / 256 / 256) % 256
  out[idx + 1] = Math.floor(v / 256) % 256
  out[idx + 2] = Math.floor(v) % 256
  out[idx + 3] = alpha
}

/** elevationToTerrainrgb written straight into an RGBA buffer at `idx`. */
export function writeTerrainrgb(out: Uint8ClampedArray, idx: number, elevation: number): void {
  const v = (elevation - -10000) / 0.1
  out[idx] = Math.floor(v / 256 / 256) % 256
  out[idx + 1] = Math.floor(v / 256) % 256
  out[idx + 2] = Math.floor(v) % 256
  out[idx + 3] = 255
}

export function elevationToTerrarium(elevation: number): [number, number, number, number] {
  const v = elevation + 32768
  return [
    Math.floor(v / 256),
    Math.floor(v % 256),
    Math.floor((v - Math.floor(v)) * 256),
    255,
  ]
}

// Inverse of the two encoders above — decodes a rendered tile's RGB back into an
// elevation value, e.g. for client-side DTM export from terrainrgb/terrarium TMS
// tiles (no server-side GDAL/titiler involved).
export function terrainrgbToElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
}

export function terrariumToElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

// ---------------------------------------------------------------------------
// Custom RGB packing (maplibre `encoding: "custom"`)
//
//     elevation = R*redFactor + G*greenFactor + B*blueFactor - baseShift
//
// Read out of maplibre-gl's own source rather than the style spec, which
// documents the four fields but not the formula (and describes baseShift as
// "added" where the implementation subtracts it). These two presets are exactly
// what maplibre uses internally for its named encodings, so they double as the
// sensible fallback when a source overrides only some of the four.
export const TERRARIUM_FACTORS = { redFactor: 256, greenFactor: 1, blueFactor: 1 / 256, baseShift: 32768 } as const
export const TERRAIN_RGB_FACTORS = { redFactor: 6553.6, greenFactor: 25.6, blueFactor: 0.1, baseShift: 10000 } as const

export interface CustomRgbEncoding {
  redFactor?: number
  greenFactor?: number
  blueFactor?: number
  baseShift?: number
}

/**
 * Null unless the source actually overrides something — so a source that sets
 * none of the four keeps its plain "terrarium"/"mapbox" encoding and this stays
 * entirely inert. Unset fields fall back to the Terrain-RGB preset rather than
 * maplibre's raw 1/1/1/0 defaults, because the real-world case is "Terrain-RGB
 * but with a different base" (Mexico's INEGI: baseShift 1000, not 10000).
 */
export function resolveCustomEncoding(c: CustomRgbEncoding): Required<CustomRgbEncoding> | null {
  const { redFactor, greenFactor, blueFactor, baseShift } = c
  if ([redFactor, greenFactor, blueFactor, baseShift].every((v) => v === undefined)) return null
  const out = {
    redFactor: redFactor ?? TERRAIN_RGB_FACTORS.redFactor,
    greenFactor: greenFactor ?? TERRAIN_RGB_FACTORS.greenFactor,
    blueFactor: blueFactor ?? TERRAIN_RGB_FACTORS.blueFactor,
    baseShift: baseShift ?? TERRAIN_RGB_FACTORS.baseShift,
  }
  // A NaN here would silently blank the terrain rather than error, so treat a
  // half-typed value in the modal as "not configured yet".
  return Object.values(out).every((v) => isFinite(v)) ? out : null
}
