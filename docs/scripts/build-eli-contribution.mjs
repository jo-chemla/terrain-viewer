#!/usr/bin/env node
// Preparatory work for an OSM Editor Layer Index contribution: one ELI
// source file (GeoJSON Feature, the index's own schema) per dated layer of
// the national and regional archives Terrain Viewer reads
// (lib/national-historical.ts, lib/national-historical-layers.json), sorted
// by what their licence allows:
//
//   ready      CC0, public domain, DL-DE Zero: no permission needed
//   waiver     CC BY 4.0 and similar: ELI lists them once the publisher has
//              signed the OSMF attribution waiver (or ELI's own permission
//              record); the file is written, the permission is the next step
//   ask        a licence of the publisher's own, or unknown: write to them
//
// Writes docs/public/eli-contribution/<class>/<id>.geojson and a README with
// the counts, and prints the summary. Nothing is sent anywhere: the files
// are what a pull request to osmlab/editor-layer-index would carry, after
// the licence step and a check against the layers ELI already has.
//
//   node docs/scripts/build-eli-contribution.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ROOT = path.resolve(DOCS, "..")
const OUT = path.join(DOCS, "public", "eli-contribution")
const { NATIONAL_SOURCES } = await import(new URL(`file:///${path.join(ROOT, "lib/national-historical.ts").replace(/\\/g, "/")}`).href)
const LAYERS = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/national-historical-layers.json"), "utf8"))

const COUNTRY = { France: "FR", Switzerland: "CH", Norway: "NO", Germany: "DE", Austria: "AT", Belgium: "BE", "Netherlands and Luxembourg": null, "Spain and Portugal": null, Italy: "IT", "Central and Eastern Europe": null, "North America": null, "Asia and Oceania": null, "South America": "BR", Global: null }
const COUNTRY_BY_ID = { "cat-nat-pdok": "NL", "cat-nat-lu": "LU", "cat-nat-portugal": "PT", "cat-nat-slovenija": "SI", "cat-nat-lietuva": "LT", "cat-nat-cyprus": "CY", "cat-nat-slovensko": "SK", "cat-nat-gsi": "JP", "cat-nat-nsw": "AU", "cat-nat-sinica": "TW", "cat-nat-nlsc": "TW", "cat-nat-toronto": "CA", "cat-nat-ottawa": "CA", "cat-nat-weld": null,
  ...Object.fromEntries(["icgc", "pnoa", "navarra", "balears", "madrid", "euskadi", "andalucia", "canarias", "valencia", "galicia", "cantabria", "asturias", "aragon"].map((k) => [`cat-nat-${k}`, "ES"])),
  ...Object.fromEntries(["nyc", "kingcounty", "dc", "massgis", "ctecco", "iowa", "chicagoland", "minnesota", "chatham", "florida1940"].map((k) => [`cat-nat-${k}`, "US"])) }
const classify = (licence) => {
  const l = licence.toLowerCase()
  if (/cc0|public domain|dl-de zero|open government data license|nasa open/.test(l)) return "ready"
  if (/cc by|dl-de by|licence ouverte|open government licence|etalab|modellicentie|ogd|open data/.test(l)) return "waiver"
  return "ask"
}
const licenceUrl = (licence) => {
  const l = licence.toLowerCase()
  if (l.includes("cc0")) return "https://creativecommons.org/publicdomain/zero/1.0/"
  if (l.includes("cc by 4.0")) return "https://creativecommons.org/licenses/by/4.0/"
  if (l.includes("dl-de zero")) return "https://www.govdata.de/dl-de/zero-2-0"
  if (l.includes("dl-de by")) return "https://www.govdata.de/dl-de/by-2-0"
  if (l.includes("licence ouverte")) return "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
  return undefined
}
// ELI expects an XYZ template with {zoom}/{x}/{y}; a WMS needs its own type
// and the template MapLibre uses ({bbox-epsg-3857}) becomes {bbox}.
const eliUrl = (l) => (l.type === "wms" ? l.url.replace("{bbox-epsg-3857}", "{bbox}").replace(/CRS=EPSG:3857/i, "CRS={proj}").replace(/SRS=EPSG:3857/i, "SRS={proj}").replace("WIDTH=256", "WIDTH={width}").replace("HEIGHT=256", "HEIGHT={height}") : l.url.replace("{z}", "{zoom}"))
const rect = (b) => ({ type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] })

fs.rmSync(OUT, { recursive: true, force: true })
const counts = { ready: 0, waiver: 0, ask: 0 }
const rows = []
for (const src of NATIONAL_SOURCES) {
  const layers = src.lazy ? LAYERS[src.id] ?? [] : src.layers
  const cls = classify(src.licence)
  const cc = COUNTRY_BY_ID[src.id] !== undefined ? COUNTRY_BY_ID[src.id] : COUNTRY[src.group.replace(/^Historical · /, "")] ?? null
  if (!cc) { rows.push({ source: src.label, licence: src.licence, cls, layers: layers.length, written: 0, note: "country code to set by hand" }); continue }
  let written = 0
  for (const l of layers) {
    if (l.type === "wms" && /export\?|exportImage\?|TIME=/.test(l.url)) continue // ArcGIS export and TIME parameters: not ELI url templates
    const id = `${src.id.replace(/^cat-nat-/, "")}-${l.key}`.replace(/[^A-Za-z0-9_.-]/g, "_")
    const isMap = /map|karte|carte|plan|kaart|survey|cadast/i.test(l.label) && !/ortho|aerial|luftbild|dop|photo/i.test(l.label)
    const feature = {
      type: "Feature",
      properties: {
        id, name: `${src.label}: ${l.label}`, type: l.type === "wms" ? "wms" : "tms", url: eliUrl(l),
        category: isMap ? "historicmap" : "historicphoto", country_code: cc,
        start_date: String(l.year), end_date: String(l.endYear ?? l.year),
        min_zoom: l.minzoom ?? 1, max_zoom: l.maxzoom ?? 19,
        license_url: licenceUrl(src.licence), attribution: { text: `${src.label} (${src.licence})`, url: src.infoUrl, required: true },
        description: `${src.note} Served by Terrain Viewer's historical timeline; licence: ${src.licence}.`,
      },
      geometry: rect(l.bbox ?? src.bbox),
    }
    fs.mkdirSync(path.join(OUT, cls), { recursive: true })
    fs.writeFileSync(path.join(OUT, cls, `${id}.geojson`), JSON.stringify(feature, null, 2))
    written++
  }
  counts[cls] += written
  rows.push({ source: src.label, licence: src.licence, cls, layers: layers.length, written })
}
const md = [
  "# ELI contribution, prepared",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by docs/scripts/build-eli-contribution.mjs. One file per dated layer, in the Editor Layer Index's own GeoJSON form, sorted by licence class: **ready** (${counts.ready}) needs no permission, **waiver** (${counts.waiver}) needs the publisher's OSMF waiver first, **ask** (${counts.ask}) needs the publisher's answer. ArcGIS export services and time-parameter WMS are skipped (ELI has no template for them). Before a pull request: check each layer against ELI's existing entries (osmlab/editor-layer-index, sources/), and fill the country codes marked by hand.`,
  "",
  "| Source | Licence | Class | Layers | Files |",
  "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.source} | ${r.licence} | ${r.cls} | ${r.layers} | ${r.written}${r.note ? ` (${r.note})` : ""} |`),
]
fs.writeFileSync(path.join(OUT, "README.md"), md.join("\n"))
console.log(md.slice(0, 3).join("\n"))
console.table(rows.map((r) => ({ source: r.source.slice(0, 40), cls: r.cls, files: r.written })))
