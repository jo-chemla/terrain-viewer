// Pure helpers of the live GPU shadow layer (lib/shadow-live-gl-layer.ts):
// the sun step vector, the ray's step schedule, the view mosaic's layout, the
// far-field mosaic, the ground size of a texel, the Earth's curvature, and the
// fragment shader itself (shadowFragmentShader) next to sunVisibilityCpu, its
// line-by-line CPU twin. Import-free so lib/shadow-live-math.test.ts and
// scripts/bench-shadow.mjs run them in Node (the bench runs the very shader
// string in Chrome).

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

// ─── Ground scale, curvature, sun disc ─────────────────────────────────────

/** Web Mercator's equator length (spherical, a = 6 378 137 m). */
export const MERCATOR_EQUATOR_M = 2 * Math.PI * 6378137
/** Mean Earth radius, for the curvature drop. */
export const EARTH_RADIUS_M = 6371008.8
/** Coefficient of atmospheric refraction: a ray near the ground bends down
 *  with a radius of about R / k, which flattens the apparent curvature to
 *  (1 − k) / 2R (k ≈ 0.13, the surveyors' standard value). */
export const REFRACTION_K = 0.13
/** Drop of the ground below the tangent plane per square metre of distance:
 *  the ground d metres away sits d² · CURVATURE_PER_M2 lower (with refraction). */
export const CURVATURE_PER_M2 = (1 - REFRACTION_K) / (2 * EARTH_RADIUS_M)
/** Angular radius of the sun's disc (0.533° across, mean). */
export const SUN_RADIUS_DEG = 0.2665

/** Ground metres of one mosaic texel at Web Mercator y (0..1, y down):
 *  the Mercator scale factor is 1 / cos(lat), and cos(lat) = 1 / cosh(π(1 − 2y)).
 *  The shader's texelMeters(). */
export function texelGroundMeters(mercY: number, mercPerTexel: number): number {
  return (MERCATOR_EQUATOR_M * mercPerTexel) / Math.cosh(Math.PI * (1 - 2 * mercY))
}

/** How far the ground d metres away lies below the local tangent plane
 *  (curvature less refraction): what a ray toward the sun gains over the
 *  ground beyond the flat-Earth rise d · tan(alt). 0.07 m at 1 km, 7 m at
 *  10 km, 170 m at 50 km. */
export function curvatureDrop(distanceM: number): number {
  return distanceM * distanceM * CURVATURE_PER_M2
}

// ─── Far field ─────────────────────────────────────────────────────────────

/** The far-field mosaic is this many zooms coarser than the view mosaic: a
 *  tile there covers 8 × 8 view tiles, so up to 36 of them reach tens of
 *  kilometres beyond the view at any zoom (Mont Blanc's shadow under a 3°
 *  sun is about 70 km long). */
export const FAR_LEVELS = 3
export const FAR_MAX_TILES = 36
export const FAR_MARGIN_TILES = 3

/** The far-field mosaic around a view mosaic: FAR_LEVELS zooms coarser (not
 *  below `minzoom`), the view mosaic's footprint plus up to
 *  FAR_MARGIN_TILES coarse tiles on every side (fewer until it fits
 *  `maxTiles`). Null when there is no coarser zoom, when the view mosaic is
 *  the whole world, or when even a one-tile margin does not fit. */
export function chooseFarLayout(
  fine: MosaicLayout, tileSize: number,
  opts: { minzoom?: number; levels?: number; margin?: number; maxTiles?: number; maxSide?: number } = {},
): MosaicLayout | null {
  const { minzoom = 0, levels = FAR_LEVELS, margin = FAR_MARGIN_TILES, maxTiles = FAR_MAX_TILES, maxSide = SHADOW_MOSAIC_MAX_SIDE } = opts
  if (fine.nx >= 2 ** fine.z) return null
  const z = Math.max(minzoom, fine.z - levels)
  if (z >= fine.z) return null
  const k = 2 ** (fine.z - z), s = 2 ** z
  const cx0 = Math.floor(fine.x0 / k), cx1 = Math.floor((fine.x0 + fine.nx - 1) / k)
  const cy0 = Math.floor(fine.y0 / k), cy1 = Math.floor((fine.y0 + fine.ny - 1) / k)
  for (let m = margin; m >= 1; m--) {
    const x0 = cx0 - m, nx = cx1 + m - x0 + 1
    const y0 = Math.max(0, cy0 - m), ny = Math.min(s - 1, cy1 + m) - y0 + 1
    if (nx < s && nx * ny <= maxTiles && nx * tileSize <= maxSide && ny * tileSize <= maxSide) return { z, x0, y0, nx, ny }
  }
  return null
}

/** Where a view-mosaic texel lands in the far mosaic: far = fine · scale + offset. */
export function farTransform(fine: MosaicLayout, far: MosaicLayout, tileSize: number): { scale: number; offsetX: number; offsetY: number } {
  const scale = 2 ** (far.z - fine.z)
  return { scale, offsetX: (fine.x0 * scale - far.x0) * tileSize, offsetY: (fine.y0 * scale - far.y0) * tileSize }
}

/** Distance along the unit step (sx, sy) from (px, py) to the edge of the
 *  sampled box [0.5, w − 0.5] × [0.5, h − 0.5]; 0 when outside. The shader's boxExit(). */
export function boxExitDistance(px: number, py: number, sx: number, sy: number, w: number, h: number): number {
  const tx = sx > 0 ? (w - 0.5 - px) / sx : sx < 0 ? (0.5 - px) / sx : Infinity
  const ty = sy > 0 ? (h - 0.5 - py) / sy : sy < 0 ? (0.5 - py) / sy : Infinity
  return Math.max(0, Math.min(tx, ty))
}

// ─── The march: CPU twin and shader ────────────────────────────────────────

export interface ElevationGrid {
  data: Float32Array
  w: number
  h: number
  /** Web Mercator y of row 0's north edge, and per texel. */
  mercY0: number
  mercPerTexel: number
  /** Highest elevation in the grid. */
  maxElev: number
}

export interface SunMarchOptions {
  azimuthDeg: number
  altitudeDeg: number
  /** Angular radius of the sun's disc for a soft edge (SUN_RADIUS_DEG), 0 for a hard one. */
  sunRadiusDeg?: number
  /** Ground drop per square metre (CURVATURE_PER_M2), 0 for a flat Earth. */
  curvature?: number
  /** Optional far-field grid, with the view-texel → far-texel transform. */
  far?: { grid: ElevationGrid; scale: number; offsetX: number; offsetY: number }
  /** Step growth (SHADOW_STEP_GROWTH); smaller for a denser reference. */
  growth?: number
  maxSteps?: number
}

const DEG = Math.PI / 180
const MAX_ALT_RAD = 89.999 * DEG

/** Fraction of the sun visible from the fragment at texel coords (px, py)
 *  of `fine`: 0 in shadow, 1 lit, in between in a soft edge. Line for line
 *  what shadowFragmentShader's main() does:
 *   - horizon = the highest elevation angle (as a tangent) of the ground
 *     ahead, (elev − h0 − curvatureDrop(d)) / d, starting at 0 (the flat
 *     horizon: a sun below it is down);
 *   - the view mosaic first, metres per texel taken at the fragment's own
 *     latitude, until the ray leaves it or rises above the view mosaic's top;
 *   - then the far mosaic from where the ray leaves the view mosaic (coarse
 *     ground is never read under the view mosaic, where its smoothing would
 *     fill narrow valleys), metres per texel at each step's latitude, until
 *     it leaves the far mosaic or rises above everything;
 *   - stops early once the horizon is above the top of the sun's disc;
 *   - visibility = smoothstep over the disc of the angular margin
 *     (sun altitude − horizon angle), or a step for a hard edge. */
export function sunVisibilityCpu(fine: ElevationGrid, px: number, py: number, o: SunMarchOptions): number {
  const r = (o.sunRadiusDeg ?? 0) * DEG
  const alt = o.altitudeDeg * DEG
  if (alt + r <= 0) return 0
  const growth = o.growth ?? SHADOW_STEP_GROWTH
  const maxSteps = o.maxSteps ?? SHADOW_MAX_STEPS
  const curv = o.curvature ?? 0
  const tanLo = Math.tan(Math.min(MAX_ALT_RAD, alt - r))
  const tanHi = Math.tan(Math.min(MAX_ALT_RAD, alt + r))
  const [sx, sy] = sunStepVector(o.azimuthDeg)
  const h0 = bilinearAt(fine.data, fine.w, fine.h, px, py)
  const allMax = Math.max(fine.maxElev, o.far ? o.far.grid.maxElev : -Infinity)
  const mpt0 = texelGroundMeters(fine.mercY0 + py * fine.mercPerTexel, fine.mercPerTexel)
  let horizon = 0
  let blocked = false
  let above = false
  const dExit = boxExitDistance(px, py, sx, sy, fine.w, fine.h)
  let d = 0
  for (let i = 0; i < maxSteps; i++) {
    d += Math.max(1, d * growth)
    if (d > dExit) break
    const dm = d * mpt0
    const drop = dm * dm * curv
    const ray = h0 + dm * tanLo + drop
    if (ray > fine.maxElev) { above = ray > allMax; break }
    const e = (bilinearAt(fine.data, fine.w, fine.h, px + sx * d, py + sy * d) - h0 - drop) / dm
    if (e > horizon) { horizon = e; if (horizon > tanHi) { blocked = true; break } }
  }
  const far = o.far
  if (!blocked && !above && far) {
    const g = far.grid
    let t = dExit * far.scale
    let dm = dExit * mpt0
    const cx = px * far.scale + far.offsetX, cy = py * far.scale + far.offsetY
    for (let i = 0; i < maxSteps; i++) {
      const step = Math.max(1, t * growth)
      t += step
      const qx = cx + sx * t, qy = cy + sy * t
      if (qx < 0.5 || qy < 0.5 || qx > g.w - 0.5 || qy > g.h - 0.5) break
      dm += step * texelGroundMeters(g.mercY0 + (qy - 0.5 * sy * step) * g.mercPerTexel, g.mercPerTexel)
      const drop = dm * dm * curv
      if (h0 + dm * tanLo + drop > allMax) break
      const e = (bilinearAt(g.data, g.w, g.h, qx, qy) - h0 - drop) / dm
      if (e > horizon) { horizon = e; if (horizon > tanHi) { blocked = true; break } }
    }
  }
  if (blocked) return 0
  if (r <= 0) return horizon > Math.tan(alt) ? 0 : 1
  const x = Math.min(1, Math.max(0, (alt - Math.atan(horizon) + r) / (2 * r)))
  return x * x * (3 - 2 * x)
}

/** The hard march at a fixed texel size, flat Earth, no far field: is the
 *  point at texel coords (px, py) in shadow? (The plateau-edge and early-exit
 *  tests.) */
export function marchShadowCpu(
  grid: Float32Array, w: number, h: number, px: number, py: number,
  azimuthDeg: number, altitudeDeg: number, metersPerTexel: number, maxElev: number,
): boolean {
  // A Mercator grid whose row py sits on the equator, with the requested texel size.
  const mercPerTexel = metersPerTexel / MERCATOR_EQUATOR_M
  const fine: ElevationGrid = { data: grid, w, h, mercY0: 0.5 - py * mercPerTexel, mercPerTexel, maxElev }
  return sunVisibilityCpu(fine, px, py, { azimuthDeg, altitudeDeg }) < 0.5
}

/** The fragment shader of the live layer, mirrored by sunVisibilityCpu.
 *  `nodata` is the elevation written for missing texels (they neither cast
 *  nor receive). Expects `in vec2 v_uv`, the view-mosaic uv. */
export function shadowFragmentShader(nodata: number): string {
  return `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_mosaic; // R32F, metres, row 0 = north
uniform vec2 u_size;              // view mosaic size in texels
uniform float u_mercY0;           // Web Mercator y (0..1) of its north edge
uniform float u_mercPerTexel;     // 1 / (tileSize * 2^z)
uniform float u_fineMax;          // highest elevation in the view mosaic
uniform highp sampler2D u_far;    // far-field mosaic, FAR_LEVELS zooms coarser
uniform bool u_hasFar;
uniform vec2 u_farSize;
uniform float u_farScale;         // far texel = view texel * scale + offset
uniform vec2 u_farOffset;
uniform float u_farMercY0;
uniform float u_farMercPerTexel;
uniform float u_allMax;           // highest elevation in both mosaics
uniform vec2 u_sunStep;           // unit step toward the sun, texels (east, south)
uniform float u_alt;              // sun altitude, radians
uniform float u_sunRadius;        // sun disc radius, radians (0: hard edge)
uniform float u_curv;             // curvature drop per m² (0: flat Earth)
uniform float u_opacity;
in vec2 v_uv;
out vec4 fragColor;

const float NODATA_BELOW = ${(nodata / 10).toFixed(1)};
const float GROWTH = ${SHADOW_STEP_GROWTH.toFixed(8)};
const int MAX_STEPS = ${SHADOW_MAX_STEPS};
const float PI = 3.141592653589793;
const float EQUATOR_M = ${MERCATOR_EQUATOR_M.toFixed(3)};
const float MAX_ALT = ${MAX_ALT_RAD.toFixed(8)};

float fineTexel(ivec2 c) { return texelFetch(u_mosaic, clamp(c, ivec2(0), ivec2(u_size) - 1), 0).r; }
float farTexel(ivec2 c) { return texelFetch(u_far, clamp(c, ivec2(0), ivec2(u_farSize) - 1), 0).r; }

// bilinearAt(): continuous texel coords (centres at i + 0.5), full float
// precision, four texelFetches, no hardware filtering.
float fineElev(vec2 p) {
  vec2 b = p - 0.5; ivec2 i = ivec2(floor(b)); vec2 f = b - vec2(i);
  return mix(mix(fineTexel(i), fineTexel(i + ivec2(1, 0)), f.x), mix(fineTexel(i + ivec2(0, 1)), fineTexel(i + ivec2(1, 1)), f.x), f.y);
}
float farElev(vec2 p) {
  vec2 b = p - 0.5; ivec2 i = ivec2(floor(b)); vec2 f = b - vec2(i);
  return mix(mix(farTexel(i), farTexel(i + ivec2(1, 0)), f.x), mix(farTexel(i + ivec2(0, 1)), farTexel(i + ivec2(1, 1)), f.x), f.y);
}

// texelGroundMeters(): Mercator scale 1 / cos(lat), cos(lat) = 1 / cosh(pi (1 - 2y)).
float texelMeters(float mercY, float mercPerTexel) { return EQUATOR_M * mercPerTexel / cosh(PI * (1.0 - 2.0 * mercY)); }

// boxExitDistance()
float boxExit(vec2 p, vec2 s, vec2 size) {
  float tx = s.x > 0.0 ? (size.x - 0.5 - p.x) / s.x : s.x < 0.0 ? (0.5 - p.x) / s.x : 1e30;
  float ty = s.y > 0.0 ? (size.y - 0.5 - p.y) / s.y : s.y < 0.0 ? (0.5 - p.y) / s.y : 1e30;
  return max(0.0, min(tx, ty));
}

// sunVisibilityCpu()
void main() {
  vec2 p = v_uv * u_size;
  if (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) discard;
  float h0 = fineElev(p);
  if (h0 < NODATA_BELOW) discard;
  float vis = 0.0;
  if (u_alt + u_sunRadius > 0.0) {
    float tanLo = tan(min(MAX_ALT, u_alt - u_sunRadius));
    float tanHi = tan(min(MAX_ALT, u_alt + u_sunRadius));
    vec2 s = u_sunStep;
    float mpt0 = texelMeters(u_mercY0 + p.y * u_mercPerTexel, u_mercPerTexel);
    float horizon = 0.0;
    bool blocked = false;
    bool above = false;
    float dExit = boxExit(p, s, u_size);
    float d = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      d += max(1.0, d * GROWTH);
      if (d > dExit) break;
      float dm = d * mpt0;
      float drop = dm * dm * u_curv;
      float ray = h0 + dm * tanLo + drop;
      if (ray > u_fineMax) { above = ray > u_allMax; break; }
      float e = (fineElev(p + s * d) - h0 - drop) / dm;
      if (e > horizon) { horizon = e; if (horizon > tanHi) { blocked = true; break; } }
    }
    if (!blocked && !above && u_hasFar) {
      float t = dExit * u_farScale;
      float dm = dExit * mpt0;
      vec2 c = p * u_farScale + u_farOffset;
      for (int i = 0; i < MAX_STEPS; i++) {
        float stp = max(1.0, t * GROWTH);
        t += stp;
        vec2 q = c + s * t;
        if (q.x < 0.5 || q.y < 0.5 || q.x > u_farSize.x - 0.5 || q.y > u_farSize.y - 0.5) break;
        dm += stp * texelMeters(u_farMercY0 + (q.y - 0.5 * s.y * stp) * u_farMercPerTexel, u_farMercPerTexel);
        float drop = dm * dm * u_curv;
        if (h0 + dm * tanLo + drop > u_allMax) break;
        float e = (farElev(q) - h0 - drop) / dm;
        if (e > horizon) { horizon = e; if (horizon > tanHi) { blocked = true; break; } }
      }
    }
    if (!blocked) {
      if (u_sunRadius <= 0.0) vis = horizon > tan(u_alt) ? 0.0 : 1.0;
      else vis = smoothstep(-u_sunRadius, u_sunRadius, u_alt - atan(horizon));
    }
  }
  float a = u_opacity * (1.0 - vis);
  if (a <= 0.0) discard;
  fragColor = vec4(0.0, 0.0, 0.0, a);
}
`
}
