// Contour lines made by maplibre-contour, the library the app's contour
// layer runs, with the app's options (components/LayersAndSources/
// ContoursLayer.tsx): layer `contours`, `ele` and `level`, extent 4096,
// buffer 1, overzoom 1, major lines alone below zoom 6. In Node it needs an
// image decoder (sharp) in place of the browser's.
import mlcontour from "maplibre-contour"
import { VectorTile } from "@mapbox/vector-tile"
import { PbfReader } from "pbf"
import sharp from "sharp"

const managers = new Map()
function manager(dem) {
  let m = managers.get(dem.tiles)
  if (!m) {
    m = new mlcontour.LocalDemManager({
      demUrlPattern: dem.tiles, cacheSize: 128, encoding: dem.encoding === "mapbox" ? "mapbox" : "terrarium", maxzoom: dem.maxzoom, timeoutMs: 20000,
      decodeImage: async (blob, encoding) => {
        const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        return mlcontour.decodeParsedImage(info.width, info.height, encoding, new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength))
      },
    })
    managers.set(dem.tiles, m)
    if (managers.size > 16) managers.delete(managers.keys().next().value)
  }
  return m
}

/** The app's contour levels at a vector tile zoom (buildThresholds). */
export function levelsAt(z, minor, major) {
  if (!(minor > 0)) return z < 6 ? [major] : [major, major]
  return z < 6 ? [major] : [minor, major]
}

/** The vector source's deepest zoom in the app: the DEM's, at least 15. */
export const contourMaxzoom = (dem) => Math.max(15, dem.maxzoom)

/** One contour vector tile (MVT bytes), as the app's contour layer gets it. */
export async function contourVectorTile(dem, s, z, x, y) {
  const tile = await manager(dem).fetchContourTile(z, x, y, {
    levels: levelsAt(z, s.contourMinor, s.contourMajor), multiplier: 1,
    contourLayer: "contours", elevationKey: "ele", levelKey: "level", extent: 4096, buffer: 1, overzoom: 1,
  }, new AbortController())
  return Buffer.from(tile.arrayBuffer)
}

/** The contour lines over a rectangle of the world, drawn as an SVG: the
 *  vector tiles the map would use at this scale (512 px each, the vector
 *  source's size), at the app's widths and colour. */
export async function contourSvg(dem, s, { world, x0, y0, width, height }) {
  const mapZoom = Math.log2(world / 512)
  const zv = Math.max(0, Math.min(contourMaxzoom(dem), Math.floor(mapZoom + 1e-9)))
  const tilePx = world / 2 ** zv
  const paths = { 0: [], 1: [] }
  const jobs = []
  for (let ty = Math.floor(y0 / tilePx); ty <= Math.floor((y0 + height - 1) / tilePx); ty++) for (let tx = Math.floor(x0 / tilePx); tx <= Math.floor((x0 + width - 1) / tilePx); tx++) {
    jobs.push(contourVectorTile(dem, s, zv, tx, ty).then((bytes) => {
      const layer = new VectorTile(new PbfReader(bytes)).layers.contours
      if (!layer) return
      const k = tilePx / layer.extent, ox = tx * tilePx - x0, oy = ty * tilePx - y0
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const d = f.loadGeometry().map((line) => "M" + line.map((p) => `${(ox + p.x * k).toFixed(2)},${(oy + p.y * k).toFixed(2)}`).join("L")).join("")
        paths[f.properties.level === 1 ? 1 : 0].push(d)
      }
    }).catch(() => { }))
  }
  await Promise.all(jobs)
  // MapLibre's line defaults: butt caps, miter joins.
  const stroke = s.contourColor || "rgba(0,0,0,0.5)"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="none" stroke="${stroke}" stroke-miterlimit="2"><path stroke-width="${0.5 * s.contourWeight}" d="${paths[0].join("")}"/><path stroke-width="${s.contourWeight}" d="${paths[1].join("")}"/></g></svg>`
}
