#!/usr/bin/env node
// The MapLibre styles the app serves itself (public/styles/), rebuilt from
// their upstream repositories at a pinned commit:
//
//   gpx.studio's styles (github.com/gpxstudio/styles: liberty-topo,
//   liberty-satellite, osm, osm-topo). Its hosts (tiles., fonts., sprites.,
//   styles.gpx.studio) send no CORS header, so a browser on another origin
//   cannot read them; copies are kept here (MIT, BSD and CC BY allow it),
//   credited, pointed at OpenFreeMap. The tiles are the same OpenMapTiles
//   schema, the fonts the same three Noto Sans, Liberty's sprite the same
//   file.
//
//   Carte Facile's "aerial" style of IGN's Plan IGN tiles
//   (github.com/fab-geocommuns/carte-facile, Apache-2.0), which lives inside
//   an npm bundle and has no address of its own.
//
// What is changed in each is written into the file's `metadata`
// ("terrain-viewer:changes"), with the credits and licences. Run by hand:
// `node scripts/build-vector-styles.mjs` (needs the network), then
// `node scripts/test-lib.mjs lib/vector-sources.test.ts`.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "styles")
const GPX_COMMIT = "24034041bc7c210edc53af8495213092a1715fcd" // 2026-06-09
const CF_COMMIT = "a9bc8668e0f8be332a1114f6c29c5cfab619fe90" // carte-facile 0.10.2
const gpxRaw = (name) => `https://raw.githubusercontent.com/gpxstudio/styles/${GPX_COMMIT}/${name}.json`

export const OFM_TILES = "https://tiles.openfreemap.org/planet"
export const OFM_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
export const OFM_SPRITE = "https://tiles.openfreemap.org/sprites/ofm_f384/ofm"
/** The font a missing one is replaced with, by what its name says. */
const nearestFont = (font) => (/bold|black|heavy|semi/i.test(font) ? "Noto Sans Bold" : /italic|oblique/i.test(font) ? "Noto Sans Italic" : "Noto Sans Regular")

const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() }
const bytes = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()) }

// Every font stack a style names: a plain array of names, a ["literal", […]]
// inside an expression, the outputs of a zoom function.
const isStack = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")
function eachFontStack(value, visit, top = true) {
  if (top && isStack(value) && value[0] !== "literal") return visit(value)
  if (Array.isArray(value)) {
    if (value[0] === "literal" && isStack(value[1])) return visit(value[1])
    for (const x of value) eachFontStack(x, visit, false)
  } else if (value && typeof value === "object") {
    for (const stop of value.stops ?? []) if (isStack(stop[1])) visit(stop[1])
  }
}

/** Fonts of the style that OpenFreeMap does not serve are replaced in place
 *  by the nearest one it does; returns the substitutions made. */
async function fitFonts(style) {
  const known = new Map()
  const serves = async (font) => {
    if (!known.has(font)) known.set(font, (await fetch(OFM_GLYPHS.replace("{fontstack}", encodeURIComponent(font)).replace("{range}", "0-255"), { method: "HEAD" })).ok)
    return known.get(font)
  }
  const stacks = []
  for (const l of style.layers) eachFontStack(l.layout?.["text-font"], (s) => stacks.push(s))
  const swapped = new Map()
  for (const stack of stacks) {
    // OpenFreeMap serves one font per request, not a comma-joined stack.
    const first = stack[0]
    const font = (await serves(first)) ? first : nearestFont(first)
    if (font !== first) swapped.set(first, font)
    stack.splice(0, stack.length, font)
  }
  return { fonts: [...new Set(stacks.map((s) => s[0]))].sort(), swapped: [...swapped].map(([a, b]) => `${a} -> ${b}`) }
}

/** Drops the sources named and every layer that reads one. */
function dropSources(style, ids) {
  const dropped = style.layers.filter((l) => ids.includes(l.source)).map((l) => l.id)
  style.layers = style.layers.filter((l) => !ids.includes(l.source))
  for (const id of ids) delete style.sources[id]
  return dropped
}

const GPX_CREDIT = {
  "terrain-viewer:credit": "Style by gpx.studio (https://gpx.studio, https://github.com/gpxstudio/styles), copied under its licence (MIT for Liberty, BSD 3-Clause and CC BY 4.0 for OpenMapTiles' design) and credited. Tiles, fonts and sprite: OpenFreeMap (https://openfreemap.org). Schema and design: © OpenMapTiles (https://www.openmaptiles.org/). Data: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).",
  "terrain-viewer:source": `https://github.com/gpxstudio/styles/tree/${GPX_COMMIT}`,
}
const LIBERTY_LICENSE = "MIT (OpenFreeMap Styles, © 2023 Zsolt Ero; gpx.studio's changes under the same terms, https://github.com/gpxstudio/styles/blob/main/license.md). Liberty is a fork of maputnik/osm-liberty, itself a fork of OSM Bright, derived from Mapbox Open Styles: code BSD 3-Clause, design CC BY 4.0. Fonts: Noto Sans, SIL OFL 1.1. Icons: Maki, CC0."
const OSM_LICENSE = "OpenMapTiles' OSM style (https://github.com/openmaptiles/openmaptiles/tree/master/style): code BSD 3-Clause, design CC BY 4.0, credit © OpenMapTiles © OpenStreetMap contributors. Icons from openstreetmap-carto, CC0. Fonts: Noto Sans, SIL OFL 1.1."

async function gpxStyle(name, { license, sprite, keepTypes, note }) {
  const style = await json(gpxRaw(name))
  const changes = []
  // What gpx.studio serves itself, or with a key: its hillshade and contour
  // vector tiles (made from Mapterhorn, no CORS header), MapTiler's satellite
  // imagery (key), and a source that only carried a credit.
  const closed = Object.keys(style.sources).filter((id) => id !== "openmaptiles")
  const dropped = dropSources(style, closed)
  if (closed.length) changes.push(`sources dropped with their layers (${closed.join(", ")}): ${dropped.join(", ") || "no layer"}`)
  if (keepTypes) {
    const before = style.layers.length
    style.layers = style.layers.filter((l) => keepTypes.includes(l.type))
    changes.push(`cut to ${keepTypes.join(" and ")} layers (${before - style.layers.length} of ${before} dropped)`)
  }
  style.sources = { openmaptiles: { type: "vector", url: OFM_TILES } }
  style.glyphs = OFM_GLYPHS
  style.sprite = sprite
  changes.push("tiles, fonts and sprite moved from gpx.studio's hosts to OpenFreeMap's")
  // The original filters on "brunel", a key neither tile set has: the
  // schema's key is "brunnel", so pedestrian tunnels were drawn as streets.
  let typo = 0
  const fix = (v) => (Array.isArray(v) ? v.map((x) => (x === "brunel" ? (typo++, "brunnel") : fix(x))) : v)
  for (const l of style.layers) if (l.filter) l.filter = fix(l.filter)
  if (typo) changes.push(`filter key "brunel" corrected to "brunnel" (${typo} layers)`)
  const { fonts, swapped } = await fitFonts(style)
  if (swapped.length) changes.push(`fonts replaced: ${swapped.join(", ")}`)
  if (note) changes.push(note)
  style.name = `gpx.studio ${name}`
  style.metadata = { ...GPX_CREDIT, "terrain-viewer:license": license, "terrain-viewer:changes": changes, "terrain-viewer:fonts": fonts }
  return style
}

/** The images of a sprite a set of layers can ask for are all of them but
 *  the fill patterns: every image no larger than `max` pixels a side at 1x,
 *  repacked in rows. Returns the two index files and the two pictures. */
async function iconSprite(base, max) {
  const out = {}
  for (const ratio of [1, 2]) {
    const suffix = ratio === 2 ? "@2x" : ""
    const index = await json(`${base}${suffix}.json`)
    const sheet = sharp(await bytes(`${base}${suffix}.png`))
    const names = Object.keys(index).filter((n) => index[n].width <= max * ratio && index[n].height <= max * ratio).sort()
    const width = 512 * ratio
    let x = 0, y = 0, row = 0
    const packed = {}, parts = []
    for (const n of names) {
      const i = index[n]
      if (x + i.width > width) { x = 0; y += row; row = 0 }
      parts.push({ input: await sheet.clone().extract({ left: i.x, top: i.y, width: i.width, height: i.height }).png().toBuffer(), left: x, top: y })
      packed[n] = { ...i, x, y }
      x += i.width; row = Math.max(row, i.height)
    }
    const png = await sharp({ create: { width, height: y + row, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(parts).png({ compressionLevel: 9, palette: false }).toBuffer()
    out[`sprite${suffix}.json`] = JSON.stringify(packed)
    out[`sprite${suffix}.png`] = png
    out.count = names.length
    out.total = Object.keys(index).length
  }
  return out
}

async function main() {
  mkdirSync(join(OUT, "gpx-osm"), { recursive: true })
  const written = []
  const write = (file, data) => { writeFileSync(join(OUT, file), data); written.push(`${file} ${(Buffer.byteLength(data) / 1e3).toFixed(0)} KB`) }

  write("gpx-liberty-satellite.json", JSON.stringify(await gpxStyle("liberty-satellite", { license: LIBERTY_LICENSE, sprite: OFM_SPRITE })))
  write("gpx-liberty-topo.json", JSON.stringify(await gpxStyle("liberty-topo", { license: LIBERTY_LICENSE, sprite: OFM_SPRITE })))

  // OSM: its sprite is not OpenFreeMap's. 0.3 MB (1.1 MB at 2x) of it are the
  // fill patterns of OSM Carto (forest, scrub, wetland, 128 and 256 px); the
  // icons, shields and arrows the lines and labels use fit in a few tens of
  // kilobytes, so the copy keeps the lines and labels and their images.
  const sprite = await iconSprite("https://sprites.gpx.studio/osm/sprite", 48)
  for (const f of ["sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"]) write(`gpx-osm/${f}`, sprite[f])
  write("gpx-osm.json", JSON.stringify(await gpxStyle("osm", {
    license: OSM_LICENSE, sprite: "./gpx-osm/sprite", keepTypes: ["line", "symbol"],
    note: `sprite: ${sprite.count} of its ${sprite.total} images kept (the fill patterns left out), served beside this file; a relative address, resolved against the style's`,
  })))

  // Carte Facile, aerial: the lines and names it lays over IGN's aerial
  // photographs. The photographs (an open WMTS, no key) are left out: the
  // overlay goes over whatever basemap the view has.
  const cf = await json(`https://raw.githubusercontent.com/fab-geocommuns/carte-facile/${CF_COMMIT}/src/maps/aerial.json`)
  const cfDropped = dropSources(cf, ["Ortho IGN"])
  const bg = cf.layers.filter((l) => l.type === "background").map((l) => l.id)
  cf.layers = cf.layers.filter((l) => l.type !== "background")
  cf.glyphs = OFM_GLYPHS
  const cfFonts = await fitFonts(cf)
  cf.name = "Carte Facile aerial (IGN)"
  cf.metadata = {
    "terrain-viewer:credit": "Style by Carte Facile (La Fabrique des géocommuns, IGN; https://fab-geocommuns.github.io/carte-facile-site/, https://github.com/fab-geocommuns/carte-facile). Tiles: © IGN, Plan IGN, Géoplateforme (https://cartes.gouv.fr), Licence Ouverte 2.0. Fonts: Noto Sans (SIL OFL 1.1) from OpenFreeMap.",
    "terrain-viewer:source": `https://github.com/fab-geocommuns/carte-facile/blob/${CF_COMMIT}/src/maps/aerial.json`,
    "terrain-viewer:license": "Apache-2.0 (carte-facile, https://github.com/fab-geocommuns/carte-facile/blob/main/LICENSE). Modified from the original as listed under terrain-viewer:changes.",
    "terrain-viewer:changes": [
      `source dropped with its layer (Ortho IGN, IGN's aerial photographs): ${cfDropped.join(", ")}`,
      `background dropped: ${bg.join(", ")}`,
      "fonts moved from openmaptiles.geo.data.gouv.fr to OpenFreeMap (the same three Noto Sans)",
      ...(cfFonts.swapped.length ? [`fonts replaced: ${cfFonts.swapped.join(", ")}`] : []),
      "its French and English description (metadata) left out",
    ],
    "terrain-viewer:fonts": cfFonts.fonts,
  }
  write("ign-carte-facile-aerial.json", JSON.stringify(cf))
  console.log(written.join("\n"))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1) })
