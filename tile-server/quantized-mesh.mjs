// Cesium quantized-mesh-1.0 terrain tiles from a height grid, standalone:
// no server, no source reading, no Node built-in. Give it the heights of a
// geographic tile on a square grid and it meshes and encodes them; the tile
// service (server.mjs, direct.mjs) fills the grid from any terrain source it
// reads, and another app (a 3D Tiles companion) can fill it from its own.
//
// Format: https://github.com/CesiumGS/quantized-mesh (spec, 1.0).
// Tiling: the geographic TMS scheme Cesium uses, EPSG:4326, 2 x 1 tiles at
// level 0, y counted from the south.
//
//   tileBounds(z, x, y)                 the tile's west, south, east, north in degrees
//   levelGeometricError(z)              Cesium's geometric error of a level, metres
//   encodeTile({ heights, size, bounds, maxError, mesher, normals })
//                                       mesh (RTIN or Delaunay) and encode: a Uint8Array
//   decodeTile(bytes)                   the reverse, every field, for tests and clients
//   layerJson({ ... })                  the layer.json Cesium reads first
//   availableRanges(maxzoom, bounds)    its `available` field
//   requestedExtensions(accept, query)  the extensions a request asks for
//
// Meshing: delatin (Delaunay refinement, any grid) by default, or
// @mapbox/martini (right-triangulated irregular network, a 2^k + 1 grid).
// Measured on Mapterhorn around the Matterhorn, levels 10 to 14, 257 x 257:
// for the same error delatin makes 45% fewer triangles (and bytes) in about
// three times the time (17 to 40 ms a tile against 6 to 12). Both stop at
// `maxError` metres of vertical error. Skirts are the client's (the spec leaves them out).
import Martini from "@mapbox/martini"
import Delatin from "delatin"

export const CONTENT_TYPE = "application/vnd.quantized-mesh"
/** The extensions this module writes (the water mask is not). */
export const EXTENSIONS = ["octvertexnormals"]

// WGS84, as Cesium's Ellipsoid.WGS84.
const A = 6378137.0
const B = 6356752.3142451793
const E2 = 1 - (B * B) / (A * A)
const RAD = Math.PI / 180

/** The tile's extent in degrees: `{ west, south, east, north }`. Level z has
 *  2^(z+1) columns and 2^z rows; y = 0 is the southernmost row (TMS). */
export function tileBounds(z, x, y) {
  const span = 180 / 2 ** z
  return { west: -180 + x * span, south: -90 + y * span, east: -180 + (x + 1) * span, north: -90 + (y + 1) * span }
}

/** Cesium's geometric error of a level (TerrainProvider.
 *  getEstimatedLevelZeroGeometricErrorForAHeightmap with 65 samples and two
 *  tiles at level 0, halved each level), in metres: Cesium refines a tile
 *  when this error, projected, passes its maximumScreenSpaceError. */
export function levelGeometricError(z) {
  return (A * 2 * Math.PI * 0.25) / (65 * 2) / 2 ** z
}

/** Geodetic to Earth-centred, Earth-fixed metres. */
function ecef(lon, lat, h, out, o) {
  const cl = Math.cos(lat * RAD), sl = Math.sin(lat * RAD)
  const N = A / Math.sqrt(1 - E2 * sl * sl)
  out[o] = (N + h) * cl * Math.cos(lon * RAD)
  out[o + 1] = (N + h) * cl * Math.sin(lon * RAD)
  out[o + 2] = (N * (1 - E2) + h) * sl
}

/** Holes (NaN) filled: the mesher needs a value everywhere. `fill`
 *  "nearest" grows the data into them (each pass gives a hole next to data
 *  the mean of its neighbours), so a void is neither a pit nor a cliff; a
 *  number sets them to it. A grid with no data at all is set to 0. */
function filled(heights, size, fill = "nearest") {
  let holes = 0
  for (let i = 0; i < heights.length; i++) if (!Number.isFinite(heights[i])) holes++
  if (!holes) return heights
  const out = Float32Array.from(heights)
  if (typeof fill === "number" || holes === out.length) {
    const v = typeof fill === "number" ? fill : 0
    for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = v
    return out
  }
  const next = new Float32Array(out.length)
  while (holes > 0) {
    next.set(out)
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const k = j * size + i
      if (Number.isFinite(out[k])) continue
      let s = 0, c = 0
      if (i > 0 && Number.isFinite(out[k - 1])) { s += out[k - 1]; c++ }
      if (i < size - 1 && Number.isFinite(out[k + 1])) { s += out[k + 1]; c++ }
      if (j > 0 && Number.isFinite(out[k - size])) { s += out[k - size]; c++ }
      if (j < size - 1 && Number.isFinite(out[k + size])) { s += out[k + size]; c++ }
      if (c) { next[k] = s / c; holes-- }
    }
    out.set(next)
  }
  return out
}

const martinis = new Map()
/** The grid's triangles: `{ coords, triangles }`, coords as grid column and
 *  row pairs (row 0 the north edge). */
export function meshGrid(heights, size, maxError, mesher = "delatin") {
  if (mesher === "delatin") {
    const tin = new Delatin(heights, size, size)
    tin.run(maxError)
    return { coords: Uint32Array.from(tin.coords), triangles: Uint32Array.from(tin.triangles) }
  }
  if (!Number.isInteger(Math.log2(size - 1))) throw new Error("martini needs a 2^k + 1 grid")
  let m = martinis.get(size)
  if (!m) { m = new Martini(size); martinis.set(size, m) }
  const { vertices, triangles } = m.createTile(heights).getMesh(maxError)
  return { coords: vertices, triangles }
}

const zigzag = (n) => ((n << 1) ^ (n >> 31)) & 0xffff
const unzigzag = (n) => (n >> 1) ^ -(n & 1)

/** Cesium's AttributeCompression.octEncode, into 0..255 a component. */
function octEncode(x, y, z, out, o) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1
  let px = x / s, py = y / s
  if (z < 0) {
    const ox = px
    px = (1 - Math.abs(py)) * (ox < 0 ? -1 : 1)
    py = (1 - Math.abs(ox)) * (py < 0 ? -1 : 1)
  }
  const snorm = (v) => Math.round((Math.min(1, Math.max(-1, v)) * 0.5 + 0.5) * 255)
  out[o] = snorm(px); out[o + 1] = snorm(py)
}

/** Cesium's EllipsoidalOccluder.computeHorizonCullingPointFromPoints: the
 *  point, in ellipsoid-scaled coordinates, from which the whole tile is
 *  hidden once it is below the horizon. */
function horizonOcclusionPoint(positions, cx, cy, cz) {
  const rx = 1 / A, rz = 1 / B
  let dx = cx * rx, dy = cy * rx, dz = cz * rz
  const dl = Math.hypot(dx, dy, dz) || 1
  dx /= dl; dy /= dl; dz /= dl
  let max = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] * rx, py = positions[i + 1] * rx, pz = positions[i + 2] * rz
    let m2 = px * px + py * py + pz * pz
    let m = Math.sqrt(m2)
    const ux = px / m, uy = py / m, uz = pz / m
    m2 = Math.max(1, m2); m = Math.max(1, m)
    const cosAlpha = ux * dx + uy * dy + uz * dz
    const sinAlpha = Math.hypot(uy * dz - uz * dy, uz * dx - ux * dz, ux * dy - uy * dx)
    const cosBeta = 1 / m, sinBeta = Math.sqrt(m2 - 1) * cosBeta
    const mag = 1 / (cosAlpha * cosBeta - sinAlpha * sinBeta)
    if (mag > max) max = mag
  }
  // A tile wider than the horizon allows (level 0): no culling point; one
  // far out along the centre never culls it.
  if (!(max > 0) || !Number.isFinite(max)) max = 1e6
  return [dx * max, dy * max, dz * max]
}

/**
 * One quantized-mesh-1.0 tile.
 * @param {object} o
 * @param {Float32Array|number[]} o.heights  size * size heights in metres, row by row,
 *   row 0 along the north edge, column 0 along the west edge; NaN: no data (see o.fill)
 * @param {number} o.size      the grid's side; 2^k + 1 for martini (65, 129, 257)
 * @param {{west:number,south:number,east:number,north:number}} o.bounds  degrees
 * @param {number} o.maxError  metres of vertical error allowed
 * @param {"delatin"|"martini"} [o.mesher]  delatin by default
 * @param {boolean} [o.normals]  write the oct-encoded vertex normals extension
 * @param {number|"nearest"} [o.fill]   holes grown from the data around ("nearest", the default) or set to a height
 * @returns {Uint8Array}
 */
export function encodeTile({ heights, size, bounds, maxError, mesher = "delatin", normals = false, fill = "nearest" }) {
  if (heights.length !== size * size) throw new Error(`heights holds ${heights.length} values, not ${size} x ${size}`)
  const grid = filled(heights, size, fill)
  const { coords, triangles: tri } = meshGrid(grid, size, Math.max(0, maxError), mesher)
  const nIn = coords.length / 2
  const last = size - 1

  // Vertices in the order the triangles first name them: what the
  // high-water-mark index encoding needs.
  const remap = new Int32Array(nIn).fill(-1)
  const order = []
  const tris = new Uint32Array(tri.length)
  for (let t = 0; t < tri.length; t += 3) {
    // Counter-clockwise seen from above (u east, v north): the globe culls back faces.
    let a = tri[t], b = tri[t + 1], c = tri[t + 2]
    const ax = coords[2 * a], ay = coords[2 * a + 1], bx = coords[2 * b], by = coords[2 * b + 1], cx = coords[2 * c], cy = coords[2 * c + 1]
    // Rows grow southwards, so the signed area in (column, row) is negated.
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0) { const s = b; b = c; c = s }
    for (const [k, i] of [[0, a], [1, b], [2, c]]) {
      if (remap[i] < 0) { remap[i] = order.length; order.push(i) }
      tris[t + k] = remap[i]
    }
  }
  const n = order.length
  const col = new Uint32Array(n), row = new Uint32Array(n), h = new Float64Array(n)
  let minH = Infinity, maxH = -Infinity
  for (let k = 0; k < n; k++) {
    const i = order[k]
    col[k] = coords[2 * i]; row[k] = coords[2 * i + 1]
    h[k] = grid[row[k] * size + col[k]]
    if (h[k] < minH) minH = h[k]
    if (h[k] > maxH) maxH = h[k]
  }
  if (!n) { minH = maxH = 0 }
  const span = maxH - minH
  const U = new Uint16Array(n), V = new Uint16Array(n), H = new Uint16Array(n)
  const { west, south, east, north } = bounds
  const pos = new Float64Array(n * 3)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let k = 0; k < n; k++) {
    U[k] = Math.round((col[k] / last) * 32767)
    V[k] = Math.round(((last - row[k]) / last) * 32767)
    H[k] = span > 0 ? Math.round(((h[k] - minH) / span) * 32767) : 0
    // The position the client will decode, so the bounds hold it.
    const hq = minH + (H[k] / 32767) * span
    ecef(west + (U[k] / 32767) * (east - west), south + (V[k] / 32767) * (north - south), hq, pos, 3 * k)
    const px = pos[3 * k], py = pos[3 * k + 1], pz = pos[3 * k + 2]
    if (px < x0) x0 = px; if (px > x1) x1 = px
    if (py < y0) y0 = py; if (py > y1) y1 = py
    if (pz < z0) z0 = pz; if (pz > z1) z1 = pz
  }
  const sc = n ? [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] : [0, 0, 0]
  let r2 = 0
  for (let k = 0; k < n; k++) r2 = Math.max(r2, (pos[3 * k] - sc[0]) ** 2 + (pos[3 * k + 1] - sc[1]) ** 2 + (pos[3 * k + 2] - sc[2]) ** 2)
  const hop = horizonOcclusionPoint(pos, sc[0], sc[1], sc[2])

  // Edge vertices, along each edge.
  const edge = (test, key) => { const e = []; for (let k = 0; k < n; k++) if (test(k)) e.push(k); return e.sort((a, b) => key(a) - key(b)) }
  const westE = edge((k) => U[k] === 0, (k) => V[k])
  const southE = edge((k) => V[k] === 0, (k) => U[k])
  const eastE = edge((k) => U[k] === 32767, (k) => V[k])
  const northE = edge((k) => V[k] === 32767, (k) => U[k])

  const wide = n > 65536
  const ib = wide ? 4 : 2
  let normalBytes = null
  if (normals) {
    const acc = new Float64Array(n * 3)
    for (let t = 0; t < tris.length; t += 3) {
      const a = 3 * tris[t], b = 3 * tris[t + 1], c = 3 * tris[t + 2]
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
      // Area-weighted face normal (counter-clockwise: outwards).
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      for (const o of [a, b, c]) { acc[o] += nx; acc[o + 1] += ny; acc[o + 2] += nz }
    }
    normalBytes = new Uint8Array(n * 2)
    for (let k = 0; k < n; k++) {
      let nx = acc[3 * k], ny = acc[3 * k + 1], nz = acc[3 * k + 2]
      const l = Math.hypot(nx, ny, nz)
      if (l > 0) { nx /= l; ny /= l; nz /= l } else {
        // An isolated vertex: the ellipsoid's normal.
        const gx = pos[3 * k] / (A * A), gy = pos[3 * k + 1] / (A * A), gz = pos[3 * k + 2] / (B * B), gl = Math.hypot(gx, gy, gz) || 1
        nx = gx / gl; ny = gy / gl; nz = gz / gl
      }
      octEncode(nx, ny, nz, normalBytes, 2 * k)
    }
  }

  // Sizes, then one pass of writes.
  let size0 = 88 + 4 + n * 6
  const pad = size0 % ib ? ib - (size0 % ib) : 0
  let total = size0 + pad + 4 + tris.length * ib
  for (const e of [westE, southE, eastE, northE]) total += 4 + e.length * ib
  if (normalBytes) total += 5 + normalBytes.length
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  let p = 0
  const f64 = (v) => { dv.setFloat64(p, v, true); p += 8 }
  const f32 = (v) => { dv.setFloat32(p, v, true); p += 4 }
  const u32 = (v) => { dv.setUint32(p, v, true); p += 4 }
  const u16 = (v) => { dv.setUint16(p, v, true); p += 2 }
  const idx = wide ? u32 : u16
  f64(sc[0]); f64(sc[1]); f64(sc[2])
  f32(minH); f32(maxH)
  f64(sc[0]); f64(sc[1]); f64(sc[2]); f64(Math.sqrt(r2))
  f64(hop[0]); f64(hop[1]); f64(hop[2])
  u32(n)
  for (const arr of [U, V, H]) { let prev = 0; for (let k = 0; k < n; k++) { u16(zigzag(arr[k] - prev)); prev = arr[k] } }
  p += pad
  u32(tris.length / 3)
  let highest = 0
  for (let t = 0; t < tris.length; t++) {
    const code = highest - tris[t]
    idx(code)
    if (code === 0) highest++
  }
  for (const e of [westE, southE, eastE, northE]) { u32(e.length); for (const k of e) idx(k) }
  if (normalBytes) {
    dv.setUint8(p, 1); p += 1
    u32(normalBytes.length)
    new Uint8Array(buf, p, normalBytes.length).set(normalBytes); p += normalBytes.length
  }
  return new Uint8Array(buf)
}

/** A quantized-mesh-1.0 tile read back: the header, the vertices (u, v,
 *  height quantized 0..32767), the triangle indices, the four edge lists,
 *  and the extensions (normals as the oct-encoded bytes). */
export function decodeTile(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 0
  const f64 = () => { const v = dv.getFloat64(p, true); p += 8; return v }
  const f32 = () => { const v = dv.getFloat32(p, true); p += 4; return v }
  const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v }
  const u16 = () => { const v = dv.getUint16(p, true); p += 2; return v }
  const header = {
    center: [f64(), f64(), f64()], minHeight: f32(), maxHeight: f32(),
    boundingSphere: { center: [f64(), f64(), f64()], radius: f64() },
    horizonOcclusionPoint: [f64(), f64(), f64()],
  }
  const n = u32()
  const read = () => { const out = new Uint16Array(n); let v = 0; for (let k = 0; k < n; k++) { v += unzigzag(u16()); out[k] = v } return out }
  const u = read(), v = read(), height = read()
  const wide = n > 65536, ib = wide ? 4 : 2
  if (p % ib) p += ib - (p % ib)
  const idx = wide ? u32 : u16
  const triangleCount = u32()
  const indices = new Uint32Array(triangleCount * 3)
  let highest = 0
  for (let t = 0; t < indices.length; t++) { const code = idx(); indices[t] = highest - code; if (code === 0) highest++ }
  const edgeList = () => { const c = u32(); const out = new Uint32Array(c); for (let k = 0; k < c; k++) out[k] = idx(); return out }
  const west = edgeList(), south = edgeList(), east = edgeList(), north = edgeList()
  const extensions = {}
  while (p < bytes.byteLength) {
    const id = dv.getUint8(p); p += 1
    const len = u32()
    const data = new Uint8Array(bytes.buffer, bytes.byteOffset + p, len)
    if (id === 1) extensions.vertexNormals = data
    else if (id === 2) extensions.waterMask = data
    else if (id === 4) extensions.metadata = JSON.parse(new TextDecoder().decode(data.subarray(4)))
    else extensions[`ext${id}`] = data
    p += len
  }
  return { header, vertexCount: n, u, v, height, triangleCount, indices, edges: { west, south, east, north }, extensions }
}

/** The tiles of each level from 0 to `maxzoom` inside `bounds` ([west,
 *  south, east, north] degrees; the world when left out), as the
 *  `available` field of a layer.json. Level 0 is always whole: Cesium
 *  needs both root tiles. */
export function availableRanges(maxzoom, bounds) {
  const [w, s, e, n] = bounds ?? [-180, -90, 180, 90]
  const out = []
  for (let z = 0; z <= maxzoom; z++) {
    const span = 180 / 2 ** z, nx = 2 ** (z + 1), ny = 2 ** z
    if (z === 0 || !bounds) { out.push([{ startX: 0, startY: 0, endX: nx - 1, endY: ny - 1 }]); continue }
    const cl = (v, m) => Math.min(m - 1, Math.max(0, v))
    out.push([{
      startX: cl(Math.floor((w + 180) / span), nx), endX: cl(Math.ceil((e + 180) / span) - 1, nx),
      startY: cl(Math.floor((s + 90) / span), ny), endY: cl(Math.ceil((n + 90) / span) - 1, ny),
    }])
  }
  return out
}

/** The layer.json a Cesium client reads first (CesiumTerrainProvider).
 *  `tiles`: the tile templates, relative to the layer.json or absolute,
 *  with {z}, {x}, {y} and optionally {version}. */
export function layerJson({ name = "terrain", description, attribution = "", tiles, minzoom = 0, maxzoom, bounds, extensions = EXTENSIONS, version = "1.0.0" }) {
  return {
    tilejson: "2.1.0",
    name,
    ...(description ? { description } : {}),
    version,
    format: "quantized-mesh-1.0",
    attribution,
    scheme: "tms",
    tiles,
    projection: "EPSG:4326",
    bounds: bounds ?? [-180, -90, 180, 90],
    minzoom,
    maxzoom,
    available: availableRanges(maxzoom, bounds),
    extensions,
  }
}

/** The extensions a request asks for, among the ones written here: from
 *  the Accept header (Cesium sends
 *  `application/vnd.quantized-mesh;extensions=octvertexnormals-watermask`)
 *  or an `extensions` parameter (comma- or dash-separated, for clients
 *  that set no header). */
export function requestedExtensions(accept = "", param = "") {
  const asked = new Set()
  for (const m of String(accept).matchAll(/extensions=([a-z-]+)/gi)) for (const x of m[1].split("-")) asked.add(x.toLowerCase())
  for (const x of String(param ?? "").split(/[,-]/)) if (x) asked.add(x.trim().toLowerCase())
  return EXTENSIONS.filter((x) => asked.has(x))
}
