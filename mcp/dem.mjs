// Elevation tiles read in Node, without a browser: a Terrarium or
// Terrain-RGB pyramid fetched and decoded (PNG or WebP, by sharp, the
// decoder a browser has built in and Node has not). The base of the MCP
// server's elevation tools (data-tools.mjs) and of the tile service's
// direct engine (direct.mjs).
import { readFileSync } from "node:fs"
import sharp from "sharp"

const AWS_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
const MAPTERHORN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"
const UA = "terrain-viewer-mcp/0.3 (+https://terrain-viewer.iconem.com)"

let libraryCache
/** The app's terrain library, as written by build.mjs. */
export function library() {
  if (!libraryCache) libraryCache = JSON.parse(readFileSync(new URL("./generated/library.json", import.meta.url), "utf8"))
  return libraryCache
}

/** The sources read here without a browser. */
export const BUILTIN_DEMS = [
  { id: "mapterhorn", name: "Mapterhorn - Terrarium", tiles: MAPTERHORN_TILES, encoding: "terrarium", tileSize: 512, maxzoom: 17 },
  { id: "aws", name: "AWS Terrain - Terrarium Mapzen", tiles: AWS_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 15 },
]

/** A terrain source as tiles that can be decoded here, or null: a COG, WMS,
 *  VRT, LERC or mesh dataset is read by the app alone. `source` is an id, a
 *  tile address, or a configuration `{ url, type, maxzoom?, tileSize? }`
 *  with type `terrarium` or `terrainrgb`. */
export function resolveDem(source) {
  if (!source || source === "mapterhorn") return BUILTIN_DEMS[0]
  if (source === "aws") return BUILTIN_DEMS[1]
  if (typeof source === "object") {
    if (!/^https:\/\/.+\{z\}.+/.test(source.url ?? "") || !["terrarium", "terrainrgb"].includes(source.type)) return null
    return { id: source.url, tiles: source.url, encoding: source.type === "terrainrgb" ? "mapbox" : "terrarium", tileSize: source.tileSize ?? 256, maxzoom: source.maxzoom ?? 14, external: true }
  }
  const lib = library().terrain.find((s) => s.id === source)
  if (lib) return lib.tiles ? { id: lib.id, name: lib.name, tiles: lib.tiles, encoding: lib.type === "terrainrgb" ? "mapbox" : "terrarium", tileSize: 256, maxzoom: lib.maxzoom ?? 14 } : null
  if (/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(source)) return { id: source, tiles: source, encoding: "terrarium", tileSize: 256, maxzoom: 14, external: true }
  return null
}

// Decoded tiles, newest last: a Float32 grid each (NaN where there is no data).
const tiles = new Map()
const MAX_TILES = 160

/** One tile as elevations: `{ side, data: Float32Array }`, or null when the
 *  tile does not exist. */
export function loadTile(dem, z, x, y) {
  const n = 2 ** z
  if (y < 0 || y >= n || z < 0) return Promise.resolve(null)
  x = ((x % n) + n) % n
  const key = `${dem.tiles}|${z}/${x}/${y}`
  const have = tiles.get(key)
  if (have) { tiles.delete(key); tiles.set(key, have); return have }
  const promise = (async () => {
    const res = await fetch(dem.tiles.replace("{z}", z).replace("{x}", x).replace("{y}", y), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const out = new Float32Array(info.width * info.height)
    const mapbox = dem.encoding === "mapbox"
    for (let i = 0, o = 0; i < out.length; i++, o += 4) {
      const v = mapbox ? -10000 + (data[o] * 65536 + data[o + 1] * 256 + data[o + 2]) * 0.1 : data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768
      out[i] = data[o + 3] === 0 || v < -12000 ? NaN : v
    }
    return { side: info.width, data: out }
  })().catch(() => null)
  tiles.set(key, promise)
  promise.then((t) => { if (!t) tiles.delete(key) })
  while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value)
  return promise
}

/** The elevations of a rectangle of the pyramid's own pixels at zoom `z`:
 *  columns x0 .. x0+w-1 and rows y0 .. y0+h-1 of the world grid, where a
 *  tile is `side` pixels. NaN where there is no data. */
export async function window(dem, z, side, x0, y0, w, h) {
  const out = new Float32Array(w * h).fill(NaN)
  const jobs = []
  for (let ty = Math.floor(y0 / side); ty <= Math.floor((y0 + h - 1) / side); ty++) for (let tx = Math.floor(x0 / side); tx <= Math.floor((x0 + w - 1) / side); tx++) {
    jobs.push(loadTile(dem, z, tx, ty).then((t) => {
      if (!t || t.side !== side) return
      const j0 = Math.max(y0, ty * side), j1 = Math.min(y0 + h, (ty + 1) * side), i0 = Math.max(x0, tx * side), i1 = Math.min(x0 + w, (tx + 1) * side)
      for (let j = j0; j < j1; j++) out.set(t.data.subarray((j - ty * side) * side + (i0 - tx * side), (j - ty * side) * side + (i1 - tx * side)), (j - y0) * w + (i0 - x0))
    }))
  }
  await Promise.all(jobs)
  return out
}

/** The side of the pyramid's tiles, from a first tile at or above `z` over
 *  the given world position (0..1): `{ z, side }`, or null. */
export async function probe(dem, z, wx, wy) {
  for (; z >= 0; z--) {
    const n = 2 ** z
    const t = await loadTile(dem, z, Math.floor(wx * n), Math.floor(wy * n))
    if (t) return { z, side: t.side }
  }
  return null
}
