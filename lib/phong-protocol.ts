// Client-side Blinn-Phong-shaded tile computation, registered as the
// `phong://` maplibre custom protocol — a plain `raster` source/layer pair
// (see components/LayersAndSources/MapSources.tsx's PhongSource /
// MapLayers.tsx's PhongRasterLayer), draped over 3D terrain AND globe the
// exact same automatic way the raster basemap already is. See
// lib/matcap-protocol.ts's header for why this is a plain raster tile
// rather than a custom WebGL layer with its own mesh, and for why the
// shading math below runs on the GPU (gpu-phong-compute.ts) rather than a
// JS loop — every light-direction/strength change still costs a full tile
// round-trip through addProtocol (MapLibre's raster-source model has no
// live-uniform hook), so accelerating the actual per-pixel math matters even
// though it can't eliminate that round-trip. Falls back to an equivalent CPU
// loop if WebGL2 is ever unavailable.
//
// Light direction is compass-fixed (state.illuminationDir/illuminationAlt —
// the same fields the on-map "hold L, drag" light control and maplibre's own
// hillshade illumination direction use), not camera-relative: panning/
// rotating the map must not spin the light, the way it's deliberately
// allowed to for a matcap material (see lib/matcap-protocol.ts). The raw
// normal encoding is already compass-aligned (x=east, y=south, z=up — see
// normals-protocol.ts's header), so the light vector is built directly in
// that same space with no rotation needed.
import { computeNormalPixels } from "./normals-protocol"
import { buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"
import { computePhongPixelsGPU } from "./gpu-phong-compute"

const PHONG_URL_RE = /^phong:\/\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildPhongProtocolUrl(
  diffuseStrength: number, specularStrength: number, lightDir: number, lightAlt: number, exaggeration: number,
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
): string {
  const base = buildProtocolUrl("phong", upstreamTileTemplate, encoding, tileSize)
  return base.replace("phong://", `phong://${diffuseStrength}/${specularStrength}/${lightDir}/${lightAlt}/${exaggeration}/`)
}

const AMBIENT = 0.35
const SHININESS = 32

// maplibre's own request layer (util/ajax.ts's makeRequest) calls this
// function directly and applies WHATEVER it resolves with — it never checks
// abortController.signal itself, that's entirely this handler's
// responsibility. That alone isn't the whole story, though: verified via
// live instrumentation (timestamped logging per call) that when the SOURCE's
// tiles URL template itself changes (a new light-direction commit), maplibre
// does NOT abort tile requests still in flight under the OLD template at
// all — abortController.signal.aborted stays false for them the entire time.
// They just keep running (a real, sometimes 1-2 second round-trip) and
// resolve successfully whenever they finish, however much later. Since
// maplibre's raster tile cache is keyed by z/x/y (not the full URL), an old-
// template result for a z/x/y that ALSO got a newer-template request can
// land in that same slot AFTER the newer one already did — repainting it
// with stale shading. This is the actual "old, new, old, new" flicker; no
// amount of checking abortController.signal catches it, because that signal
// genuinely never flips for this case.
//
// Fixed with an independent staleness guard: __currentParamsKey tracks the
// most recent (diffuse, specular, lightDir, lightAlt, exaggeration) tuple
// seen across ALL phong:// calls, regardless of which tile. Multiple
// concurrent calls for different z/x/y under the SAME (current) params are
// legitimate and never flagged stale; a call whose own params have since
// been superseded by a newer tuple is provably outdated and refused right
// before it would otherwise resolve, no matter what maplibre's own
// AbortController says.
let __currentParamsKey = ""

// Only reached if computePhongPixelsGPU returns null (no WebGL2) — same
// math, same output layout, just the original per-pixel JS loop.
function shadePhongCPU(
  normalPixels: Uint8ClampedArray, n: number,
  diffuseStrength: number, specularStrength: number, lightDir: [number, number, number], exaggeration: number,
): Uint8ClampedArray {
  const [lx, ly, lz] = lightDir
  const vx = 0, vy = 0, vz = 1
  let hx = lx + vx, hy = ly + vy, hz = lz + vz
  const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1
  hx /= hLen; hy /= hLen; hz /= hLen

  const out = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const idx = i * 4
    let nx = (normalPixels[idx] / 255) * 2 - 1
    let ny = (normalPixels[idx + 1] / 255) * 2 - 1
    let nz = (normalPixels[idx + 2] / 255) * 2 - 1

    if (exaggeration !== 1) {
      const sx = (nx / nz) * exaggeration
      const sy = (ny / nz) * exaggeration
      const len = Math.sqrt(sx * sx + sy * sy + 1) || 1
      nx = sx / len
      ny = sy / len
      nz = 1 / len
    }

    const diffuse = diffuseStrength * Math.max(nx * lx + ny * ly + nz * lz, 0)
    const diffuseIntensity = Math.min(Math.max(AMBIENT + diffuse, 0), 1)

    const specDot = Math.max(nx * hx + ny * hy + nz * hz, 0)
    const specular = specularStrength * Math.pow(specDot, SHININESS)
    const total = diffuseIntensity + specular

    if (total <= 1) {
      const alpha = Math.round((1 - total) * 255)
      out[idx] = 0
      out[idx + 1] = 0
      out[idx + 2] = 0
      out[idx + 3] = alpha
    } else {
      const alpha = Math.round(Math.min(total - 1, 1) * 255)
      out[idx] = 255
      out[idx + 1] = 255
      out[idx + 2] = 255
      out[idx + 3] = alpha
    }
  }
  return out
}

export async function phongProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(PHONG_URL_RE)
  if (!match) throw new Error(`Invalid phong protocol URL: ${params.url}`)
  const [, diffuseStr, specularStr, lightDirStr, lightAltStr, exaggerationStr, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const diffuseStrength = parseFloat(diffuseStr)
  const specularStrength = parseFloat(specularStr)
  const lightDir = parseFloat(lightDirStr)
  const lightAlt = parseFloat(lightAltStr)
  const exaggeration = parseFloat(exaggerationStr)
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)

  // This call's own params tuple, captured now — the shared "latest" tracker
  // may move on to a NEWER tuple while this call is still in flight, but this
  // constant never changes for the lifetime of this call.
  const myParamsKey = `${diffuseStr}|${specularStr}|${lightDirStr}|${lightAltStr}|${exaggerationStr}`
  __currentParamsKey = myParamsKey

  const { pixels: normalPixels } = await computeNormalPixels(upstreamTemplate, encoding, z, x, y, n, abortController.signal)
  if (abortController.signal.aborted || myParamsKey !== __currentParamsKey) throw new DOMException("Aborted", "AbortError")

  // Compass azimuth (clockwise from north) + elevation-above-horizon -> a
  // unit vector in the SAME (nx, ny, nz) space the normal map is encoded in.
  // The signs here are NOT derived from first principles (an earlier attempt
  // to derive them via lib/aspect-protocol.ts's own dx/dy-to-compass formula
  // as "ground truth" produced a plausible-looking but WRONG answer — that
  // formula's own sign turned out not to carry over the way assumed). These
  // are instead pinned by direct empirical measurement against maplibre's
  // own (independently implemented, trusted) native hillshade shader: added a
  // real `type: "hillshade"` layer at a known illumination-direction/altitude
  // pointed at the same DEM, captured both renders' pixels via
  // gl.readPixels, and computed the Pearson correlation of their luminance
  // over the same viewport. The x (east/west) sign was backwards (r ≈ -0.89
  // at due-east light — nearly perfectly *inverted*, not just off) while y
  // (north/south) was already correct (flipping it too broke due-north light
  // the same way, r ≈ -0.89 there instead) — flipping x alone gives r ≈ +0.93
  // at both due-east and due-north against maplibre's own shader.
  const azRad = (lightDir * Math.PI) / 180
  const elRad = (lightAlt * Math.PI) / 180
  const cosEl = Math.cos(elRad)
  const lightVec: [number, number, number] = [-Math.sin(azRad) * cosEl, -Math.cos(azRad) * cosEl, Math.sin(elRad)]

  // A raster layer only composites via standard "over" alpha blending — no
  // multiply *and* screen blend mode exists in the style spec — so this
  // encodes TWO regimes in one alpha channel, split at the "neutral" point
  // (diffuseIntensity == 1, i.e. no shading adjustment at all):
  //  - Below neutral (shadow): color=black, alpha=(1-diffuseIntensity). Over-
  //    compositing gives result = basemap*(1-alpha) + black*alpha =
  //    basemap*diffuseIntensity — a true multiply-darken, transparent
  //    (basemap untouched) at full brightness, darkening in shadow.
  //  - Above neutral (specular highlight): color=white, alpha=(total-1).
  //    Over-compositing gives result = basemap*(1-alpha) + white*alpha — a
  //    screen-like brightening, letting a strong reflection actually paint
  //    brighter than the albedo instead of just "not darkening" there.
  // diffuseIntensity is capped at 1 on its own (ordinary diffuse-lit terrain,
  // however brightly lit, is never a "highlight") — only specular can push
  // the total past 1 into the highlight regime, so regular sunlit slopes
  // stay in the ordinary shadow/neutral range and only sharp glints whiten.
  // (See gpu-phong-compute.ts's fragment shader for the GPU version of this
  // exact same encoding.)
  const out = computePhongPixelsGPU(normalPixels, n, diffuseStrength, specularStrength, lightVec, exaggeration)
    ?? shadePhongCPU(normalPixels, n, diffuseStrength, specularStrength, lightVec, exaggeration)
  if (abortController.signal.aborted || myParamsKey !== __currentParamsKey) throw new DOMException("Aborted", "AbortError")

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(out as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  // Re-check after the async PNG encode too — a fast-fire light-direction
  // drag can supersede this exact request while convertToBlob was pending.
  if (abortController.signal.aborted || myParamsKey !== __currentParamsKey) throw new DOMException("Aborted", "AbortError")
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
