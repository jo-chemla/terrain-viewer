// GeoTIFF encoders for exports: single-band float32 values in EPSG:4326, and
// 8-bit RGBA renders in EPSG:3857. Uncompressed, one strip, little-endian.
//
// Why not geotiff.js's writeArrayBuffer: its encoder copies the values into
// a Uint8Array whatever BitsPerSample says, so a float32 raster came out as
// one byte per pixel with a header promising four. GDAL refused the file
// ("TIFFReadEncodedStrip ... expected 8192, got 4096"), and every DEM
// GeoTIFF the app exported until 2026-09-25 was unreadable. It is fine for
// 8-bit RGB (lib/rgb-geotiff.ts still uses it).

export interface GeoBbox { west: number; south: number; east: number; north: number }

const SHORT = 3, LONG = 4, ASCII = 2, DOUBLE = 12
const TYPE_SIZE: Record<number, number> = { [SHORT]: 2, [LONG]: 4, [ASCII]: 1, [DOUBLE]: 8 }

type Entry = { tag: number; type: number; values: number[] | string }

/** Lays out header, one IFD, out-of-line tag values, then the pixel bytes.
 *  `entries` must be sorted by tag and include StripOffsets (273), whose
 *  value is filled in here. */
function writeTiff(entries: Entry[], pixels: Uint8Array): ArrayBuffer {
  const ifdOffset = 8
  const ifdSize = 2 + entries.length * 12 + 4
  const count = (e: Entry) => e.values.length
  const byteLength = (e: Entry) => count(e) * TYPE_SIZE[e.type]

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

  const buffer = new ArrayBuffer(pixelOffset + pixels.byteLength)
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
    view.setUint16(at, e.tag, true)
    view.setUint16(at + 2, e.type, true)
    view.setUint32(at + 4, count(e), true)
    const offset = outOfLine.get(e)
    if (offset != null) { view.setUint32(at + 8, offset, true); writeValues(e, offset) }
    else writeValues(e, at + 8)
  })
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true) // no next IFD

  new Uint8Array(buffer, pixelOffset, pixels.byteLength).set(pixels)
  return buffer
}

const georef = (bbox: GeoBbox, width: number, height: number): Entry[] => [
  { tag: 33550, type: DOUBLE, values: [(bbox.east - bbox.west) / width, (bbox.north - bbox.south) / height, 0] }, // ModelPixelScale
  { tag: 33922, type: DOUBLE, values: [0, 0, 0, bbox.west, bbox.north, 0] },                                   // ModelTiepoint
]

/** Single band float32, NaN = nodata. EPSG:3857 (bbox in Web Mercator
 *  metres, the grid of the tiles and of every export in the app) or
 *  EPSG:4326 (bbox in degrees, the titiler DEM path). */
export function encodeFloat32GeoTiff(data: Float32Array, width: number, height: number, bbox: GeoBbox, epsg: 3857 | 4326 = 4326): ArrayBuffer {
  if (data.length !== width * height) throw new Error(`encodeFloat32GeoTiff: ${data.length} values for ${width}x${height}`)
  return writeTiff([
    { tag: 256, type: LONG, values: [width] },            // ImageWidth
    { tag: 257, type: LONG, values: [height] },           // ImageLength
    { tag: 258, type: SHORT, values: [32] },              // BitsPerSample
    { tag: 259, type: SHORT, values: [1] },               // Compression: none
    { tag: 262, type: SHORT, values: [1] },               // Photometric: BlackIsZero
    { tag: 273, type: LONG, values: [0] },                // StripOffsets
    { tag: 277, type: SHORT, values: [1] },               // SamplesPerPixel
    { tag: 278, type: LONG, values: [height] },           // RowsPerStrip: one strip
    { tag: 279, type: LONG, values: [width * height * 4] }, // StripByteCounts
    { tag: 284, type: SHORT, values: [1] },               // PlanarConfiguration
    { tag: 339, type: SHORT, values: [3] },               // SampleFormat: IEEE float
    ...georef(bbox, width, height),
    // GeoKeyDirectory, pixel is area: projected EPSG:3857 or geographic 4326.
    { tag: 34735, type: SHORT, values: epsg === 3857
      ? [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857]
      : [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326] },
    { tag: 42113, type: ASCII, values: "nan\0" },         // GDAL_NODATA
  ], new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
}

/** 8-bit RGBA with alpha as a real band, so transparent areas stay
 *  transparent in GIS. EPSG:3857 (bbox in Web Mercator metres) for renders
 *  of the canvas, EPSG:4326 (degrees) for colour-mapped values. */
export function encodeRgbaGeoTiff(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, bbox: GeoBbox, epsg: 3857 | 4326 = 3857): ArrayBuffer {
  if (rgba.length !== width * height * 4) throw new Error(`encodeRgbaGeoTiff: ${rgba.length} bytes for ${width}x${height} RGBA`)
  return writeTiff([
    { tag: 256, type: LONG, values: [width] },
    { tag: 257, type: LONG, values: [height] },
    { tag: 258, type: SHORT, values: [8, 8, 8, 8] },
    { tag: 259, type: SHORT, values: [1] },
    { tag: 262, type: SHORT, values: [2] },               // Photometric: RGB
    { tag: 273, type: LONG, values: [0] },
    { tag: 277, type: SHORT, values: [4] },
    { tag: 278, type: LONG, values: [height] },
    { tag: 279, type: LONG, values: [width * height * 4] },
    { tag: 284, type: SHORT, values: [1] },
    { tag: 338, type: SHORT, values: [2] },               // ExtraSamples: unassociated alpha
    { tag: 339, type: SHORT, values: [1, 1, 1, 1] },      // SampleFormat: unsigned
    ...georef(bbox, width, height),
    // GeoKeyDirectory, pixel is area: projected EPSG:3857 or geographic 4326.
    { tag: 34735, type: SHORT, values: epsg === 3857
      ? [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857]
      : [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326] },
  ], new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength))
}

/** Image + world file + .prj for RGBA outputs, for tools that prefer them
 *  to a GeoTIFF. The world file holds the pixel size and the centre of the
 *  top-left pixel; JPEG has no alpha, so transparent pixels become white. */
export async function encodeImageWithWorldFile(
  rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, bbox: GeoBbox, epsg: 3857 | 4326, format: "png" | "jpeg",
): Promise<{ image: Blob; worldFile: string; prj: string }> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  if (format === "jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height) }
  const img = new ImageData(new Uint8ClampedArray(rgba), width, height)
  if (format === "jpeg") {
    const tmp = document.createElement("canvas")
    tmp.width = width; tmp.height = height
    tmp.getContext("2d")!.putImageData(img, 0, 0)
    ctx.drawImage(tmp, 0, 0)
  } else ctx.putImageData(img, 0, 0)
  const image = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image encoding failed"))), format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.95 : undefined))
  const px = (bbox.east - bbox.west) / width
  const py = (bbox.north - bbox.south) / height
  const worldFile = [px, 0, 0, -py, bbox.west + px / 2, bbox.north - py / 2].map((v) => v.toFixed(12)).join("\n")
  return { image, worldFile, prj: epsg === 3857 ? WKT_3857 : WKT_4326 }
}

const WKT_4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
const WKT_3857 = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]'

const R = 6378137
/** A lon/lat bbox as Web Mercator metres, for the EPSG:3857 writers. */
export function toMercatorBbox(b: GeoBbox): GeoBbox {
  const x = (lon: number) => (R * lon * Math.PI) / 180
  const y = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return { west: x(b.west), south: y(b.south), east: x(b.east), north: y(b.north) }
}
