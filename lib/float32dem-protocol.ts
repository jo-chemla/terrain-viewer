import { fromArrayBuffer } from "geotiff"

/**
 * Ported from public/maplibre-raster-dem-wms-float32-generic.html (the IGN LidarHD
 * WMS-raw demo). Registers a `float32dem://` maplibre custom protocol: fetches a WMS
 * GetMap request that returns a raw Float32 GeoTIFF (band 0 = elevation in meters,
 * no RGB encoding), then re-encodes it in-memory as a Mapbox Terrain-RGB PNG so it can
 * be consumed directly as a `raster-dem` source — skipping any encode/decode round trip
 * through byte-packed pixels, and giving true float precision instead of the ~0.1m step
 * that Terrain-RGB itself would otherwise introduce for the *source* data.
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

  // Encode to Mapbox Terrain-RGB (same packing MapSources.tsx/download-section.tsx decode elsewhere).
  const rgbaData = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < elevationData.length; i++) {
    let elevation = elevationData[i]
    if (!isFinite(elevation)) elevation = 0
    const encodedValue = Math.round((elevation + 10000) / 0.1)
    rgbaData[i * 4 + 0] = Math.floor(encodedValue / 65536) & 0xff
    rgbaData[i * 4 + 1] = Math.floor(encodedValue / 256) & 0xff
    rgbaData[i * 4 + 2] = encodedValue & 0xff
    rgbaData[i * 4 + 3] = 255
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(rgbaData, width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
