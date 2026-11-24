// Run with: node scripts/test-lib.mjs lib/stac-dated.test.ts
// Offline: fetch answers from a recorded HOT STAC search over Antakya
// (lib/fixtures/hot-stac-antakya.json: two OpenAerialMap pages, one Maxar page).
import test from "node:test"
import assert from "node:assert/strict"
import recorded from "./fixtures/hot-stac-antakya.json"
import { findDatedImagery, ALL_DATED_IMAGERY_SOURCES } from "./dated-imagery"
import type { StacItem } from "./stac-crawl"
import { STAC_DATED_CATALOGS, STAC_DATED_SOURCES, groupStacItemsByDay, maxzoomForGsd, searchStacItems, signPcHref, stacItemDateMs, type StacDay } from "./stac-dated"

type Page = { links: unknown[]; features: StacItem[] }
const fixture = recorded as unknown as { oam: Page[]; maxar: Page[] }
const antakya = { lat: 36.2, lng: 36.16, zoom: 16 }
const calls: { method: string; url: string; body?: any }[] = []

globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? "GET"
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ method, url, body })
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } })
  if (!url.startsWith("https://api.imagery.hotosm.org/stac/search")) return new Response("not recorded", { status: 404 })
  const collections = body?.collections?.join(",") ?? new URL(url).searchParams.get("collections")
  if (collections === "maxar-opendata") return json(fixture.maxar[0])
  return json(body?.token ? fixture.oam[1] : fixture.oam[0])
}) as typeof fetch

test("presets: OAM and Maxar are dated sources of the registry", () => {
  for (const id of ["stac-oam", "stac-maxar"]) {
    const s = findDatedImagery(id)
    assert.ok(s, id)
    assert.equal(s.section, "catalog")
    assert.equal(s.granularity, "capture")
    assert.equal(s.realDates, true)
  }
  assert.equal(STAC_DATED_SOURCES.length, STAC_DATED_CATALOGS.length)
  assert.equal(new Set(ALL_DATED_IMAGERY_SOURCES.map((s) => s.id)).size, ALL_DATED_IMAGERY_SOURCES.length, "ids are distinct")
})

test("search follows a POST next link with its body", async () => {
  calls.length = 0
  const items = await searchStacItems({ endpoint: "https://api.imagery.hotosm.org/stac", kind: "api", collections: ["openaerialmap"] }, [36.15, 36.19, 36.17, 36.21])
  assert.equal(items.length, 6, "4 on the first page, 2 on the next")
  assert.equal(calls[0].method, "GET")
  assert.equal(calls[1].method, "POST")
  assert.match(calls[1].body.token, /^next:openaerialmap:/)
  // The cap stops paging.
  calls.length = 0
  assert.equal((await searchStacItems({ endpoint: "https://api.imagery.hotosm.org/stac", kind: "api", collections: ["openaerialmap"] }, [36.15, 36.19, 36.17, 36.21], { maxItems: 3 })).length, 3)
  assert.equal(calls.length, 1)
})

test("an interval's start dates an item with no datetime", () => {
  const f = fixture.oam[0].features[0]
  assert.equal(f.properties.datetime, undefined)
  assert.equal(stacItemDateMs(f), Date.parse(String(f.properties.start_datetime)))
})

test("OAM: one date per day, oldest first, with footprints and GSD", async () => {
  const oam = findDatedImagery("stac-oam")!
  const ticks = await oam.listDates(antakya, 0, Date.parse("2030-01-01"), {})
  assert.deepEqual(ticks.map((t) => t.label), ["2023-02-08", "2023-02-09", "2023-02-11", "2023-02-22", "2023-03-05"])
  // Two drone flights the same day are one date, mosaicked over the union of their footprints.
  const feb9 = ticks[1]
  const day = feb9.ref as StacDay
  assert.equal(day.items.length, 2)
  assert.equal(feb9.title, "2 items, 3 cm")
  const flights = [...fixture.oam[0].features, ...fixture.oam[1].features].filter((f: any) => f.properties.start_datetime?.startsWith("2023-02-09"))
  const union = [Math.min(...flights.map((f: any) => f.bbox[0])), Math.min(...flights.map((f: any) => f.bbox[1])), Math.max(...flights.map((f: any) => f.bbox[2])), Math.max(...flights.map((f: any) => f.bbox[3]))]
  const tiles = oam.tiles(feb9)!
  assert.match(tiles.tiles[0], /^capture:\/\//)
  assert.ok(tiles.fetchTileBlob, "an export reads the mosaic through the capture protocol")
  assert.deepEqual(tiles.bounds, union)
  assert.equal(tiles.maxzoom, 22, "3.4 cm: the cap")
  // One item: titiler on its COG, the ceiling from its 30 cm GSD.
  const march = ticks[4]
  const one = oam.tiles(march)!
  assert.match(one.tiles[0], /\/cog\/tiles\/WebMercatorQuad\/\{z\}\/\{x\}\/\{y\}\.png\?.*url=https%3A%2F%2Foin-hotosm-prod/)
  assert.deepEqual(one.bounds, fixture.oam[0].features[0].bbox)
  assert.equal(one.maxzoom, 19)
  // A date alone names the tiles of the last listing (any time that day).
  assert.deepEqual(oam.tiles({ dateMs: feb9.dateMs + 3_600_000 })?.bounds, union)
  assert.equal(oam.tiles({ dateMs: Date.UTC(2001, 0, 1) }), null)
})

test("Maxar: a pass cut into COGs is one date, several items", async () => {
  const ticks = await findDatedImagery("stac-maxar")!.listDates(antakya, 0, Date.now(), {})
  assert.deepEqual(ticks.map((t) => [t.label, (t.ref as StacDay).items.length]), [["2023-02-08", 2], ["2023-02-11", 4]])
  assert.equal(findDatedImagery("stac-maxar")!.tiles(ticks[1])!.maxzoom, maxzoomForGsd(0.67, 36.2))
})

test("the date range filters days", async () => {
  const ticks = await findDatedImagery("stac-oam")!.listDates(antakya, Date.UTC(2023, 2, 1), Date.UTC(2023, 2, 31), {})
  assert.deepEqual(ticks.map((t) => t.label), ["2023-03-05"])
})

test("grouping drops items without a COG, a date or a footprint", () => {
  const ok = fixture.oam[0].features[0]
  const days = groupStacItemsByDay([ok, { ...ok, id: "nodate", properties: {} }, { ...ok, id: "noasset", assets: {} }, { ...ok, id: "dup" }], [0, 0, 1, 1])
  assert.equal(days.length, 1)
  assert.equal(days[0].items.length, 1)
})

test("GSD to zoom", () => {
  assert.equal(maxzoomForGsd(10, 0), 14)
  assert.equal(maxzoomForGsd(0.3, 0), 19)
  assert.equal(maxzoomForGsd(0.01, 0), 22, "capped")
})

test("Planetary Computer hrefs wait for a token", () => {
  assert.equal(signPcHref("https://sentinel2l2a01.blob.core.windows.net/sentinel2-l2/x.tif", "sentinel-2-l2a"), null)
  assert.equal(signPcHref("https://example.com/x.tif", "sentinel-2-l2a"), "https://example.com/x.tif")
  const pc = findDatedImagery("stac-pc-s2")!
  const day: StacDay = { dayMs: 0, label: "1970-01-01", items: [{ id: "a", collection: "sentinel-2-l2a", href: "https://sentinel2l2a01.blob.core.windows.net/sentinel2-l2/x.tif", bbox: [0, 0, 1, 1], gsd: 10 }], gsd: 10, bounds: [0, 0, 1, 1], searched: [0, 0, 1, 1] }
  assert.equal(pc.tiles({ dateMs: 0, ref: day }), null, "no token, no tiles")
})
