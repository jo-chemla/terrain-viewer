// node scripts/test-lib.mjs lib/ndsm-mode.test.ts
// The nDSM / DEM difference mode's tiles: the view's terrain minus a
// subtrahend, through demdiff://. Offline: the two operands' tiles are put in
// the decoded-tile cache the protocol reads.
import { test } from "node:test"
import assert from "node:assert/strict"
import { ndsmTileSpec, NDSM_PRESETS, type NdsmOperand } from "./ndsm-mode"
import { demDiffProtocol } from "./demdiff-protocol"
import { sharedTileCache, type DecodedTile } from "./normal-derived-protocol"
import { colorRampsClassic } from "./color-ramps"

// toTileImage's two browser types: hand the pixels straight back.
const g = globalThis as Record<string, unknown>
g.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} }
g.createImageBitmap = async (d: unknown) => d

const DSM: NdsmOperand = { template: "https://dsm.test/{z}/{x}/{y}.png", encoding: "terrarium", tileSize: 256, minzoom: 2, maxzoom: 14 }
const DTM: NdsmOperand = { template: "https://dtm.test/{z}/{x}/{y}.png", encoding: "mapbox", tileSize: 256, minzoom: 0, maxzoom: 12 }

const flat = (value: number, size = 256, valid?: Uint8Array): DecodedTile => ({ data: new Float32Array(size * size).fill(value), width: size, height: size, ...(valid ? { valid } : {}) })
const put = (op: NdsmOperand, z: number, x: number, y: number, tile: DecodedTile | null) =>
  sharedTileCache.set(op.template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)), Promise.resolve(tile))

/** A mode tile's values (Terrain-RGB) and its hole flags (alpha 254). */
async function tile(spec: { template: string; tileSize: number }, z: number, x: number, y: number) {
  const url = spec.template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
  const { data } = await demDiffProtocol({ url }, new AbortController()) as unknown as { data: { data: Uint8ClampedArray; width: number } }
  const px = data.data, n = px.length / 4
  const values = new Float64Array(n), holes = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    values[i] = Math.round((-10000 + (px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) * 0.1) * 10) / 10
    holes[i] = px[i * 4 + 3] === 254 ? 1 : 0
  }
  return { values, holes, width: data.width }
}

test("the template is a demdiff:// one on the view terrain's grid, Terrain-RGB", () => {
  const spec = ndsmTileSpec(DSM, DTM)
  assert.match(spec.template, /^demdiff:\/\/terrarium\/mapbox\/256~0~0~14~12\/0\//)
  assert.ok(spec.template.endsWith("/{z}/{x}/{y}"))
  assert.equal(spec.encoding, "mapbox")
  assert.equal(spec.tileSize, 256)
})

test("zoom range: the higher floor, the finer operand's ceiling", () => {
  assert.deepEqual([ndsmTileSpec(DSM, DTM).minzoom, ndsmTileSpec(DSM, DTM).maxzoom], [2, 14])
  // Inverting changes the sign, not the range.
  assert.deepEqual([ndsmTileSpec(DSM, DTM, { invert: true }).minzoom, ndsmTileSpec(DSM, DTM, { invert: true }).maxzoom], [2, 14])
  // A 512 px terrain: tiles are 512 px, and a 256 px subtrahend's z12 is this grid's z11.
  const spec = ndsmTileSpec({ ...DSM, tileSize: 512, maxzoom: 13 }, { ...DTM, maxzoom: 16 })
  assert.equal(spec.tileSize, 512)
  assert.equal(spec.maxzoom, 15)
  // No declared range (a WMS on both sides): none invented.
  const open = ndsmTileSpec({ ...DSM, minzoom: undefined, maxzoom: undefined }, { ...DTM, minzoom: undefined, maxzoom: undefined })
  assert.equal(open.minzoom, undefined)
  assert.equal(open.maxzoom, undefined)
})

test("invert swaps the operands, the offset rides in the address", () => {
  const inv = ndsmTileSpec(DSM, DTM, { invert: true, offsetM: -1.234 })
  assert.match(inv.template, /^demdiff:\/\/mapbox\/terrarium\/256~0~0~12~14\/-1\.23\//)
  assert.notEqual(ndsmTileSpec(DSM, DTM).template, ndsmTileSpec(DSM, DTM, { offsetM: 2 }).template, "a new offset is a new cache key")
  assert.match(ndsmTileSpec(DSM, DTM, { offsetM: NaN }).template, /\/256~0~0~14~12\/0\//)
})

test("a tile reads terrain minus subtrahend; invert flips the sign; the offset is added", async () => {
  put(DSM, 10, 5, 6, flat(112.5)); put(DTM, 10, 5, 6, flat(100))
  assert.equal((await tile(ndsmTileSpec(DSM, DTM), 10, 5, 6)).values[1000], 12.5)
  assert.equal((await tile(ndsmTileSpec(DSM, DTM, { invert: true }), 10, 5, 6)).values[1000], -12.5)
  assert.equal((await tile(ndsmTileSpec(DSM, DTM, { offsetM: -2 }), 10, 5, 6)).values[1000], 10.5)
  assert.equal((await tile(ndsmTileSpec(DSM, DTM, { invert: true, offsetM: -2 }), 10, 5, 6)).values[1000], -14.5)
})

test("above the subtrahend's maxzoom its ancestor tile is read, with no request deeper", async () => {
  // DTM stops at z12; the view asks z14 (x 8+2, y 12+1 inside z12 tile 2/3).
  put(DSM, 14, 10, 13, flat(57)); put(DTM, 12, 2, 3, flat(50))
  const before = sharedTileCache.size
  const t = await tile(ndsmTileSpec(DSM, DTM), 14, 10, 13)
  assert.equal(t.values[0], 7)
  assert.equal(t.values[t.values.length - 1], 7)
  assert.equal(sharedTileCache.size, before, "no z14 or z13 tile of the subtrahend was asked for")
})

test("a 512 px terrain over a 256 px subtrahend gives 512 px tiles", async () => {
  const big = { ...DSM, template: "https://dsm512.test/{z}/{x}/{y}.png", tileSize: 512 }
  put(big, 9, 1, 1, flat(30, 512)); put(DTM, 9, 1, 1, flat(10))
  const t = await tile(ndsmTileSpec(big, DTM), 9, 1, 1)
  assert.equal(t.width, 512)
  assert.equal(t.values[512 * 300 + 17], 20)
})

test("where either side has no data the pixel is a hole: 0 m, alpha 254", async () => {
  const valid = new Uint8Array(256 * 256).fill(1); valid[0] = 0
  put(DSM, 8, 3, 3, flat(40)); put(DTM, 8, 3, 3, flat(25, 256, valid))
  const t = await tile(ndsmTileSpec(DSM, DTM), 8, 3, 3)
  assert.deepEqual([t.values[0], t.holes[0]], [0, 1])
  assert.deepEqual([t.values[5000], t.holes[5000]], [15, 0])
})

test("the presets name ramps that exist; heights leave the ground untinted", () => {
  for (const preset of Object.values(NDSM_PRESETS)) assert.ok(preset.ndsmColorRamp in colorRampsClassic, preset.ndsmColorRamp)
  const stops = colorRampsClassic["ndsm-heights"].colors.slice(3)
  assert.equal(stops[0], 0)
  assert.match(String(stops[1]), /rgba\(.*, 0\)$/)
  assert.equal(NDSM_PRESETS.change.ndsmMin, -NDSM_PRESETS.change.ndsmMax)
})
