import type { decode as LercDecode } from "lerc"
// Vite resolves this to a hashed asset URL and emits the file; the wasm is not
// inlined in the lerc package, and its own default loader looks for it next to
// the script, which is wrong for any bundled build. Importing the URL is free -
// it compiles to a string constant, and the 117 kB wasm is only fetched when
// something actually calls load().
import lercWasmUrl from "lerc/lerc-wasm.wasm?url"
import { toTileImage, type TileImage } from "./tile-image"

/**
 * `lerc://` - ArcGIS **tiled elevation services**, which serve LERC-compressed
 * float rasters rather than any RGB packing. The motivating source is Esri's
 * World Elevation 3D (`elevation3d.arcgis.com/.../Terrain3D/ImageServer`), a
 * global best-available blend that is keyless and CORS-open on this endpoint.
 *
 * LERC (Limited Error Raster Compression) is Esri's open raster codec: a real
 * float grid plus a validity mask, compressed to a stated maximum per-pixel
 * error - 0.1 m for Terrain3D. Decoding it gives metres directly, so this is
 * the same shape as float32dem://: decode floats, re-encode as Terrarium, hand
 * maplibre an ordinary raster-dem tile.
 *
 * URL: lerc://<host+path, no scheme>, with the tile placeholders left in the
 * template for maplibre to substitute. ArcGIS orders them **z/y/x**, which
 * needs no special handling here - maplibre substitutes each placeholder where
 * it finds it, so a template ending `/tile/{z}/{y}/{x}` simply works.
 *
 * NOTE on the ImageServer's other endpoints: `exportImage` on the same service
 * only ever answers anonymously from a coarse overview (`WorldDTM_OV256` -
 * about 2.5 km/px, which renders an alpine valley as a smooth ramp), and
 * passing an explicit fine `pixelSize` does not change that. The `/tile`
 * pyramid below is the one that serves real resolution without a token.
 */

// Both the decoder (64 kB) and its wasm (117 kB) are pulled in on the first
// lerc:// tile and never before: this protocol is registered at startup like
// every other, but almost no session uses an ArcGIS elevation service, and a
// static import would put all of it in the initial bundle. Every concurrent
// tile awaits the same promise rather than racing to initialise the module.
let lercReady: Promise<typeof LercDecode> | null = null
function ensureLerc(): Promise<typeof LercDecode> {
  if (!lercReady) {
    lercReady = import("lerc")
      .then(async (m) => { if (!m.isLoaded()) await m.load({ locateFile: () => lercWasmUrl }); return m.decode })
      .catch((e) => { lercReady = null; throw e })
  }
  return lercReady
}

/** A tile outside the service's coverage, which is ordinary rather than an
 *  error: maplibre only keeps a tile failure quiet when `status === 404`. */
class TileNotFound extends Error {
  status = 404
  constructor(url: string) { super(`404 ${url}`) }
}

export async function lercProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const url = `https://${params.url.replace(/^lerc:\/\//, "")}`
  const decode = await ensureLerc()

  const response = await fetch(url, { signal: abortController.signal })
  if (response.status === 404) throw new TileNotFound(url)
  if (!response.ok) throw new Error(`lerc:// HTTP ${response.status} for ${url}`)
  const buffer = await response.arrayBuffer()
  // ArcGIS answers a missing tile with a short JSON error body and HTTP 200,
  // so an empty-ish response is checked here rather than trusted to the status.
  if (buffer.byteLength < 64) throw new TileNotFound(url)

  const lerc = decode(buffer)
  const { width: srcW, height: srcH } = lerc
  const pixels = lerc.pixels[0] as ArrayLike<number>
  // The band mask is per-band; `mask` is the shared one. Either may be absent,
  // which means every pixel is valid.
  const mask = lerc.bandMasks?.[0] ?? lerc.mask ?? null
  const noDataValue = lerc.noDataValues?.[0] ?? null

  // ArcGIS elevation tiles are 257x257: one extra row and column so that
  // neighbouring tiles share an edge of vertices. maplibre's raster-dem wants
  // a plain square tile of its declared size, so the shared edge is dropped
  // rather than resampled - it is the first cell of the next tile, and
  // maplibre backfills tile borders from neighbours anyway.
  const size = srcW === srcH && srcW === 257 ? 256 : Math.min(srcW, srcH)

  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const src = row * srcW + col
      const dst = (row * size + col) * 4
      let elevation = pixels[src]
      // A hole is written as 0 m with alpha 254 - maplibre ignores alpha and
      // sees flat ground, while this app's own decoders read the cell as
      // invalid. A transparent pixel would premultiply to the Terrain-RGB
      // floor instead. See /dev/demdiff-protocol for the convention.
      const hole = (mask ? mask[src] === 0 : false)
        || !Number.isFinite(elevation)
        || (noDataValue !== null && elevation === noDataValue)
      if (hole) elevation = 0
      // Terrarium: height = (R*256 + G + B/256) - 32768.
      const v = elevation + 32768
      const intPart = Math.floor(v)
      rgba[dst] = Math.floor(intPart / 256) & 0xff
      rgba[dst + 1] = intPart & 0xff
      rgba[dst + 2] = Math.floor((v - intPart) * 256) & 0xff
      rgba[dst + 3] = hole ? 254 : 255
    }
  }

  return { data: await toTileImage(rgba, size, size) }
}
