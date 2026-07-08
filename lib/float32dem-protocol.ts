import { fromArrayBuffer } from "geotiff"

/**
 * Ported from public/maplibre-raster-dem-wms-float32-generic.html (the IGN LidarHD
 * WMS-raw demo). Registers a `float32dem://` maplibre custom protocol: fetches a WMS
 * GetMap request that returns a raw Float32 GeoTIFF (band 0 = elevation in meters,
 * no RGB encoding), then re-encodes it in-memory as a Terrarium PNG so it can be
 * consumed directly as a `raster-dem` source (encoding: "terrarium") — skipping any
 * encode/decode round trip through byte-packed pixels, and giving far finer precision
 * for the *source* data than Terrain-RGB's fixed 0.1m step would: Terrarium's fractional
 * byte (B channel = (elevation - floor(elevation)) * 256) resolves to ~1/256m, i.e. ~4mm,
 * vs Terrain-RGB's 10cm — meaningful for LidarHD-grade data.
 *
 * URL format: float32dem://<host+path, no scheme> — the actual request is always made
 * over https. Use `{bbox-epsg-3857}` in the WMS query string; maplibre substitutes it
 * per-tile the same way it does for ordinary `type: "raster"` WMS sources.
 */
export async function float32demProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const url = "https://" + params.url.replace(/^float32dem:\/\//, "")
  const response = await fetch(url, { signal: abortController.signal })
  const arrayBuffer = await response.arrayBuffer()

  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const width = image.getWidth()
  const height = image.getHeight()
  const elevationData = rasters[0] as ArrayLike<number>

  // Encode to Terrarium (same formula as elevationToTerrarium in MapSources.tsx):
  // height = (R*256 + G + B/256) - 32768, so R/G pack the integer meters (16-bit split
  // across two bytes) and B packs the sub-meter fraction at 1/256m resolution.
  const rgbaData = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < elevationData.length; i++) {
    let elevation = elevationData[i]
    if (!isFinite(elevation)) elevation = 0
    const v = elevation + 32768
    const intPart = Math.floor(v)
    rgbaData[i * 4 + 0] = Math.floor(intPart / 256) & 0xff
    rgbaData[i * 4 + 1] = intPart & 0xff
    rgbaData[i * 4 + 2] = Math.floor((v - intPart) * 256) & 0xff
    rgbaData[i * 4 + 3] = 255
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(rgbaData, width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
