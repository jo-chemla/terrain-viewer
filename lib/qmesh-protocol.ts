// qmesh:// — Cesium quantized-mesh terrain as a maplibre raster-dem source.
//
// SKELETON (registered but dormant — no UI reaches it yet). Fetches Cesium
// `.terrain` tiles (the open quantized-mesh spec), decodes the triangle mesh
// with @here/quantized-mesh-decoder, rasterizes it back to a heightmap grid,
// re-grids from the geographic (EPSG:4326, two-root-tile TMS) pyramid onto the
// requested web-mercator tile, and terrarium-encodes the result.
//
// Why: unlocks the whole quantized-mesh ecosystem MapLibre can't otherwise
// consume — Cesium World Terrain / ion Moon Terrain (via the user's own ion
// token and registerIonQmeshSource below; Iconem has an ion arrangement for
// prototyping), national open services (Austria, Switzerland), and anything
// produced by ctb/cesium-terrain-builder. Same protocol shape as
// float32dem://: decode → Float32Array → terrarium PNG, wrapped in
// withTileResultCache at registration.
//
// URL format: qmesh://{sourceId}/{z}/{x}/{y} with the endpoint registered via
// registerQmeshSource() — quantized-mesh endpoints need layer.json metadata
// (tile template, available levels), which doesn't fit in a tile URL template.

import { elevationToTerrarium } from "./elevation-encoding"

export interface QmeshSourceConfig {
  /** Root URL containing layer.json, e.g.
   *  "https://assets.ion.cesium.com/{assetId}" or a self-hosted ctb tree. */
  rootUrl: string
  /** Appended to tile requests, e.g. "?access_token=..." for ion. */
  query?: string
  /** Extra request headers (ion uses Authorization: Bearer). */
  headers?: Record<string, string>
  tileSize?: number
}

interface LayerJson {
  tiles: string[]           // e.g. ["{z}/{x}/{y}.terrain?v={version}"]
  version?: string
  available?: unknown[]     // per-level availability rectangles
  maxzoom?: number
  projection?: string       // "EPSG:4326" (geographic) is the common case
}

const sources = new Map<string, QmeshSourceConfig>()
const layerJsonCache = new Map<string, Promise<LayerJson>>()

export function registerQmeshSource(id: string, config: QmeshSourceConfig): void {
  sources.set(id, config)
}

/** Cesium ion flow: assets aren't served at a static URL — exchange the user's
 *  ion token for the asset's endpoint (temporary tile-server URL + short-lived
 *  access token), then register that as a qmesh source. Known terrain assets:
 *  1 = Cesium World Terrain, 2684 = Cesium Moon Terrain (heights relative to
 *  the Moon reference ellipsoid; pair with the angular/true-position lunar
 *  mapping — see docs/beta/moon-lola on the moon branch).
 *  NOTE: the endpoint accessToken expires (~1h) — re-registering on a 401 is
 *  a TODO for the caller; the protocol will surface the 401 as a tile error. */
export async function registerIonQmeshSource(
  id: string, assetId: number, ionToken: string,
): Promise<void> {
  const res = await fetch(`https://api.cesium.com/v1/assets/${assetId}/endpoint`, {
    headers: { Authorization: `Bearer ${ionToken}` },
  })
  if (!res.ok) throw new Error(`qmesh: ion endpoint exchange for asset ${assetId} -> ${res.status}`)
  const endpoint = await res.json() as { url: string; accessToken: string }
  registerQmeshSource(id, {
    rootUrl: endpoint.url.replace(/\/$/, ""),
    headers: { Authorization: `Bearer ${endpoint.accessToken}` },
  })
}

async function getLayerJson(config: QmeshSourceConfig): Promise<LayerJson> {
  let cached = layerJsonCache.get(config.rootUrl)
  if (!cached) {
    cached = fetch(`${config.rootUrl}/layer.json${config.query ?? ""}`, { headers: config.headers })
      .then((r) => {
        if (!r.ok) throw new Error(`qmesh: layer.json ${r.status}`)
        return r.json()
      })
    layerJsonCache.set(config.rootUrl, cached)
  }
  return cached
}

const EARTH_R = 6378137
const DEG = Math.PI / 180

function mercatorTileBboxLonLat(z: number, x: number, y: number): [number, number, number, number] {
  const n = Math.pow(2, z)
  const lon0 = (x / n) * 360 - 180
  const lon1 = ((x + 1) / n) * 360 - 180
  const mercY = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / DEG
  return [lon0, mercY(y + 1), lon1, mercY(y)]
}

/** Geographic TMS used by quantized-mesh: 2 root tiles (west/east hemisphere),
 *  y counts up from the SOUTH pole. Level g fits 2^(g+1) x-tiles of 180/2^g°. */
function geoTileOf(lon: number, lat: number, level: number): [number, number] {
  const tileDeg = 180 / Math.pow(2, level)
  const gx = Math.min(Math.floor((lon + 180) / tileDeg), 2 * Math.pow(2, level) - 1)
  const gy = Math.min(Math.floor((lat + 90) / tileDeg), Math.pow(2, level) - 1)
  return [gx, gy]
}

/** Pick the geographic level whose tile resolution best matches a mercator
 *  tile at zoom z: a geo level-g tile spans 180/2^g° with 64+ vertices; the
 *  simple, Cesium-conventional pairing is g = z (mercator z0 spans 360° like
 *  the two geo roots together). Clamped to what layer.json advertises. */
function geoLevelFor(z: number, layer: LayerJson): number {
  const max = layer.available ? layer.available.length - 1 : layer.maxzoom ?? 14
  return Math.max(0, Math.min(z, max))
}

interface DecodedMesh {
  /** Per-vertex lon/lat/height in the tile's local frame. */
  u: Float64Array
  v: Float64Array
  h: Float64Array
  indices: Uint16Array | Uint32Array
}

async function fetchAndDecodeGeoTile(
  config: QmeshSourceConfig, layer: LayerJson,
  level: number, gx: number, gy: number, signal: AbortSignal,
): Promise<DecodedMesh | null> {
  const template = layer.tiles?.[0] ?? "{z}/{x}/{y}.terrain"
  const path = template
    .replace("{z}", String(level)).replace("{x}", String(gx)).replace("{y}", String(gy))
    .replace("{version}", layer.version ?? "1.0.0")
  const url = `${config.rootUrl}/${path}${template.includes("?") ? "" : config.query ?? ""}`
  const res = await fetch(url, {
    signal,
    headers: {
      // gzip handled transparently by fetch; extensions deliberately not
      // requested (no octvertexnormals/watermask needed for a heightmap).
      Accept: "application/vnd.quantized-mesh,application/octet-stream;q=0.9",
      ...config.headers,
    },
  })
  if (res.status === 404) return null // hole in availability — caller falls back
  if (!res.ok) throw new Error(`qmesh: tile ${level}/${gx}/${gy} -> ${res.status}`)
  const buf = await res.arrayBuffer()

  const { default: decode } = await import("@here/quantized-mesh-decoder")
  const mesh = decode(buf)
  // vertexData: u[], v[], height[] as consecutive Uint16 runs, each value
  // quantized 0..32767 across the tile extent / header height range.
  const vd = mesh.vertexData as Uint16Array
  const count = vd.length / 3
  const u = new Float64Array(count), v = new Float64Array(count), h = new Float64Array(count)
  const { minHeight, maxHeight } = mesh.header as { minHeight: number; maxHeight: number }
  for (let i = 0; i < count; i++) {
    u[i] = vd[i] / 32767
    v[i] = vd[count + i] / 32767
    h[i] = minHeight + (vd[2 * count + i] / 32767) * (maxHeight - minHeight)
  }
  return { u, v, h, indices: mesh.triangleIndices as Uint16Array | Uint32Array }
}

/** Rasterize the mesh into `out` (size x size), where the output grid covers
 *  [w,s,e,n] of THIS geo tile's local 0..1 uv space. Plain barycentric
 *  scanline over each triangle — meshes are ~1-5k triangles, cheap on CPU. */
function rasterizeMesh(
  mesh: DecodedMesh, out: Float32Array, size: number,
  u0: number, v0: number, u1: number, v1: number,
): void {
  const su = size / (u1 - u0)
  const sv = size / (v1 - v0)
  const px = (uu: number) => (uu - u0) * su
  // v=0 is the tile's south edge; row 0 of the raster is its NORTH edge.
  const py = (vv: number) => size - (vv - v0) * sv
  const { u, v, h, indices } = mesh
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    const ax = px(u[a]), ay = py(v[a]), bx = px(u[b]), by = py(v[b]), cx = px(u[c]), cy = py(v[c])
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)))
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(den) < 1e-12) continue
    for (let yy = minY; yy <= maxY; yy++) {
      for (let xx = minX; xx <= maxX; xx++) {
        const w0 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / den
        const w1 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / den
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        out[yy * size + xx] = w0 * h[a] + w1 * h[b] + w2 * h[c]
      }
    }
  }
}

/** qmesh://{sourceId}/{z}/{x}/{y} -> terrarium PNG. */
export async function qmeshProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const m = params.url.match(/^qmesh:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/)
  if (!m) throw new Error(`qmesh: bad url ${params.url}`)
  const [, id, zs, xs, ys] = m
  const config = sources.get(id)
  if (!config) throw new Error(`qmesh: unregistered source "${id}"`)
  const z = +zs, x = +xs, y = +ys
  const size = config.tileSize ?? 256
  const layer = await getLayerJson(config)

  const [w, s, e, n] = mercatorTileBboxLonLat(z, x, y)
  const level = geoLevelFor(z, layer)
  const tileDeg = 180 / Math.pow(2, level)

  // Rasterize every overlapping geographic tile into a lat/lon-gridded buffer
  // covering the mercator tile's lon/lat bbox (1-4 tiles in practice).
  const geo = new Float32Array(size * size).fill(NaN)
  const [gx0, gy0] = geoTileOf(w + 1e-9, s + 1e-9, level)
  const [gx1, gy1] = geoTileOf(e - 1e-9, n - 1e-9, level)
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const mesh = await fetchAndDecodeGeoTile(config, layer, level, gx, gy, abortController.signal)
      // TODO(availability): on 404, retry one level up (coarser) instead of
      // leaving NaN — quantized-mesh pyramids are sparse at deep levels.
      if (!mesh) continue
      // This geo tile's uv window that overlaps the output bbox:
      const tw = gx * tileDeg - 180, ts = gy * tileDeg - 90
      rasterizeMesh(
        mesh, geo, size,
        (w - tw) / tileDeg, (s - ts) / tileDeg,
        (e - tw) / tileDeg, (n - ts) / tileDeg,
      )
    }
  }
  // TODO(seams): rasterizing per-tile into a shared lat-gridded buffer with
  // uv windows outside 0..1 relies on neighbor tiles' edge vertices matching
  // (the spec guarantees shared edge vertices); revisit with skirt handling.

  // Re-grid rows from linear-latitude to mercator-y. Within one tile the
  // stretch is near-constant (z>=3); at z<3 this nonuniform row resample is
  // exactly what fixes the classic 4326->3857 squash.
  const elev = new Float32Array(size * size)
  const mercN = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / Math.pow(2, z))))
  const mercS = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / Math.pow(2, z))))
  void EARTH_R
  for (let row = 0; row < size; row++) {
    // Mercator-even latitude of this output row:
    const yMerc = mercN + ((row + 0.5) / size) * (mercS - mercN)
    const lat = yMerc / DEG // gudermannian already applied via atan(sinh())
    const srcRow = Math.min(size - 1, Math.max(0, ((n - lat) / (n - s)) * size - 0.5))
    const r0 = Math.floor(srcRow)
    const r1 = Math.min(size - 1, r0 + 1)
    const f = srcRow - r0
    for (let col = 0; col < size; col++) {
      const a = geo[r0 * size + col]
      const b = geo[r1 * size + col]
      elev[row * size + col] = isFinite(a) && isFinite(b) ? a + (b - a) * f : isFinite(a) ? a : b
    }
  }

  // Terrarium-encode (identical tail to float32dem-protocol).
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext("2d")!
  const imageData = ctx.createImageData(size, size)
  for (let i = 0; i < elev.length; i++) {
    const val = isFinite(elev[i]) ? elev[i] : 0
    const [r, g, b, alpha] = elevationToTerrarium(val)
    imageData.data[i * 4] = r
    imageData.data[i * 4 + 1] = g
    imageData.data[i * 4 + 2] = b
    imageData.data[i * 4 + 3] = alpha
  }
  ctx.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
