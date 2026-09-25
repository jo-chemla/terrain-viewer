// A single-band float32 GeoTIFF encoder, uncompressed, one strip, EPSG:4326.
//
// Why not geotiff.js's writeArrayBuffer: its encoder copies the values into
// a Uint8Array whatever BitsPerSample says, so a float32 raster came out as
// one byte per pixel with a header promising four. GDAL refuses the file
// ("TIFFReadEncodedStrip ... expected 8192, got 4096"), and every DEM
// GeoTIFF the app exported until 2026-09-25 was unreadable. It is fine for
// 8-bit RGB (lib/rgb-geotiff.ts still uses it); floats come through here.
//
// Layout: 8-byte header, one IFD, the out-of-line tag values, then the
// pixels. Little-endian. NaN marks nodata (GDAL_NODATA "nan").

export interface GeoBbox { west: number; south: number; east: number; north: number }

const SHORT = 3, LONG = 4, ASCII = 2, DOUBLE = 12
const TYPE_SIZE: Record<number, number> = { [SHORT]: 2, [LONG]: 4, [ASCII]: 1, [DOUBLE]: 8 }

type Entry = { tag: number; type: number; values: number[] | string }

export function encodeFloat32GeoTiff(data: Float32Array, width: number, height: number, bbox: GeoBbox): ArrayBuffer {
  if (data.length !== width * height) throw new Error(`encodeFloat32GeoTiff: ${data.length} values for ${width}x${height}`)
  const pixelX = (bbox.east - bbox.west) / width
  const pixelY = (bbox.north - bbox.south) / height
  const pixelBytes = width * height * 4

  const entries: Entry[] = [
    { tag: 256, type: LONG, values: [width] },            // ImageWidth
    { tag: 257, type: LONG, values: [height] },           // ImageLength
    { tag: 258, type: SHORT, values: [32] },              // BitsPerSample
    { tag: 259, type: SHORT, values: [1] },               // Compression: none
    { tag: 262, type: SHORT, values: [1] },               // Photometric: BlackIsZero
    { tag: 273, type: LONG, values: [0] },                // StripOffsets, patched below
    { tag: 277, type: SHORT, values: [1] },               // SamplesPerPixel
    { tag: 278, type: LONG, values: [height] },           // RowsPerStrip: one strip
    { tag: 279, type: LONG, values: [pixelBytes] },       // StripByteCounts
    { tag: 284, type: SHORT, values: [1] },               // PlanarConfiguration
    { tag: 339, type: SHORT, values: [3] },               // SampleFormat: IEEE float
    { tag: 33550, type: DOUBLE, values: [pixelX, pixelY, 0] },                 // ModelPixelScale
    { tag: 33922, type: DOUBLE, values: [0, 0, 0, bbox.west, bbox.north, 0] }, // ModelTiepoint
    // GeoKeyDirectory: version 1.1.0, 3 keys - geographic model, pixel is
    // area, EPSG:4326.
    { tag: 34735, type: SHORT, values: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326] },
    { tag: 42113, type: ASCII, values: "nan\0" },         // GDAL_NODATA
  ]

  const ifdOffset = 8
  const ifdSize = 2 + entries.length * 12 + 4
  const byteLength = (e: Entry) => (typeof e.values === "string" ? e.values.length : e.values.length) * TYPE_SIZE[e.type]

  // Out-of-line values follow the IFD, each on an even offset.
  let cursor = ifdOffset + ifdSize
  const outOfLine = new Map<Entry, number>()
  for (const e of entries) {
    if (byteLength(e) > 4) {
      cursor += cursor % 2
      outOfLine.set(e, cursor)
      cursor += byteLength(e)
    }
  }
  cursor += (4 - (cursor % 4)) % 4
  const pixelOffset = cursor
  entries.find((e) => e.tag === 273)!.values = [pixelOffset]

  const buffer = new ArrayBuffer(pixelOffset + pixelBytes)
  const view = new DataView(buffer)
  view.setUint8(0, 0x49); view.setUint8(1, 0x49) // "II": little-endian
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)

  const writeValues = (e: Entry, at: number) => {
    if (typeof e.values === "string") {
      for (let i = 0; i < e.values.length; i++) view.setUint8(at + i, e.values.charCodeAt(i))
      return
    }
    e.values.forEach((v, i) => {
      if (e.type === SHORT) view.setUint16(at + i * 2, v, true)
      else if (e.type === LONG) view.setUint32(at + i * 4, v, true)
      else view.setFloat64(at + i * 8, v, true)
    })
  }

  view.setUint16(ifdOffset, entries.length, true)
  entries.forEach((e, i) => {
    const at = ifdOffset + 2 + i * 12
    const count = typeof e.values === "string" ? e.values.length : e.values.length
    view.setUint16(at, e.tag, true)
    view.setUint16(at + 2, e.type, true)
    view.setUint32(at + 4, count, true)
    const offset = outOfLine.get(e)
    if (offset != null) { view.setUint32(at + 8, offset, true); writeValues(e, offset) }
    else writeValues(e, at + 8)
  })
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true) // no next IFD

  new Float32Array(buffer, pixelOffset, width * height).set(data)
  return buffer
}
