// node scripts/test-lib.mjs lib/style-overlay.test.ts   (offline)
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_GLYPHS, GLYPH_ROUTER_URL, fontStacks, glyphUrl, parseGlyphRequest, prefixImage, registerGlyphs, routeGlyphs, spriteIdOf, spriteUrl, styleFonts, withSprite,
} from "./style-overlay"
import { VECTOR_LIBRARY } from "./vector-sources"

const fromRoot = createRequire(join(process.cwd(), "package.json"))
const { validateStyleMin } = createRequire(fromRoot.resolve("maplibre-gl/package.json"))("@maplibre/maplibre-gl-style-spec") as { validateStyleMin: (style: unknown) => { message: string }[] }

const OFM = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
const SWISS = "https://vectortiles.geo.admin.ch/fonts/{fontstack}/{range}.pbf"

test("font stacks: a plain list, the literals of an expression, the outputs of a zoom function", () => {
  assert.deepEqual(fontStacks(["Noto Sans Bold"]), [["Noto Sans Bold"]])
  assert.deepEqual(fontStacks(["match", ["get", "class"], "town", ["literal", ["A Bold"]], ["literal", ["A Regular", "B"]]]), [["A Bold"], ["A Regular", "B"]])
  assert.deepEqual(fontStacks({ stops: [[6, ["A"]], [10, ["B"]]] }), [["A"], ["B"]])
  assert.deepEqual(fontStacks(undefined), [])
  assert.deepEqual(styleFonts([{ layout: { "text-font": ["A", "B"] } }, { layout: { "text-font": ["A"] } }, {}]), ["A", "B"])
})

test("glyphs: each font at the address its style registered, the first style keeping a shared name", () => {
  const table = new Map<string, string>()
  registerGlyphs(["Noto Sans Regular", "Noto Sans Bold"], OFM, table)
  registerGlyphs(["Frutiger Neue Italic", "Noto Sans Regular"], SWISS, table)
  assert.equal(glyphUrl("Frutiger Neue Italic", "0-255", table), "https://vectortiles.geo.admin.ch/fonts/Frutiger%20Neue%20Italic/0-255.pbf")
  assert.equal(glyphUrl("Noto Sans Regular", "256-511", table), "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/256-511.pbf")
  // A stack goes whole to the server of its first font, the comma kept.
  assert.equal(glyphUrl("Frutiger Neue Italic,Arial Unicode", "0-255", table), "https://vectortiles.geo.admin.ch/fonts/Frutiger%20Neue%20Italic,Arial%20Unicode/0-255.pbf")
  // Nobody registered it: the default address, one of its three fonts.
  assert.equal(glyphUrl("Open Sans Semibold", "0-255", table), DEFAULT_GLYPHS.replace("{fontstack}", "Noto%20Sans%20Regular").replace("{range}", "0-255"))
  assert.equal(glyphUrl("Noto Sans Italic", "0-255", new Map()), DEFAULT_GLYPHS.replace("{fontstack}", "Noto%20Sans%20Italic").replace("{range}", "0-255"))
  // Not an address with a font in it, or the router's own: not registered.
  registerGlyphs(["X"], "https://example.com/fonts.pbf", table); registerGlyphs(["Y"], GLYPH_ROUTER_URL, table)
  assert.ok(!table.has("X") && !table.has("Y"))
})

test("glyphs: the router's address parses back, and a map is pointed at it once", () => {
  assert.deepEqual(parseGlyphRequest("tvglyphs://Noto Sans Bold/0-255.pbf"), { fontstack: "Noto Sans Bold", range: "0-255" })
  assert.deepEqual(parseGlyphRequest("tvglyphs://Frutiger%20Neue%20Italic,B/65280-65535.pbf"), { fontstack: "Frutiger Neue Italic,B", range: "65280-65535" })
  assert.equal(parseGlyphRequest("https://example.com/a/0-255.pbf"), null)
  assert.equal(validateStyleMin({ version: 8, glyphs: GLYPH_ROUTER_URL, sources: {}, layers: [] }).length, 0)
  let glyphs: string | null = "https://example.com/{fontstack}/{range}.pbf", sets = 0
  const map = { getGlyphs: () => glyphs, setGlyphs: (u: string) => { glyphs = u; sets++ } }
  routeGlyphs(map, [{ layout: { "text-font": ["Test Font One"] } }], SWISS)
  routeGlyphs(map, [{ layout: { "text-font": ["Test Font Two"] } }], OFM)
  assert.equal(glyphs, GLYPH_ROUTER_URL); assert.equal(sets, 1)
  assert.match(glyphUrl("Test Font One", "0-255"), /^https:\/\/vectortiles\.geo\.admin\.ch\//)
  assert.match(glyphUrl("Test Font Two", "0-255"), /^https:\/\/tiles\.openfreemap\.org\/fonts\/Test%20Font%20Two\//)
})

test("images: every name a value can give is read from the style's own sprite", () => {
  const p = (v: unknown) => prefixImage(v, "s")
  assert.equal(p("bus_11"), "s:bus_11")
  assert.equal(p("{class}_11"), "s:{class}_11")
  assert.equal(p(""), ""); assert.equal(p(" "), " ")
  assert.deepEqual(p(["get", "class"]), ["concat", "s:", ["get", "class"]])
  assert.deepEqual(p(["concat", "road_", ["get", "ref_length"]]), ["concat", "s:", ["concat", "road_", ["get", "ref_length"]]])
  assert.deepEqual(p(["coalesce", ["image", ["get", "subclass"]], ["image", "dot"]]), ["coalesce", ["image", ["concat", "s:", ["get", "subclass"]]], ["image", "s:dot"]])
  assert.deepEqual(p(["match", ["get", "class"], ["a", "b"], "x", "c", ["get", "class"], ""]), ["match", ["get", "class"], ["a", "b"], "s:x", "c", ["concat", "s:", ["get", "class"]], ""])
  assert.deepEqual(p(["case", ["has", "depth"], "arrow", ""]), ["case", ["has", "depth"], "s:arrow", ""])
  assert.deepEqual(p(["step", ["zoom"], "a", 10, ["match", ["get", "k"], "v", "b", "c"], 14, ""]), ["step", ["zoom"], "s:a", 10, ["match", ["get", "k"], "v", "s:b", "s:c"], 14, ""])
  assert.deepEqual(p({ stops: [[4, "place-6"], [7, " "]] }), { stops: [[4, "s:place-6"], [7, " "]] })
  const layer = { id: "l", type: "symbol", layout: { "icon-image": "peak", "text-field": "{name}" }, paint: { "text-color": "#000" } }
  assert.deepEqual(withSprite(layer, "s").layout, { "icon-image": "s:peak", "text-field": "{name}" })
  assert.equal(layer.layout["icon-image"], "peak", "the style's own layer is left as it was")
  assert.equal(withSprite({ id: "f", paint: { "fill-pattern": "wood" } }, "s").paint!["fill-pattern"], "s:wood")
  const plain = { id: "x", paint: { "line-color": "#fff" } }
  assert.equal(withSprite(plain, "s"), plain)
  // What comes out is still a valid layer.
  for (const icon of [["coalesce", ["image", ["get", "subclass"]], ["image", "dot"]], ["step", ["zoom"], "a", 10, ""], { stops: [[4, "place-6"], [7, " "]] }, "{class}_11", ["get", "class"]]) {
    const errors = validateStyleMin({ version: 8, sources: { s: { type: "vector", tiles: ["https://example.com/{z}/{x}/{y}.pbf"] } }, layers: [{ id: "l", type: "symbol", source: "s", "source-layer": "poi", layout: { "icon-image": p(icon) } }] })
    assert.deepEqual(errors.map((e) => e.message), [], JSON.stringify(icon))
  }
})

test("sprite: an absolute address, a relative one read against the style's, an id per entry", () => {
  assert.equal(spriteUrl("https://a.example/sprites/x", "https://b.example/style.json"), "https://a.example/sprites/x")
  assert.equal(spriteUrl("./gpx-osm/sprite", "/terrain-viewer/styles/gpx-osm.json", "https://site.example/terrain-viewer/?x=1"), "https://site.example/terrain-viewer/styles/gpx-osm/sprite")
  assert.equal(spriteUrl([{ id: "extra", url: "https://a.example/e" }, { id: "default", url: "https://a.example/d" }], "https://b.example/s.json"), "https://a.example/d")
  assert.equal(spriteUrl(undefined, "https://b.example/s.json"), null)
  assert.equal(spriteIdOf("gpx-osm-lines-labels"), "vo-gpx-osm-lines-labels")
  assert.doesNotMatch(spriteIdOf("my style: v2 (https://x)"), /[^\w-]/)
})

// ── The styles the app serves itself (scripts/build-vector-styles.mjs) ──────

type Style = { glyphs?: string; sprite?: string; metadata?: Record<string, unknown>; sources: Record<string, { type: string; url?: string; tiles?: string[] }>; layers: { id: string; type: string; source?: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }[] }
const OPEN_HOSTS = ["tiles.openfreemap.org", "data.geopf.fr"]
const OFM_FONTS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]
const served = VECTOR_LIBRARY.filter((s) => s.type === "style" && s.url.startsWith("/styles/"))
const read = (id: string) => JSON.parse(readFileSync(join(process.cwd(), "public", served.find((s) => s.id === id)!.url), "utf8")) as Style

test("the styles served by the app: open hosts only, OpenFreeMap's fonts, valid, credited", () => {
  assert.deepEqual(served.map((s) => s.id).sort(), ["gpx-liberty-satellite", "gpx-liberty-topo-lines-labels", "gpx-osm-lines-labels", "ign-carte-facile-aerial"])
  for (const entry of served) {
    const file = join(process.cwd(), "public", entry.url)
    assert.ok(existsSync(file), `${entry.id}: ${entry.url} is tracked`)
    const text = readFileSync(file, "utf8")
    assert.ok(text.length < 120e3, `${entry.id}: ${text.length} bytes`)
    const style = JSON.parse(text) as Style
    // No key, and no address but the open hosts' (the credits in the
    // metadata and the name are prose, not addresses the map asks).
    const { metadata: meta = {}, name: _name, ...drawn } = style as Style & { name?: string }
    assert.doesNotMatch(JSON.stringify(drawn), /gpx\.studio|maptiler|[?&](key|token|access_token|apikey)=/i, entry.id)
    const addresses = [style.glyphs, ...Object.values(style.sources).flatMap((s) => [s.url, ...(s.tiles ?? [])])].filter((u): u is string => !!u)
    for (const u of addresses) assert.ok(OPEN_HOSTS.includes(new URL(u).host), `${entry.id}: ${u}`)
    assert.equal(style.glyphs, OFM)
    for (const font of styleFonts(style.layers)) assert.ok(OFM_FONTS.includes(font), `${entry.id}: font ${font}`)
    for (const l of style.layers) {
      if (l.source) assert.ok(style.sources[l.source], `${entry.id}: layer ${l.id} reads ${l.source}`)
      assert.ok(!["raster", "hillshade"].includes(l.type), `${entry.id}: ${l.id} is a ${l.type}`)
    }
    // Valid as MapLibre reads it, with a relative sprite made absolute and
    // the images prefixed as the loader does.
    const sprite = spriteUrl(style.sprite, `https://site.example${entry.url}`)
    const errors = validateStyleMin({ ...style, ...(sprite ? { sprite } : {}), layers: style.layers.map((l) => withSprite(l, "vo-x")) })
    assert.deepEqual(errors.map((e) => e.message), [], entry.id)
    for (const k of ["terrain-viewer:credit", "terrain-viewer:source", "terrain-viewer:license"]) assert.ok(typeof meta[k] === "string" && (meta[k] as string).length > 20, `${entry.id}: ${k}`)
    assert.ok(Array.isArray(meta["terrain-viewer:changes"]) && (meta["terrain-viewer:changes"] as unknown[]).length, `${entry.id}: changes`)
    assert.match(String(meta["terrain-viewer:source"]), /github\.com\/[\w-]+\/[\w.-]+\/(tree|blob)\/[0-9a-f]{40}/, `${entry.id}: pinned commit`)
  }
})

test("gpx.studio's styles: credited, OpenFreeMap's tiles, the topo and satellite sources gone", () => {
  for (const id of ["gpx-liberty-satellite", "gpx-liberty-topo-lines-labels", "gpx-osm-lines-labels"]) {
    const style = read(id)
    assert.deepEqual(style.sources, { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } }, id)
    assert.ok(!style.layers.some((l) => /contour|hillshad/i.test(l.id)), `${id}: no contour or hillshade layer`)
    const credit = String(style.metadata!["terrain-viewer:credit"])
    for (const who of ["gpx.studio", "github.com/gpxstudio/styles", "OpenFreeMap", "OpenMapTiles", "OpenStreetMap contributors"]) assert.ok(credit.includes(who), `${id}: ${who}`)
  }
  assert.equal(read("gpx-liberty-satellite").sprite, "https://tiles.openfreemap.org/sprites/ofm_f384/ofm")
  // Liberty Satellite is drawn whole: lines, labels and one fill.
  assert.deepEqual([...new Set(read("gpx-liberty-satellite").layers.map((l) => l.type))].sort(), ["fill", "line", "symbol"])
  // OSM: lines and labels, with a sprite of its own beside it that holds
  // every image a layer names outright.
  const osm = read("gpx-osm-lines-labels")
  assert.deepEqual([...new Set(osm.layers.map((l) => l.type))].sort(), ["line", "symbol"])
  assert.equal(osm.sprite, "./gpx-osm/sprite")
  const dir = join(process.cwd(), "public", "styles", "gpx-osm")
  for (const suffix of ["", "@2x"]) {
    const index = JSON.parse(readFileSync(join(dir, `sprite${suffix}.json`), "utf8")) as Record<string, { width: number; pixelRatio: number }>
    assert.ok(existsSync(join(dir, `sprite${suffix}.png`)))
    assert.equal(Object.values(index)[0].pixelRatio, suffix ? 2 : 1)
    for (const l of osm.layers) {
      const icon = l.layout?.["icon-image"]
      if (typeof icon === "string" && icon.trim() && !icon.includes("{")) assert.ok(index[icon], `sprite${suffix}: ${icon} (${l.id})`)
    }
    for (const name of ["peak", "oneway", "road_motorway", "camping"]) assert.ok(index[name], `sprite${suffix}: ${name}`)
    assert.ok(!index.scrub && !index.wetland, "the fill patterns are left out")
  }
  assert.doesNotMatch(JSON.stringify(osm.layers), /"brunel"/)
})

test("Carte Facile's IGN style: the Plan IGN tiles alone, the photographs left out", () => {
  const style = read("ign-carte-facile-aerial")
  assert.deepEqual(Object.keys(style.sources), ["plan_ign"])
  assert.deepEqual(style.sources.plan_ign.tiles, ["https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf"])
  assert.equal(style.sprite, undefined)
  assert.match(String(style.metadata!["terrain-viewer:license"]), /Apache-2\.0/)
})
