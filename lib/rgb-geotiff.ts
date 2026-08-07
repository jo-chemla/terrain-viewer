// RGB sibling of download-section.tsx's saveElevationGeoTiff — that helper
// writes a single float32 elevation band via geotiff.js's writeArrayBuffer
// using a flat TypedArray. Multi-band (RGB) output uses a DIFFERENT calling
// convention: `data` must be an array of N nested 2D arrays, `data[band][row][col]`,
// not a flat typed array with SamplesPerPixel: 3 — confirmed by reading
// geotiff.js's own writer source. This builds that nested shape from three
// flat Uint8Array bands (see lib/rgb-tile-mosaic.ts) plus the same
// ModelPixelScale/ModelTiepoint georeferencing tags the DTM export uses.
import { writeArrayBuffer } from "geotiff"

export async function buildRgbGeoTiff(
  r: Uint8Array, g: Uint8Array, b: Uint8Array, width: number, height: number,
  bbox: { west: number; south: number; east: number; north: number },
): Promise<Blob> {
  const pixelSizeX = (bbox.east - bbox.west) / width
  const pixelSizeY = (bbox.north - bbox.south) / height

  // geotiff.js's multi-band writer wants data[band][row][col] — a plain
  // typed-array band still works as the innermost "row" if pre-sliced per
  // row, so this builds one Array<Uint8Array> (one entry per row) per band
  // rather than a fully-nested plain-Array-of-Array-of-number, which would
  // be far more allocation for the same result.
  const toRows = (band: Uint8Array): Uint8Array[] => {
    const rows: Uint8Array[] = new Array(height)
    for (let row = 0; row < height; row++) {
      rows[row] = band.subarray(row * width, (row + 1) * width)
    }
    return rows
  }

  const metadata = {
    GTModelTypeGeoKey: 2,
    GeographicTypeGeoKey: 4326,
    GeogCitationGeoKey: "WGS 84",
    height,
    width,
    ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
    ModelTiepoint: [0, 0, 0, bbox.west, bbox.north, 0],
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    SampleFormat: [1, 1, 1],
    PlanarConfiguration: 1,
    // 2 = RGB (vs. 1 = BlackIsZero, used for the single-band DTM export).
    PhotometricInterpretation: 2,
  }

  const outputArrayBuffer = await writeArrayBuffer(
    [toRows(r), toRows(g), toRows(b)] as unknown as any[],
    metadata,
  )
  return new Blob([outputArrayBuffer], { type: "image/tiff" })
}
