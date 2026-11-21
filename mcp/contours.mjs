// Contour lines made by maplibre-contour, the library the app's contour
// layer runs, with the app's options (components/LayersAndSources/
// ContoursLayer.tsx): layer `contours`, `ele` and `level`, extent 4096,
// buffer 1, overzoom 1, major lines alone below zoom 6. In Node it needs an
// image decoder (sharp) in place of the browser's, and, for elevation on one
// of the app's own schemes (the local relief model's lrm://, an iso-line's
// slope://), the app's protocol in place of fetch.
import mlcontour from "maplibre-contour"
import { VectorTile } from "@mapbox/vector-tile"
import { PbfReader } from "pbf"
import sharp from "sharp"
import { pixelsOf } from "./browser-shim.mjs"

const CUSTOM = /^(?!https?:)[a-z][a-z0-9+.-]*:\/\//i

const managers = new Map()
function manager(dem) {
  let m = managers.get(dem.tiles)
  if (!m) {
    const encoding = dem.encoding === "mapbox" ? "mapbox" : "terrarium"
    const custom = CUSTOM.test(dem.tiles)
    m = new mlcontour.LocalDemManager({
      demUrlPattern: dem.tiles, cacheSize: 128, encoding, maxzoom: dem.maxzoom, timeoutMs: 60000,
      ...(custom ? {
        // As buildRegistryDemSource in ContoursLayer.tsx: the tile through the
        // app's registry, its pixels handed straight to the decoder.
        getTile: async (url) => {
          const A = await import("./generated/app-render.mjs")
          A.registerDerivedProtocols()
          return { data: await pixelsOf(await A.dispatchAppTile(url)) }
        },
        decodeImage: async (px, enc) => mlcontour.decodeParsedImage(px.width, px.height, enc, new Uint8ClampedArray(px.data.buffer, px.data.byteOffset, px.data.byteLength)),
      } : {
        decodeImage: async (blob, enc) => {
          const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          return mlcontour.decodeParsedImage(info.width, info.height, enc, new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength))
        },
      }),
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

/** One contour vector tile (MVT bytes), as the app's contour layer gets it.
 *  `minor`, `major`: the intervals, in the elevation's own unit. */
export async function contourVectorTile(dem, { minor, major }, z, x, y) {
  const tile = await manager(dem).fetchContourTile(z, x, y, {
    levels: levelsAt(z, minor, major), multiplier: 1,
    contourLayer: "contours", elevationKey: "ele", levelKey: "level", extent: 4096, buffer: 1, overzoom: 1,
  }, new AbortController())
  return Buffer.from(tile.arrayBuffer)
}

const esc = (t) => String(t).replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c])

/**
 * The contour lines over a rectangle of the world, as SVG: the vector tiles
 * the map would use at this scale (512 px each, the vector source's size),
 * at the app's widths and colour, with the app's labels (contourLabelsLayerDef:
 * the elevation and "m" on major lines, bold 10 px, a 1 px halo, placed along
 * the line every 250 px like a MapLibre line symbol, kept upright, not where
 * the line bends more than 45° or where another label already is).
 * opts: { minor, major, weight, color, labels, theme, unit }
 */
export async function contourSvg(dem, opts, { world, x0, y0, width, height }) {
  const { minor, major, weight = 1, labels = false, theme = "light", unit = "m" } = opts
  const color = opts.color || (theme === "dark" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)")
  const mapZoom = Math.log2(world / 512)
  const zv = Math.max(0, Math.min(contourMaxzoom(dem), Math.floor(mapZoom + 1e-9)))
  const tilePx = world / 2 ** zv
  const paths = { 0: [], 1: [] }
  const majors = []
  const jobs = []
  // Labels near the edge belong to lines in the next tile too: one more
  // vector tile around when labels are on, so neighbouring pictures place
  // the same labels.
  const pad = labels ? 120 : 0
  for (let ty = Math.floor((y0 - pad) / tilePx); ty <= Math.floor((y0 + height + pad - 1) / tilePx); ty++) for (let tx = Math.floor((x0 - pad) / tilePx); tx <= Math.floor((x0 + width + pad - 1) / tilePx); tx++) {
    if (ty < 0 || ty >= 2 ** zv) continue
    jobs.push(contourVectorTile(dem, { minor, major }, zv, ((tx % 2 ** zv) + 2 ** zv) % 2 ** zv, ty).then((bytes) => {
      const layer = new VectorTile(new PbfReader(bytes)).layers.contours
      if (!layer) return
      const k = tilePx / layer.extent, ox = tx * tilePx - x0, oy = ty * tilePx - y0
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const lines = f.loadGeometry().map((line) => line.map((p) => [ox + p.x * k, oy + p.y * k]))
        const lvl = f.properties.level === 1 ? 1 : 0
        paths[lvl].push(lines.map((l) => "M" + l.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")).join(""))
        if (lvl === 1) majors.push({ ele: f.properties.ele, lines, key: `${zv}/${tx}/${ty}/${i}` })
      }
    }).catch(() => { }))
  }
  await Promise.all(jobs)
  // MapLibre's line defaults: butt caps, miter joins.
  let svg = `<g fill="none" stroke="${esc(color)}" stroke-miterlimit="2"><path stroke-width="${0.5 * weight}" d="${paths[0].join("")}"/><path stroke-width="${weight}" d="${paths[1].join("")}"/></g>`
  if (labels) svg += labelSvg(majors, { theme, unit, width, height })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg}</svg>`
}

/** Line labels, as MapLibre places them roughly: every 250 px along each
 *  line from 125 px, where the 10 px glyphs fit on a stretch that turns
 *  less than 45°, upright, and not over an earlier label. */
function labelSvg(features, { theme, unit, width, height }) {
  const SPACING = 250, SIZE = 10, CHAR = 6.1, MAX_TURN = Math.PI / 4
  const boxes = []
  const out = []
  features.sort((a, b) => (a.key < b.key ? -1 : 1))
  for (const { ele, lines } of features) {
    const text = `${Number(ele).toLocaleString("en-US")}${unit}`
    const half = (text.length * CHAR) / 2 + 2
    for (const line of lines) {
      const cum = [0]
      for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
      const total = cum[cum.length - 1]
      if (total < 2 * half) continue
      const at = (d) => {
        let i = 1
        while (i < cum.length - 1 && cum[i] < d) i++
        const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
        return { x: line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, y: line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t, a: Math.atan2(line[i][1] - line[i - 1][1], line[i][0] - line[i - 1][0]) }
      }
      for (let d = SPACING / 2; d + half <= total; d += SPACING) {
        if (d - half < 0) continue
        const s = at(d - half), m = at(d), e = at(d + half)
        let turn = Math.abs(((e.a - s.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
        if (turn > MAX_TURN) continue
        if (m.x < -half || m.y < -half || m.x > width + half || m.y > height + half) continue
        const a = Math.atan2(e.y - s.y, e.x - s.x)
        const r = Math.hypot(half, SIZE / 2 + 1)
        if (boxes.some((b) => Math.hypot(b.x - m.x, b.y - m.y) < b.r + r)) continue
        boxes.push({ x: m.x, y: m.y, r })
        let deg = (a * 180) / Math.PI
        if (deg > 90) deg -= 180
        else if (deg < -90) deg += 180
        out.push(`<text transform="translate(${m.x.toFixed(1)},${m.y.toFixed(1)}) rotate(${deg.toFixed(1)})">${esc(text)}</text>`)
      }
    }
  }
  if (!out.length) return ""
  const fill = theme === "dark" ? "#ffffff" : "#000000", halo = theme === "dark" ? "#000000" : "#ffffff"
  return `<g font-family="Noto Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="bold" font-size="${SIZE}" text-anchor="middle" dominant-baseline="central" fill="${fill}" stroke="${halo}" stroke-width="2" stroke-linejoin="round" paint-order="stroke">${out.join("")}</g>`
}
