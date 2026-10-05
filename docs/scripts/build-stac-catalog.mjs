#!/usr/bin/env node
// Writes a static STAC catalogue (STAC 1.1) of every source Terrain Viewer
// knows, to docs/public/stac/, served next to the docs at /docs/stac/catalog.json
// so STAC Browser, STAC Map or any STAC client can open it:
//
//   terrain-builtin     the built-in elevation tiles (Mapterhorn, Mapbox...)
//   terrain-library     the terrain library (lib/custom-sources.json)
//   basemap-library     the basemap library (same file)
//   historical-imagery  the timeline's own sources (Wayback, Google Earth...)
//   eli                 every OSM Editor Layer Index layer, with its footprint
//                       and dates (from the index's imagery.geojson)
//   ign-historical      every dated IGN Géoplateforme layer (WMTS capabilities)
//   national-historical the regional year series of lib/national-historical.ts
//                       (Catalonia, Spain, NRW, Wallonia, Flanders, PDOK...)
//   timeline-catalogues the searchable catalogues the timeline queries per view
//                       (HOT STAC, Planet, Map Warper, ArcGIS...): links only
//
// Tile services are described with the web-map-links extension (xyz, wms,
// wmts links); elevation tiles also carry their encoding. COGs are assets.
// QMS and Allmaps are searched per view; serving them as STAC would take a
// server-side proxy (a later step), so they are only linked here.
//
//   node docs/scripts/build-stac-catalog.mjs            # network for ELI and IGN
//   node docs/scripts/build-stac-catalog.mjs --offline  # skip them
//
// The output is generated, not tracked (docs/public/stac is git-ignored); the
// docs build runs this.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ROOT = path.resolve(DOCS, "..")
const OUT = path.join(DOCS, "public", "stac")
const OFFLINE = process.argv.includes("--offline")
const APP = "https://terrain-viewer.iconem.com/"
const STAC_VERSION = "1.1.0"
const WEB_MAP_LINKS = "https://stac-extensions.github.io/web-map-links/v1.2.0/schema.json"
const NOW = new Date().toISOString()
const WORLD = [-180, -85.0511, 180, 85.0511]

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/custom-sources.json"), "utf8"))
const { terrainSources } = await import(pathToUrl(path.join(ROOT, "lib/terrain-sources.ts")))
const { NATIONAL_SOURCES } = await import(pathToUrl(path.join(ROOT, "lib/national-historical.ts")))
const NATIONAL_LAYERS = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/national-historical-layers.json"), "utf8"))
function pathToUrl(p) { return new URL(`file:///${p.replace(/\\/g, "/")}`).href }

fs.rmSync(OUT, { recursive: true, force: true })
const write = (rel, obj) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 1))
}
const slug = (s) => String(s).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120)
const bboxPolygon = (b) => ({ type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] })
function bboxOf(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]) } else c.forEach(walk) }
  walk(geometry.coordinates)
  return [w, s, e, n]
}
const union = (boxes) => boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : WORLD
const openInApp = (bbox) => {
  const lng = (bbox[0] + bbox[2]) / 2, lat = (bbox[1] + bbox[3]) / 2
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1], 1e-6)
  const zoom = Math.max(1, Math.min(16, Math.log2(360 / span)))
  return { rel: "alternate", type: "text/html", title: "Open in Terrain Viewer", href: `${APP}?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&zoom=${zoom.toFixed(1)}` }
}
const isoYear = (y) => `${String(y).padStart(4, "0")}-01-01T00:00:00Z`

// A tile URL as a web-map link: xyz templates, WMS (base + layers), WMTS.
function tileLinks(url, type, extra = {}) {
  if (!url) return []
  const u = url.startsWith("http") ? url : `https://${url}`
  if (type === "wms" || /request=GetMap/i.test(u)) {
    const [base, query = ""] = u.split("?")
    const q = new URLSearchParams(query)
    const get = (k) => [...q.entries()].find(([kk]) => kk.toLowerCase() === k)?.[1]
    const layers = (get("layers") || get("coverage") || "").split(",").filter(Boolean)
    // A WMS link needs its layers; a request without them (WCS, odd
    // templates) stays a plain related link to the full template.
    if (!layers.length) return [{ rel: "related", type: get("format") || "image/png", href: u, ...extra }]
    const styles = (get("styles") || "").split(",").filter(Boolean)
    return [{ rel: "wms", type: get("format") || "image/png", href: base, "wms:layers": layers, ...(styles.length ? { "wms:styles": styles } : {}), ...extra }]
  }
  if (type === "wmts" || /request=GetTile/i.test(u)) {
    const [base, query = ""] = u.split("?")
    const q = new URLSearchParams(query)
    const get = (k) => [...q.entries()].find(([kk]) => kk.toLowerCase() === k)?.[1]
    if (get("layer")) return [{ rel: "wmts", type: get("format") || "image/png", href: base, "wmts:layer": get("layer"), ...extra }]
  }
  if (type === "tilejson") return [{ rel: "tilejson", type: "application/json", href: u, ...extra }]
  if (/\{z\}|\{zoom\}/.test(u)) {
    const href = u.replace("{zoom}", "{z}").replace(/\{switch:([^,}]+)[^}]*\}/, "$1").replace("{-y}", "{y}")
    return [{ rel: "xyz", type: /\.(jpe?g)(\?|$)/i.test(href) ? "image/jpeg" : /\.webp(\?|$)/i.test(href) ? "image/webp" : "image/png", href, ...extra }]
  }
  return []
}

// Item ids are unique per collection: a slug that collides gets a suffix.
const usedIds = new Map()
function item(collection, rawId, { title, description, bbox, geometry, datetime = null, start = null, end = null, links = [], assets = {}, props = {} }) {
  const used = usedIds.get(collection) ?? new Set()
  usedIds.set(collection, used)
  let id = slug(rawId)
  for (let n = 2; used.has(id); n++) id = `${slug(rawId)}-${n}`
  used.add(id)
  const b = bbox ?? (geometry ? bboxOf(geometry) : WORLD)
  const time = datetime || start || end ? { datetime, start_datetime: start ?? undefined, end_datetime: end ?? undefined }
    // Undated: STAC needs a time, so an open range, flagged.
    : { datetime: null, start_datetime: "1800-01-01T00:00:00Z", end_datetime: NOW, "terrain-viewer:undated": true }
  const it = {
    type: "Feature", stac_version: STAC_VERSION, stac_extensions: links.some((l) => ["xyz", "wms", "wmts", "tilejson"].includes(l.rel)) ? [WEB_MAP_LINKS] : [],
    id, collection, bbox: b, geometry: geometry ?? bboxPolygon(b),
    properties: { title: title || undefined, description: description || undefined, ...time, ...props },
    links: [
      { rel: "root", href: "../../catalog.json", type: "application/json" },
      { rel: "parent", href: "../collection.json", type: "application/json" },
      { rel: "collection", href: "../collection.json", type: "application/json" },
      openInApp(b),
      ...links,
    ],
    assets,
  }
  write(`${collection}/items/${it.id}.json`, it)
  return it
}

const collections = []
function collection(id, { title, description, items, keywords = [], links = [], providers, license = "various", temporal }) {
  const boxes = items.map((i) => i.bbox)
  const starts = items.map((i) => i.properties.datetime || i.properties.start_datetime).filter(Boolean).sort()
  const ends = items.map((i) => i.properties.datetime || i.properties.end_datetime).filter(Boolean).sort()
  write(`${id}/collection.json`, {
    type: "Collection", stac_version: STAC_VERSION, stac_extensions: [], id, title, description, license, keywords, providers,
    extent: { spatial: { bbox: [items.length ? union(boxes) : WORLD] }, temporal: { interval: [temporal ?? [starts[0] ?? null, ends[ends.length - 1] ?? null]] } },
    links: [
      { rel: "root", href: "../catalog.json", type: "application/json" },
      { rel: "parent", href: "../catalog.json", type: "application/json" },
      ...items.map((i) => ({ rel: "item", href: `./items/${i.id}.json`, type: "application/geo+json", title: i.properties.title })),
      ...links,
    ],
  })
  collections.push({ id, title, count: items.length })
  console.log(`  ${id}: ${items.length} items`)
}

// ── Built-in terrain ───────────────────────────────────────────────────────
{
  const items = Object.entries(terrainSources).map(([id, t]) => {
    const cfg = t.sourceConfig ?? {}
    const encoding = t.encoding ?? cfg.encoding
    return item("terrain-builtin", id, {
      title: t.name, description: t.description,
      links: [
        ...tileLinks(cfg.tiles?.[0], "tms", { title: t.name, "terrain-viewer:encoding": encoding, "terrain-viewer:maxzoom": cfg.maxzoom, "terrain-viewer:tile_size": cfg.tileSize, "terrain-viewer:needs_key": /\{API_KEY\}|access_token=/.test(cfg.tiles?.[0] ?? "") || undefined }),
        t.link && { rel: "about", type: "text/html", href: t.link, title: "Provider page" },
        { rel: "alternate", type: "text/html", title: "Open in Terrain Viewer with this source", href: `${APP}?sourceA=${id}` },
      ].filter(Boolean),
      props: { "terrain-viewer:kind": "terrain", "terrain-viewer:source": id },
    })
  })
  collection("terrain-builtin", { title: "Built-in elevation tiles", description: "The global elevation tile services Terrain Viewer ships with. Links carry the tile encoding (terrarium, terrainrgb...) and whether an API key is needed.", items, keywords: ["elevation", "dem", "terrain"] })
}

// ── Libraries ──────────────────────────────────────────────────────────────
function library(collectionId, list, kind, title, description) {
  const items = list.map((s) => {
    const isCog = /cog/.test(s.type) || /\.tiff?(\?|$)/i.test(s.url)
    const href = s.url?.startsWith("http") ? s.url : `https://${s.url}`
    return item(collectionId, s.id, {
      title: s.name, description: s.description, bbox: s.bounds,
      links: [
        ...(isCog ? [] : tileLinks(s.url, s.type === "wms-raw" ? "wms" : s.type, { title: s.name, "terrain-viewer:type": s.type, "terrain-viewer:encoding": s.encoding, "terrain-viewer:maxzoom": s.maxzoom })),
        s.infoUrl && { rel: "about", type: "text/html", href: s.infoUrl, title: "Dataset page" },
      ].filter(Boolean),
      assets: isCog && !/\{/.test(href) ? { data: { href, type: "image/tiff; application=geotiff; profile=cloud-optimized", roles: kind === "terrain" ? ["data", "elevation"] : ["data", "visual"], title: s.name } } : {},
      props: { "terrain-viewer:kind": kind, "terrain-viewer:type": s.type, ...(s.resolutionM ? { gsd: s.resolutionM } : {}), ...(s.role ? { "terrain-viewer:role": s.role } : {}) },
    })
  })
  collection(collectionId, { title, description, items, keywords: kind === "terrain" ? ["elevation", "dem", "lidar"] : ["basemap", "imagery"] })
}
library("terrain-library", sources.SAMPLE_TERRAIN_SOURCES, "terrain", "Terrain library", "National and regional elevation datasets in Terrain Viewer's terrain library: COGs, tile services, WCS. Footprints are the declared bounds; gsd is the native resolution in metres.")
library("basemap-library", sources.SAMPLE_BASEMAPS_SOURCES, "basemap", "Basemap library", "Basemaps and overlays in Terrain Viewer's basemap library.")

// ── Historical imagery (the timeline's own sources) ────────────────────────
{
  const H = [
    ["wayback", "Esri World Imagery Wayback", "Every archived release of Esri World Imagery since 2014; the timeline resolves each release to its real capture dates per tile.", "2014-02-20T00:00:00Z", null, "https://livingatlas.arcgis.com/wayback/"],
    ["ge-historical", "Google Earth Historical", "Google Earth's historical imagery, dated per tile from its own quadtree packets.", "1940-01-01T00:00:00Z", null, "https://earth.google.com/"],
    ["bing", "Bing Maps aerial", "The current Bing mosaic, its capture range read per tile.", null, null, "https://www.bing.com/maps"],
    ["planet", "Planet Global Monthly Basemaps", "Planet's monthly global mosaics (needs a Planet key).", "2016-01-01T00:00:00Z", null, "https://www.planet.com/"],
    ["eox-s2", "EOX Sentinel-2 Cloudless", "Yearly cloudless Sentinel-2 mosaics by EOX.", "2016-01-01T00:00:00Z", null, "https://s2maps.eu/"],
    ["hls", "NASA Harmonized Landsat Sentinel-2", "Monthly HLS mosaics from NASA GIBS.", "2013-04-01T00:00:00Z", null, "https://hls.gsfc.nasa.gov/"],
  ]
  const items = H.map(([id, title, description, start, end, about]) => item("historical-imagery", id, {
    title, description, start: start ?? NOW, end: end ?? NOW,
    links: [{ rel: "about", type: "text/html", href: about, title }],
    props: { "terrain-viewer:kind": "historical", "terrain-viewer:timeline_source": id },
  }))
  collection("historical-imagery", { title: "Historical imagery (timeline sources)", description: "The dated imagery sources Terrain Viewer's historical timeline reads natively. Their dates are resolved per tile at run time, so each is one item spanning its archive.", items, keywords: ["historical", "imagery", "timeline"] })
}

// ── OSM Editor Layer Index ─────────────────────────────────────────────────
if (!OFFLINE) {
  try {
    const res = await fetch("https://osmlab.github.io/editor-layer-index/imagery.geojson")
    if (!res.ok) throw new Error(`ELI ${res.status}`)
    const fc = await res.json()
    const date = (d, endOfYear) => {
      if (!d) return null
      const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(d))
      if (!m) return null
      return endOfYear && !m[2] ? `${m[1]}-12-31T23:59:59Z` : `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}T00:00:00Z`
    }
    const items = []
    for (const f of fc.features) {
      const p = f.properties ?? {}
      if (!p.id) continue
      const start = date(p.start_date), end = date(p.end_date, true)
      items.push(item("eli", p.id, {
        title: p.name, description: p.description ?? `${p.type ?? ""} layer of the OSM Editor Layer Index${p.category ? ` (${p.category})` : ""}`,
        geometry: f.geometry ?? undefined, bbox: f.geometry ? undefined : WORLD,
        ...(start && end && start !== end ? { start, end } : start || end ? { datetime: start ?? end } : {}),
        links: [
          ...tileLinks(p.url, p.type, { title: p.name, "terrain-viewer:maxzoom": p.max_zoom }),
          p.attribution?.url && { rel: "license", type: "text/html", href: p.attribution.url, title: p.attribution.text },
          p.privacy_policy_url && { rel: "related", type: "text/html", href: p.privacy_policy_url, title: "Privacy policy" },
        ].filter(Boolean),
        props: { "eli:id": p.id, "eli:type": p.type, "eli:category": p.category, "eli:best": p.best || undefined, "eli:overlay": p.overlay || undefined, "eli:country_code": p.country_code, "eli:worldwide": !f.geometry || undefined },
      }))
    }
    collection("eli", { title: "OSM Editor Layer Index", description: "Every imagery and map layer of the OSM Editor Layer Index, with its coverage polygon (worldwide layers get the whole world) and its capture dates where the index has them. Year-only dates span the year.", items, keywords: ["openstreetmap", "imagery", "orthophoto"], license: "various", links: [{ rel: "via", href: "https://github.com/osmlab/editor-layer-index", type: "text/html", title: "OSM Editor Layer Index" }] })
  } catch (e) { console.warn("  eli skipped:", e.message) }

  // ── IGN Géoplateforme dated layers ─────────────────────────────────────
  try {
    const xml = await (await fetch("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities")).text()
    const items = []
    const now = new Date().getUTCFullYear()
    for (const [, layer] of xml.matchAll(/<Layer>([\s\S]*?)<\/Layer>/g)) {
      const id = /<ows:Identifier>(.*?)<\/ows:Identifier>/.exec(layer)?.[1] ?? ""
      if (!/^(ORTHOIMAGERY\.ORTHO|orthophoto_|POC_ORTHOS|GEOGRAPHICALGRIDSYSTEMS\.)|CASSINI/.test(id) || /IRC|PLANIGN|\.MAPS$|MAPS\.(BDUNI|OVERVIEW)|SCAN-EXPRESS|SCAN(25|100|OACI|REG)/i.test(id)) continue
      const title = (/<ows:Title>(.*?)<\/ows:Title>/.exec(layer)?.[1] ?? id).replace(/&apos;/g, "'").replace(/&amp;/g, "&")
      const m = /\b(1[5-9]\d\d|20\d\d)(?:\s*[-–]\s*(1[5-9]\d\d|20\d\d))?/.exec(`${title} ${id}`)
      const span = m ? [Number(m[1]), Number(m[2] ?? m[1])] : /CASSINI/.test(id) ? [1756, 1815] : null
      if (!span || span[0] > now) continue
      const lo = /<ows:LowerCorner>(.*?)<\/ows:LowerCorner>/.exec(layer)?.[1].split(/\s+/).map(Number)
      const hi = /<ows:UpperCorner>(.*?)<\/ows:UpperCorner>/.exec(layer)?.[1].split(/\s+/).map(Number)
      if (!lo || !hi) continue
      const format = /<Format>(.*?)<\/Format>/.exec(layer)?.[1] ?? "image/jpeg"
      const tms = /<TileMatrixSet>(.*?)<\/TileMatrixSet>/.exec(layer)?.[1] ?? "PM"
      const style = /<Style[^>]*>[\s\S]*?<ows:Identifier>(.*?)<\/ows:Identifier>/.exec(layer)?.[1] ?? "normal"
      items.push(item("ign-historical", id, {
        title, description: `IGN Géoplateforme layer ${id}`, bbox: [lo[0], lo[1], hi[0], hi[1]],
        ...(span[0] === span[1] ? { datetime: isoYear(span[0]) } : { start: isoYear(span[0]), end: `${span[1]}-12-31T23:59:59Z` }),
        links: [
          { rel: "wmts", type: format, href: "https://data.geopf.fr/wmts", "wmts:layer": id, "wmts:dimensions": { STYLE: style, TILEMATRIXSET: tms }, title },
          { rel: "xyz", type: format, href: `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(id)}&STYLE=${encodeURIComponent(style)}&FORMAT=${encodeURIComponent(format)}&TILEMATRIXSET=${encodeURIComponent(tms)}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`, title },
          { rel: "about", type: "text/html", href: "https://remonterletemps.ign.fr/", title: "Remonter le temps" },
        ],
        props: { "terrain-viewer:kind": "historical", "terrain-viewer:catalog": "cat-ign" },
      }))
    }
    collection("ign-historical", { title: "IGN Remonter le temps (France)", description: "Every dated layer of IGN's Géoplateforme WMTS: historical aerial mosaics 1950-1995, yearly orthophotos since 2000 (each year covers part of France; the extent is the layer's declared one), SPOT and Pléiades years, Cassini, État-major, the 1950 map, departmental archives.", items, keywords: ["france", "historical", "orthophoto"], license: "etalab-2.0" })
  } catch (e) { console.warn("  ign-historical skipped:", e.message) }
}

// ── Regional historical series (lib/national-historical.ts) ───────────────
{
  const items = []
  for (const src of NATIONAL_SOURCES) {
    for (const l of src.lazy ? NATIONAL_LAYERS[src.id] ?? [] : src.layers) {
      const end = l.endYear && l.endYear !== l.year ? `${l.endYear}-12-31T23:59:59Z` : null
      items.push(item("national-historical", `${src.id.replace(/^cat-nat-/, "")}-${l.key}`, {
        title: `${src.label}: ${l.label}`, description: `${src.note} Licence: ${src.licence}.`, bbox: l.bbox ?? src.bbox,
        ...(end ? { start: isoYear(l.year), end } : { datetime: isoYear(l.year) }),
        links: [
          ...(() => {
            const wml = tileLinks(l.url, l.type, { title: l.label, "terrain-viewer:maxzoom": l.maxzoom })
            // The WMS link drops what it cannot express (TIME, the exact
            // request): the ready tile template rides along.
            return wml.some((k) => k.rel === "wms") ? [...wml, { rel: "related", type: "image/jpeg", href: l.url, title: "Tile template ({bbox-epsg-3857})" }] : wml
          })(),
          { rel: "about", type: "text/html", href: src.infoUrl, title: src.label },
        ],
        props: { "terrain-viewer:kind": "historical", "terrain-viewer:catalog": src.id, "terrain-viewer:licence": src.licence },
      }))
    }
  }
  collection("national-historical", { title: "National and regional historical imagery", description: "Year series of orthophotos and historical maps from about 70 national, regional and city mapping agencies, browser-friendly (CORS, Web Mercator, no key), as on Terrain Viewer's timeline: Spain and its regions, Portugal, France's regions, Italy's regions, Germany's Länder, Austria, Switzerland, Belgium, the Netherlands, Luxembourg, Slovenia, Lithuania, Cyprus, Slovakia, Canada, the United States, Australia, Taiwan, Japan, Brazil and Landsat WELD. A year's layer may cover only part of the extent.", items, keywords: ["historical", "orthophoto", "aerial"] })
}

// ── Catalogues searched per view (links only) ──────────────────────────────
{
  const C = [
    ["hot-stac", "HOT STAC API (OpenAerialMap, Maxar and Vantor Open Data, NOAA)", "https://api.imagery.hotosm.org/stac", "STAC API"],
    ["planet-disaster", "Planet disaster data (Source Cooperative)", "https://data.source.coop/planet/disasterdata/catalog.json", "static STAC catalog"],
    ["mapwarper", "Map Warper", "https://mapwarper.net/api/v1/maps", "JSON API, bbox search"],
    ["wikimaps-warper", "Wikimaps Warper", "https://warper.wmflabs.org/api/v1/maps", "JSON API, bbox search"],
    ["usgs-topo", "USGS historical topographic maps (Esri image service)", "https://historical1.arcgis.com/arcgis/rest/services/USA_Historical_Topographic_Maps/ImageServer", "ArcGIS ImageServer"],
    ["arcgis-online", "ArcGIS Online search", "https://www.arcgis.com/sharing/rest/search", "ArcGIS search API"],
    ["swisstopo", "swisstopo time travel (SWISSIMAGE Zeitreise, map series)", "https://api3.geo.admin.ch/rest/services/all/MapServer/identify", "geo.admin.ch identify"],
    ["qms", "NextGIS Quick Map Services", "https://qms.nextgis.com/api/v1/geoservices/", "JSON API, extent search"],
    ["allmaps", "Allmaps georeferenced maps", "https://annotations.allmaps.org/maps.geojson", "GeoJSON, bbox search"],
  ]
  const items = C.map(([id, title, href, kind]) => item("timeline-catalogues", id, {
    title, description: `Searched by Terrain Viewer for the current view (${kind}); not copied here.`,
    links: [{ rel: kind.startsWith("STAC") || kind.startsWith("static STAC") ? "child" : "via", href, type: "application/json", title }],
    props: { "terrain-viewer:kind": "catalogue" },
  }))
  collection("timeline-catalogues", { title: "Catalogues searched per view", description: "The imagery and old-map catalogues Terrain Viewer queries for the view (historical timeline Catalogues tree, coverage overlays). Live searches, so only linked: the two STAC ones are children a STAC client can follow.", items, keywords: ["catalogue", "search"] })
}

write("catalog.json", {
  type: "Catalog", stac_version: STAC_VERSION, id: "terrain-viewer", title: "Terrain Viewer sources",
  description: `Every elevation, basemap, historical and catalogue source Terrain Viewer knows, as STAC. Generated ${NOW.slice(0, 10)} by docs/scripts/build-stac-catalog.mjs.`,
  links: [
    { rel: "root", href: "./catalog.json", type: "application/json" },
    { rel: "self", href: "./catalog.json", type: "application/json" },
    ...collections.map((c) => ({ rel: "child", href: `./${c.id}/collection.json`, type: "application/json", title: `${c.title} (${c.count})` })),
    { rel: "about", href: `${APP}docs`, type: "text/html", title: "Terrain Viewer docs" },
  ],
})
console.log(`stac: ${collections.length} collections, ${collections.reduce((n, c) => n + c.count, 0)} items -> ${path.relative(ROOT, OUT)}`)
