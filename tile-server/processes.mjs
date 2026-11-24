// The modes described as OGC API - Processes (Part 1: Core, OGC 18-062r2):
// the landing page (/), /conformance, the process list (/processes) and one
// process description per mode (/processes/{id}), its settings as inputs
// with JSON Schema, its pictures and values as outputs.
//
// Execution is not the standard's POST /processes/{id}/execution: a mode is
// run by asking for its tiles, so each description links its tile
// endpoints (rel ".../ogc/1.0/execute", templated) and the execution path
// answers 501 with those links. That is why /conformance claims the
// process-description class and not the Processes core class.
//
// What the standard has no slot for is kept as `x-tv-` properties: the
// group of the app's panel a mode belongs to, how it is drawn (form,
// shading, stacking rank), its opacity and group opacity parameters, the
// app's switches, its values' unit and typical range. The QGIS plugin
// builds its panel from these. Built from modesCatalog (qgis-project.mjs),
// the same source as the deprecated /modes.
import { modesCatalog } from "./qgis-project.mjs"
import { MODES, IMAGERY_SOURCES, STACK_ORDER } from "./url.mjs"
import { DIRECT_MODES } from "./direct.mjs"

const OGC = "http://www.opengis.net/def/rel/ogc/1.0"
export const CONFORMANCE = [
  "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core",
  "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/landing-page",
  "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/json",
  "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/ogc-process-description",
  "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/json",
]
const VERSION = "1.0.0"
const binary = (type) => ({ type: "string", contentEncoding: "binary", contentMediaType: type })
export const GEOTIFF = "image/tiff; application=geotiff"
export const MVT = "application/vnd.mapbox-vector-tile"

/** One of the app's URL parameters (a setting of modesCatalog) as a
 *  process input: JSON Schema for its value, the app's own type kept. */
function input(setting, role) {
  const { key, type, enum: values, default: d, note } = setting
  const schema =
    type === "boolean" ? { type: "boolean" }
      : type === "integer" ? { type: "integer" }
        : type === "number" ? { type: "number" }
          : type === "array" ? { type: "array", items: { type: "string" } }
            : { type: "string" }
  if (values) { schema.type = typeof values[0] === "number" ? "number" : "string"; schema.enum = values }
  if (/Opacity$/.test(key)) Object.assign(schema, { minimum: 0, maximum: 1 })
  if (d !== undefined) schema.default = d
  return {
    title: key,
    ...(note ? { description: note } : {}),
    minOccurs: 0, maxOccurs: 1, schema,
    "x-tv-url-param": key, "x-tv-type": type, "x-tv-role": role,
  }
}

/** The inputs every terrain process takes besides its settings. */
const COMMON_INPUTS = {
  terrainSource: { title: "Elevation source", description: "An id from /sources, a tile address (a .tif is read as a COG, a .vrt as a VRT) or a JSON configuration {\"url\", \"type\", \"maxzoom\"}. Unset: Mapterhorn.", minOccurs: 0, maxOccurs: 1, schema: { type: "string", default: "mapterhorn" }, "x-tv-url-param": "terrainSource", "x-tv-role": "common" },
  background: { title: "Map background", description: "`none`: transparent where nothing is drawn, to stack layers in a GIS (direct engine only).", minOccurs: 0, maxOccurs: 1, schema: { type: "string", enum: ["map", "none"], default: "map" }, "x-tv-url-param": "background", "x-tv-role": "common" },
  engine: { title: "Engine", description: "Who draws: `direct` (in the server, fast), `browser` (the app, every source and mode) or `auto`.", minOccurs: 0, maxOccurs: 1, schema: { type: "string", enum: ["auto", "direct", "browser"], default: "auto" }, "x-tv-url-param": "engine", "x-tv-role": "common" },
}

/** The panel groups a mode's opacity is multiplied by: the group switch
 *  (showTerrainAnalysis) named as its opacity (terrainAnalysisOpacity), when
 *  the app has that parameter. */
function groupOpacityKeys(mode, known) {
  return Object.keys(MODES[mode] ?? {}).filter((k) => k.startsWith("show")).map((k) => `${k[4].toLowerCase()}${k.slice(5)}Opacity`).filter((k) => known.has(k) && !k.startsWith(mode))
}

/** Every mode as a process description, in the map's order (top drawn on
 *  top), with its group path; and the group tree by ids. `params`: the
 *  app's URL reference (generated/url-params.json `params`). */
export function processCatalog(params, valueModes = {}) {
  const tree = modesCatalog(params, valueModes)
  const known = new Set(params.map((p) => p.key))
  const byKey = new Map(params.map((p) => [p.key, p]))
  const out = []
  const walk = (g, path) => {
    const here = g.group ? [...path, g.group] : path
    const ids = { ...(g.group ? { group: g.group } : {}) }
    if (g.groups) ids.groups = g.groups.map((s) => walk(s, here))
    if (g.items) {
      ids.items = g.items.map((m) => { out.push({ mode: m, path: here }); return m.id })
    }
    return ids
  }
  const groups = tree.map((g) => walk(g, []))
  return { groups, processes: out.map(({ mode, path }) => describe(mode, path, known, byKey)) }
}

function describe(m, path, known, byKey) {
  const inputs = { ...COMMON_INPUTS }
  const opacityKey = m.opacityKey
  if (opacityKey) inputs[opacityKey] = input({ key: opacityKey, type: "number", default: byKey.get(opacityKey)?.default ?? 1, note: `The opacity of ${m.name}, 0 to 1. Multiplied by its group's (x-tv-group-opacity-keys).` }, "opacity")
  const groupKeys = groupOpacityKeys(m.id, known)
  for (const k of groupKeys) inputs[k] = input({ key: k, type: "number", default: byKey.get(k)?.default ?? 1, note: "The opacity of the mode's panel group, 0 to 1, multiplied with the mode's own." }, "group-opacity")
  for (const s of m.settings) inputs[s.key] = input(s, "setting")
  const outputs = {
    image: { title: `${m.name}, coloured as in the app`, description: "PNG (transparent with background=none) or JPEG tiles.", schema: { oneOf: [binary("image/png"), binary("image/jpeg")] } },
  }
  if (m.values) outputs.values = { title: `${m.name} values`, description: `${m.values.description} Float32 GeoTIFF tiles, EPSG:3857, NaN for no data; or packed in a PNG (encoding=terrarium|terrainrgb).`, schema: { oneOf: [binary(GEOTIFF), binary("image/png")] }, "x-tv-unit": m.values.unit, ...(m.values.range ? { "x-tv-display-range": m.values.range } : {}) }
  if (m.vector) outputs.vectorTile = { title: `${m.name} features`, description: "A Mapbox Vector Tile with the features the overlay draws.", schema: binary(MVT) }
  const rank = STACK_ORDER.indexOf(m.id)
  return {
    id: m.id, version: VERSION, title: m.name,
    description: `${m.name}${path.length ? ` (${path.join(" > ")})` : ""}. ${m.values ? m.values.description + " " : ""}Run by asking for its tiles: see the links with rel ${OGC}/execute.`,
    keywords: [...path, m.form, ...(m.shading ? ["shading"] : []), ...(m.values ? ["values"] : [])],
    outputTransmission: ["value"],
    inputs, outputs,
    "x-tv-group": path,
    "x-tv-form": m.form,
    "x-tv-shading": m.shading,
    "x-tv-vector": m.vector,
    "x-tv-stack-rank": rank,
    "x-tv-engine": DIRECT_MODES.includes(m.id) ? "direct" : "browser",
    "x-tv-switches": m.switches,
    ...(opacityKey ? { "x-tv-opacity-key": opacityKey } : {}),
    "x-tv-group-opacity-keys": groupKeys,
    "x-tv-has-values": !!m.values,
    ...(m.values ? { "x-tv-values": { unit: m.values.unit, description: m.values.description, ...(m.values.range ? { range: m.values.range } : {}) } } : {}),
  }
}

/** The basemap as a process: imagery, not computed from the elevation,
 *  served at /basemap-tiles. */
export const BASEMAP_PROCESS = {
  id: "basemap", version: VERSION, title: "Basemap imagery",
  description: "The app's basemap as it draws it: dated imagery (imagerySource, imageryDate), an XYZ or COG address (imageryUrl), or a named basemap with its overlays (the app's basemap parameters). Run by asking for /basemap-tiles.",
  keywords: ["imagery", "basemap"], outputTransmission: ["value"],
  inputs: {
    imagerySource: { title: "Dated imagery source", minOccurs: 0, maxOccurs: 1, schema: { type: "string", enum: IMAGERY_SOURCES }, "x-tv-url-param": "imagerySource", "x-tv-role": "setting" },
    imageryDate: { title: "Date of the imagery", description: "YYYY-MM-DD, with imagerySource.", minOccurs: 0, maxOccurs: 1, schema: { type: "string", format: "date" }, "x-tv-url-param": "imageryDate", "x-tv-role": "setting" },
    imageryUrl: { title: "Imagery address", description: "XYZ tiles ({z}/{x}/{y}) or a COG.", minOccurs: 0, maxOccurs: 1, schema: { type: "string", format: "uri-template" }, "x-tv-url-param": "imageryUrl", "x-tv-role": "setting" },
    basemapSource: { title: "Named basemap", description: "The app's basemapSource (an id of its basemap list, or an address).", minOccurs: 0, maxOccurs: 1, schema: { type: "string" }, "x-tv-url-param": "basemapSource", "x-tv-role": "setting" },
    overlayBasemapIds: { title: "Basemap overlays", description: "The app's overlayBasemapIds, comma-separated.", minOccurs: 0, maxOccurs: 1, schema: { type: "string" }, "x-tv-url-param": "overlayBasemapIds", "x-tv-role": "setting" },
  },
  outputs: { image: { title: "The imagery", schema: { oneOf: [binary("image/jpeg"), binary("image/png")] } } },
  "x-tv-group": [], "x-tv-form": "raster", "x-tv-shading": false, "x-tv-vector": false, "x-tv-stack-rank": -1, "x-tv-engine": "browser",
  "x-tv-switches": MODES.basemap, "x-tv-group-opacity-keys": [], "x-tv-has-values": false,
}

/** A description's links: itself, and its tile endpoints as the way to run
 *  it (templated: {z}, {x}, {y} are the client's). */
function links(base, p) {
  const terrain = p.id !== "basemap"
  const path = terrain ? "terrain-tiles" : "basemap-tiles"
  const q = terrain ? `?modes=${p.id}` : ""
  const out = [
    { href: `${base}/processes/${p.id}`, rel: "self", type: "application/json", title: "This process description" },
    { href: `${base}/${path}/{z}/{x}/{y}.png${q}`, rel: `${OGC}/execute`, type: "image/png", templated: true, title: "Run: one XYZ tile, PNG" },
    { href: `${base}/${path}/{z}/{x}/{y}.jpg${q}`, rel: `${OGC}/execute`, type: "image/jpeg", templated: true, title: "Run: one XYZ tile, JPEG" },
  ]
  if (p["x-tv-has-values"]) {
    out.push({ href: `${base}/terrain-tiles/{z}/{x}/{y}.tif${q}`, rel: `${OGC}/execute`, type: GEOTIFF, templated: true, title: "Run: the values as a Float32 GeoTIFF tile" })
    out.push({ href: `${base}/gdal.xml${q}`, rel: "alternate", type: "application/xml", title: "The values as one GDAL raster" })
  }
  if (p["x-tv-vector"]) out.push({ href: `${base}/terrain-tiles/{z}/{x}/{y}.pbf${q}`, rel: `${OGC}/execute`, type: MVT, templated: true, title: "Run: the features as a vector tile" })
  out.push({ href: `${base}/tilejson.json${q}`, rel: "describedby", type: "application/json", title: "A TileJSON of the tiles" })
  return out
}

export const withLinks = (base, p) => ({ ...p, links: links(base, p) })

/** The summary of a process in the list: the description without its
 *  inputs and outputs (all of it with `expand`). */
export function summary(base, p, expand = false) {
  if (expand) return withLinks(base, p)
  const { inputs, outputs, ...rest } = p
  return { ...rest, links: [{ href: `${base}/processes/${p.id}`, rel: "self", type: "application/json", title: "The process description" }] }
}

/** /processes: every terrain mode, then the basemap. `x-tv-groups`: the
 *  app's panel tree, by process id, top of the map first. */
export function processList(base, catalog, expand = false) {
  return {
    processes: [...catalog.processes, BASEMAP_PROCESS].map((p) => summary(base, p, expand)),
    links: [
      { href: `${base}/processes${expand ? "?expand=true" : ""}`, rel: "self", type: "application/json", title: "The processes" },
      { href: `${base}/`, rel: "service", type: "application/json", title: "The landing page" },
    ],
    "x-tv-groups": catalog.groups,
    "x-tv-note": "One process per mode of the app. A process is run by asking for its tiles (links rel execute, templated), not by POST to /processes/{id}/execution. Several modes stack in one tile with modes=a,b,c: see the description of `modes` in /openapi.json. ?expand=true gives every description in full.",
  }
}

/** The landing page (OGC API Common), with the service's own index kept. */
export function landingPage(base, extra = {}) {
  return {
    title: "Terrain Viewer tile service",
    description: "What Terrain Viewer draws, as map tiles and pictures: the elevation-derived modes at /terrain-tiles, the imagery at /basemap-tiles, each mode described as an OGC API - Processes process.",
    links: [
      { href: `${base}/`, rel: "self", type: "application/json", title: "This document" },
      { href: `${base}/openapi.json`, rel: "service-desc", type: "application/vnd.oai.openapi+json;version=3.1", title: "The API definition" },
      { href: `${base}/docs`, rel: "service-doc", type: "text/html", title: "The API documentation" },
      { href: `${base}/conformance`, rel: "conformance", type: "application/json", title: "Conformance classes" },
      { href: `${base}/conformance`, rel: `${OGC}/conformance`, type: "application/json", title: "Conformance classes" },
      { href: `${base}/processes`, rel: `${OGC}/processes`, type: "application/json", title: "The modes, as processes" },
      { href: `${base}/terrain-tiles/{z}/{x}/{y}.png?modes=hillshade`, rel: "item", type: "image/png", templated: true, title: "Terrain tiles" },
      { href: `${base}/basemap-tiles/{z}/{x}/{y}.jpg?imagerySource=wayback`, rel: "item", type: "image/jpeg", templated: true, title: "Basemap tiles" },
    ],
    ...extra,
  }
}

