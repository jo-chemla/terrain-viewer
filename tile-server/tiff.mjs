// A one-band Float32 GeoTIFF in EPSG:3857, deflate-compressed with the
// floating-point predictor (TIFF Technical Note 3, GDAL's PREDICTOR=3), what
// the values endpoints serve. geotiff.js writes uncompressed files only; this
// is the small subset of TIFF they need, with Node's zlib.
//
// Layout: header, image data in strips (each about 64 KB before compression,
// so a reader can take a window without inflating the whole image), then the
// IFD and the arrays its tags point to.

import { deflateSync } from "node:zlib"

const SHORT = 3, LONG = 4, DOUBLE = 12, ASCII = 2

/** Predictor 3 on one row: the bytes of each float split into planes, most
 *  significant first, then each byte minus the one before it. */
function predictRow(src, width, dst) {
  const bytes = new Uint8Array(src.buffer, src.byteOffset, width * 4) // little endian
  for (let i = 0; i < width; i++) {
    dst[i] = bytes[i * 4 + 3]; dst[width + i] = bytes[i * 4 + 2]
    dst[2 * width + i] = bytes[i * 4 + 1]; dst[3 * width + i] = bytes[i * 4]
  }
  for (let i = width * 4 - 1; i > 0; i--) dst[i] = (dst[i] - dst[i - 1]) & 255
}

/**
 * @param {Float32Array} values row by row, NaN where there is no data
 * @param {{ width: number, height: number, pixelSize: number, west: number, north: number, compress?: boolean, level?: number }} o
 *   pixelSize in metres, west and north the top-left corner in EPSG:3857 metres
 */
export function float32GeoTiff(values, { width, height, pixelSize, west, north, compress = true, level = 6 }) {
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(65536 / (width * 4))))
  const strips = []
  const row = new Uint8Array(width * 4)
  for (let r0 = 0; r0 < height; r0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - r0)
    if (!compress) { strips.push(Buffer.from(values.buffer, values.byteOffset + r0 * width * 4, rows * width * 4)); continue }
    const raw = Buffer.alloc(rows * width * 4)
    for (let r = 0; r < rows; r++) {
      predictRow(values.subarray((r0 + r) * width, (r0 + r + 1) * width), width, row)
      raw.set(row, r * width * 4)
    }
    strips.push(deflateSync(raw, { level }))
  }

  // GeoKeys: version 1.1.0, then GTModelType projected, GTRasterType
  // PixelIsArea, ProjectedCSType 3857.
  const geoKeys = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857]
  const tags = [
    [256, LONG, [width]], [257, LONG, [height]], [258, SHORT, [32]], [259, SHORT, [compress ? 8 : 1]],
    [262, SHORT, [1]], [273, LONG, null /* offsets, below */], [277, SHORT, [1]], [278, LONG, [rowsPerStrip]],
    [279, LONG, strips.map((s) => s.length)], [284, SHORT, [1]],
    ...(compress ? [[317, SHORT, [3]]] : []),
    [339, SHORT, [3]],
    [33550, DOUBLE, [pixelSize, pixelSize, 0]], [33922, DOUBLE, [0, 0, 0, west, north, 0]],
    [34735, SHORT, geoKeys], [42113, ASCII, "nan\0"],
  ]
  const size = { [SHORT]: 2, [LONG]: 4, [DOUBLE]: 8, [ASCII]: 1 }
  const count = (t) => (t[2] ?? strips).length

  const dataLength = strips.reduce((a, s) => a + s.length, 0)
  const ifdAt = 8 + dataLength + (dataLength & 1)
  const ifdLength = 2 + tags.length * 12 + 4
  let extraAt = ifdAt + ifdLength
  const extras = tags.map((t) => {
    const n = count(t) * size[t[1]]
    if (n <= 4) return null
    const at = extraAt; extraAt += n + (n & 1); return at
  })
  const out = Buffer.alloc(extraAt)
  out.write("II", 0, "ascii"); out.writeUInt16LE(42, 2); out.writeUInt32LE(ifdAt, 4)
  const offsets = []
  let p = 8
  for (const s of strips) { offsets.push(p); s.copy(out, p); p += s.length }
  tags[5][2] = offsets

  out.writeUInt16LE(tags.length, ifdAt)
  tags.forEach((t, k) => {
    const [tag, type, v] = t, e = ifdAt + 2 + k * 12
    out.writeUInt16LE(tag, e); out.writeUInt16LE(type, e + 2); out.writeUInt32LE(v.length, e + 4)
    let w = extras[k] ?? e + 8
    if (type === ASCII) { out.write(v, w, "latin1"); w += v.length }
    else for (const x of v) {
      if (type === SHORT) { out.writeUInt16LE(x, w); w += 2 }
      else if (type === LONG) { out.writeUInt32LE(x, w); w += 4 }
      else { out.writeDoubleLE(x, w); w += 8 }
    }
    if (extras[k] != null) out.writeUInt32LE(extras[k], e + 8)
  })
  out.writeUInt32LE(0, ifdAt + 2 + tags.length * 12) // no next IFD
  return out
}
