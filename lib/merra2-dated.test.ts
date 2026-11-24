// Run with: node scripts/test-lib.mjs lib/merra2-dated.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { MERRA2_LAYERS, merra2Months, merra2TileUrl } from "./national-historical"
import { findDatedImagery } from "./dated-imagery"

test("MERRA-2 months run from January 1980 to two months before now", () => {
  const ms = merra2Months(Date.UTC(2026, 10, 24))
  assert.deepEqual(ms[0], [1980, 1])
  assert.deepEqual(ms[ms.length - 1], [2026, 9])
  assert.equal(ms.length, (2026 - 1980) * 12 + 9)
  assert.deepEqual(merra2Months(Date.UTC(2027, 0, 5)).at(-1), [2026, 11])
})

test("each MERRA-2 layer is a monthly dated source with GIBS dated tiles, gaps left out", () => {
  assert.equal(merra2TileUrl("MERRA2_X", 1990, 7), "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MERRA2_X/default/1990-07-01/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png")
  for (const m of MERRA2_LAYERS) {
    const src = findDatedImagery(m.id)
    assert.ok(src, m.id)
    assert.equal(src!.granularity, "month", m.id)
    assert.equal(src!.maxzoom, 6, m.id)
    const ticks = src!.fixedDates!({})
    assert.equal(ticks[0].label, "1980-01")
    assert.equal(ticks[0].dateMs, Date.UTC(1980, 0, 1))
    for (const g of m.gaps ?? []) assert.ok(!ticks.some((t) => t.label === g), `${m.id}: ${g} is a gap`)
    const t = ticks.find((x) => x.label === "1990-07")!
    assert.match(src!.tiles(t)!.tiles[0], new RegExp(`/${m.layer}/default/1990-07-01/`))
  }
})
