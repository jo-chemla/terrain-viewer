#!/usr/bin/env node
// UNESCO's World Heritage List as two compact GeoJSON files the app serves
// from its own origin (public/vector/, not tracked: they live on the
// dataset-indexes release, see scripts/dataset-assets.mjs):
//
//   unesco-world-heritage.geojson             one point per inscribed property
//   unesco-world-heritage-components.geojson  one point per component of a
//                                             serial property (2 parts or more)
//
// Source: the dataset whc001 of UNESCO's open data portal (CC BY-SA 4.0),
// whose export weighs 23 MB because every record carries its descriptions in
// six languages, its justification and its picture list. Kept here: name, id,
// category, year, danger flag, States Parties, region, criteria, area, number
// of components and the English short description cut at 200 characters (a
// component keeps its name, its reference, its property and what colors it);
// coordinates rounded to 5 decimals (about 1 m); minified.
//
//   node scripts/build-unesco-vectors.mjs                 from the portal (current list)
//   node scripts/build-unesco-vectors.mjs <whc001.geojson>  from a downloaded export
//
// Then: pnpm datasets:push public/vector/unesco-world-heritage.geojson public/vector/unesco-world-heritage-components.geojson
// and commit datasets.lock.json.
//
// The input is data, never code: it is only parsed as JSON.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(ROOT, "public", "vector")
const FIELDS = ["name_en", "short_description_en", "date_inscribed", "danger", "category", "states_names", "iso_codes", "region", "transboundary", "criteria_txt", "area_hectares", "id_no", "components_list", "components_count", "geo_point_2d"]
export const WHC001_EXPORT = `https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/exports/geojson?select=${FIELDS.join(",")}`
const DESCRIPTION_MAX = 200

const round = (n) => Math.round(Number(n) * 1e5) / 1e5
const text = (v) => (v === null || v === undefined ? "" : String(v)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
const list = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : text(v).replace(/^\[|\]$/g, "").replace(/'/g, ""))
const truthy = (v) => v === true || v === 1 || /^(true|1)$/i.test(String(v))
/** Cut at a word, with an ellipsis. */
export function cap(s, max = DESCRIPTION_MAX) {
  const t = text(s)
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).replace(/[\s,;:.]+$/, "") + "…"
}
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null && v !== false && !(typeof v === "number" && !Number.isFinite(v))))

/** The components of a record: whc001 gives them as one string of
 *  `{name: …, ref: …, latitude: …, longitude: …}` groups (a name may hold
 *  commas and colons, so the groups are read from their fixed keys). */
export function parseComponents(raw) {
  // The portal's export gives JSON; a file saved from its table view gives
  // the bare `{name: …}` form.
  if (typeof raw === "string" && raw.trim().startsWith("[")) { try { raw = JSON.parse(raw) } catch { /* the bare form below */ } }
  if (Array.isArray(raw)) return raw.map((c) => ({ name: text(c.name), ref: text(c.ref), lat: Number(c.latitude), lng: Number(c.longitude) }))
  const out = []
  const re = /\{name: (.*?), ref: ([^,{}]*?), latitude: (-?[\d.]+|None|null), longitude: (-?[\d.]+|None|null)\}/gs
  for (const m of String(raw ?? "").matchAll(re)) out.push({ name: text(m[1]), ref: text(m[2]), lat: Number(m[3]), lng: Number(m[4]) })
  return out
}
const valid = (lng, lat) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lng === 0 && lat === 0)
const point = (lng, lat, properties) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [round(lng), round(lat)] } })

/** The two collections of a whc001 export. */
export function buildUnesco(collection) {
  const properties = [], components = []
  for (const f of collection.features ?? []) {
    const p = f.properties ?? {}
    const id = Number(p.id_no)
    if (!Number.isFinite(id)) continue
    const parts = parseComponents(p.components_list).filter((c) => valid(c.lng, c.lat))
    const shared = compact({ category: text(p.category), danger: truthy(p.danger) })
    // Where the property's own point goes: the portal's point, which for a
    // serial property is the mean of its components (often on nothing), so
    // the component nearest to it stands for the property.
    const g = p.geo_point_2d
    let at = g && valid(Number(g.lon), Number(g.lat)) ? [Number(g.lon), Number(g.lat)] : f.geometry?.type === "Point" ? f.geometry.coordinates.map(Number) : null
    if (at && !valid(at[0], at[1])) at = null
    if (parts.length > 1 || !at) {
      const ref = at ?? [parts[0]?.lng, parts[0]?.lat]
      const near = parts.reduce((best, c) => (!best || (c.lng - ref[0]) ** 2 + (c.lat - ref[1]) ** 2 < (best.lng - ref[0]) ** 2 + (best.lat - ref[1]) ** 2 ? c : best), null)
      if (near) at = [near.lng, near.lat]
    }
    if (at) {
      properties.push(point(Number(at[0]), Number(at[1]), compact({
        name: text(p.name_en), id_no: id, ...shared, year: Number(p.date_inscribed) || undefined,
        country: list(p.states_names), iso: list(p.iso_codes), region: text(p.region), transboundary: truthy(p.transboundary),
        criteria: text(p.criteria_txt), area_ha: p.area_hectares ? Math.round(Number(p.area_hectares) * 10) / 10 : undefined,
        components: Number(p.components_count) > 1 ? Number(p.components_count) : undefined,
        description: cap(p.short_description_en),
      })))
    }
    if (parts.length > 1) {
      for (const c of parts) components.push(point(c.lng, c.lat, compact({ name: c.name || text(p.name_en), ref: c.ref, id_no: id, property: text(p.name_en), ...shared })))
    }
  }
  properties.sort((a, b) => a.properties.id_no - b.properties.id_no)
  components.sort((a, b) => a.properties.id_no - b.properties.id_no || String(a.properties.ref).localeCompare(String(b.properties.ref)))
  return { properties: { type: "FeatureCollection", features: properties }, components: { type: "FeatureCollection", features: components } }
}

async function main() {
  const input = process.argv[2]
  let collection
  if (input) collection = JSON.parse(await readFile(resolve(input), "utf8"))
  else {
    const res = await fetch(WHC001_EXPORT)
    if (!res.ok) throw new Error(`data.unesco.org answered ${res.status}`)
    collection = await res.json()
  }
  const { properties, components } = buildUnesco(collection)
  await mkdir(OUT, { recursive: true })
  for (const [name, fc] of [["unesco-world-heritage.geojson", properties], ["unesco-world-heritage-components.geojson", components]]) {
    const body = JSON.stringify(fc)
    await writeFile(join(OUT, name), body)
    console.log(`${name}: ${fc.features.length} features, ${Math.round(Buffer.byteLength(body) / 1e3)} KB`)
  }
  const serial = new Set(components.features.map((f) => f.properties.id_no)).size
  console.log(`${collection.features.length} records read, ${properties.features.length} properties placed, ${serial} serial properties`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`build-unesco-vectors: ${e.message}`); process.exit(1) })
