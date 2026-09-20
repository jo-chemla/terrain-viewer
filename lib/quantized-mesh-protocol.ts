import { QuantizedMeshLoader } from "@loaders.gl/terrain"
import { toTileImage, type TileImage } from "./tile-image"

/**
 * `quantized-mesh://` - Cesium terrain (quantized-mesh-1.0) as an ordinary
 * maplibre `raster-dem` source.
 *
 * Quantized mesh is a **TIN**: per tile, a set of vertices and triangles whose
 * density follows the terrain, with the level of detail chosen by the camera.
 * maplibre's terrain wants a regular grid, so the mesh is rasterised here -
 * scan-converted triangle by triangle with barycentric height interpolation -
 * and re-encoded as Terrarium.
 *
 * NOTE on the meshing libraries: pymartini / pydelatin (and their JS ports
 * @mapbox/martini and delatin) go the OTHER way, raster -> TIN. They are what
 * titiler-style services use to PRODUCE quantized mesh from a DEM, and cannot
 * consume one. The direction needed here has no package because it is just
 * triangle rasterisation; that is the loop below.
 *
 * Two URL shapes:
 *
 *   quantized-mesh://ion/<assetId>/{z}/{x}/{y}
 *       A Cesium ion asset. The ion REST endpoint is resolved once per asset
 *       (it hands back a tile base URL plus a short-lived access token) and
 *       re-resolved on a 401. The account token is NOT in the URL - it is held
 *       in this module via setCesiumIonToken, because a protocol URL is also
 *       the tile cache's key and ends up in devtools, logs and error messages.
 *   quantized-mesh://<host+path>/{z}/{x}/{y}
 *       Any other quantized-mesh service, fetched directly over https.
 *
 * In both cases {z}/{x}/{y} are maplibre's own WEB MERCATOR tile coordinates.
 * Quantized mesh is tiled geographically instead (EPSG:4326, TMS row order,
 * 2^(L+1) x 2^L tiles over the whole world), so the mapping to source tiles
 * happens here rather than in the template.
 */

const TILE_SIZE = 256
const MAX_LAT = 85.051129
/** Cesium World Terrain stops here; deeper requests just repeat the last level. */
const DEFAULT_MAX_LEVEL = 15

// --------------------------------------------------------------- mercator
const lat2merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 360))
const merc2lat = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI)

/** Web Mercator tile z/x/y -> its geographic bounds, degrees. */
function mercTileBounds(z: number, x: number, y: number) {
  const n = 2 ** z
  const west = (x / n) * 360 - 180
  const east = ((x + 1) / n) * 360 - 180
  const north = merc2lat(Math.PI * (1 - (2 * y) / n))
  const south = merc2lat(Math.PI * (1 - (2 * (y + 1)) / n))
  return { west, south, east, north }
}

/** Geographic (quantized-mesh) tile col/row -> its bounds, degrees. Row is
 *  counted from the SOUTH: the scheme is TMS. */
function geoTileBounds(level: number, col: number, row: number) {
  const span = 360 / 2 ** (level + 1)
  return { west: -180 + col * span, east: -180 + (col + 1) * span, south: -90 + row * span, north: -90 + (row + 1) * span }
}

// ------------------------------------------------------------- ion endpoint
/** The account token, kept out of every URL - see the header comment. Written
 *  from TerrainViewer whenever cesiumIonKeyAtom changes. */
let ionAccountToken = ""
export function setCesiumIonToken(token: string) {
  if (token === ionAccountToken) return
  ionAccountToken = token
  ionEndpoints.clear()  // per-asset endpoints were issued against the old token
}

type IonEndpoint = { base: string; token: string }
const ionEndpoints = new Map<string, Promise<IonEndpoint>>()

function resolveIon(assetId: string, ionToken: string, force = false): Promise<IonEndpoint> {
  const key = `${assetId}:${ionToken}`
  if (force) ionEndpoints.delete(key)
  let p = ionEndpoints.get(key)
  if (!p) {
    p = fetch(`https://api.cesium.com/v1/assets/${assetId}/endpoint`, { headers: { Authorization: `Bearer ${ionToken}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`Cesium ion ${r.status} for asset ${assetId} - check the token in Settings -> API Keys`)
        return r.json()
      })
      .then((d: { url: string; accessToken: string }) => ({ base: d.url, token: d.accessToken }))
      .catch((e) => { ionEndpoints.delete(key); throw e })
    ionEndpoints.set(key, p)
  }
  return p
}

// ----------------------------------------------------------------- fetching
/** A source tile that does not exist. Common and not an error: maplibre only
 *  stays quiet about a tile failure when `status === 404`. */
class TileNotFound extends Error {
  status = 404
  constructor(url: string) { super(`404 ${url}`) }
}

const QM_ACCEPT = "application/vnd.quantized-mesh,application/octet-stream;q=0.9"

async function fetchMesh(url: string, auth: string | null, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = { Accept: QM_ACCEPT }
  if (auth) headers.Authorization = `Bearer ${auth}`
  const r = await fetch(url, { headers, signal })
  if (r.status === 404 || r.status === 204) return null
  if (r.status === 401) throw new TokenExpired()
  if (!r.ok) throw new Error(`quantized-mesh:// HTTP ${r.status} for ${url}`)
  const buf = await r.arrayBuffer()
  // A quantized-mesh tile is at least its 92-byte header plus counts.
  return buf.byteLength < 92 ? null : buf
}

class TokenExpired extends Error {}

// -------------------------------------------------------------- rasteriser
/**
 * Scan-converts one mesh into `heights`, in the output tile's pixel space.
 * Vertices arrive as (lon, lat, height) - QuantizedMeshLoader's `bounds`
 * option maps the tile's normalised coordinates onto whatever rectangle it is
 * given, so passing the source tile's geographic bounds means the projection
 * to Mercator is a per-vertex operation here rather than a resampling pass.
 */
function rasterise(
  positions: Float32Array,
  indices: ArrayLike<number>,
  out: { west: number; east: number; northY: number; southY: number },
  heights: Float32Array,
  filled: Uint8Array,
) {
  const lonSpan = out.east - out.west
  const ySpan = out.northY - out.southY
  const px = new Float32Array(positions.length / 3)
  const py = new Float32Array(positions.length / 3)
  for (let i = 0, v = 0; i < positions.length; i += 3, v++) {
    px[v] = ((positions[i] - out.west) / lonSpan) * TILE_SIZE
    py[v] = ((out.northY - lat2merc(positions[i + 1])) / ySpan) * TILE_SIZE
  }

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    const ax = px[a], ay = py[a], bx = px[b], by = py[b], cx = px[c], cy = py[c]
    // Signed area x2. A degenerate triangle covers nothing.
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (area === 0 || !Number.isFinite(area)) continue
    const inv = 1 / area
    const az = positions[a * 3 + 2], bz = positions[b * 3 + 2], cz = positions[c * 3 + 2]

    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(TILE_SIZE - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const y1 = Math.min(TILE_SIZE - 1, Math.ceil(Math.max(ay, by, cy)))
    if (x1 < x0 || y1 < y0) continue

    for (let row = y0; row <= y1; row++) {
      const cyPix = row + 0.5
      for (let col = x0; col <= x1; col++) {
        const cxPix = col + 0.5
        // Barycentric weights. A small negative tolerance keeps shared edges
        // from leaving unwritten seams between adjacent triangles.
        const w0 = ((bx - cxPix) * (cy - cyPix) - (cx - cxPix) * (by - cyPix)) * inv
        const w1 = ((cx - cxPix) * (ay - cyPix) - (ax - cxPix) * (cy - cyPix)) * inv
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        const i = row * TILE_SIZE + col
        heights[i] = w0 * az + w1 * bz + w2 * cz
        filled[i] = 1
      }
    }
  }
}

// ------------------------------------------------------------------ protocol
export async function quantizedMeshProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const rest = params.url.replace(/^quantized-mesh:\/\//, "")
  const m = rest.match(/^(.*)\/(\d+)\/(-?\d+)\/(-?\d+)$/)
  if (!m) throw new Error(`Invalid quantized-mesh URL: ${params.url}`)
  const [, prefix, zS, xS, yS] = m
  const z = parseInt(zS, 10), x = parseInt(xS, 10), y = parseInt(yS, 10)

  const ion = prefix.match(/^ion\/([^/]+)$/)
  let base: string, auth: string | null = null
  if (ion) {
    if (!ionAccountToken) throw new Error("Cesium ion needs an access token - Settings -> API Keys")
    const ep = await resolveIon(ion[1], ionAccountToken)
    base = ep.base
    auth = ep.token
  } else {
    base = `https://${prefix.replace(/\/$/, "")}/`
  }

  const out = mercTileBounds(z, x, y)
  const northY = lat2merc(out.north), southY = lat2merc(out.south)

  // Geographic level whose tiles are the same angular width as this Mercator
  // tile. In latitude a geographic tile is square in degrees while a Mercator
  // one is shorter, so the output usually falls inside one source tile and
  // sometimes straddles two.
  const level = Math.max(0, Math.min(DEFAULT_MAX_LEVEL, z - 1))
  const span = 360 / 2 ** (level + 1)
  const colMin = Math.floor((out.west + 180) / span)
  const colMax = Math.floor((out.east - 1e-9 + 180) / span)
  const rowMin = Math.floor((out.south + 90) / span)
  const rowMax = Math.floor((out.north - 1e-9 + 90) / span)

  const heights = new Float32Array(TILE_SIZE * TILE_SIZE)
  const filled = new Uint8Array(TILE_SIZE * TILE_SIZE)

  const jobs: { col: number; row: number }[] = []
  for (let col = colMin; col <= colMax; col++) for (let row = rowMin; row <= rowMax; row++) jobs.push({ col, row })

  const loadOne = async (col: number, row: number, retried = false): Promise<void> => {
    const url = `${base}${level}/${col}/${row}.terrain?v=1.2.0`
    let buf: ArrayBuffer | null
    try {
      buf = await fetchMesh(url, auth, abortController.signal)
    } catch (e) {
      // ion's per-session token is short-lived; re-resolve once and retry.
      if (e instanceof TokenExpired && ion && !retried) {
        const ep = await resolveIon(ion[1], ionAccountToken, true)
        base = ep.base; auth = ep.token
        return loadOne(col, row, true)
      }
      throw e
    }
    if (!buf) return
    const b = geoTileBounds(level, col, row)
    const mesh = QuantizedMeshLoader.parseSync(buf, {
      // Mapping the mesh straight onto its own geographic bounds means
      // POSITION comes back as (lon, lat, height) and the Mercator projection
      // is one cheap per-vertex step in rasterise() rather than a resample.
      "quantized-mesh": { bounds: [b.west, b.south, b.east, b.north], skirtHeight: null },
    }) as unknown as { indices: { value: ArrayLike<number> }; attributes: { POSITION: { value: Float32Array } } }
    rasterise(mesh.attributes.POSITION.value, mesh.indices.value, { west: out.west, east: out.east, northY, southY }, heights, filled)
  }

  await Promise.all(jobs.map(({ col, row }) => loadOne(col, row)))
  if (abortController.signal.aborted) throw new Error("aborted")
  if (!filled.some((v) => v)) throw new TileNotFound(params.url)

  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  for (let i = 0; i < heights.length; i++) {
    // Unwritten pixels are holes: 0 m with alpha 254, so maplibre draws flat
    // ground while this app's decoders still see them as invalid. See
    // /dev/demdiff-protocol for why transparency would dig a 10 km pit.
    const hole = filled[i] === 0
    const v = (hole ? 0 : heights[i]) + 32768
    const intPart = Math.floor(v)
    rgba[i * 4] = Math.floor(intPart / 256) & 0xff
    rgba[i * 4 + 1] = intPart & 0xff
    rgba[i * 4 + 2] = Math.floor((v - intPart) * 256) & 0xff
    rgba[i * 4 + 3] = hole ? 254 : 255
  }

  return { data: await toTileImage(rgba, TILE_SIZE, TILE_SIZE) }
}
