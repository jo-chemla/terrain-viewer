// Mapbox Vector Tiles, read and written: a .pbf tile of the tile service
// puts the layers of several sources in one tile (contours,
// iso-line, mound detector, graticule), renames the ones that share a name,
// and serves a layer past its last zoom from its deepest tile, scaled up as
// MapLibre overzooms it.
import { VectorTile } from "@mapbox/vector-tile"
import { PbfReader } from "pbf"

/** A tile's layers as plain objects: `{ name, extent, features: [{ id?,
 *  type (1 point, 2 line, 3 polygon), properties, geometry: [[[x, y]...]...] }] }`. */
export function readLayers(bytes) {
  const vt = new VectorTile(new PbfReader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
  return Object.entries(vt.layers).map(([name, layer]) => {
    const features = []
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      features.push({ id: f.id, type: f.type, properties: f.properties, geometry: f.loadGeometry().map((ring) => ring.map((p) => [p.x, p.y])) })
    }
    return { name, extent: layer.extent, features }
  })
}

/** The layers of tile z/x/y read from its ancestor `dz` levels up: the
 *  geometry scaled by 2^dz around this tile's corner. Features that miss
 *  the tile (with `buffer` units around it) are dropped; the rest keep
 *  their full geometry, which a renderer clips. */
export function overzoom(layers, dz, x, y, buffer = 256) {
  if (!dz) return layers
  const k = 2 ** dz
  return layers.map((layer) => {
    const E = layer.extent, ox = (x % k) * E, oy = (y % k) * E
    const features = []
    for (const f of layer.features) {
      const geometry = f.geometry.map((ring) => ring.map(([px, py]) => [px * k - ox, py * k - oy]))
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const ring of geometry) for (const [px, py] of ring) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py }
      if (x1 < -buffer || y1 < -buffer || x0 > E + buffer || y0 > E + buffer) continue
      features.push({ ...f, geometry })
    }
    return { ...layer, features }
  })
}

// ── Writing ──────────────────────────────────────────────────────────────

class Writer {
  constructor() { this.bytes = []; }
  varint(v) {
    v = Math.floor(v)
    if (v < 0) v = 2 ** 64 + v // only tag lengths and uints come here
    while (v >= 0x80) { this.bytes.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80) }
    this.bytes.push(v)
  }
  tag(field, wire) { this.varint(field * 8 + wire) }
  sub(field, writer) { this.tag(field, 2); this.varint(writer.bytes.length); for (const b of writer.bytes) this.bytes.push(b) }
  string(field, s) { const b = Buffer.from(String(s), "utf8"); this.tag(field, 2); this.varint(b.length); for (const c of b) this.bytes.push(c) }
  double(field, v) { this.tag(field, 1); const b = Buffer.alloc(8); b.writeDoubleLE(v); for (const c of b) this.bytes.push(c) }
}

const zigzag = (n) => (n << 1) ^ (n >> 31)

function geometryOf(type, rings) {
  const out = []
  let cx = 0, cy = 0
  const cmd = (id, count) => out.push((id & 7) | (count << 3))
  const move = (p) => { const x = Math.round(p[0]), y = Math.round(p[1]); out.push(zigzag(x - cx), zigzag(y - cy)); cx = x; cy = y }
  if (type === 1) {
    const pts = rings.flat()
    if (!pts.length) return out
    cmd(1, pts.length)
    for (const p of pts) move(p)
    return out
  }
  for (const ring of rings) {
    const pts = type === 3 && ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
    if (pts.length < (type === 3 ? 3 : 2)) continue
    cmd(1, 1); move(pts[0])
    cmd(2, pts.length - 1)
    for (let i = 1; i < pts.length; i++) move(pts[i])
    if (type === 3) cmd(7, 1)
  }
  return out
}

/** Layers (as readLayers gives them) as a tile's bytes. */
export function writeTile(layers) {
  const tile = new Writer()
  for (const layer of layers) {
    if (!layer.features.length) continue
    const w = new Writer()
    w.tag(15, 0); w.varint(2) // version
    w.string(1, layer.name)
    const keys = [], keyIndex = new Map(), values = [], valueIndex = new Map()
    for (const f of layer.features) {
      const tags = []
      for (const [k, v] of Object.entries(f.properties ?? {})) {
        if (v === undefined || v === null) continue
        if (!keyIndex.has(k)) { keyIndex.set(k, keys.length); keys.push(k) }
        const vk = `${typeof v}:${v}`
        if (!valueIndex.has(vk)) { valueIndex.set(vk, values.length); values.push(v) }
        tags.push(keyIndex.get(k), valueIndex.get(vk))
      }
      const geometry = geometryOf(f.type, f.geometry)
      if (!geometry.length) continue
      const fw = new Writer()
      if (Number.isInteger(f.id) && f.id >= 0) { fw.tag(1, 0); fw.varint(f.id) }
      if (tags.length) { const t = new Writer(); for (const n of tags) t.varint(n); fw.sub(2, t) }
      fw.tag(3, 0); fw.varint(f.type)
      const g = new Writer(); for (const n of geometry) g.varint(n >>> 0); fw.sub(4, g)
      w.sub(2, fw)
    }
    for (const k of keys) w.string(3, k)
    for (const v of values) {
      const vw = new Writer()
      if (typeof v === "string") vw.string(1, v)
      else if (typeof v === "boolean") { vw.tag(7, 0); vw.varint(v ? 1 : 0) }
      else vw.double(3, Number(v))
      w.sub(4, vw)
    }
    w.tag(5, 0); w.varint(layer.extent ?? 4096)
    tile.sub(3, w)
  }
  return Buffer.from(tile.bytes)
}
