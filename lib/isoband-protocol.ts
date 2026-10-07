// The Iso-line "at a value" as vector tiles, registered as `isoband://`:
// the tile and its one-pixel halo of the measure's DEM-shaped template
// (the terrain, a derived mode, luma:// over a light) run through marching
// squares at one threshold (d3-contour), which yields the POLYGONS of the
// area at or above the value; the line is those polygons' boundary. One
// geometry for both, so the fill stops exactly on the line, with no raster
// resampling between them. Two layers in the tile: "isoband" (polygons) and
// "isoline" (the rings as lines, minus the segments that run along the
// grid's border, which are the tile edge, not a contour).
//
// d3-contour places the value of pixel i at i + 0.5 and closes rings along
// the grid's outer edge; the grid is the padded one (halo 1), so a polygon
// reaches one pixel past the tile on every side (the vector tile's buffer),
// and adjacent tiles' fills meet without a seam.
import { contours } from "d3-contour"
import { sharedTileCache, fetchPaddedElevationGrid, buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"
import { encodeVectorTile, GeomType, type VectorTileFeature } from "./mvt-encode"

const ISOBAND_URL_RE = /^isoband:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?v=(-?[\d.]+)(?:&s=(\d+))?(?:&m=(\d+))?$/
const EXTENT = 4096

/** `smooth`: a box blur of that many pixels on the measure before the line
 *  is traced (the halo grows with it, so tiles still meet); `minLength`:
 *  runs of the line shorter than that many pixels are dropped. Both for
 *  the cliff line, which wants the outline of the steep areas rather than
 *  every wiggle and speck of the full-resolution measure. */
export function buildIsobandProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, value: number, opts: { smooth?: number; minLength?: number } = {}): string {
  const extra = `${opts.smooth ? `&s=${Math.round(opts.smooth)}` : ""}${opts.minLength ? `&m=${Math.round(opts.minLength)}` : ""}`
  return `${buildProtocolUrl("isoband", upstreamTileTemplate, encoding, tileSize)}?v=${Number.isFinite(value) ? value : 0}${extra}`
}

/** Separable box blur of radius r on a stride×stride grid, in place; the
 *  -1e9 nodata values are left out of the averages. */
function boxBlur(values: number[], stride: number, r: number) {
  const tmp = new Array<number>(values.length)
  const pass = (src: number[], dst: number[], horizontal: boolean) => {
    for (let a = 0; a < stride; a++) {
      for (let b = 0; b < stride; b++) {
        let sum = 0, cnt = 0
        for (let k = -r; k <= r; k++) {
          const c = b + k
          if (c < 0 || c >= stride) continue
          const v = horizontal ? src[a * stride + c] : src[c * stride + a]
          if (v > -1e8) { sum += v; cnt++ }
        }
        const i = horizontal ? a * stride + b : b * stride + a
        dst[i] = cnt ? sum / cnt : -1e9
      }
    }
  }
  pass(values, tmp, true)
  pass(tmp, values, false)
}

export async function isobandProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: Uint8Array }> {
  const match = params.url.match(ISOBAND_URL_RE)
  if (!match) throw new Error(`Invalid isoband protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, vStr, sStr, mStr] = match
  const n = parseInt(tileSizeStr, 10)
  const value = parseFloat(vStr)
  const smooth = sStr ? Math.min(16, parseInt(sStr, 10)) : 0
  const minLength = mStr ? parseInt(mStr, 10) : 0
  // The blur needs neighbours past the tile edge: a wider halo, so the
  // smoothed lines of adjacent tiles still meet.
  const HALO = Math.max(1, smooth + 1)
  const grid = await fetchPaddedElevationGrid(sharedTileCache, decodeURIComponent(encodedTemplate), encodingRaw as UpstreamEncoding, parseInt(zStr, 10), parseInt(xStr, 10), parseInt(yStr, 10), n, abortController.signal, HALO)
  const empty = () => ({ data: encodeVectorTile({ extent: EXTENT, layers: { isoband: { features: [] }, isoline: { features: [] } } }) })
  if (!grid) return empty()
  const { padded, stride, paddedValid } = grid
  // Nodata counts as below: a hole never fills.
  const values: number[] = new Array(stride * stride)
  let any = false
  for (let i = 0; i < values.length; i++) {
    const ok = !paddedValid || paddedValid[i] !== 0
    const v = ok && Number.isFinite(padded[i]) ? padded[i] : -1e9
    values[i] = v
    if (v >= value) any = true
  }
  if (!any) return empty()
  if (smooth > 0) boxBlur(values, stride, smooth)
  const scale = EXTENT / n
  const toTile = (p: number[]) => [(p[0] - HALO) * scale, (p[1] - HALO) * scale]
  const onBorder = (p: number[]) => p[0] <= 0 || p[1] <= 0 || p[0] >= stride || p[1] >= stride
  const runLength = (run: number[]) => { let l = 0; for (let i = 2; i < run.length; i += 2) l += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1]); return l }
  const polygons: VectorTileFeature[] = []
  const lines: VectorTileFeature[] = []
  const [result] = contours().size([stride, stride]).thresholds([value])(values)
  for (const polygon of result?.coordinates ?? []) {
    const rings: number[][] = []
    for (const ring of polygon) {
      const flat: number[] = []
      for (const p of ring) { const [x, y] = toTile(p); flat.push(x, y) }
      rings.push(flat)
      // The ring's runs that are not along the grid border, as lines.
      let run: number[] = []
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[i + 1]
        const edgeOnBorder = q ? onBorder(p) && onBorder(q) && (p[0] === q[0] || p[1] === q[1]) : true
        if (!run.length) { const [x, y] = toTile(p); run.push(x, y) }
        if (edgeOnBorder || !q) {
          if (run.length >= 4 && (!minLength || runLength(run) >= minLength * scale)) lines.push({ type: GeomType.LINESTRING, properties: { ele: value }, geometry: [run] })
          run = []
        } else {
          const [x, y] = toTile(q); run.push(x, y)
        }
      }
    }
    polygons.push({ type: GeomType.POLYGON, properties: { ele: value }, geometry: rings })
  }
  return { data: encodeVectorTile({ extent: EXTENT, layers: { isoband: { features: polygons }, isoline: { features: lines } } }) }
}
