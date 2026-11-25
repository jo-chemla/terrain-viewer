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

// The bytes go into a growing Uint8Array, not a JS array a byte at a time:
// a sub-message is copied into its parent with one set() (it was a push per
// byte at every level of nesting, four levels for a vertex), a string is
// encoded in place, a double through one scratch DataView. Same bytes.
const utf8 = new TextEncoder()
const f64 = new DataView(new ArrayBuffer(8))
class Writer {
  constructor(size = 64) { this.buf = new Uint8Array(size); this.length = 0 }
  room(n) {
    if (this.length + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.length + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
  }
  varint(v) {
    v = Math.floor(v)
    if (v < 0) v = 2 ** 64 + v // only tag lengths and uints come here
    this.room(10)
    const b = this.buf
    let i = this.length
    if (v <= 0x7fffffff) {
      // Below 2^31 the integer operations give the same bytes as % and /.
      while (v >= 0x80) { b[i++] = (v & 0x7f) | 0x80; v >>>= 7 }
    } else {
      while (v >= 0x80) { b[i++] = (v % 0x80) | 0x80; v = Math.floor(v / 0x80) }
    }
    b[i++] = v
    this.length = i
  }
  tag(field, wire) { this.varint(field * 8 + wire) }
  sub(field, writer) { this.tag(field, 2); this.varint(writer.length); this.room(writer.length); this.buf.set(writer.buf.subarray(0, writer.length), this.length); this.length += writer.length }
  string(field, s) {
    s = String(s)
    this.tag(field, 2)
    // At most 3 bytes per UTF-16 unit; the length is written after.
    const max = s.length * 3
    const scratch = max <= 4096 ? STRING_SCRATCH : new Uint8Array(max)
    const n = utf8.encodeInto(s, scratch).written
    this.varint(n); this.room(n); this.buf.set(scratch.subarray(0, n), this.length); this.length += n
  }
  double(field, v) { this.tag(field, 1); f64.setFloat64(0, v, true); this.room(8); this.buf.set(new Uint8Array(f64.buffer), this.length); this.length += 8 }
  bytes() { return this.buf.subarray(0, this.length) }
}
const STRING_SCRATCH = new Uint8Array(4096)

const zigzag = (n) => (n << 1) ^ (n >> 31)

/** A feature's geometry commands, written straight into `g` as varints
 *  (`>>> 0`, as the packed field wants). Returns whether anything was
 *  written. No closure, no flattened or sliced copy of the points. */
function writeGeometry(g, type, rings) {
  let cx = 0, cy = 0
  if (type === 1) {
    let count = 0
    for (const ring of rings) count += ring.length
    if (!count) return false
    g.varint(((1 & 7) | (count << 3)) >>> 0)
    for (const ring of rings) for (const p of ring) {
      const x = Math.round(p[0]), y = Math.round(p[1])
      g.varint(zigzag(x - cx) >>> 0); g.varint(zigzag(y - cy) >>> 0); cx = x; cy = y
    }
    return true
  }
  let any = false
  for (const ring of rings) {
    // A closed polygon ring repeats its first point: MVT closes with ClosePath.
    const n = type === 3 && ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length
    if (n < (type === 3 ? 3 : 2)) continue
    any = true
    g.varint(((1 & 7) | (1 << 3)) >>> 0)
    let x = Math.round(ring[0][0]), y = Math.round(ring[0][1])
    g.varint(zigzag(x - cx) >>> 0); g.varint(zigzag(y - cy) >>> 0); cx = x; cy = y
    g.varint(((2 & 7) | ((n - 1) << 3)) >>> 0)
    for (let i = 1; i < n; i++) {
      x = Math.round(ring[i][0]); y = Math.round(ring[i][1])
      g.varint(zigzag(x - cx) >>> 0); g.varint(zigzag(y - cy) >>> 0); cx = x; cy = y
    }
    if (type === 3) g.varint(((7 & 7) | (1 << 3)) >>> 0)
  }
  return any
}

/** Layers (as readLayers gives them) as a tile's bytes. */
export function writeTile(layers) {
  const tile = new Writer(1 << 16)
  // One writer each for a feature, its tags and its geometry, emptied and
  // reused feature after feature.
  const fw = new Writer(256), t = new Writer(64), g = new Writer(1024)
  for (const layer of layers) {
    if (!layer.features.length) continue
    const w = new Writer(1 << 14)
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
      g.length = 0
      if (!writeGeometry(g, f.type, f.geometry)) continue
      fw.length = 0
      if (Number.isInteger(f.id) && f.id >= 0) { fw.tag(1, 0); fw.varint(f.id) }
      if (tags.length) { t.length = 0; for (const n of tags) t.varint(n); fw.sub(2, t) }
      fw.tag(3, 0); fw.varint(f.type)
      fw.sub(4, g)
      w.sub(2, fw)
    }
    for (const k of keys) w.string(3, k)
    const vw = new Writer(64)
    for (const v of values) {
      vw.length = 0
      if (typeof v === "string") vw.string(1, v)
      else if (typeof v === "boolean") { vw.tag(7, 0); vw.varint(v ? 1 : 0) }
      else vw.double(3, Number(v))
      w.sub(4, vw)
    }
    w.tag(5, 0); w.varint(layer.extent ?? 4096)
    tile.sub(3, w)
  }
  return Buffer.from(tile.bytes())
}
