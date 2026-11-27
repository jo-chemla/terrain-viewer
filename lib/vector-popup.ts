// The card of a clicked vector feature: its title, its rows, its picture and
// its links, from the feature's properties and the entry's optional `popup`
// (lib/source-schema.ts). Without a `popup` a card is the feature's name and
// every non-empty property, plus the links a property makes obvious (a
// Wikidata id, an OpenStreetMap object).
//
// Properties are someone else's data: they are only ever returned as text,
// and a link is built from a fixed template or from a value that is itself
// an http(s) address. No MapLibre import and no DOM, so the tests run under
// Node (node scripts/test-lib.mjs lib/vector-popup.test.ts); the card itself
// is components/LayersAndSources/VectorFeaturePopup.tsx.
import type { VectorPopup, VectorPopupLink, VectorSourceEntry } from "./source-schema"

export type FeatureProperties = Record<string, unknown>

export interface PopupRow { key: string; label: string; value: string; href?: string }
export interface PopupLink { label: string; href: string }
export interface PopupCard { title: string; subtitle?: string; image?: string; rows: PopupRow[]; links: PopupLink[] }

/** Properties tried for a title when the entry names none. */
const TITLE_FIELDS = ["name", "name_en", "name:en", "label", "title", "@name", "NAME", "Name", "nom", "site_name", "int_name", "ref"]
/** The longest value a row shows. */
export const POPUP_VALUE_MAX = 400
/** The most rows a card lists (a tile feature can carry a hundred tags). */
export const POPUP_ROWS_MAX = 40

const isHttp = (v: string) => /^https?:\/\/[^\s<>"']+$/i.test(v)

/** A property as the text a card shows: "" for nothing, numbers plainly,
 *  an object as JSON, cut at POPUP_VALUE_MAX. */
export function propertyText(value: unknown): string {
  if (value === null || value === undefined) return ""
  let text: string
  if (typeof value === "number") text = Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : ""
  else if (typeof value === "boolean") text = value ? "yes" : "no"
  else if (typeof value === "object") { try { text = JSON.stringify(value) } catch { text = "" } }
  else text = String(value).trim()
  return text.length > POPUP_VALUE_MAX ? text.slice(0, POPUP_VALUE_MAX - 1) + "…" : text
}

/** Overture packs names as JSON ({"primary": "…"}); the plain name of that. */
function primaryName(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("{")) return ""
  try { const o = JSON.parse(value) as { primary?: unknown }; return typeof o?.primary === "string" ? o.primary : "" } catch { return "" }
}

const first = (props: FeatureProperties, fields: readonly string[]) => {
  for (const f of fields) { const t = propertyText(props[f]); if (t) return { field: f, text: t } }
  return null
}

/** A label from a property name: "date_inscribed" to "Date inscribed". */
export function fieldLabel(field: string): string {
  const t = field.replace(/^@/, "").replace(/[_:]+/g, " ").trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : field
}

/** A link template filled from the properties, or null when the property it
 *  needs is empty or not of the expected shape. Values are URL-encoded, a
 *  slash kept ("way/123"). */
export function fillLink(link: VectorPopupLink, props: FeatureProperties): PopupLink | null {
  const names = [...link.url.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1])
  const need = link.field ?? names[0]
  if (need) {
    const v = propertyText(props[need])
    if (!v) return null
    if (link.pattern) { try { if (!new RegExp(`^(?:${link.pattern})$`).test(v)) return null } catch { return null } }
  }
  // A template that is one property and nothing else ("{url}"): the property
  // is the address, taken as it is when it is an http(s) one.
  const whole = /^\{([^{}]+)\}$/.exec(link.url)
  if (whole) {
    const v = propertyText(props[whole[1]])
    return isHttp(v) ? { label: link.label, href: v } : null
  }
  let ok = true
  const href = link.url.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const v = propertyText(props[name])
    if (!v) ok = false
    return v.split("/").map(encodeURIComponent).join("/")
  })
  return ok && isHttp(href) ? { label: link.label, href } : null
}

/** Links any source gets from properties that say where a feature comes
 *  from: a Wikidata id, an OpenStreetMap object, a Wikipedia article. */
const GENERIC_LINKS: VectorPopupLink[] = [
  { label: "OpenStreetMap", url: "https://www.openstreetmap.org/{id}", field: "id", pattern: "(node|way|relation)/[0-9]+" },
  { label: "OpenStreetMap", url: "https://www.openstreetmap.org/{@id}", field: "@id", pattern: "(node|way|relation)/[0-9]+" },
  { label: "OpenStreetMap", url: "https://www.openstreetmap.org/{osm_type}/{osm_id}", field: "osm_id", pattern: "[0-9]+" },
  { label: "Wikidata", url: "https://www.wikidata.org/wiki/{wikidata}", field: "wikidata", pattern: "Q[0-9]+" },
  { label: "Wikidata", url: "https://www.wikidata.org/wiki/{qid}", field: "qid", pattern: "Q[0-9]+" },
]

function wikipediaLink(props: FeatureProperties): PopupLink | null {
  const v = propertyText(props.wikipedia)
  const m = /^([a-z-]{2,12}):(.+)$/.exec(v)
  return m ? { label: "Wikipedia", href: `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, "_"))}` } : null
}

/** A Wikimedia Commons file (a name, or its address) as a picture address. */
export function commonsImage(value: string, width = 480): string {
  const name = /^https?:\/\//i.test(value) ? decodeURIComponent(value.split("/").pop() ?? "") : value
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replace(/^File:/i, ""))}?width=${width}`
}

/** The card of a feature of `entry`. */
export function featureCard(entry: Pick<VectorSourceEntry, "popup" | "name" | "shortName">, properties: FeatureProperties | null | undefined): PopupCard {
  const props = properties ?? {}
  const popup: VectorPopup = entry.popup ?? {}
  const titled = first(props, popup.title ?? []) ?? first(props, TITLE_FIELDS)
  const overture = !titled ? primaryName(props.names) : ""
  const title = titled?.text || overture || ""
  const used = new Set<string>(titled ? [titled.field] : overture ? ["names"] : [])
  const sub = first(props, (popup.subtitle ?? []).filter((f) => !used.has(f)))
  if (sub && sub.text !== title) used.add(sub.field)

  const links: PopupLink[] = []
  const seen = new Set<string>()
  const push = (l: PopupLink | null, field?: string) => {
    if (!l || seen.has(l.href)) return
    seen.add(l.href); links.push(l)
    if (field) used.add(field)
  }
  for (const l of popup.links ?? []) push(fillLink(l, props))
  for (const l of GENERIC_LINKS) push(fillLink(l, props))
  push(wikipediaLink(props))

  let image: string | undefined
  if (popup.image) {
    const v = propertyText(props[popup.image.field])
    if (v) { image = popup.image.commons ? commonsImage(v) : isHttp(v) ? v : undefined; used.add(popup.image.field) }
  }

  const row = (key: string, label: string, suffix = ""): PopupRow | null => {
    const value = propertyText(props[key])
    if (!value) return null
    return isHttp(value) ? { key, label, value, href: value } : { key, label, value: value + suffix }
  }
  // Codes to words: a value, or each item of a list, as its label.
  const coded = (key: string, label: string, values: Record<string, string>, separator?: string): PopupRow | null => {
    const raw = propertyText(props[key])
    if (!raw) return null
    const word = (v: string) => (Object.hasOwn(values, v) ? values[v] : undefined)
    const value = separator
      ? [...new Set(raw.split(separator).map((v) => word(v.trim())).filter((v): v is string => !!v))].join(", ")
      : word(raw) ?? raw
    return value ? { key, label, value } : null
  }
  const rows: PopupRow[] = []
  for (const f of popup.fields ?? []) {
    if (used.has(f.field)) continue
    const r = f.values ? coded(f.field, f.label ?? fieldLabel(f.field), f.values, f.separator) : row(f.field, f.label ?? fieldLabel(f.field), f.suffix ?? "")
    if (r) rows.push(r)
    used.add(f.field)
  }
  if (popup.rest !== false) {
    const hidden = new Set(popup.hide ?? [])
    for (const key of Object.keys(props)) {
      if (rows.length >= POPUP_ROWS_MAX) break
      if (used.has(key) || hidden.has(key)) continue
      const r = row(key, fieldLabel(key))
      if (r) rows.push(r)
    }
  }
  return { title: title || entry.shortName || entry.name, subtitle: sub && sub.text !== title ? sub.text : undefined, image, rows, links }
}

type Position = [number, number]
/** [west, south, east, north] of a GeoJSON geometry, or null. */
export function geometryBounds(geometry: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c as Position
      if (Number.isFinite(x) && Number.isFinite(y)) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y) }
      return
    }
    for (const x of c) walk(x)
  }
  if (geometry?.type === "GeometryCollection") for (const g of geometry.geometries ?? []) walk((g as { coordinates?: unknown }).coordinates)
  else walk(geometry?.coordinates)
  return w <= e && s <= n ? [w, s, e, n] : null
}
