// Run with: node scripts/test-lib.mjs lib/tile-transform-protocol.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildTileTransformUrl, childTiles, makeOpaque, tileIntersects, wantsTileTransform, MAX_UNDERZOOM } from "./tile-transform-protocol"
import { LIBRARY_GROUPS, libraryGroup } from "./library-groups"
import { searchLibrary } from "./library-search"

const lib = JSON.parse(readFileSync("lib/custom-sources.json", "utf8"))
const basemaps: any[] = lib.SAMPLE_BASEMAPS_SOURCES
const TIKAL: [number, number, number, number] = [-89.684, 17.158, -89.576, 17.475]

test("makeOpaque lifts any alpha to 255 and keeps no-data transparent", () => {
  const d = new Uint8ClampedArray([10, 20, 30, 127, 1, 2, 3, 0, 4, 5, 6, 255, 7, 8, 9, 1])
  makeOpaque(d)
  assert.deepEqual([...d], [10, 20, 30, 255, 1, 2, 3, 0, 4, 5, 6, 255, 7, 8, 9, 255])
})

test("underzoom lowers the MapLibre minzoom, capped at 3 levels", () => {
  const t = "https://example.com/tile/{z}/{y}/{x}"
  assert.equal(buildTileTransformUrl(t, { underzoom: 3, minzoom: 12 }).minzoom, 9)
  assert.equal(buildTileTransformUrl(t, { underzoom: 9, minzoom: 12 }).minzoom, 12 - MAX_UNDERZOOM)
  assert.equal(buildTileTransformUrl(t, { underzoom: 3, minzoom: 1 }).minzoom, 0)
  assert.equal(buildTileTransformUrl(t, { forceOpaque: true, minzoom: 12 }).minzoom, 12)
  assert.equal(wantsTileTransform({ underzoom: 3 }), false, "no minzoom, nothing to underzoom")
  assert.equal(wantsTileTransform({}), false)
  assert.equal(wantsTileTransform({ forceOpaque: true }), true)
})

test("the tiletx URL round-trips the template, scheme and bounds", () => {
  const { url } = buildTileTransformUrl("https://a.b/c/{z}/{y}/{x}?k=1&j=2", { forceOpaque: true, underzoom: 2, minzoom: 11, scheme: "tms", bounds: TIKAL })
  assert.match(url, /^tiletx:\/\/[^/]+\/\{z\}\/\{x\}\/\{y\}\?o=1&mz=11&uz=2&s=tms&b=-89\.684,17\.158,-89\.576,17\.475$/)
  assert.equal(decodeURIComponent(url.slice(9, url.indexOf("/{z}"))), "https://a.b/c/{z}/{y}/{x}?k=1&j=2")
})

test("children outside the bounds are not fetched", () => {
  // Tikal at z9: one parent tile, 64 children at z12, only a handful inside.
  const lng = -89.63, lat = 17.3, z = 9
  const x = Math.floor(((lng + 180) / 360) * 2 ** z)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
  const all = childTiles(z, x, y, 3, null)
  const inside = childTiles(z, x, y, 3, TIKAL)
  assert.equal(all.length, 64)
  assert.ok(inside.length > 0 && inside.length <= 12, `${inside.length} children`)
  for (const c of inside) assert.ok(c.dx >= 0 && c.dx < 8 && c.dy >= 0 && c.dy < 8)
  assert.equal(tileIntersects(z, x + 3, y, TIKAL), false)
})

test("every library group key is registered, every relief entry is a raster overlay with credits", () => {
  const keys = new Set(LIBRARY_GROUPS.map((g) => g.key))
  for (const s of [...basemaps, ...lib.SAMPLE_TERRAIN_SOURCES]) {
    if (!s.libraryGroup) continue
    assert.ok(keys.has(s.libraryGroup), `${s.id}: unknown group ${s.libraryGroup}`)
    if (s.libraryGroup === "relief") {
      assert.ok(s.attribution || s.description?.includes("©"), `${s.id}: no attribution`)
      assert.ok(s.infoUrl, `${s.id}: no infoUrl`)
    }
  }
})

test("forceOpaque / underzoom entries are tiled http(s) templates, underzoom has a minzoom", () => {
  for (const s of basemaps) {
    if (!s.forceOpaque && !s.underzoom) continue
    assert.ok(/^https?:\/\//.test(s.url) && /\{z\}|\{bbox-epsg-3857\}/.test(s.url), `${s.id}: not a tile template`)
    if (s.underzoom) assert.ok(s.minzoom > 0 && s.underzoom <= MAX_UNDERZOOM, `${s.id}: underzoom without minzoom`)
  }
  for (const id of ["maya-lidar-tikal-svf", "maya-lidar-tikal-ld", "maya-lidar-chactun-svf"]) assert.equal(basemaps.find((s) => s.id === id)?.forceOpaque, true, id)
  assert.equal(basemaps.find((s) => s.id === "maya-lidar-chactun-svf")?.maxzoom, 20)
})

test("the relief group is found by its theme words, like the dialog's search", () => {
  // What the dialog reads of a row (sample-sources-modal.tsx rowText).
  const textOf = (s: any) => `${s.name} ${s.id} ${s.type ?? ""} ${s.keywords ?? ""}${s.libraryGroup ? ` ${libraryGroup(s.libraryGroup).title} ${libraryGroup(s.libraryGroup).keywords ?? ""}` : ""}`
  const relief = basemaps.filter((s) => s.libraryGroup === "relief").map((s) => s.id)
  for (const q of ["archaeology", "relief", "sky view factor"]) {
    const ids = searchLibrary(basemaps, textOf, q).map((s) => s.id)
    for (const id of relief) assert.ok(ids.includes(id), `${id} missing for "${q}"`)
  }
})
