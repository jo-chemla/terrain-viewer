// Client-side cast-shadow tile computation, registered as the `shadow://`
// maplibre custom protocol — a plain `raster` source/layer pair (same
// drape-for-free reasoning as every other derived mode in this app, see
// matcap-protocol.ts's header). Reuses lib/normal-derived-protocol.ts's
// fetchPaddedElevationGrid for the padded-neighbor-tile DEM fetch (shared,
// cached independent of light direction — dragging the light control never
// re-derives elevation, only re-marches).
//
// Single-ray variant of lib/horizon-angle.ts's horizon-angle marching: SVF/
// Openness check 8 fixed compass directions and aggregate; a cast shadow only
// ever cares about ONE direction — straight toward the sun's actual azimuth
// (not snapped to a 45° compass tick) — so this marches exactly that ray per
// pixel and compares its horizon angle against the sun's altitude: if
// something between here and the sun rises above the sun's own angle in the
// sky, this pixel is in shadow.
import { sharedTileCache, fetchPaddedElevationGrid, tileRowToLatRad, groundResolutionM, YIELD_EVERY_ROWS, yieldToMainThread, buildProtocolUrl, formatUrlNumber, type UpstreamEncoding } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"

const SHADOW_URL_RE = /^shadow:\/\/(-?[\d.]+)\/(-?[\d.]+)\/(\d+)\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

/** `azimuthDeg`/`altitudeDeg` — same compass-clockwise-from-north / degrees-
 *  above-horizon convention as state.illuminationDir/illuminationAlt (shared
 *  with Hillshade and Phong, see lighting-effects-options-section.tsx: no
 *  separate light control for Shadows). `radiusPx` is how far same-zoom
 *  pixels are marched toward the sun looking for an obstruction — same
 *  "Search Radius" convention SVF/Openness use. */
export function buildShadowProtocolUrl(
  azimuthDeg: number, altitudeDeg: number, radiusPx: number,
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
): string {
  const base = buildProtocolUrl("shadow", upstreamTileTemplate, encoding, tileSize)
  return base.replace("shadow://", `shadow://${formatUrlNumber(azimuthDeg)}/${formatUrlNumber(altitudeDeg)}/${radiusPx}/`)
}

export async function shadowProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(SHADOW_URL_RE)
  if (!match) throw new Error(`Invalid shadow protocol URL: ${params.url}`)
  const [, azimuthDegStr, altitudeDegStr, radiusStr, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const azimuthDeg = parseFloat(azimuthDegStr)
  const altitudeDeg = parseFloat(altitudeDegStr)
  const radiusPx = parseInt(radiusStr, 10)
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)
  const signal = abortController.signal

  const { padded, stride } = await fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal, radiusPx)

  const latDeg = tileRowToLatRad(y + 0.5, z) * (180 / Math.PI)
  const groundResM = groundResolutionM(latDeg, z, n)

  // Direction TOWARD the sun in (row=south-component, col=east-component)
  // pixel-step space — azimuth 0 (north) should step toward negative row
  // (northward, i.e. up-tile), matching phong-live-gl-layer.ts's own
  // az->vector sign convention for the same compass/tile-space pairing.
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const altitudeRad = (altitudeDeg * Math.PI) / 180
  const dCol = Math.sin(azimuthRad)
  const dRow = -Math.cos(azimuthRad)

  // The ray toward the sun is the same for every pixel of the tile: its index
  // offsets and 1/distance are built once. A pixel is in shadow when any step
  // rises above the sun, i.e. when elevDiff / dist > tan(altitude) (atan is
  // increasing and every distance is positive), so no atan per step and the
  // march stops at the first obstruction. Same result as the old per-step
  // atan2 loop, about 10x faster (2026-11-16 timing).
  const offsets: number[] = []
  const invDist: number[] = []
  for (let r = 1; r <= radiusPx; r++) {
    const rr = Math.round(r * dRow)
    const rc = Math.round(r * dCol)
    const dist = Math.sqrt(rr * rr + rc * rc) * groundResM
    if (dist === 0) continue
    offsets.push(rr * stride + rc)
    invDist.push(1 / dist)
  }
  const rayOffsets = Int32Array.from(offsets)
  const rayInvDist = Float64Array.from(invDist)
  // No ray at all (radius 0) means a flat horizon, angle 0, as before.
  const tanAltitude = altitudeRad >= Math.PI / 2 ? Infinity : Math.tan(altitudeRad)
  const flatInShadow = 0 > altitudeRad

  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    if (row > 0 && row % YIELD_EVERY_ROWS === 0) {
      if (signal.aborted) throw new Error("Aborted")
      await yieldToMainThread()
    }
    const pr = row + radiusPx
    for (let col = 0; col < n; col++) {
      const base = pr * stride + col + radiusPx
      const centerElevation = padded[base]

      let inShadow = rayOffsets.length === 0 ? flatInShadow : false
      for (let j = 0; j < rayOffsets.length; j++) {
        if ((padded[base + rayOffsets[j]] - centerElevation) * rayInvDist[j] > tanAltitude) { inShadow = true; break }
      }

      const idx = (row * n + col) * 4
      // Plain dark, fully opaque when in shadow, fully transparent when lit
      // — the raster layer's own paint opacity (state.shadowOpacity) is what
      // actually controls how dark shadows read on screen, same convention
      // as every other derived-mode raster layer in this app.
      outData[idx] = 0
      outData[idx + 1] = 0
      outData[idx + 2] = 0
      outData[idx + 3] = inShadow ? 255 : 0
    }
  }

  return { data: await toTileImage(outData, n, n) }
}
