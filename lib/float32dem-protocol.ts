import { fromArrayBuffer, type GeoTIFFImage } from "geotiff"
import { NODATA_FILL_PARAM, NODATA_FLOOR_PARAM, resolveNodata, isSentinel } from "./nodata"

/**
 * geotiff's readRasters, tolerant of SPARSE tiled/stripped files. ArcGIS
 * (WCSServer and ImageServer alike) writes the parts of a window that fall
 * outside the coverage extent as tiles with TileOffsets = TileByteCounts = 0 —
 * GDAL's SPARSE_OK convention — and geotiff.js then throws "Offset is outside
 * the bounds of the DataView" for the whole read. That is every tile that
 * crosses the border, i.e. at country-fit zoom for a small extent like Tirol or
 * Czechia it is every tile there is, so the country rendered blank exactly when
 * the map had just been fenced to it.
 *
 * Missing blocks are synthesised as NaN (float) or the GDAL_NODATA value (int)
 * so the ordinary hole handling downstream (isSentinel treats non-finite as a
 * hole; the Terrarium encoder maps it to 0) does the rest. Files with no empty
 * block go straight through untouched.
 */
export async function readRastersSparse(image: GeoTIFFImage) {
  const fd = image.fileDirectory
  const counts: ArrayLike<number> | undefined = fd.TileByteCounts ?? fd.StripByteCounts
  const offsets: ArrayLike<number> | undefined = fd.TileOffsets ?? fd.StripOffsets
  let hasEmpty = false
  if (counts && offsets) {
    for (let i = 0; i < counts.length; i++) if (counts[i] === 0 || offsets[i] === 0) { hasEmpty = true; break }
  }
  if (!hasEmpty || !counts || !offsets) return image.readRasters()

  const tileW = image.getTileWidth()
  const tileH = image.getTileHeight()
  const perRow = Math.ceil(image.getWidth() / tileW)
  const perCol = Math.ceil(image.getHeight() / tileH)
  const bytesPerPixel = image.getBytesPerPixel()
  const bits: number = fd.BitsPerSample[0]
  const isFloat = image.getSampleFormat() === 3
  const nodataTag = fd.GDAL_NODATA !== undefined ? parseFloat(String(fd.GDAL_NODATA)) : NaN
  const fill = isFloat ? NaN : Number.isFinite(nodataTag) ? nodataTag : 0
  const { littleEndian } = image
  const blank = new ArrayBuffer(tileW * tileH * bytesPerPixel)
  if (fill !== 0) {
    const view = new DataView(blank)
    for (let off = 0; off < blank.byteLength; off += bytesPerPixel) {
      if (isFloat && bits === 32) view.setFloat32(off, fill, littleEndian)
      else if (isFloat && bits === 64) view.setFloat64(off, fill, littleEndian)
      else if (bits === 16) view.setInt16(off, fill, littleEndian)
      else if (bits === 32) view.setInt32(off, fill, littleEndian)
      else if (bits === 8) view.setInt8(off, fill)
    }
  }

  const original = image.getTileOrStrip.bind(image)
  // Instance-level override — geotiff reads through this.getTileOrStrip, so
  // shadowing it on the one image is enough and nothing else is affected.
  ;(image as unknown as { getTileOrStrip: typeof original }).getTileOrStrip = async (x, y, sample, poolOrDecoder, signal) => {
    const index = image.planarConfiguration === 2 ? sample * perRow * perCol + y * perRow + x : y * perRow + x
    if (counts[index] === 0 || offsets[index] === 0) {
      return { x, y, sample, data: blank.slice(0) } as unknown as ArrayBuffer
    }
    return original(x, y, sample, poolOrDecoder, signal)
  }
  return image.readRasters()
}

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

// WCS 2.0 request-shape rewrite. Most raw-elevation services this protocol talks
// to are WCS *1.0* GetCoverage, which takes `BBOX=minx,miny,maxx,maxy` +
// WIDTH/HEIGHT — byte-identical to the WMS GetMap shape, so `{bbox-epsg-3857}`
// templates straight in and no rewrite is needed (Norway, Finland, AHN, NRW,
// Baden-Wurttemberg, Brandenburg, Meckl.-Vorpommern, BKG, UK EA, Flanders).
//
// WCS *2.0* dropped BBOX entirely: it wants one `subset=` per axis and
// `scaleSize=` instead of WIDTH/HEIGHT. Sending BBOX to a 2.0.1 endpoint returns
// HTTP 504 (measured against TINITALY). Since maplibre can only ever substitute
// a comma-joined bbox, the conversion has to happen here.
//
// Opt in with `&__wcs2subset=<xAxis>,<yAxis>[,ogc|axis]`. The axis LABELS are
// part of the marker because servers disagree: TINITALY (Italy) publishes X/Y
// for a projected CRS, Digital Earth Africa publishes x/y, EMODnet Long/Lat,
// and Poland's GUGiK `y x` where y is easting. Getting them backwards silently
// returns the wrong region rather than an error, so it is explicit, not guessed.
//
// The third field picks how `scaleSize` names its axes, because the two servers
// we support want OPPOSITE spellings and reject the other outright:
//   ogc  (default) - OGC grid-axis URIs, .../1/i(W),.../1/j(H). TINITALY needs
//                    this and 404s on plain labels.
//   axis           - reuse the subset labels, x(W),y(H). Digital Earth Africa
//                    needs this and 500s on the OGC URIs.
const WCS2SUBSET_RE = /[?&]__wcs2subset=([A-Za-z]+),([A-Za-z]+)(?:,(ogc|axis))?/i
const OGC_AXIS = "http://www.opengis.net/def/axis/OGC/1"

// Some WCS servers honour the requested BBOX only approximately: they reproject
// it into their native CRS, snap to their own grid, and hand back a raster whose
// real extent is LARGER than what was asked for — correctly georeferenced, just
// not the rectangle we wanted. Measured on a z12 tile: Finland's Paituli returns
// 10400 m for a 9784 m tile, England's EA 10282 m. Packing those pixels as if
// they covered the tile exactly shifts and scales the terrain by ~3-6%, which
// reads as "the tiles are weird" rather than as an outright failure. (Adding
// RESPONSE_CRS changes nothing — verified both ways.)
//
// So: believe the GeoTIFF's georeferencing over the request, and resample onto
// the grid actually asked for. Servers that already answer with the requested
// extent (Norway, Tirol, Czechia, IGN) skip this entirely.
//
// BILINEAR, not nearest-neighbour. The drift is a non-integer fraction of a
// pixel — TINITALY is off by a steady 5.3% at every zoom — so nearest-neighbour
// duplicates and drops whole rows/columns on a regular beat, which reads as a
// grid of ridges once hillshade amplifies the derivative. Bilinear is only safe
// because the nodata fill has already run by this point (see the call site), so
// there are no sentinels left to smear into their neighbours; the isSentinel
// fallback covers sources that never opted into nodata handling at all.
function resampleToBbox(
  src: ArrayLike<number>, sw: number, sh: number,
  srcBbox: [number, number, number, number], dstBbox: [number, number, number, number],
  dw: number, dh: number,
): Float64Array {
  const [sx0, sy0, sx1, sy1] = srcBbox
  const [dx0, dy0, dx1, dy1] = dstBbox
  const out = new Float64Array(dw * dh)
  const sxSpan = sx1 - sx0, sySpan = sy1 - sy0
  const at = (x: number, y: number) =>
    src[Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))]
  for (let y = 0; y < dh; y++) {
    // Row centre in world coords; raster rows run north -> south.
    const wy = dy1 - ((y + 0.5) * (dy1 - dy0)) / dh
    const fy = ((sy1 - wy) * sh) / sySpan - 0.5
    const y0 = Math.floor(fy), ty = fy - y0
    for (let x = 0; x < dw; x++) {
      const wx = dx0 + ((x + 0.5) * (dx1 - dx0)) / dw
      const fx = ((wx - sx0) * sw) / sxSpan - 0.5
      const x0 = Math.floor(fx), tx = fx - x0
      const v00 = at(x0, y0), v10 = at(x0 + 1, y0), v01 = at(x0, y0 + 1), v11 = at(x0 + 1, y0 + 1)
      out[y * dw + x] = isSentinel(v00) || isSentinel(v10) || isSentinel(v01) || isSentinel(v11)
        ? at(Math.round(fx), Math.round(fy))
        : v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
    }
  }
  return out
}

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
          if (!isSentinel(v) && v > holeFloor) { sum += v; count++ }
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

  // Captured before any marker rewriting, since the WCS 2.0 branch below removes
  // BBOX outright. Used after decode to detect a server that answered with a
  // different extent than we asked for (see resampleToBbox).
  const requestedBboxMatch = url.match(/[?&]BBOX=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/i)
  const requestedBbox: [number, number, number, number] | null = requestedBboxMatch
    ? [parseFloat(requestedBboxMatch[1]), parseFloat(requestedBboxMatch[2]), parseFloat(requestedBboxMatch[3]), parseFloat(requestedBboxMatch[4])]
    : null

  // Supersampling marker (see SUPERSAMPLE_RE's comment): strip it and
  // scale the GetMap's own WIDTH/HEIGHT up by the factor.
  const ssMatch = url.match(SUPERSAMPLE_RE)
  const supersample = ssMatch ? Math.max(1, Math.min(4, parseInt(ssMatch[1], 10) || 1)) : 1
  if (ssMatch) {
    url = url.replace(SUPERSAMPLE_RE, "")
      .replace(/([?&]WIDTH=)(\d+)/i, (_, k, v) => `${k}${parseInt(v, 10) * supersample}`)
      .replace(/([?&]HEIGHT=)(\d+)/i, (_, k, v) => `${k}${parseInt(v, 10) * supersample}`)
  }

  // WCS 2.0 rewrite (see WCS2SUBSET_RE's comment). Runs AFTER the supersample
  // block so it converts the already-scaled WIDTH/HEIGHT, not the original.
  const wcs2Match = url.match(WCS2SUBSET_RE)
  if (wcs2Match) {
    const [, xAxis, yAxis, scaleStyle] = wcs2Match
    url = url.replace(WCS2SUBSET_RE, "")
    const bboxMatch = url.match(/[?&]BBOX=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/i)
    if (bboxMatch) {
      const [, minX, minY, maxX, maxY] = bboxMatch
      url = url.replace(/[?&]BBOX=[^&]*/i, "") +
        `&subset=${xAxis}(${minX},${maxX})&subset=${yAxis}(${minY},${maxY})`
    }
    const wMatch = url.match(/[?&]WIDTH=(\d+)/i)
    const hMatch = url.match(/[?&]HEIGHT=(\d+)/i)
    if (wMatch && hMatch) {
      const scale = scaleStyle?.toLowerCase() === "axis"
        ? `${xAxis}(${wMatch[1]}),${yAxis}(${hMatch[1]})`
        : `${OGC_AXIS}/i(${wMatch[1]}),${OGC_AXIS}/j(${hMatch[1]})`
      url = url.replace(/[?&]WIDTH=\d+/i, "").replace(/[?&]HEIGHT=\d+/i, "") + `&scaleSize=${scale}`
    }
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
  const rasters = await readRastersSparse(image)
  let width = image.getWidth()
  let height = image.getHeight()
  let elevationData = rasters[0] as ArrayLike<number>

  // Replace holes + reprojection smear with the fill level, in place. Writable in
  // both branches: geotiff's own Float32Array, or boxDownsample's Float64Array.
  // A substitution rather than a clamp — when floor sits below fill, a valid cell
  // between the two keeps its own value; when they're equal the two are identical.
  //
  // Runs FIRST, before the re-grid below, because that step interpolates: filling
  // here means there is no -9999 left to smear into its valid neighbours. Doing it
  // the other way round would reintroduce exactly the fringe this exists to kill.
  if (nodata) {
    const out = elevationData as Float32Array | Float64Array
    for (let i = 0; i < out.length; i++) {
      const v = out[i]
      if (isSentinel(v) || v <= nodata.floor) out[i] = nodata.fill
    }
  }

  // Re-grid onto the requested extent if the server drifted (see resampleToBbox).
  // Tolerance is 0.5% of the tile span: comfortably above float/grid-snap noise,
  // well below the 3-6% drift that actually causes visible misregistration.
  if (requestedBbox) {
    const got = image.getBoundingBox() as [number, number, number, number]
    const spanX = requestedBbox[2] - requestedBbox[0]
    const spanY = requestedBbox[3] - requestedBbox[1]
    const tol = Math.max(Math.abs(spanX), Math.abs(spanY)) * 0.005
    const drifted = got.some((v, i) => Math.abs(v - requestedBbox[i]) > tol)
    if (drifted && isFinite(got[0]) && got[2] !== got[0] && got[3] !== got[1]) {
      elevationData = resampleToBbox(elevationData, width, height, got, requestedBbox, width, height)
    }
  }

  if (supersample > 1) {
    const down = boxDownsample(elevationData, width, height, supersample, holeFloor)
    elevationData = down.data
    width = down.width
    height = down.height
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
