import { fromArrayBuffer } from "geotiff"
import { NODATA_FILL_PARAM, NODATA_FLOOR_PARAM, resolveNodata } from "./nodata"

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
// Anti-aliasing supersampling for UNDERZOOMED WMS requests — dormant, not
// enabled on any shipped source yet. Rationale (IGN LiDAR-HD moiré,
// 2026-08-21): at mid zooms a mercator tile pixel spans many native-grid
// cells, and WMS servers typically fill a small GetMap by POINT-DECIMATING
// their native grid during reprojection — no low-pass filter — which
// aliases sub-meter texture into a beat-pattern grid that hillshade's
// derivative amplifies. Opting a source in = appending
// `&__supersample=2` (or 3/4) to its GetMap URL template: the protocol
// strips the marker, multiplies the request's WIDTH/HEIGHT by the factor,
// and BOX-downsamples the decoded floats back to the original size before
// Terrarium packing. Box (full-footprint average), deliberately NOT
// bilinear: bilinear is an interpolator — it only ever weighs the ~4
// samples nearest each output point, so at ratios ≥2 it skips input
// samples entirely and the aliasing survives; the box kernel integrates
// every sample in the F×F footprint exactly once, i.e. a proper
// decimation prefilter matched to the factor. Costs F² pixels per request.
const SUPERSAMPLE_RE = /[?&]__supersample=(\d+)/i

// Nodata fill for out-of-coverage cells — dormant unless a source opts in.
// Measured against IGN LiDAR-HD MNT/MNS (2026-09-12, Rade de Brest): the WMS
// returns a **-9999 sentinel** (declared in the GeoTIFF's GDAL_NODATA tag), never
// NaN — so the `isFinite` guard in the encode loop below fires on exactly zero
// samples, and a -9999 m pit sails straight through (it does NOT wrap: -9999 +
// 32768 = 22769 is in range, so Terrarium round-trips it exactly).
//
// Worse, the server's LAMB93 -> 3857 reprojection *interpolates* the sentinel
// against valid neighbours, smearing a fringe of intermediate garbage around
// every coverage boundary — a straddling MNT tile measured ~46951 cells at
// exactly -9999 plus ~1400 more spread continuously over -9374, -5000, -1000,
// -100, -50, -10. So an exact `v === nodata` test leaves a halo of deep pits,
// and so does any fixed floor placed down near the sentinel.
//
// The smear is strictly one-directional — blending -9999 with valid terrain can
// only land *below* the valid range, never above — so testing from below erases
// sentinel and fringe together, in one pass, with no hole bookkeeping:
//
//     if (v <= floor) v = fill
//
// The floor/fill pair and its "either implies the other" rule are shared with the
// COG path — see lib/nodata.ts for the full semantics. A URL is all this protocol
// receives, so the pair arrives as two markers appended by source-builder.ts
// (or hand-written on the source), stripped here before the GetMap goes out:
//
//   &__nodatafill=<meters>   what a hole is replaced with
//   &__nodatafloor=<meters>  at or below this = hole
//
// Neither marker = data passed through untouched, so generic float32dem:// sources
// (incl. real bathymetry) are unaffected.
//
// The IGN sources ship floor -20 / fill 0. The floor sits under the Etang de
// Lavalduc's -5..-10 m bed with margin, so no genuine French terrain is eaten;
// the fill sits at sea level because IGN's holes are water abutting a valid
// surface measuring -2.4 to -2.6 m, leaving a ~2.4 m step at the coverage
// boundary where filling at the floor would leave ~17.6 m of ledge for terrain
// skirts to hang off.
const NODATAFILL_RE = new RegExp(`[?&]${NODATA_FILL_PARAM}=(-?\\d+(?:\\.\\d+)?)`, "i")
const NODATAFLOOR_RE = new RegExp(`[?&]${NODATA_FLOOR_PARAM}=(-?\\d+(?:\\.\\d+)?)`, "i")

function boxDownsample(src: ArrayLike<number>, width: number, height: number, factor: number, holeFloor: number): { data: Float64Array; width: number; height: number } {
  const outW = Math.floor(width / factor)
  const outH = Math.floor(height / factor)
  const out = new Float64Array(outW * outH)
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let sum = 0
      let count = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (oy * factor + dy) * width + ox * factor
        for (let dx = 0; dx < factor; dx++) {
          const v = src[row + dx]
          // Average only valid samples — a nodata cell shouldn't drag its whole
          // block down. holeFloor is -Infinity for sources that haven't opted
          // into nodata handling, leaving this a bare finite check as before.
          if (isFinite(v) && v > holeFloor) { sum += v; count++ }
        }
      }
      // NaN, not 0, for an all-hole block: it stays flagged as a hole so the
      // fill pass below resolves it, instead of silently becoming sea level.
      out[oy * outW + ox] = count > 0 ? sum / count : NaN
    }
  }
  return { data: out, width: outW, height: outH }
}

export async function float32demProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  let url = "https://" + params.url.replace(/^float32dem:\/\//, "")

  // Supersampling marker (see SUPERSAMPLE_RE's comment): strip it and
  // scale the GetMap's own WIDTH/HEIGHT up by the factor.
  const ssMatch = url.match(SUPERSAMPLE_RE)
  const supersample = ssMatch ? Math.max(1, Math.min(4, parseInt(ssMatch[1], 10) || 1)) : 1
  if (ssMatch) {
    url = url.replace(SUPERSAMPLE_RE, "")
      .replace(/([?&]WIDTH=)(\d+)/i, (_, k, v) => `${k}${parseInt(v, 10) * supersample}`)
      .replace(/([?&]HEIGHT=)(\d+)/i, (_, k, v) => `${k}${parseInt(v, 10) * supersample}`)
  }

  // Nodata fill marker (see NODATAFILL_RE's comment): strip it before the
  // GetMap, same as __supersample. null = source hasn't opted in.
  const fillMatch = url.match(NODATAFILL_RE)
  const floorMatch = url.match(NODATAFLOOR_RE)
  if (fillMatch) url = url.replace(NODATAFILL_RE, "")
  if (floorMatch) url = url.replace(NODATAFLOOR_RE, "")
  // resolveNodata applies the "either one implies the other" rule, so a single
  // marker is the plain single-knob clamp.
  const nodata = resolveNodata({
    nodataFill: fillMatch ? parseFloat(fillMatch[1]) : undefined,
    nodataFloor: floorMatch ? parseFloat(floorMatch[1]) : undefined,
  })
  const holeFloor = nodata?.floor ?? -Infinity

  const response = await fetch(url, { signal: abortController.signal })
  const arrayBuffer = await response.arrayBuffer()

  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  let width = image.getWidth()
  let height = image.getHeight()
  let elevationData = rasters[0] as ArrayLike<number>

  if (supersample > 1) {
    const down = boxDownsample(elevationData, width, height, supersample, holeFloor)
    elevationData = down.data
    width = down.width
    height = down.height
  }

  // Replace holes + reprojection smear with the fill level, in place. Runs after
  // the downsample so box averages are computed from valid samples only. Writable
  // in both branches: geotiff's own Float32Array, or boxDownsample's Float64Array.
  // A substitution rather than a clamp — when floor sits below fill, a valid cell
  // between the two keeps its own value; when they're equal the two are identical.
  if (nodata) {
    const out = elevationData as Float32Array | Float64Array
    for (let i = 0; i < out.length; i++) {
      const v = out[i]
      if (!isFinite(v) || v <= nodata.floor) out[i] = nodata.fill
    }
  }

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
