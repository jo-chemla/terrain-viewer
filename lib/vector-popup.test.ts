// node scripts/test-lib.mjs lib/vector-popup.test.ts   (offline)
import test from "node:test"
import assert from "node:assert/strict"
import { commonsImage, featureCard, fieldLabel, fillLink, geometryBounds, propertyText, POPUP_ROWS_MAX, POPUP_VALUE_MAX } from "./vector-popup"
import { expandCompactGeoJSON, findVectorSource, VECTOR_LIBRARY } from "./vector-sources"
import { buildUnesco, cap, parseComponents } from "../scripts/build-unesco-vectors.mjs"

const plain = { name: "Mine", shortName: "Mine" }

test("a source with no popup: the name as title, every non-empty property as a row", () => {
  const card = featureCard(plain, { name: "Town hall", height: 12.5, levels: 3, empty: "", none: null, open: true, tags: { a: 1 } })
  assert.equal(card.title, "Town hall")
  assert.deepEqual(card.rows.map((r) => [r.label, r.value]), [["Height", "12.5"], ["Levels", "3"], ["Open", "yes"], ["Tags", '{"a":1}']])
  assert.deepEqual(card.links, [])
  assert.equal(card.image, undefined)
  // No name at all: the source's own.
  assert.equal(featureCard(plain, { class: "x" }).title, "Mine")
  assert.equal(featureCard(plain, null).title, "Mine")
  // Overture packs its names as JSON.
  assert.equal(featureCard(plain, { names: '{"primary":"Parc de la Tête d\'Or"}', class: "park" }).title, "Parc de la Tête d'Or")
})

test("values are text: long ones cut, many rows capped, an address becomes a link, nothing else does", () => {
  assert.equal(propertyText("x".repeat(900)).length, POPUP_VALUE_MAX)
  assert.equal(propertyText(0), "0")
  assert.equal(propertyText(Number.NaN), "")
  assert.equal(propertyText(1.23456789), "1.234568")
  const many = Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`k${i}`, i]))
  assert.equal(featureCard(plain, many).rows.length, POPUP_ROWS_MAX)
  const card = featureCard(plain, { name: "<img src=x onerror=alert(1)>", site: "https://example.org/a?b=1", bad: "javascript:alert(1)", spaced: "https://example.org/a b" })
  assert.equal(card.title, "<img src=x onerror=alert(1)>", "kept as text, for React to escape")
  assert.equal(card.rows.find((r) => r.key === "site")!.href, "https://example.org/a?b=1")
  assert.equal(card.rows.find((r) => r.key === "bad")!.href, undefined)
  assert.equal(card.rows.find((r) => r.key === "spaced")!.href, undefined)
  assert.equal(fieldLabel("date_inscribed"), "Date inscribed")
  assert.equal(fieldLabel("@geometry_source"), "Geometry source")
})

test("links: a template filled from the properties, refused when the value is not of the expected shape", () => {
  const wd = { label: "Wikidata", url: "https://www.wikidata.org/wiki/{qid}", field: "qid", pattern: "Q[0-9]+" }
  assert.deepEqual(fillLink(wd, { qid: "Q42" }), { label: "Wikidata", href: "https://www.wikidata.org/wiki/Q42" })
  assert.equal(fillLink(wd, { qid: "Q42/../../evil" }), null)
  assert.equal(fillLink(wd, { qid: "" }), null)
  assert.equal(fillLink(wd, {}), null)
  const osm = { label: "OpenStreetMap", url: "https://www.openstreetmap.org/{id}", field: "id", pattern: "(node|way|relation)/[0-9]+" }
  assert.equal(fillLink(osm, { id: "way/123" })!.href, "https://www.openstreetmap.org/way/123")
  assert.equal(fillLink(osm, { id: "way/123?x=<script>" }), null)
  // A value is encoded, never spliced in raw.
  assert.equal(fillLink({ label: "S", url: "https://example.org/s?q={name}" }, { name: "a b&c=d" })!.href, "https://example.org/s?q=a%20b%26c%3Dd")
  // A template that is the property itself: only an http(s) address passes.
  const record = { label: "Record", url: "{url}", field: "url" }
  assert.equal(fillLink(record, { url: "javascript:alert(1)" }), null)
  assert.equal(fillLink(record, { url: "data:text/html,x" }), null)
  // Any source gets the links a property makes obvious.
  const card = featureCard(plain, { name: "X", wikidata: "Q7", "@id": "node/5", wikipedia: "fr:Tour Eiffel" })
  assert.deepEqual(card.links.map((l) => l.href), ["https://www.openstreetmap.org/node/5", "https://www.wikidata.org/wiki/Q7", "https://fr.wikipedia.org/wiki/Tour_Eiffel"])
  assert.equal(featureCard(plain, { wikidata: "not a qid" }).links.length, 0)
})

test("the Heritage map's cards: Wikidata, OpenStreetMap, the inventories", () => {
  const wikidata = featureCard(findVectorSource("hwai-heritage-wikidata")!, { qid: "Q190063", label: "Umayyad Mosque", label_local: "الجامع الأموي", cls: "Q32815,Q839954", des: "World Heritage Site", img: "Umayyad Mosque.jpg", gone: "" })
  assert.equal(wikidata.title, "Umayyad Mosque")
  assert.equal(wikidata.subtitle, "الجامع الأموي")
  assert.equal(wikidata.image, "https://commons.wikimedia.org/wiki/Special:FilePath/Umayyad%20Mosque.jpg?width=480")
  assert.deepEqual(wikidata.rows.map((r) => [r.label, r.value]), [["Class", "mosque, archaeological site"], ["Designation", "World Heritage Site"]], "the class ids as their names, the qid not a row")
  const unclassed = featureCard(findVectorSource("hwai-heritage-wikidata")!, { qid: "Q1", label: "A", cls: "Q999999999,designated,Q358316" })
  assert.deepEqual(unclassed.rows.map((r) => [r.label, r.value]), [["Class", "heritage designation alone"]], "an id outside the 40 classes is left out, and Q358 is not read in Q358316")
  const ocs = featureCard(findVectorSource("ign-ocsge-couverture")!, { code_cs: "CS1.1.1.1", code_us: "US5", millesime: "2021", source: "calcul", fid: 3 })
  assert.deepEqual(ocs.rows.map((r) => [r.label, r.value]), [["Cover", "Zones bâties (CS1.1.1.1)"], ["Use", "Usage résidentiel (US5)"], ["Year", "2021"], ["Origin", "calcul"]])
  assert.deepEqual(featureCard(findVectorSource("ign-ocsge-couverture")!, { code_cs: "CS9" }).rows.map((r) => r.value), ["CS9"], "a code without a label shows as it is")
  assert.deepEqual(wikidata.links, [{ label: "Wikidata", href: "https://www.wikidata.org/wiki/Q190063" }])

  const osm = featureCard(findVectorSource("hwai-heritage-osm-condition")!, { id: "way/42", name: "جامع", name_en: "Great Mosque", historic: "", building: "mosque", status: "destroyed", damage_event: "war", damage_date: "2013", height: 14, levels: 2, wikidata: "Q1", gone: 1, parts: 1 })
  assert.equal(osm.title, "Great Mosque")
  assert.equal(osm.subtitle, "جامع")
  assert.deepEqual(osm.rows.map((r) => [r.label, r.value]), [["Building", "mosque"], ["State", "destroyed"], ["Event", "war"], ["When", "2013"], ["Height", "14 m"], ["Levels", "2"]])
  assert.deepEqual(osm.links.map((l) => l.label), ["OpenStreetMap", "Wikidata"])
  assert.equal(osm.links[0].href, "https://www.openstreetmap.org/way/42")
  // One name only: no second line repeating it.
  assert.equal(featureCard(findVectorSource("hwai-heritage-osm")!, { id: "node/1", name: "Citadel" }).subtitle, undefined)

  const inv = featureCard(findVectorSource("hwai-heritage-inventories")!, { rid: 2401319, source: "fra-merimee", iso3: "FRA", kind: "monuments", id: "PA92000012", name: "Église Notre-Dame du Calvaire", url: "http://www.culture.gouv.fr/x", licence_class: "open", shape: 1 })
  assert.equal(inv.title, "Église Notre-Dame du Calvaire")
  assert.deepEqual(inv.rows.map((r) => r.label), ["Kind", "Id", "Country", "Inventory", "Licence"])
  assert.deepEqual(inv.links, [{ label: "Record", href: "http://www.culture.gouv.fr/x" }])
})

test("UNESCO's cards link to the property's page; only the listed fields show", () => {
  const card = featureCard(findVectorSource("unesco-world-heritage")!, { name: "Ancient City of Damascus", id_no: 20, category: "Cultural", year: 1979, danger: true, country: "Syrian Arab Republic", iso: "SY", criteria: "(i)(ii)", description: "Founded in the 3rd millennium B.C." })
  assert.equal(card.title, "Ancient City of Damascus")
  assert.equal(card.subtitle, "Syrian Arab Republic")
  assert.deepEqual(card.rows.map((r) => [r.label, r.value]), [["Category", "Cultural"], ["Inscribed", "1979"], ["In danger", "yes"], ["Criteria", "(i)(ii)"], ["About", "Founded in the 3rd millennium B.C."]])
  assert.deepEqual(card.links, [{ label: "UNESCO", href: "https://whc.unesco.org/en/list/20" }])
  const part = featureCard(findVectorSource("unesco-world-heritage-components")!, { name: "Villa Mairea, Pori", ref: "1752-013", id_no: 1752, property: "Aalto Works", category: "Cultural" })
  assert.equal(part.subtitle, "Aalto Works")
  assert.equal(part.links[0].href, "https://whc.unesco.org/en/list/1752")
})

test("every popup of the Library is well formed: http(s) templates, patterns that compile", () => {
  for (const s of VECTOR_LIBRARY) for (const l of s.popup?.links ?? []) {
    assert.ok(/^https:\/\/|^\{[\w@:]+\}$/.test(l.url), `${s.id}: ${l.url}`)
    if (l.pattern) assert.doesNotThrow(() => new RegExp(`^(?:${l.pattern})$`), `${s.id}: ${l.pattern}`)
    assert.ok(l.label)
  }
})

test("pictures and bounds", () => {
  assert.equal(commonsImage("File:A b.jpg", 320), "https://commons.wikimedia.org/wiki/Special:FilePath/A%20b.jpg?width=320")
  assert.equal(commonsImage("http://commons.wikimedia.org/wiki/Special:FilePath/A%20b.jpg"), "https://commons.wikimedia.org/wiki/Special:FilePath/A%20b.jpg?width=480")
  assert.deepEqual(geometryBounds({ type: "Point", coordinates: [2, 48] }), [2, 48, 2, 48])
  assert.deepEqual(geometryBounds({ type: "Polygon", coordinates: [[[1, 2], [3, 2], [3, 5], [1, 2]]] }), [1, 2, 3, 5])
  assert.deepEqual(geometryBounds({ type: "MultiPolygon", coordinates: [[[[1, 2], [3, 2], [3, 5], [1, 2]]], [[[-4, 0], [-3, 0], [-3, 1], [-4, 0]]]] }), [-4, 0, 3, 5])
  assert.equal(geometryBounds({ type: "Polygon", coordinates: [] }), null)
  assert.equal(geometryBounds(null), null)
})

// ── The compact UNESCO files (scripts/build-unesco-vectors.mjs) ─────────────

test("UNESCO build: properties and components from a whc001 export, compact", () => {
  const record = (over: Record<string, unknown>, geometry: unknown = null) => ({ type: "Feature", geometry, properties: { name_en: "Site", category: "Cultural", date_inscribed: "1992", danger: "false", states_names: ["Albania"], iso_codes: ["AL"], region: "Europe and North America", transboundary: "false", criteria_txt: "(iii)", components_count: 1, ...over } })
  const serial = JSON.stringify([{ name: "North, the gate", ref: "9-001", latitude: 60.1234567, longitude: 24.7654321 }, { name: "South", ref: "9-002", latitude: 61, longitude: 25 }, { name: "Far", ref: "9-003", latitude: 68, longitude: 29 }])
  const { properties, components } = buildUnesco({ features: [
    record({ id_no: "570", name_en: "Butrint", short_description_en: "<p>Inhabited since prehistoric times.</p>", geo_point_2d: { lon: 20.020951234, lat: 39.745732 }, components_list: '[{"name": "Butrint", "ref": "570ter", "latitude": 39.745732, "longitude": 20.02095}]', area_hectares: 8591.04 }),
    record({ id_no: "9", name_en: "Serial", danger: "true", components_count: 3, components_list: serial, geo_point_2d: { lon: 26.25, lat: 63.04 }, short_description_en: "word ".repeat(100) }),
    record({ id_no: "1567", name_en: "No place", components_count: 0, components_list: null }),
    record({ id_no: "x", name_en: "No id" }),
  ] })
  assert.deepEqual(properties.features.map((f: { properties: { id_no: number } }) => f.properties.id_no), [9, 570], "sorted by id; no coordinates, no feature")
  const butrint = properties.features[1]
  assert.deepEqual(butrint.geometry.coordinates, [20.02095, 39.74573], "5 decimals")
  assert.deepEqual(butrint.properties, { name: "Butrint", id_no: 570, category: "Cultural", year: 1992, country: "Albania", iso: "AL", region: "Europe and North America", criteria: "(iii)", area_ha: 8591, description: "Inhabited since prehistoric times." })
  const s = properties.features[0]
  assert.equal(s.properties.danger, true)
  assert.equal(s.properties.components, 3)
  assert.deepEqual(s.geometry.coordinates, [25, 61], "a serial property stands on its component nearest to the middle")
  assert.ok(s.properties.description.length <= 200 && s.properties.description.endsWith("…"))
  assert.equal(components.features.length, 3, "only the parts of serial properties")
  // Compact: short keys, and what a property's components share said once.
  assert.deepEqual(components.features[0], { type: "Feature", properties: { n: "North, the gate", r: "9-001", i: 9 }, geometry: { type: "Point", coordinates: [24.76543, 60.12346] } })
  assert.deepEqual(components.keys, { n: "name", r: "ref", i: "id_no" })
  assert.deepEqual(components.shared, { by: "id_no", values: { 9: { property: "Serial", category: "Cultural", danger: true } } })
  assert.deepEqual(expandCompactGeoJSON(components).features[0].properties, { property: "Serial", category: "Cultural", danger: true, name: "North, the gate", ref: "9-001", id_no: 9 }, "what the app's card and colors read")
  // The table view's bare form, names with commas and colons.
  assert.deepEqual(parseComponents("{name: Fort: north, east wing, ref: 12bis-001, latitude: 1.5, longitude: -2.25}{name: B, ref: 12bis-002, latitude: 3, longitude: 4}").map((c: { name: string; ref: string }) => [c.name, c.ref]), [["Fort: north, east wing", "12bis-001"], ["B", "12bis-002"]])
  assert.equal(cap("short"), "short")
})
