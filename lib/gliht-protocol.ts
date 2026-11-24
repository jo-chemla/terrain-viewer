// `gliht://<campaign>/{z}/{x}/{y}[?cells=1][&dem=lo,hi]`: NASA G-LiHT's DTM
// KMZs as Web Mercator tiles, read in the browser (lib/gliht-kmz.ts does the
// reading and warping; this file is the MapLibre side).
//
// Without `dem` the tile is the KMZ's own grey picture of the elevation, for
// a raster overlay (role "overlay", type "tms"). With `dem=lo,hi` (the
// stretch measured against the campaign's GeoTIFF, see g-liht.mdx) it is a
// Terrarium-encoded elevation tile for a raster-dem source (type
// "terrarium"); off the swath alpha is 254 at height `lo`, the app's nodata
// convention (float32dem, COG).
//
// glihtdata.gsfc.nasa.gov sends no CORS header, so where the KMZs are read
// from is a local setting (Settings > Sources: "G-LiHT address",
// glihtBaseUrlAtom): empty for the host itself (a CORS-unblocking browser
// extension needed), the tile service's `<server>/proxy/gliht`, or any CORS
// proxy as a `{url}` template. It is read from storage on every tile, so a
// change applies to the next tiles without a reload.
import { GLIHT_ORIGIN, parseGlihtUrl, readGreyTile, greyToMetres, type Env } from "./gliht-kmz"
import { toTileImage, type TileImage } from "./tile-image"
import { pixelView, writeTerrariumPx } from "./elevation-encoding"

export const GLIHT_BASE_URL_KEY = "glihtBaseUrl"

export function glihtBaseUrl(): string {
  try {
    const raw = localStorage.getItem(GLIHT_BASE_URL_KEY)
    const v = raw ? JSON.parse(raw) : ""
    return typeof v === "string" ? v : ""
  } catch { return "" }
}

async function decodePng(bytes: Uint8Array) {
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
}

const SIZE = 256
let warned = false

export async function glihtProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: TileImage }> {
  const t = parseGlihtUrl(params.url)
  if (!t) throw new Error(`gliht: cannot read ${params.url}`)
  const base = glihtBaseUrl()
  const env: Env = { fetch: (u, init) => fetch(u, init), decodePng, signal: abortController.signal }
  let grey: Float32Array | null
  try {
    grey = await readGreyTile(env, t.campaign, base, t.z, t.x, t.y, SIZE)
  } catch (e) {
    // A refused cross-origin read is a TypeError with no status: say what to do once.
    if (!warned && e instanceof TypeError && !base) {
      warned = true
      console.warn(`[gliht] ${GLIHT_ORIGIN} sends no CORS header: turn on a CORS-unblocking browser extension, or set Settings > G-LiHT address to a proxy (the tile service's <server>/proxy/gliht).`)
    }
    throw e
  }
  const px = new Uint8ClampedArray(SIZE * SIZE * 4)
  if (t.dem) {
    const [lo] = t.dem
    const px32 = pixelView(px)
    for (let i = 0; i < SIZE * SIZE; i++) {
      const g = grey ? grey[i] : NaN
      writeTerrariumPx(px, px32, i, Number.isNaN(g) ? lo : greyToMetres(g, t.dem), Number.isNaN(g) ? 254 : 255)
    }
  } else if (grey) {
    for (let i = 0; i < SIZE * SIZE; i++) {
      const g = grey[i]
      if (Number.isNaN(g)) continue
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = g
      px[i * 4 + 3] = 255
    }
  }
  return { data: await toTileImage(px, SIZE, SIZE) }
}
