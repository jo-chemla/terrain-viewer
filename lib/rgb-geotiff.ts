// RGB(A) GeoTIFF for the historical batch export (lib/export-multi.ts):
// three flat 8-bit bands from lib/rgb-tile-mosaic.ts plus an optional
// alpha band, written as unassociated alpha (ExtraSamples 2), which GDAL
// and QGIS read as the transparency mask. Interleaved pixels, one strip,
// through the same writer as the DEM and layer exports (lib/float-geotiff.ts),
// so the georeferencing is the one GridGeoref of lib/output-crs.ts: an
// axis-aligned EPSG:3857 grid, or an affine fitted in another CRS, written
// as ModelTransformation when it has rotation or shear.
//
// It used to go through geotiff.js's writeArrayBuffer, whose multi-band
// writer wants data[band][row][col]; it has no ModelTransformation, and
// the app's own writer was already there.
import { writeTiff, georefTags, TIFF_TYPE } from "./float-geotiff"
import type { GridGeoref } from "./output-crs"

export async function buildRgbGeoTiff(
  r: Uint8Array, g: Uint8Array, b: Uint8Array, width: number, height: number,
  georef: GridGeoref,
  alpha?: Uint8Array,
): Promise<Blob> {
  const bands = alpha ? 4 : 3
  const n = width * height
  if (r.length !== n || g.length !== n || b.length !== n || (alpha && alpha.length !== n)) throw new Error(`buildRgbGeoTiff: band length does not match ${width}x${height}`)
  const pixels = new Uint8Array(n * bands)
  for (let i = 0, j = 0; i < n; i++, j += bands) {
    pixels[j] = r[i]
    pixels[j + 1] = g[i]
    pixels[j + 2] = b[i]
    if (alpha) pixels[j + 3] = alpha[i]
  }
  const { SHORT, LONG } = TIFF_TYPE
  const entries = [
    { tag: 256, type: LONG, values: [width] },
    { tag: 257, type: LONG, values: [height] },
    { tag: 258, type: SHORT, values: new Array(bands).fill(8) },
    { tag: 259, type: SHORT, values: [1] },                 // Compression: none
    { tag: 262, type: SHORT, values: [2] },                 // Photometric: RGB
    { tag: 273, type: LONG, values: [0] },                  // StripOffsets, filled by writeTiff
    { tag: 277, type: SHORT, values: [bands] },
    { tag: 278, type: LONG, values: [height] },             // one strip
    { tag: 279, type: LONG, values: [n * bands] },
    { tag: 284, type: SHORT, values: [1] },                 // PlanarConfiguration: chunky
    ...(alpha ? [{ tag: 338, type: SHORT, values: [2] }] : []), // ExtraSamples: unassociated alpha
    { tag: 339, type: SHORT, values: new Array(bands).fill(1) },
    ...georefTags(georef),
  ]
  return new Blob([writeTiff(entries, pixels)], { type: "image/tiff" })
}
