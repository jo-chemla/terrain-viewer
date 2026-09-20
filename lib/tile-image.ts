/**
 * The last step of every raster protocol in this app: hand finished RGBA
 * pixels back to maplibre.
 *
 * The obvious way - draw to an OffscreenCanvas and `convertToBlob({type:
 * "image/png"})` - is what all of them used to do, and it is by far the most
 * expensive thing they do. Measured over 15 runs on a 256x256 tile:
 *
 *   convertToBlob -> PNG      median 99 ms, and about half the runs ~1000 ms
 *   createImageBitmap         median 0.1 ms
 *
 * Three orders of magnitude, and the PNG is then immediately decoded again:
 * maplibre's own image path calls `arrayBufferToImageBitmap` on whatever a
 * protocol returns. So the encode existed only to be undone.
 *
 * maplibre supports skipping both halves. Its image request explicitly checks
 * for a bitmap before falling back to decoding bytes:
 *
 *     if (response.data instanceof HTMLImageElement || isImageBitmap(response.data)) {
 *         // User using addProtocol can directly return HTMLImageElement/ImageBitmap type
 *         onSuccess(response);
 *     }
 *
 * (maplibre-gl 5.24, `doImageRequest`.)
 *
 * The PNG path is kept as a fallback for any environment without
 * `createImageBitmap` - it is universal in browsers that can run this app, but
 * the fallback costs one branch and keeps the protocols working under a test
 * runner that stubs it out.
 */
export type TileImage = ImageBitmap | Uint8Array

export async function toTileImage(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height = width): Promise<TileImage> {
  const imageData = new ImageData(pixels, width, height)
  if (typeof createImageBitmap === "function") return createImageBitmap(imageData)
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext("2d")!.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return new Uint8Array(await blob.arrayBuffer())
}
