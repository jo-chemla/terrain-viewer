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
import { symbolAnchors } from "./symbols.mjs"

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
        for (const l of lines) paths[lvl].push("M" + l.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L"))
        if (lvl === 1) {
          const r = 8192 / layer.extent
          majors.push({ ele: f.properties.ele, tx, ty, i, ox, oy, unit: tilePx / 8192, lines: f.loadGeometry().map((line) => line.map((p) => [Math.round(p.x * r), Math.round(p.y * r)])) })
        }
      }
    }).catch(() => { }))
  }
  await Promise.all(jobs)
  // MapLibre's line defaults: butt caps, miter joins.
  // One path per line: MapLibre draws each line on its own, so where
  // semi-transparent lines cross or crowd their colours add up. One path
  // for all of them would be painted once, as their union, and dense
  // contours would turn into a flat grey.
  const each = (ds, w) => ds.length ? `<g stroke-width="${w}">${ds.map((d) => `<path d="${d}"/>`).join("")}</g>` : ""
  let svg = `<g fill="none" stroke="${esc(color)}" stroke-miterlimit="2">${each(paths[0], 0.5 * weight)}${each(paths[1], weight)}</g>`
  if (labels) svg += labelSvg(majors, { theme, unit, width, height, overscaling: 2 ** Math.max(0, Math.floor(mapZoom + 1e-9) - zv) })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg}</svg>`
}

/** Line labels where MapLibre puts them (symbols.mjs): per vector tile, on
 *  a 250 px spacing, not where the line turns more than 45°; tiles placed
 *  bottom row first, then right to left, features in tile order, a label
 *  dropped where it would touch an earlier one (2 px of padding). Drawn
 *  straight along the chord of the stretch it covers, kept upright. */
function labelSvg(features, { theme, unit, width, height, overscaling = 1 }) {
  const SIZE = 10, CHAR = 6.1, PAD = 2
  const placed = [] // collision circles: { x, y, r }
  const out = []
  features.sort((a, b) => b.ty - a.ty || b.tx - a.tx || a.i - b.i)
  for (const { ele, lines, ox, oy, unit: u } of features) {
    const text = `${Number(ele).toLocaleString("en-US")}${unit}`
    const textPx = text.length * CHAR, half = textPx / 2
    for (const anchor of symbolAnchors(lines, { spacingPx: 250, shapedLength: (textPx * 24) / SIZE, boxSize: SIZE, text: true, overscaling })) {
      // The points half the label's length before and after the anchor.
      const line = anchor.line, halfUnits = half / u
      const walk = (dir) => {
        let p = [anchor.x, anchor.y], left = halfUnits
        for (let i = dir > 0 ? anchor.segment + 1 : anchor.segment; dir > 0 ? i < line.length : i >= 0; i += dir) {
          const q = line[i], d = Math.hypot(q[0] - p[0], q[1] - p[1])
          if (d >= left) return [p[0] + ((q[0] - p[0]) * left) / d, p[1] + ((q[1] - p[1]) * left) / d]
          left -= d; p = q
        }
        return p
      }
      const s0 = walk(-1), e0 = walk(1)
      const m = { x: ox + anchor.x * u, y: oy + anchor.y * u }
      if (m.x < -half || m.y < -half || m.x > width + half || m.y > height + half) continue
      const a = Math.atan2(e0[1] - s0[1], e0[0] - s0[0])
      // Circles along the label, as MapLibre's collision circles for line labels.
      const r = SIZE / 2 + PAD, n = Math.max(1, Math.ceil(textPx / (2 * r)))
      const circles = []
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : -half + r + ((textPx - 2 * r) * k) / (n - 1)
        circles.push({ x: m.x + Math.cos(a) * t, y: m.y + Math.sin(a) * t, r })
      }
      if (circles.some((c) => placed.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < p.r + c.r))) continue
      placed.push(...circles)
      let deg = (a * 180) / Math.PI
      if (deg > 90) deg -= 180
      else if (deg < -90) deg += 180
      out.push(`<text transform="translate(${m.x.toFixed(1)},${m.y.toFixed(1)}) rotate(${deg.toFixed(1)})">${esc(text)}</text>`)
    }
  }
  if (!out.length) return ""
  const fill = theme === "dark" ? "#ffffff" : "#000000", halo = theme === "dark" ? "#000000" : "#ffffff"
  return `<g font-family="Noto Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="bold" font-size="${SIZE}" text-anchor="middle" dominant-baseline="central" fill="${fill}" stroke="${halo}" stroke-width="2" stroke-linejoin="round" paint-order="stroke">${out.join("")}</g>`
}
