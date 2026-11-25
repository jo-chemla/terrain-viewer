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
// from is a local setting (Settings > API Keys: "G-LiHT proxy",
// glihtBaseUrlAtom): by default the local tile service's proxy
// (GLIHT_DEFAULT_BASE, http://localhost:3400/proxy/gliht; an https page may
// fetch http://localhost, a potentially trustworthy origin), empty for the
// host itself (a CORS-unblocking browser extension needed), or any CORS
// proxy as a `{url}` template. It is read from storage on every tile, so a
// change applies to the next tiles without a reload.
//
// When the proxy does not answer (tile service not started, local network
// access refused), a toast says so once and the tiles are read from NASA's
// host directly for 30 s before the proxy is tried again: with a
// CORS-unblocking extension the map still fills; without one a second toast
// says what to do. Never silent empty tiles.
import { pushToast } from "@/components/ui/toast"
import { GLIHT_ORIGIN, GLIHT_DEFAULT_BASE, parseGlihtUrl, readGreyTile, greyToMetres, type Env } from "./gliht-kmz"
import { toTileImage, type TileImage } from "./tile-image"
import { pixelView, writeTerrariumPx } from "./elevation-encoding"

export const GLIHT_BASE_URL_KEY = "glihtBaseUrl"

/** The setting as stored; never set: the default proxy. An empty string
 *  stored (the field cleared) means NASA's host itself. */
export function glihtBaseUrl(): string {
  try {
    const raw = localStorage.getItem(GLIHT_BASE_URL_KEY)
    if (raw === null) return GLIHT_DEFAULT_BASE
    const v = JSON.parse(raw)
    return typeof v === "string" ? v : GLIHT_DEFAULT_BASE
  } catch { return GLIHT_DEFAULT_BASE }
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
/** A proxy that refused a connection, and until when NASA's host is read
 *  instead. */
let down: { base: string; until: number } | null = null
const PROXY_RETRY_MS = 30_000
const toasted = new Set<string>()

function toastOnce(key: string, title: string, body: string) {
  console.warn(`[gliht] ${title}: ${body}`)
  if (toasted.has(key)) return
  toasted.add(key)
  try { pushToast({ key, tone: "warn", title, body, duration: 15000 }) } catch { /* no UI (tests) */ }
}

// A network refusal (connection refused, CORS, local network access denied)
// is a TypeError with no status; an aborted tile is an AbortError.
const refused = (e: unknown, signal: AbortSignal) => e instanceof TypeError && !signal.aborted

export async function glihtProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: TileImage }> {
  const t = parseGlihtUrl(params.url)
  if (!t) throw new Error(`gliht: cannot read ${params.url}`)
  const signal = abortController.signal
  const env: Env = { fetch: (u, init) => fetch(u, init), decodePng, signal }
  const setting = glihtBaseUrl()
  const proxyDown = !!setting && down?.base === setting && Date.now() < down.until
  const read = (base: string) => readGreyTile(env, t.campaign, base, t.z, t.x, t.y, SIZE)
  const direct = async () => {
    try { return await read("") } catch (e) {
      if (refused(e, signal)) toastOnce("gliht-cors", "NASA G-LiHT blocked by CORS", `${GLIHT_ORIGIN} sends no CORS header. Start the tile service (cd tile-server && pnpm start, it proxies the KMZs at http://localhost:3400/proxy/gliht), or turn on a CORS-unblocking browser extension with Settings > G-LiHT address left empty.`)
      throw e
    }
  }
  let grey: Float32Array | null
  if (!setting || proxyDown) grey = await direct()
  else {
    try {
      grey = await read(setting)
    } catch (e) {
      if (!refused(e, signal)) throw e
      down = { base: setting, until: Date.now() + PROXY_RETRY_MS }
      toastOnce(`gliht-proxy:${setting}`, "G-LiHT proxy not answering", `${setting} does not answer: the tile service is not running on this computer, or the browser refused local network access. Reading NASA's host directly meanwhile, which works only with a CORS-unblocking extension. Start it with cd tile-server && pnpm start, or change Settings > G-LiHT address.`)
      grey = await direct()
    }
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
