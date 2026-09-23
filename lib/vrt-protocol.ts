import { elevationToTerrainrgb } from "./elevation-encoding"
import { toTileImage, type TileImage } from "./tile-image"

/**
 * `vrt://` — read a GDAL **VRT mosaic** in the browser, with no titiler in the
 * middle.
 *
 * A `.vrt` is an XML index over many real rasters: a virtual raster of
 * `rasterXSize x rasterYSize` pixels with a `GeoTransform`, and a list of
 * sources each saying "this file's `SrcRect` lands at this `DstRect` of the
 * virtual raster". Nothing in it needs GDAL to *read*: the referenced files are
 * ordinary (Cloud-Optimized) GeoTIFFs, and geotiff.js already Range-reads those
 * — it is the same reader the `cog://` path uses. What GDAL does that has to be
 * redone here is the bookkeeping: which sources a requested window touches, and
 * where inside each one to read.
 *
 * How the server does it, for reference: titiler opens `vrt:///vsicurl/<url>`
 * through rasterio, i.e. it hands the whole problem to GDAL's VRT driver, which
 * resolves sources and warps in C. The three steps below — intersect, read,
 * composite — are that same pipeline, minus a server.
 *
 * ### Reprojection
 *
 * A VRT is in whatever CRS its sources are (LAMB93 for the RGE ALTI repack, a
 * UTM zone for the OpenTopography LiDAR mosaics, plain 4326 for AW3D30);
 * maplibre asks for Web Mercator tiles. The `<SRS>` element carries the
 * projection as WKT and `proj4` (already a dependency) turns that into a
 * transform, so an arbitrary projected VRT works rather than only the 4326 and
 * 3857 cases. It is not called per output pixel: like GDAL's warper, the
 * projection is evaluated on a coarse grid and interpolated between the nodes,
 * refined until it is within an eighth of a pixel of the real thing.
 *
 * GDAL's `a_srs=` open option, which some library entries carry in the URL
 * (`...FXX.vrt?a_srs=EPSG:2154`), is honoured as an override.
 *
 * ### What this deliberately does not do
 *
 * - No `ComplexSource` scale/offset and no `<LUT>`; `<NODATA>` is honoured,
 *   which is the part that matters for elevation.
 * - One band per source, the one `<SourceBand>` names (default 1). A VRT that
 *   combined several into one output band would need a policy this has no way
 *   to express.
 * - No recursion into sources that are themselves VRTs.
 * - A tile touching more than `MAX_SOURCES_PER_TILE` files is refused rather
 *   than served: zoomed far out over a global mosaic that is hundreds of
 *   Range-read files for one tile. `getVrtInfo` derives a minzoom from the mean
 *   source footprint so maplibre stops asking before it gets there.
 *
 * URL shape: `vrt://<encodeURIComponent(vrt url)>/{z}/{x}/{y}`.
 * Output: Terrain-RGB, matching what titiler's `algorithm=terrainrgb` returns
 * for the same file, so both modes agree with the `encoding: "terrainrgb"` that
 * controls-utils.tsx already declares for a VRT source.
 */

const VRT_URL_RE = /^vrt:\/\/(.+)\/(\d+)\/(-?\d+)\/(-?\d+)$/
const TILE_SIZE = 256
const EARTH = 6378137
const ORIGIN = Math.PI * EARTH
const MAX_SOURCES_PER_TILE = 40
/** What `getVrtInfo` aims for when it derives a minzoom (see there). */
const MINZOOM_TARGET_SOURCES = 4
/** Ceiling on the source pixels one tile may decode from a single file. */
const MAX_READ_PIXELS = 8e6
/** Starting cells per side of the approximate-transformer grid, and the error
 *  it refines down to. 0.125 px is GDAL's own `-et` default.
 *
 *  1 means the grid starts as the tile's four CORNERS and an affine fit
 *  between them, which is all a conformal projection needs over a small tile:
 *  measured over Lambert-93 the corner fit is 0.012 px out at z15 and 0.0002
 *  at z18, so street-level tiles cost exactly four proj4 calls. It only
 *  subdivides where the projection actually curves across the tile - at z12
 *  the corner fit is 0.8 px and it refines to 4 cells, at z3 it goes further
 *  still. Starting at 16 instead, as this first did, spent 289 calls at every
 *  zoom to buy precision that only the lowest few need. */
const APPROX_GRID = 1
const APPROX_MAX_ERR_PX = 0.125

/** A tile outside the mosaic, which is ordinary rather than an error: maplibre
 *  only keeps a tile failure quiet when `status === 404`. */
class TileNotFound extends Error {
  status = 404
  constructor(url: string) { super(`404 ${url}`) }
}

interface VrtSource {
  filename: string
  /** 1-based `<SourceBand>`; a mosaic of multi-band files needs it, e.g. the
   *  Open Buildings tiles whose height is band 2 of three. */
  band: number
  srcX: number; srcY: number; srcW: number; srcH: number
  dstX: number; dstY: number; dstW: number; dstH: number
  nodata: number | null
}

interface VrtDoc {
  width: number; height: number
  /** GDAL GeoTransform: [originX, pxW, rowRot, originY, colRot, pxH]. */
  gt: number[]
  srs: string | null
  nodata: number | null
  sources: VrtSource[]
  /** Mean source footprint in VRT pixels, for the minzoom estimate. */
  meanSourceSpan: number
}

export interface VrtInfo {
  /** [west, south, east, north] in degrees. */
  bounds: [number, number, number, number]
  /** Zoom at which one tile pixel is roughly one source pixel. */
  maxzoom: number
  /** Below this a tile would touch too many files to be worth reading. */
  minzoom: number
  sourceCount: number
}

// The index itself is fetched and parsed once per URL and kept: a national
// mosaic's VRT is tens of MB of XML over thousands of sources (AW3D30's global
// one is ~10 MB), and re-parsing that per tile would dwarf everything else here.
const docCache = new Map<string, Promise<VrtDoc>>()
// geotiff's own header read is one more round trip per file, and a tile
// commonly revisits the same neighbours as its siblings, so the opened files
// are kept too (geotiff caches decoded strips inside each instance).
const tiffCache = new Map<string, Promise<any>>()
// `getImageCount()` walks the whole IFD chain, which for a 7-overview COG is
// seven dependent header reads. Asking once per tile made the first viewport
// spend about a second per tile just re-deciding how many overviews a file it
// already had open has.
const levelCache = new Map<string, Promise<number>>()

function parseVrt(xml: string, vrtUrl: string): VrtDoc {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  const ds = doc.querySelector("VRTDataset")
  if (!ds || doc.querySelector("parsererror")) throw new Error("not a parsable VRTDataset")

  const gt = (doc.querySelector("GeoTransform")?.textContent ?? "").split(",").map((v) => parseFloat(v.trim()))
  if (gt.length !== 6 || gt.some((v) => !Number.isFinite(v))) throw new Error("VRT has no usable GeoTransform")
  if (gt[2] !== 0 || gt[4] !== 0) throw new Error("rotated VRT GeoTransform is not supported")

  const band = doc.querySelector("VRTRasterBand")
  const bandNodata = band?.querySelector("NoDataValue")?.textContent
  const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr) ?? NaN)

  const sources: VrtSource[] = []
  let spanSum = 0
  for (const s of Array.from(band?.querySelectorAll("SimpleSource, ComplexSource") ?? [])) {
    const fnEl = s.querySelector("SourceFilename")
    const raw = fnEl?.textContent?.trim()
    const src = s.querySelector("SrcRect"), dst = s.querySelector("DstRect")
    if (!raw || !src || !dst) continue
    // relativeToVRT="1" resolves against the VRT's own directory; anything else
    // is taken as already absolute (an http URL, or a /vsicurl/ path this has
    // no way to reach, which will simply fail its read).
    // `/vsicurl/https://...` is GDAL's own way of saying "this is a URL", and
    // a VRT written for titiler will use it. Strip it and the path is one.
    const bare = raw.replace(/^\/vsicurl\//, "")
    const filename = fnEl?.getAttribute("relativeToVRT") === "1" ? new URL(bare, vrtUrl).toString() : bare
    const nd = s.querySelector("NODATA")?.textContent
    const bandText = s.querySelector("SourceBand")?.textContent?.trim()
    const entry: VrtSource = {
      filename,
      band: bandText && Number(bandText) > 0 ? Number(bandText) : 1,
      srcX: num(src, "xOff"), srcY: num(src, "yOff"), srcW: num(src, "xSize"), srcH: num(src, "ySize"),
      dstX: num(dst, "xOff"), dstY: num(dst, "yOff"), dstW: num(dst, "xSize"), dstH: num(dst, "ySize"),
      nodata: nd != null && nd !== "" ? Number(nd) : null,
    }
    if (!(entry.dstW > 0) || !(entry.dstH > 0) || !(entry.srcW > 0) || !(entry.srcH > 0)) continue
    spanSum += Math.max(entry.dstW, entry.dstH)
    sources.push(entry)
  }
  if (!sources.length) throw new Error("VRT lists no readable sources")

  // `?a_srs=EPSG:2154` in the URL is GDAL's assign-SRS open option, which the
  // library's RGE ALTI entry carries. An explicit override wins over the file.
  const aSrs = new URL(vrtUrl, typeof location === "undefined" ? "https://localhost/" : location.href).searchParams.get("a_srs")
  return {
    width: num(ds, "rasterXSize"), height: num(ds, "rasterYSize"), gt,
    srs: aSrs ?? doc.querySelector("SRS")?.textContent?.trim() ?? null,
    nodata: bandNodata != null && bandNodata !== "" ? Number(bandNodata) : null,
    sources,
    meanSourceSpan: spanSum / sources.length,
  }
}

function loadVrt(vrtUrl: string, signal?: AbortSignal): Promise<VrtDoc> {
  const hit = docCache.get(vrtUrl)
  if (hit) return hit
  const p = fetch(vrtUrl, { signal })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${vrtUrl}`); return r.text() })
    .then((xml) => parseVrt(xml, vrtUrl))
    .catch((e) => { docCache.delete(vrtUrl); throw e })
  docCache.set(vrtUrl, p)
  return p
}

type Transform = (x: number, y: number) => [number, number]

const IS_MERCATOR = /Pseudo-Mercator|EPSG["':,\s]*(?:3857|3785|900913)\b/i
const EPSG_CODE = /^(?:EPSG:|urn:ogc:def:crs:EPSG(?:::|:[^:]*:))(\d+)$/i

// proj4 ships definitions for WGS84, 4326, 3857 and a handful more; anything
// else has to be looked up. epsg.io serves a plain proj4 string per code, which
// is the same lookup TerraDrawSystem.tsx already does for a GeoPackage's SRS.
const defCache = new Map<string, Promise<string>>()
function resolveSrs(srs: string): Promise<string> {
  const code = EPSG_CODE.exec(srs.trim())
  if (!code) return Promise.resolve(srs)            // already WKT or a proj4 string
  const id = code[1]
  if (id === "4326") return Promise.resolve("WGS84")
  if (id === "3857") return Promise.resolve("EPSG:3857")
  const hit = defCache.get(id)
  if (hit) return hit
  const p = fetch(`https://epsg.io/${id}.proj4`)
    .then((r) => { if (!r.ok) throw new Error(`no proj4 definition for EPSG:${id}`); return r.text() })
    .then((t) => t.trim())
    .catch((e) => { defCache.delete(id); throw e })
  defCache.set(id, p)
  return p
}

/** Web Mercator metres <-> the VRT's own CRS. */
async function makeTransforms(srs: string | null): Promise<{ toVrt: Transform; toMerc: Transform }> {
  const identity: Transform = (x, y) => [x, y]
  if (!srs || IS_MERCATOR.test(srs)) return { toVrt: identity, toMerc: identity }
  const [proj4, def] = await Promise.all([import("proj4").then((m) => m.default), resolveSrs(srs)])
  const conv = proj4("EPSG:3857", def)
  return {
    toVrt: (x, y) => conv.forward([x, y]) as [number, number],
    toMerc: (x, y) => conv.inverse([x, y]) as [number, number],
  }
}

const mercToLngLat = (x: number, y: number): [number, number] => [
  (x / ORIGIN) * 180,
  (Math.atan(Math.exp((y / ORIGIN) * Math.PI)) * 360) / Math.PI - 90,
]

/**
 * Geographic bounds and a usable zoom range for a VRT, read from the same
 * parsed index the protocol uses. Feeds the max-bounds fence and the source's
 * minzoom/maxzoom: a VRT has no COG header for `useCogMetadata` to detect
 * either from, so without this it falls back to a flat 0-20.
 */
export async function getVrtInfo(vrtUrl: string, signal?: AbortSignal): Promise<VrtInfo> {
  const vrt = await loadVrt(vrtUrl, signal)
  const { toMerc } = await makeTransforms(vrt.srs)
  const [ox, pxW, , oy, , pxH] = vrt.gt

  // For a projected CRS the edges bow, so the extremes are taken over a coarse
  // sample of the whole boundary rather than the four corners alone.
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  const N = 16
  for (let i = 0; i <= N; i++) {
    for (const [px, py] of [
      [(i / N) * vrt.width, 0], [(i / N) * vrt.width, vrt.height],
      [0, (i / N) * vrt.height], [vrt.width, (i / N) * vrt.height],
    ]) {
      const [mx, my] = toMerc(ox + px * pxW, oy + py * pxH)
      const [lng, lat] = mercToLngLat(mx, my)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      west = Math.min(west, lng); east = Math.max(east, lng)
      south = Math.min(south, lat); north = Math.max(north, lat)
    }
  }

  // Resolution, measured over a short step at the raster CENTRE rather than
  // across the full width. The full-width version silently collapsed on a
  // global mosaic: proj4 normalises longitude 180 to -180, so AW3D30's two
  // edges projected to the same mercator x and the whole 30 m grid read as
  // zero metres per pixel (maxzoom 22, minzoom 22, every tile refused).
  const cx = vrt.width / 2, cy = vrt.height / 2
  const step = Math.max(1, Math.round(vrt.width / 100))
  const a = toMerc(ox + cx * pxW, oy + cy * pxH)
  const b = toMerc(ox + (cx + step) * pxW, oy + cy * pxH)
  // Mercator metres, not ground metres: that is the unit maplibre's zoom is
  // defined in, so the comparison against a tile's span is apples to apples.
  const metresPerPixel = Math.abs(b[0] - a[0]) / step

  // maxzoom: the zoom whose 256 px tile is about as fine as one source pixel.
  const maxzoom = Math.max(0, Math.min(22, Math.round(Math.log2((2 * ORIGIN) / (TILE_SIZE * metresPerPixel)))))

  // The same normalisation understates the east edge of a whole-world mosaic
  // by one sample step, so a raster that spans the full mercator width is
  // taken at its word.
  if (metresPerPixel * vrt.width >= 2 * ORIGIN * 0.999) { west = -180; east = 180 }

  // minzoom: below the zoom where a tile spans a handful of source footprints,
  // one tile is more Range-reads than it is worth. The target here is well
  // under MAX_SOURCES_PER_TILE — that is the hard refusal, this is the zoom
  // where browsing stays comfortable.
  const tileSpanPx = vrt.meanSourceSpan * Math.sqrt(MINZOOM_TARGET_SOURCES)
  const minzoom = Math.max(0, Math.min(maxzoom, Math.ceil(Math.log2((2 * ORIGIN) / (tileSpanPx * metresPerPixel)))))

  return { bounds: [west, south, east, north], maxzoom, minzoom, sourceCount: vrt.sources.length }
}

/**
 * Every pixel of a 256 tile, in VRT pixel space, via an approximating
 * transformer refined until it is within `APPROX_MAX_ERR_PX` of the real
 * projection. See the caller for why.
 */
function projectTilePixels(
  toPixel: (mercX: number, mercY: number) => [number, number],
  tileMinX: number, tileMaxY: number, span: number,
) {
  const at = (col: number, row: number) =>
    toPixel(tileMinX + (col / TILE_SIZE) * span, tileMaxY - (row / TILE_SIZE) * span)

  let cells = APPROX_GRID
  let nodes = cells + 1
  let gx = new Float64Array(0), gy = new Float64Array(0)
  for (;;) {
    nodes = cells + 1
    gx = new Float64Array(nodes * nodes)
    gy = new Float64Array(nodes * nodes)
    const step = TILE_SIZE / cells
    for (let r = 0; r < nodes; r++) {
      for (let c = 0; c < nodes; c++) {
        const [px, py] = at(c * step, r * step)
        gx[r * nodes + c] = px
        gy[r * nodes + c] = py
      }
    }
    if (cells >= TILE_SIZE) break                 // a node per pixel: exact
    // The tolerance is in OUTPUT pixels, like GDAL's -et, so it has to be
    // scaled by how many source pixels one output pixel covers. Getting this
    // wrong is not academic: an error of 3.5 source pixels sounds alarming and
    // is 0.011 of an output pixel at z9, while the same 3.5 at z18 would be a
    // visible smear. The span of the corner grid gives the scale directly.
    const sourcePxPerOutputPx = Math.max(
      Math.hypot(gx[nodes - 1] - gx[0], gy[nodes - 1] - gy[0]),
      Math.hypot(gx[nodes * (nodes - 1)] - gx[0], gy[nodes * (nodes - 1)] - gy[0]),
    ) / (TILE_SIZE / cells) / cells || 1
    const tolerance = APPROX_MAX_ERR_PX * sourcePxPerOutputPx

    // Bilinear error over a cell is not reliably worst at its centre - for a
    // conic projection the centre can sit near a zero of the error while the
    // edges do not - so each probed cell is sampled at its centre AND its four
    // edge midpoints. Probing the centre alone accepted a single-quad fit that
    // was really 0.89 px out.
    let worst = 0
    const stride = Math.max(1, cells >> 2)
    for (let r = 0; r < cells; r += stride) {
      for (let c = 0; c < cells; c += stride) {
        const a = r * nodes + c, b = a + 1, d = a + nodes, e = d + 1
        for (const [fx, fy] of [[0.5, 0.5], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]]) {
          const ix = (gx[a] * (1 - fx) + gx[b] * fx) * (1 - fy) + (gx[d] * (1 - fx) + gx[e] * fx) * fy
          const iy = (gy[a] * (1 - fx) + gy[b] * fx) * (1 - fy) + (gy[d] * (1 - fx) + gy[e] * fx) * fy
          const [ex, ey] = at((c + fx) * step, (r + fy) * step)
          if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue
          worst = Math.max(worst, Math.hypot(ix - ex, iy - ey))
        }
      }
    }
    if (worst <= tolerance) break
    cells *= 2
  }

  const vx = new Float64Array(TILE_SIZE * TILE_SIZE)
  const vy = new Float64Array(TILE_SIZE * TILE_SIZE)
  let minVX = Infinity, minVY = Infinity, maxVX = -Infinity, maxVY = -Infinity
  const cell = TILE_SIZE / cells
  for (let row = 0; row < TILE_SIZE; row++) {
    const fy = (row + 0.5) / cell
    const r0 = Math.min(cells - 1, Math.floor(fy)), ty = fy - r0
    for (let col = 0; col < TILE_SIZE; col++) {
      const fx = (col + 0.5) / cell
      const c0 = Math.min(cells - 1, Math.floor(fx)), tx = fx - c0
      const a = r0 * nodes + c0, b = a + 1, d = a + nodes, e = d + 1
      const px = (gx[a] * (1 - tx) + gx[b] * tx) * (1 - ty) + (gx[d] * (1 - tx) + gx[e] * tx) * ty
      const py = (gy[a] * (1 - tx) + gy[b] * tx) * (1 - ty) + (gy[d] * (1 - tx) + gy[e] * tx) * ty
      const i = row * TILE_SIZE + col
      vx[i] = px; vy[i] = py
      if (Number.isFinite(px) && Number.isFinite(py)) {
        if (px < minVX) minVX = px
        if (px > maxVX) maxVX = px
        if (py < minVY) minVY = py
        if (py > maxVY) maxVY = py
      }
    }
  }
  return { vx, vy, minVX, minVY, maxVX, maxVY }
}

export async function vrtProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const m = params.url.match(VRT_URL_RE)
  if (!m) throw new Error(`Invalid vrt protocol URL: ${params.url}`)
  const [, encoded, zS, xS, yS] = m
  const vrtUrl = decodeURIComponent(encoded)
  const z = parseInt(zS, 10), x = parseInt(xS, 10), y = parseInt(yS, 10)
  const signal = abortController.signal

  const vrt = await loadVrt(vrtUrl, signal)
  const { toVrt } = await makeTransforms(vrt.srs)
  const [ox, pxW, , oy, , pxH] = vrt.gt

  const span = (2 * ORIGIN) / 2 ** z
  const tileMinX = -ORIGIN + x * span
  const tileMaxY = ORIGIN - y * span

  // Every output pixel's position in VRT pixel space, computed once up front
  // rather than once per source: a tile commonly straddles several.
  //
  // Not one proj4 call per pixel. GDAL's warper does not do that either: it
  // builds an *approximate* transformer, evaluating the real projection on a
  // coarse grid and interpolating between the nodes, subdividing while the
  // error is above a threshold (`-et`, 0.125 px by default). Same idea here.
  // 65 536 proj4 calls per tile measured 21 ms of main-thread time each, and
  // 16 tiles of that in a viewport is a third of a second of jank; the grid is
  // well under 1 ms.
  //
  // The grid starts at APPROX_GRID cells and doubles while a probe says the
  // error is too big, because the error is quadratic in cell size and so
  // depends entirely on zoom: over LAMB93, a 16-cell grid is 930 px out at z3,
  // 0.2 px at z9 and 5e-5 px at z15. Every mosaic's own derived minzoom keeps
  // it in the harmless end of that range, but a source with a hand-set minzoom
  // should not have to know that.
  const { vx, vy, minVX, minVY, maxVX, maxVY } = projectTilePixels(
    (mx, my) => { const [wx, wy] = toVrt(mx, my); return [(wx - ox) / pxW, (wy - oy) / pxH] },
    tileMinX, tileMaxY, span,
  )
  if (!Number.isFinite(minVX) || maxVX <= 0 || maxVY <= 0 || minVX >= vrt.width || minVY >= vrt.height) {
    throw new TileNotFound(params.url)
  }

  const touched = vrt.sources.filter((s) =>
    s.dstX < maxVX && s.dstX + s.dstW > minVX && s.dstY < maxVY && s.dstY + s.dstH > minVY)
  if (!touched.length) throw new TileNotFound(params.url)
  if (touched.length > MAX_SOURCES_PER_TILE) {
    throw new Error(`vrt://: tile z${z}/${x}/${y} spans ${touched.length} source files (limit ${MAX_SOURCES_PER_TILE}) - zoom in, or serve this source through titiler`)
  }

  const { fromUrl } = await import("geotiff")
  const openTiff = (url: string) => {
    const hit = tiffCache.get(url)
    if (hit) return hit
    const p = fromUrl(url).catch((e: unknown) => { tiffCache.delete(url); throw e })
    tiffCache.set(url, p)
    return p
  }

  // Read each touched source once, over just the window this tile needs and at
  // roughly the tile's own resolution: geotiff picks an overview for the
  // requested width/height, which is what keeps a coarse zoom affordable.
  const reads = await Promise.all(touched.map(async (s) => {
    const x0 = Math.max(s.dstX, Math.floor(minVX)), x1 = Math.min(s.dstX + s.dstW, Math.ceil(maxVX))
    const y0 = Math.max(s.dstY, Math.floor(minVY)), y1 = Math.min(s.dstY + s.dstH, Math.ceil(maxVY))
    if (x1 <= x0 || y1 <= y0) return null
    // Virtual-raster window -> this source's own pixel window.
    const sx = s.srcW / s.dstW, sy = s.srcH / s.dstH
    const win: [number, number, number, number] = [
      Math.max(0, Math.floor(s.srcX + (x0 - s.dstX) * sx)),
      Math.max(0, Math.floor(s.srcY + (y0 - s.dstY) * sy)),
      Math.min(s.srcX + s.srcW, Math.ceil(s.srcX + (x1 - s.dstX) * sx)),
      Math.min(s.srcY + s.srcH, Math.ceil(s.srcY + (y1 - s.dstY) * sy)),
    ]
    if (win[2] <= win[0] || win[3] <= win[1]) return null
    const outW = Math.max(1, Math.min(TILE_SIZE, win[2] - win[0]))
    const outH = Math.max(1, Math.min(TILE_SIZE, win[3] - win[1]))
    try {
      const tiff = await openTiff(s.filename)
      // A file with no overviews has to decode its full-resolution window
      // however small the output is - Haiti's 1.5 m mosaic took 15 s for one
      // z11 tile that way (12 500 x 12 400 source pixels for a 256 x 256
      // output). Refusing beats a stalled map: the zoom range getVrtInfo
      // derives normally keeps maplibre above this, and titiler, which has
      // GDAL's own overview handling, is one switch away.
      if (!levelCache.has(s.filename)) {
        levelCache.set(s.filename, (tiff.getImageCount() as Promise<number>)
          .catch((e: unknown) => { levelCache.delete(s.filename); throw e }))
      }
      const levels = await levelCache.get(s.filename)!
      const decoded = Math.max(outW * outH, ((win[2] - win[0]) * (win[3] - win[1])) / 4 ** (levels - 1))
      if (decoded > MAX_READ_PIXELS) return { tooLarge: Math.round(decoded / 1e6) }
      // Nearest, NOT bilinear: these mosaics carry a nodata sentinel in the
      // same band (-99999 for RGE ALTI), and interpolating across its edge
      // produced values like -11 650 m - inside every sane guard, and a
      // kilometres-deep gash along every source boundary.
      const rasters = await tiff.readRasters({ window: win, width: outW, height: outH, resampleMethod: "nearest", fillValue: NaN, samples: [s.band - 1], signal })
      const band = (Array.isArray(rasters) ? rasters[0] : rasters) as unknown as ArrayLike<number>
      return { s, win, outW, outH, band }
    } catch {
      // One unreachable or unreadable file must not lose the whole tile: a
      // mosaic of thousands routinely has a few that 403 or time out.
      return null
    }
  }))
  const tooLarge = reads.find((r): r is { tooLarge: number } => !!r && "tooLarge" in r)
  const usable = reads.filter((r): r is Exclude<typeof r, null | { tooLarge: number }> => !!r && !("tooLarge" in r))
  // A partial composite would draw the refused file's area as a hole, which
  // reads as "no data here" rather than "too expensive to read" - so one
  // oversized source fails the tile outright.
  if (tooLarge) {
    throw new Error(`vrt://: tile z${z}/${x}/${y} would decode ~${tooLarge.tooLarge} Mpx from one source file - zoom in, or serve this source through titiler`)
  }
  if (!usable.length) throw new TileNotFound(params.url)

  const out = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  // The range guards are the usual DEM sentinels: OpenTopography's LiDAR
  // mosaics carry +1.70141e38 (the float32 max GDAL writes as nodata), which
  // would otherwise encode as ground somewhere past the top of the ramp.
  const isHole = (v: number, nd: number | null) =>
    !Number.isFinite(v) || (nd != null && v === nd) || v < -12000 || v > 9000

  for (let row = 0; row < TILE_SIZE; row++) {
    for (let col = 0; col < TILE_SIZE; col++) {
      const i = row * TILE_SIZE + col
      const px = vx[i], py = vy[i]
      let value = NaN
      // Last source wins where two overlap, which is GDAL's own z-order: a VRT
      // lists its sources in painting order.
      for (const r of usable) {
        if (!r) continue
        const { s, win, outW, outH, band } = r
        if (px < s.dstX || px >= s.dstX + s.dstW || py < s.dstY || py >= s.dstY + s.dstH) continue
        const sxPix = s.srcX + (px - s.dstX) * (s.srcW / s.dstW)
        const syPix = s.srcY + (py - s.dstY) * (s.srcH / s.dstH)
        const u = Math.floor(((sxPix - win[0]) / (win[2] - win[0])) * outW)
        const v = Math.floor(((syPix - win[1]) / (win[3] - win[1])) * outH)
        if (u < 0 || v < 0 || u >= outW || v >= outH) continue
        const sample = band[v * outW + u]
        if (isHole(sample, s.nodata ?? vrt.nodata)) continue
        value = sample
      }
      const hole = !Number.isFinite(value)
      // Same alpha-254 hole convention as demdiff:// and the COG reader: a
      // transparent pixel premultiplies to RGB 0, which in Terrain-RGB is
      // -10 000 m, so a nodata edge would draw a 10 km cliff. See
      // /docs/dev/demdiff-protocol.
      const [r8, g8, b8] = elevationToTerrainrgb(hole ? 0 : value)
      const o = i * 4
      out[o] = r8; out[o + 1] = g8; out[o + 2] = b8
      out[o + 3] = hole ? 254 : 255
    }
  }
  return { data: await toTileImage(out, TILE_SIZE, TILE_SIZE) }
}

/** The tile template for a VRT read in-browser: `vrt://<url>/{z}/{x}/{y}`. */
export function buildVrtUrl(vrtUrl: string): string {
  return `vrt://${encodeURIComponent(vrtUrl)}/{z}/{x}/{y}`
}
