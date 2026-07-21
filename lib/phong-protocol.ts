// Client-side Blinn-Phong-shaded tile computation, registered as the
// `phong://` maplibre custom protocol — a plain `raster` source/layer pair
// (see components/LayersAndSources/MapSources.tsx's PhongSource /
// MapLayers.tsx's PhongRasterLayer), draped over 3D terrain AND globe the
// exact same automatic way the raster basemap already is. See
// lib/matcap-protocol.ts's header for why this is a plain raster tile
// rather than a custom WebGL layer with its own mesh.
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

  const { pixels: normalPixels } = await computeNormalPixels(upstreamTemplate, encoding, z, x, y, n, abortController.signal)
  // maplibre's own request layer (util/ajax.ts's makeRequest) calls this
  // function directly and applies WHATEVER it resolves with — it never
  // checks abortController.signal itself, that's entirely this handler's
  // responsibility. Without this check, a request maplibre has already
  // superseded (e.g. a light-direction drag firing a newer phong:// URL for
  // the same tile) still resolves successfully — and since async completion
  // order doesn't match request order, that now-stale result can land AFTER
  // the newer one and get painted over it, then get overtaken again by the
  // next real result: exactly the "old, new, old, new" flicker this fixes.
  if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError")

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
  const lx = -Math.sin(azRad) * cosEl
  const ly = -Math.cos(azRad) * cosEl
  const lz = Math.sin(elRad)
  // Viewer looking straight down — same simplification the old GPU shader used.
  const vx = 0, vy = 0, vz = 1
  let hx = lx + vx, hy = ly + vy, hz = lz + vz
  const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1
  hx /= hLen; hy /= hLen; hz /= hLen

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
  const out = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const idx = i * 4
    let nx = (normalPixels[idx] / 255) * 2 - 1
    let ny = (normalPixels[idx + 1] / 255) * 2 - 1
    let nz = (normalPixels[idx + 2] / 255) * 2 - 1

    // Reapply the current exaggeration to the cached (unexaggerated) normal
    // — see lib/matcap-protocol.ts's identical comment for the derivation.
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

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(out as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  // Re-check after the async PNG encode too — a fast-fire light-direction
  // drag can supersede this exact request while convertToBlob was pending.
  if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError")
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
