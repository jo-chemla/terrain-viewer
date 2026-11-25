// The geoid's height above the WGS84 ellipsoid (the undulation N), for the
// quantized mesh: Cesium terrain is ellipsoidal (h = H + N), the sources are
// almost all orthometric ("above sea level", H). Without it a mesh sits N
// metres too low: about 45 m in Paris, 51 m in the Alps, -30 m... +85 m
// around the world.
//
// Model: EGM96, NGA's 15-minute grid (WW15MGH, 721 x 1440 values in cm),
// bilinear, through egm96-universal (MIT; the grid is a work of the US
// government, public domain), checked by its CI against NGA's Fortran
// reference. Shipped with the service, nothing fetched. EGM2008 differs from
// EGM96 by under a metre in most places, a few metres in high mountains: well
// within a quantized-mesh tile's error at the levels where the shift shows.
// Loading the grid takes about half a second, once per thread (warmUp).
//
//   undulation(lat, lon)                    N in metres
//   addUndulation(heights, size, bounds, sign)
//                                           a geographic tile's grid shifted by
//                                           +N (orthometric to ellipsoidal) or -N

let egm = null
const load = async () => (egm ??= await import("egm96-universal"))

/** Loads the grid (about 0.5 s): call before the first tile. */
export const warmUpGeoid = () => load().then(() => undefined)

/** N, the geoid's height above the ellipsoid, metres, at a point in degrees. */
export async function undulation(lat, lon) {
  return (await load()).meanSeaLevel(Math.max(-90, Math.min(90, lat)), lon)
}

/**
 * Adds `sign` x N to every finite height of a tile's grid (row 0 the north
 * edge, column 0 the west edge, `size` x `size`), in place. N is looked up on
 * a grid of 65 x 65 across a 257 x 257 tile and interpolated between: from
 * level 4 on those samples are closer than the model's 15' cells, so nothing
 * is lost; above, the smoothing costs metres where a tile's geometric error
 * is kilometres. A lookup per point would double a martini tile's time.
 * @param {Float32Array} heights
 * @param {number} size
 * @param {{west:number,south:number,east:number,north:number}} bounds  degrees
 * @param {1|-1} sign  +1: orthometric to ellipsoidal; -1 the reverse
 */
export async function addUndulation(heights, size, bounds, sign = 1) {
  const { meanSeaLevel } = await load()
  const last = size - 1
  // The coarse grid: every `step` points, step a divisor of size - 1.
  let step = 1
  for (const s of [8, 4, 2]) if (last % s === 0 && last / s >= 32) { step = s; break }
  const m = last / step + 1
  const N = new Float64Array(m * m)
  const { west, south, east, north } = bounds
  for (let j = 0; j < m; j++) {
    const lat = Math.max(-90, Math.min(90, north - ((j * step) / last) * (north - south)))
    for (let i = 0; i < m; i++) N[j * m + i] = meanSeaLevel(lat, west + ((i * step) / last) * (east - west))
  }
  for (let r = 0; r < size; r++) {
    const fy = r / step, j = Math.min(m - 2, Math.floor(fy)), ty = fy - j
    for (let c = 0; c < size; c++) {
      const k = r * size + c
      if (!Number.isFinite(heights[k])) continue
      const fx = c / step, i = Math.min(m - 2, Math.floor(fx)), tx = fx - i
      const a = N[j * m + i], b = N[j * m + i + 1], d = N[(j + 1) * m + i], e = N[(j + 1) * m + i + 1]
      heights[k] += sign * ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty)
    }
  }
  return heights
}
