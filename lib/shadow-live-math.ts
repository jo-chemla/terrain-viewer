// Pure helpers of the live GPU shadow layer (lib/shadow-live-gl-layer.ts):
// the sun step vector, the ray's step schedule and the view mosaic's layout.
// Import-free so lib/shadow-live-math.test.ts runs them in Node.

/** Unit step TOWARD the sun in mosaic texel space (x east, y south), for a
 *  compass azimuth (clockwise from north, degrees): the same convention as
 *  lib/shadow-protocol.ts's (dCol, dRow) = (sin az, −cos az), so the live
 *  layer and the shadow:// tiles march the same ray. Web Mercator is
 *  conformal, so a compass direction is the same direction in texels. */
export function sunStepVector(azimuthDeg: number): [number, number] {
  const a = (azimuthDeg * Math.PI) / 180
  return [Math.sin(a), -Math.cos(a)]
}

/** tan(altitude), clamped for the shader: negative below the horizon (the
 *  layer then shades everything, as the tile kernel does on flat ground at
 *  night), large but finite at the zenith. */
export function sunTanAltitude(altitudeDeg: number): number {
  if (altitudeDeg >= 89.999) return 1e6
  return Math.tan((altitudeDeg * Math.PI) / 180)
}

/** Step schedule of the ray: one-texel steps for the first
 *  1 / SHADOW_STEP_GROWTH texels (where shadows are short and edges must be
 *  sharp), then each step a fixed fraction of the distance already covered,
 *  so the reach grows geometrically and a ray crosses a 4 096 px mosaic in a
 *  few hundred steps. Mirrored by the GLSL loop of shadow-live-gl-layer.ts. */
export const SHADOW_STEP_GROWTH = 1 / 40

export function shadowStep(distance: number): number {
  return Math.max(1, distance * SHADOW_STEP_GROWTH)
}

/** How many steps the schedule takes to cover `reach` texels. */
export function shadowStepsToReach(reach: number): number {
  let d = 0
  let steps = 0
  while (d < reach) {
    d += shadowStep(d)
    steps++
  }
  return steps
}

/** Longest mosaic side, in texels; the shader's loop bound covers its diagonal. */
export const SHADOW_MOSAIC_MAX_SIDE = 6144
/** At most this many DEM tiles in the mosaic (about 1 MB of GPU memory each at 512 px). */
export const SHADOW_MOSAIC_MAX_TILES = 48
export const SHADOW_MAX_STEPS = shadowStepsToReach(SHADOW_MOSAIC_MAX_SIDE * Math.SQRT2)

export interface MosaicLayout {
  z: number
  /** North-west tile; x is unwrapped (may lie outside [0, 2^z) near the antimeridian). */
  x0: number
  y0: number
  nx: number
  ny: number
}

/** View bounds in Web Mercator units (0..1, y down; x unwrapped). */
export interface MercatorBounds { x0: number; y0: number; x1: number; y1: number }

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat))
  const s = Math.sin((clamped * Math.PI) / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
}

/** The mosaic for a view: DEM tiles at about one texel per CSS pixel
 *  (zoom + log2(512 / tileSize)), the view's tiles plus `margin` tiles on
 *  every side (so shadows cast from just off screen come in), one zoom
 *  coarser at a time until it fits `maxTiles` and `maxSide` texels. A
 *  `preferZ` within 0.75 of the target zoom is kept, so a zoom gesture
 *  across x.5 does not rebuild the mosaic back and forth. Null when even
 *  `minzoom` does not fit. */
export function chooseMosaicLayout(
  bounds: MercatorBounds, mapZoom: number, tileSize: number,
  opts: { minzoom?: number; maxzoom?: number; margin?: number; maxTiles?: number; maxSide?: number; preferZ?: number } = {},
): MosaicLayout | null {
  const { minzoom = 0, maxzoom = 22, margin = 1, maxTiles = SHADOW_MOSAIC_MAX_TILES, maxSide = SHADOW_MOSAIC_MAX_SIDE, preferZ } = opts
  const target = mapZoom + Math.log2(512 / tileSize)
  let z = preferZ !== undefined && Math.abs(target - preferZ) <= 0.75 ? preferZ : Math.round(target)
  z = Math.max(minzoom, Math.min(maxzoom, z))
  for (; z >= minzoom; z--) {
    const s = 2 ** z
    // A bound exactly on a tile edge belongs to the tile before it.
    const tx0 = Math.floor(bounds.x0 * s) - margin
    const tx1 = Math.ceil(bounds.x1 * s) - 1 + margin
    const ty0 = Math.max(0, Math.floor(bounds.y0 * s) - margin)
    const ty1 = Math.min(s - 1, Math.ceil(bounds.y1 * s) - 1 + margin)
    const nx = Math.min(s, tx1 - tx0 + 1)
    const ny = ty1 - ty0 + 1
    if (nx > 0 && ny > 0 && nx * ny <= maxTiles && nx * tileSize <= maxSide && ny * tileSize <= maxSide) {
      return { z, x0: nx === s ? 0 : tx0, y0: ty0, nx, ny }
    }
  }
  return null
}

/** Whether `outer` (same zoom) already holds every tile of `inner`. x is
 *  compared unwrapped, so a pan onto another world copy lays out a new mosaic
 *  (its tiles are drawn on their own copy), except for a whole-world mosaic. */
export function layoutContains(outer: MosaicLayout, inner: MosaicLayout): boolean {
  if (outer.z !== inner.z) return false
  if (inner.y0 < outer.y0 || inner.y0 + inner.ny > outer.y0 + outer.ny) return false
  if (outer.nx === 2 ** outer.z) return true
  return inner.x0 >= outer.x0 && inner.x0 + inner.nx <= outer.x0 + outer.nx
}

/** Bilinear elevation at continuous texel coords (texel centres at i + 0.5),
 *  edge-clamped: the shader's elevAt(). */
export function bilinearAt(grid: Float32Array, w: number, h: number, px: number, py: number): number {
  const bx = px - 0.5, by = py - 0.5
  const ix = Math.floor(bx), iy = Math.floor(by)
  const fx = bx - ix, fy = by - iy
  const t = (x: number, y: number) => grid[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  const top = t(ix, iy) * (1 - fx) + t(ix + 1, iy) * fx
  const bottom = t(ix, iy + 1) * (1 - fx) + t(ix + 1, iy + 1) * fx
  return top * (1 - fy) + bottom * fy
}

/** CPU twin of the fragment shader's march, for tests: is the point at texel
 *  coords (px, py) in shadow? `metersPerTexel` is the ground size of a
 *  texel there. No tolerance: any ground above the ray shades. */
export function marchShadowCpu(
  grid: Float32Array, w: number, h: number, px: number, py: number,
  azimuthDeg: number, altitudeDeg: number, metersPerTexel: number, maxElev: number,
): boolean {
  const tanAlt = sunTanAltitude(altitudeDeg)
  if (tanAlt < 0) return true
  const [sx, sy] = sunStepVector(azimuthDeg)
  const h0 = bilinearAt(grid, w, h, px, py)
  const rise = tanAlt * metersPerTexel
  let d = 0
  for (let i = 0; i < SHADOW_MAX_STEPS; i++) {
    d += shadowStep(d)
    const ray = h0 + d * rise
    if (ray > maxElev) return false
    const qx = px + sx * d, qy = py + sy * d
    if (qx < 0.5 || qy < 0.5 || qx > w - 0.5 || qy > h - 0.5) return false
    if (bilinearAt(grid, w, h, qx, qy) > ray) return true
  }
  return false
}
