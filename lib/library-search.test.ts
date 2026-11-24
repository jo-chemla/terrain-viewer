// Run with: node --test --experimental-strip-types lib/library-search.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { searchLibrary, matchesLibraryQuery } from "./library-search.ts"
import lib from "./custom-sources.json" with { type: "json" }

interface Row { id: string; name: string; type?: string; keywords?: string }
const basemaps: Row[] = lib.SAMPLE_BASEMAPS_SOURCES
// What the Library dialog reads of a row (sample-sources-modal.tsx).
const textOf = (s: Row) => `${s.name} ${s.id} ${s.type ?? ""} ${s.keywords ?? ""}`

const LAND_COVER = [
  "esa-worldcover-2021-map-tms", "esa-worldcover-2020-map-tms", "esri-io-landcover-10m",
  "nasa-gibs-modis-igbp-landcover", "eea-corine-land-cover-2018", "usgs-nlcd-2021-land-cover",
  "custom-basemap-ign-ocsge-couverture", "custom-basemap-ign-ocsge-usage", "custom-basemap-ign-cosia",
  "copernicus-lcfm-lcm10-2020", "copernicus-cgls-lc100-2019", "copernicus-cgls-lc100-2015",
]

for (const q of ["landcover", "land cover", "land-cover", "landuse", "land use", "land-use", "LandCover", " Land  Cover ", "lancover", "landcovr", "land covre", "lulc"]) {
  test(`"${q}" finds every land cover entry`, () => {
    const ids = searchLibrary(basemaps, textOf, q).map((s) => s.id)
    for (const id of LAND_COVER) assert.ok(ids.includes(id), `${id} missing for "${q}"`)
  })
}

test("an exact query does not pick up near misses", () => {
  const rows = [{ id: "a", name: "Land Cover" }, { id: "b", name: "Land Rover" }]
  assert.deepEqual(searchLibrary(rows, textOf, "land cover").map((r) => r.id), ["a"])
})

test("a query with no exact match falls back to one edit", () => {
  const rows = [{ id: "a", name: "Hillshade" }, { id: "b", name: "Orthophoto" }]
  assert.deepEqual(searchLibrary(rows, textOf, "hilshade").map((r) => r.id), ["a"])
  assert.deepEqual(searchLibrary(rows, textOf, "zzzz"), [])
})

test("a land cover query keeps unrelated basemaps out", () => {
  const ids = searchLibrary(basemaps, textOf, "landcover").map((s) => s.id)
  assert.ok(!ids.includes("custom-basemap-ign-ortho"))
  assert.ok(!ids.includes("waymarked-trails-hiking"))
})

test("empty query keeps everything, accents and case fold", () => {
  assert.equal(searchLibrary(basemaps, textOf, "  ").length, basemaps.length)
  assert.ok(matchesLibraryQuery("Photographies aériennes", "aeriennes"))
  assert.ok(matchesLibraryQuery("Land use / land cover", "land-use"))
  assert.ok(!matchesLibraryQuery("Hillshade", "landcover"))
})
