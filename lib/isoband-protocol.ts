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

const ISOBAND_URL_RE = /^isoband:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?v=(-?[\d.]+)$/
const EXTENT = 4096
const HALO = 1

export function buildIsobandProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, value: number): string {
  return `${buildProtocolUrl("isoband", upstreamTileTemplate, encoding, tileSize)}?v=${Number.isFinite(value) ? value : 0}`
}

export async function isobandProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: Uint8Array }> {
  const match = params.url.match(ISOBAND_URL_RE)
  if (!match) throw new Error(`Invalid isoband protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, vStr] = match
  const n = parseInt(tileSizeStr, 10)
  const value = parseFloat(vStr)
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
  const scale = EXTENT / n
  const toTile = (p: number[]) => [(p[0] - HALO) * scale, (p[1] - HALO) * scale]
  const onBorder = (p: number[]) => p[0] <= 0 || p[1] <= 0 || p[0] >= stride || p[1] >= stride
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
          if (run.length >= 4) lines.push({ type: GeomType.LINESTRING, properties: { ele: value }, geometry: [run] })
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
