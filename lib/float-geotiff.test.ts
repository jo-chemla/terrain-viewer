// Run with: node scripts/test-lib.mjs lib/float-geotiff.test.ts
//
// Offline: the GeoTIFFs our own writer (lib/float-geotiff.ts) produces must
// decode with the geotiff.js the app ships (3.x since 2026-11-25), through the
// same path as the float32dem protocol (readRastersSparse) and the download
// read-back (fromArrayBuffer -> getImage -> readRasters).
import test from "node:test"
import assert from "node:assert/strict"
import { fromArrayBuffer } from "geotiff"
import { encodeFloat32GeoTiff, encodeRgbaGeoTiff, writeTiff, TIFF_TYPE } from "./float-geotiff.ts"
import { readRastersSparse } from "./float32dem-protocol.ts"

const { SHORT, LONG, ASCII } = TIFF_TYPE

test("a Float32 GeoTIFF written by float-geotiff decodes: values, NaN, bbox, nodata", async () => {
  const w = 4, h = 3
  const data = new Float32Array(w * h).map((_, i) => i * 1.5 - 2)
  data[5] = NaN
  const bbox = [2, 48, 2.4, 48.3]
  const tiff = await fromArrayBuffer(encodeFloat32GeoTiff(data, w, h, { west: 2, south: 48, east: 2.4, north: 48.3 }, 4326))
  const image = await tiff.getImage()
  assert.equal(image.getWidth(), w)
  assert.equal(image.getHeight(), h)
  assert.equal(image.getSampleFormat(), 3)
  assert.ok(Number.isNaN(image.getGDALNoData()))
  const got = image.getBoundingBox()
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(got[i] - bbox[i]) < 1e-9, `bbox[${i}] ${got[i]} vs ${bbox[i]}`)
  assert.equal(image.getGeoKeys()?.GeographicTypeGeoKey, 4326)

  const rasters = await readRastersSparse(image)
  const band = (rasters as unknown as Float32Array[])[0]
  assert.ok(band instanceof Float32Array)
  assert.equal(band.length, w * h)
  for (let i = 0; i < band.length; i++) {
    if (i === 5) assert.ok(Number.isNaN(band[i]))
    else assert.equal(band[i], data[i])
  }
})

test("an RGBA GeoTIFF written by float-geotiff reads back four bands (download read-back path)", async () => {
  const w = 2, h = 2
  const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 128, 1, 2, 3, 4])
  const tiff = await fromArrayBuffer(encodeRgbaGeoTiff(rgba, w, h, { west: 0, south: 0, east: 100, north: 100 }, 3857))
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  assert.equal(rasters.length, 4)
  for (let b = 0; b < 4; b++) {
    assert.deepEqual(Array.from(rasters[b] as Uint8Array), [0, 1, 2, 3].map((p) => rgba[p * 4 + b]))
  }
  assert.equal(image.getGeoKeys()?.ProjectedCSTypeGeoKey, 3857)
})

test("a sparse strip (offset = byte count = 0) reads as NaN, not as 0 m", async () => {
  // Two one-row strips, the second one absent — the ArcGIS SPARSE_OK layout.
  // geotiff 3 synthesises such blocks itself but fills them with
  // GDAL_NODATA || 0, i.e. 0 for "nan"; readRastersSparse must keep NaN.
  const w = 3
  const row = new Float32Array([1, 2, 3])
  const entries = [
    { tag: 256, type: LONG, values: [w] },
    { tag: 257, type: LONG, values: [2] },
    { tag: 258, type: SHORT, values: [32] },
    { tag: 259, type: SHORT, values: [1] },
    { tag: 262, type: SHORT, values: [1] },
    { tag: 273, type: LONG, values: [0] },
    { tag: 277, type: SHORT, values: [1] },
    { tag: 278, type: LONG, values: [1] },
    { tag: 279, type: LONG, values: [w * 4] },
    { tag: 284, type: SHORT, values: [1] },
    { tag: 339, type: SHORT, values: [3] },
    { tag: 42113, type: ASCII, values: "nan\0" },
  ]
  const buf = writeTiff(entries, new Uint8Array(row.buffer))
  // writeTiff writes one strip; rewrite StripOffsets / StripByteCounts as two
  // inline SHORTs each: [first, 0].
  const view = new DataView(buf)
  const entryAt = (tag: number) => 8 + 2 + entries.findIndex((e) => e.tag === tag) * 12
  const patch = (tag: number, first: number) => {
    const at = entryAt(tag)
    view.setUint16(at + 2, SHORT, true)
    view.setUint32(at + 4, 2, true)
    view.setUint16(at + 8, first, true)
    view.setUint16(at + 10, 0, true)
  }
  patch(273, view.getUint32(entryAt(273) + 8, true))
  patch(279, w * 4)

  const image = await (await fromArrayBuffer(buf)).getImage()
  const band = (await readRastersSparse(image) as unknown as Float32Array[])[0]
  assert.deepEqual(Array.from(band.slice(0, 3)), [1, 2, 3])
  for (let i = 3; i < 6; i++) assert.ok(Number.isNaN(band[i]), `pixel ${i} = ${band[i]}`)
})
