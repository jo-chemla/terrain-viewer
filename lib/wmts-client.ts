// WMTS (OGC Web Map Tile Service 1.0.0): read a GetCapabilities document and
// turn one of its layers into a MapLibre raster tile template ({z}/{x}/{y}).
//
// A WMTS names its own tile grids (TileMatrixSets). MapLibre draws one grid
// only, Google's Web Mercator one, so a layer is usable when it links to a
// set whose matrices ARE that grid: EPSG:3857 (any spelling), top-left corner
// at (-20037508.34, 20037508.34), and each matrix covering the world's width
// in a power-of-two number of tiles. The set's name is not trusted (IGN
// France's "PM", swisstopo's "3857_18", GIBS' "GoogleMapsCompatible_Level9"
// are all fine; a set called "GoogleMapsCompatible" with other scales is
// not). The zoom of each matrix is log2(MatrixWidth), and its identifier
// (plain "5", or "EPSG:3857:5") becomes the {z} of the template through a
// common prefix and suffix.
//
// A layer offered only in EPSG:3395 on that same square grid goes through the
// row-resampling epsg3395:// protocol (lib/epsg3395-protocol.ts); any other
// CRS is refused with its name (no general raster reprojection here).
//
// Parsing uses DOMParser (no dependency); the matching is namespace-blind,
// on local names, since services disagree on prefixes.

export interface WmtsStyle { identifier: string; title?: string; isDefault: boolean }
export interface WmtsDimension { identifier: string; default?: string; values: string[]; current?: boolean }
export interface WmtsResourceUrl { format: string; resourceType: string; template: string }
export interface WmtsMatrixLimits { matrix: string; minRow: number; maxRow: number; minCol: number; maxCol: number }
export interface WmtsLayer {
  identifier: string
  title: string
  abstract?: string
  /** [west, south, east, north], from WGS84BoundingBox. */
  bbox?: [number, number, number, number]
  styles: WmtsStyle[]
  formats: string[]
  tileMatrixSetLinks: { set: string; limits: WmtsMatrixLimits[] }[]
  resourceUrls: WmtsResourceUrl[]
  dimensions: WmtsDimension[]
}
export interface WmtsTileMatrix {
  identifier: string
  scaleDenominator: number
  topLeft: [number, number]
  tileWidth: number
  tileHeight: number
  matrixWidth: number
  matrixHeight: number
}
export interface WmtsTileMatrixSet { identifier: string; crs: string; matrices: WmtsTileMatrix[] }
export interface WmtsCapabilities {
  /** The URL the document was read from. */
  url: string
  title?: string
  /** ServiceProvider name (and site), used as the attribution. */
  provider?: string
  providerSite?: string
  accessConstraints?: string
  /** The KVP GetTile endpoint, ending in "?" or "&". */
  kvpGetTile?: string
  layers: WmtsLayer[]
  matrixSets: Map<string, WmtsTileMatrixSet>
}

// --- XML helpers (namespace-blind) ---------------------------------------

const kids = (el: Element | Document, name: string): Element[] =>
  Array.from((el as Element).children ?? []).filter((c) => c.localName === name)
const kid = (el: Element | Document, name: string): Element | undefined => kids(el, name)[0]
const text = (el: Element | undefined, name?: string): string | undefined => {
  const e = name && el ? kid(el, name) : el
  const t = e?.textContent?.trim()
  return t ? t : undefined
}
const xlinkHref = (el: Element | undefined) =>
  el?.getAttribute("xlink:href") ?? el?.getAttributeNS?.("http://www.w3.org/1999/xlink", "href") ?? el?.getAttribute("href") ?? undefined
const nums = (s: string | undefined) => (s ?? "").trim().split(/\s+/).map(Number)

/** The capabilities URL of whatever was pasted: a KVP service URL gets
 *  REQUEST=GetCapabilities (and SERVICE=WMTS) when missing; a RESTful
 *  WMTSCapabilities.xml is kept as it is. */
export function wmtsCapabilitiesUrl(raw: string): string {
  const url = raw.trim()
  if (/WMTSCapabilities\.xml/i.test(url)) return url
  const has = (k: string) => new RegExp(`[?&]${k}=`, "i").test(url)
  let out = url
  const sep = () => (out.includes("?") ? (/[?&]$/.test(out) ? "" : "&") : "?")
  if (!has("service")) out += `${sep()}SERVICE=WMTS`
  if (!has("request")) out += `${sep()}REQUEST=GetCapabilities`
  else out = out.replace(/([?&]request=)[^&]*/i, "$1GetCapabilities")
  return out
}

/** Parse a GetCapabilities document. `parse` is injectable for Node tests. */
export function parseWmtsCapabilities(xml: string, url: string, parse: (s: string) => Document = (s) => new DOMParser().parseFromString(s, "application/xml")): WmtsCapabilities {
  const doc = parse(xml)
  const root = doc.documentElement
  if (!root || root.localName === "parsererror" || doc.getElementsByTagName("parsererror").length) throw new Error("The capabilities are not valid XML.")
  if (root.localName === "ExceptionReport") throw new Error(`The service answered an exception: ${text(kid(kid(root, "Exception") ?? root, "ExceptionText")) ?? "no detail"}`)
  if (root.localName !== "Capabilities") throw new Error(`Not a WMTS capabilities document (root <${root.localName}>).`)

  const ident = kid(root, "ServiceIdentification")
  const prov = kid(root, "ServiceProvider")
  // KVP GetTile endpoint, from OperationsMetadata.
  let kvpGetTile: string | undefined
  for (const op of kids(kid(root, "OperationsMetadata") ?? root, "Operation")) {
    if (op.getAttribute("name") !== "GetTile") continue
    for (const get of Array.from(op.getElementsByTagName("*")).filter((e) => e.localName === "Get")) {
      const encodings = Array.from(get.getElementsByTagName("*")).filter((e) => e.localName === "Value").map((e) => e.textContent?.trim())
      const href = xlinkHref(get)
      if (href && (encodings.length === 0 || encodings.includes("KVP"))) { kvpGetTile = href; break }
    }
  }
  if (kvpGetTile && !/[?&]$/.test(kvpGetTile)) kvpGetTile += kvpGetTile.includes("?") ? "&" : "?"

  const contents = kid(root, "Contents")
  if (!contents) throw new Error("The capabilities list no <Contents>.")
  const matrixSets = new Map<string, WmtsTileMatrixSet>()
  for (const s of kids(contents, "TileMatrixSet")) {
    const id = text(s, "Identifier")
    if (!id) continue
    matrixSets.set(id, {
      identifier: id,
      crs: text(s, "SupportedCRS") ?? "",
      matrices: kids(s, "TileMatrix").map((m) => {
        const tl = nums(text(m, "TopLeftCorner"))
        return {
          identifier: text(m, "Identifier") ?? "",
          scaleDenominator: Number(text(m, "ScaleDenominator")),
          topLeft: [tl[0], tl[1]] as [number, number],
          tileWidth: Number(text(m, "TileWidth") ?? 256),
          tileHeight: Number(text(m, "TileHeight") ?? 256),
          matrixWidth: Number(text(m, "MatrixWidth")),
          matrixHeight: Number(text(m, "MatrixHeight")),
        }
      }),
    })
  }

  const layers: WmtsLayer[] = kids(contents, "Layer").map((l) => {
    const bb = kid(l, "WGS84BoundingBox")
    const lo = nums(text(bb, "LowerCorner")), hi = nums(text(bb, "UpperCorner"))
    const bbox = bb && [lo[0], lo[1], hi[0], hi[1]].every(Number.isFinite) ? [lo[0], lo[1], hi[0], hi[1]] as [number, number, number, number] : undefined
    const id = text(l, "Identifier") ?? ""
    return {
      identifier: id,
      title: text(l, "Title") ?? id,
      abstract: text(l, "Abstract"),
      bbox,
      styles: kids(l, "Style").map((s) => ({ identifier: text(s, "Identifier") ?? "", title: text(s, "Title"), isDefault: s.getAttribute("isDefault") === "true" })),
      formats: kids(l, "Format").map((f) => f.textContent?.trim() ?? "").filter(Boolean),
      tileMatrixSetLinks: kids(l, "TileMatrixSetLink").map((k) => ({
        set: text(k, "TileMatrixSet") ?? "",
        limits: kids(kid(k, "TileMatrixSetLimits") ?? k, "TileMatrixLimits").map((t) => ({
          matrix: text(t, "TileMatrix") ?? "",
          minRow: Number(text(t, "MinTileRow")), maxRow: Number(text(t, "MaxTileRow")),
          minCol: Number(text(t, "MinTileCol")), maxCol: Number(text(t, "MaxTileCol")),
        })),
      })),
      resourceUrls: kids(l, "ResourceURL").map((r) => ({ format: r.getAttribute("format") ?? "", resourceType: r.getAttribute("resourceType") ?? "", template: r.getAttribute("template") ?? "" })).filter((r) => r.template),
      dimensions: kids(l, "Dimension").map((d) => ({
        identifier: text(d, "Identifier") ?? "",
        default: text(d, "Default"),
        current: text(d, "Current") === "true",
        values: kids(d, "Value").map((v) => v.textContent?.trim() ?? "").filter(Boolean),
      })).filter((d) => d.identifier),
    }
  }).filter((l) => l.identifier)

  return {
    url,
    title: text(ident, "Title"),
    provider: text(prov, "ProviderName"),
    providerSite: xlinkHref(kid(prov ?? root, "ProviderSite")),
    accessConstraints: text(ident, "AccessConstraints"),
    kvpGetTile,
    layers,
    matrixSets,
  }
}

// --- Matrix sets ---------------------------------------------------------

const HALF = 20037508.342789244 // half the Web Mercator world, metres
const WORLD = 2 * HALF
/** OGC "standardized rendering pixel size": 0.28 mm. */
const PIXEL = 0.00028

/** "EPSG:3857", "urn:ogc:def:crs:EPSG::3857", "urn:ogc:def:crs:EPSG:6.18:3:3857",
 *  "http://www.opengis.net/def/crs/EPSG/0/3857" → 3857; "CRS:84" → 4326. */
export function crsCode(crs: string): number | undefined {
  if (/CRS:?84|OGC:.*CRS84/i.test(crs)) return 4326
  if (/900913|GOOGLE/i.test(crs)) return 3857
  const m = /(\d{4,6})\s*$/.exec(crs.trim())
  return m ? Number(m[1]) : undefined
}

export type GridKind = "webmercator" | "epsg3395"

/** z of each matrix when the set is the square Web Mercator grid (3857, or
 *  3395 on the same square), else null. Every matrix must agree: world-wide
 *  width in 2^z tiles, the top-left corner, square tiles of one size. A
 *  missing matrix at some zoom is fine (sets that start at z6, say). */
export function webMercatorZooms(set: WmtsTileMatrixSet): { kind: GridKind; zooms: Map<string, number>; tileSize: number } | null {
  const code = crsCode(set.crs)
  const kind: GridKind | null = code === 3857 || code === 102100 || code === 102113 ? "webmercator" : code === 3395 ? "epsg3395" : null
  if (!kind || set.matrices.length === 0) return null
  const zooms = new Map<string, number>()
  let tileSize = 0
  for (const m of set.matrices) {
    if (m.tileWidth !== m.tileHeight) return null
    if (tileSize && m.tileWidth !== tileSize) return null
    tileSize = m.tileWidth
    // Corner within 20 m (PNOA writes 2.0037508E7) and either axis order.
    const okCorner = (x: number, y: number) => Math.abs(x + HALF) < 20 && Math.abs(y - HALF) < 20
    if (!okCorner(m.topLeft[0], m.topLeft[1]) && !okCorner(m.topLeft[1], m.topLeft[0])) return null
    const z = Math.log2(m.matrixWidth)
    if (!Number.isInteger(z) || z > 30) return null
    // Its width on the ground from the scale: within 0.5 % of the world.
    const span = m.matrixWidth * m.tileWidth * m.scaleDenominator * PIXEL
    if (Math.abs(span - WORLD) / WORLD > 0.005) return null
    if (m.matrixHeight && m.matrixHeight !== m.matrixWidth) return null
    zooms.set(m.identifier, z)
  }
  return { kind, zooms, tileSize }
}

/** "{prefix}{z}{suffix}" when every identifier reads that way, else null. */
export function matrixIdPattern(zooms: Map<string, number>): { prefix: string; suffix: string } | null {
  let pattern: { prefix: string; suffix: string } | null = null
  for (const [id, z] of zooms) {
    const zs = String(z)
    // The LAST occurrence of z, so "EPSG:3857:5" reads prefix "EPSG:3857:".
    const at = id.lastIndexOf(zs)
    if (at < 0) return null
    const p = { prefix: id.slice(0, at), suffix: id.slice(at + zs.length) }
    if (/\d$/.test(p.prefix) || /^\d/.test(p.suffix)) return null
    if (pattern && (pattern.prefix !== p.prefix || pattern.suffix !== p.suffix)) return null
    pattern = p
  }
  return pattern
}

// --- Choosing and building ----------------------------------------------

export interface WmtsChoice {
  style?: string
  format?: string
  /** A matrix set the layer links to; the best Web Mercator one by default. */
  matrixSet?: string
  /** Dimension values by identifier (Time…); defaults otherwise. */
  dimensions?: Record<string, string>
}

export interface WmtsTileSource {
  url: string
  minzoom: number
  maxzoom: number
  tileSize: number
  matrixSet: string
  style: string
  format: string
  encoding: "rest" | "kvp"
  kind: GridKind
  bounds?: [number, number, number, number]
  attribution?: string
  dimensions: Record<string, string>
}

export interface WmtsUsableSet { set: string; kind: GridKind; minzoom: number; maxzoom: number; tileSize: number; pattern: { prefix: string; suffix: string } }

/** The layer's matrix sets MapLibre can draw, best first: Web Mercator over
 *  3395, then the widest zoom range. */
export function usableMatrixSets(caps: WmtsCapabilities, layer: WmtsLayer): WmtsUsableSet[] {
  const out: WmtsUsableSet[] = []
  for (const link of layer.tileMatrixSetLinks) {
    const set = caps.matrixSets.get(link.set)
    if (!set) continue
    const g = webMercatorZooms(set)
    if (!g) continue
    // TileMatrixSetLimits narrow the levels the layer actually has.
    const zooms = link.limits.length ? new Map([...g.zooms].filter(([id]) => link.limits.some((l) => l.matrix === id))) : g.zooms
    if (!zooms.size) continue
    const pattern = matrixIdPattern(zooms)
    if (!pattern) continue
    const zs = [...zooms.values()]
    out.push({ set: link.set, kind: g.kind, minzoom: Math.min(...zs), maxzoom: Math.max(...zs), tileSize: g.tileSize, pattern })
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "webmercator" ? -1 : 1) || (b.maxzoom - b.minzoom) - (a.maxzoom - a.minzoom))
}

/** Why a layer cannot be drawn: the CRS of the sets it offers. */
export function unusableReason(caps: WmtsCapabilities, layer: WmtsLayer): string {
  const crss = [...new Set(layer.tileMatrixSetLinks.map((l) => caps.matrixSets.get(l.set)?.crs).filter(Boolean) as string[])]
  const named = crss.map((c) => { const n = crsCode(c); return n ? `EPSG:${n}` : c })
  const has3857 = crss.some((c) => crsCode(c) === 3857)
  if (has3857) return "Its Web Mercator matrix set does not follow the Google tile grid (corner, scales or matrix names), so MapLibre cannot draw it."
  return `This service only offers ${named.length ? [...new Set(named)].join(", ") : "an unknown CRS"} for this layer; MapLibre draws Web Mercator (EPSG:3857) tiles only, and the app has no general reprojection for raster tiles.`
}

/** Build the tile template for a layer. Throws with a readable reason. */
export function buildWmtsTileSource(caps: WmtsCapabilities, layer: WmtsLayer, choice: WmtsChoice = {}): WmtsTileSource {
  const sets = usableMatrixSets(caps, layer)
  const set = (choice.matrixSet && sets.find((s) => s.set === choice.matrixSet)) || sets[0]
  if (!set) throw new Error(unusableReason(caps, layer))
  const style = choice.style ?? layer.styles.find((s) => s.isDefault)?.identifier ?? layer.styles[0]?.identifier ?? "default"
  const dims: Record<string, string> = {}
  for (const d of layer.dimensions) {
    const v = choice.dimensions?.[d.identifier] ?? d.default ?? d.values.at(-1)
    if (v !== undefined) dims[d.identifier] = v
  }
  const tiles = layer.resourceUrls.filter((r) => r.resourceType === "tile")
  const formats = layer.formats.length ? layer.formats : [...new Set(tiles.map((r) => r.format))]
  const imageFormats = formats.filter((f) => /^image\//i.test(f))
  const format = choice.format && formats.includes(choice.format)
    ? choice.format
    // The service's own first image format (PNOA lists its pregenerated
    // JPEG before PNG; an overlay service lists PNG first).
    : imageFormats[0] ?? formats[0] ?? "image/png"
  const z = `${set.pattern.prefix}{z}${set.pattern.suffix}`

  let url: string
  let encoding: "rest" | "kvp"
  // RESTful when a template exists for the format: prefer the one that
  // carries every dimension placeholder (GIBS lists one with {Time} and one
  // without, the second meaning "default"), so a chosen value is honoured.
  const restCandidates = tiles.filter((r) => r.format === format)
  const rest = restCandidates.sort((a, b) => placeholderCount(b.template, dims) - placeholderCount(a.template, dims))[0]
  if (rest) {
    encoding = "rest"
    url = rest.template.replace(/\{([^}]+)\}/g, (m, key: string) => {
      const k = key.toLowerCase()
      if (k === "tilematrixset") return encodeURIComponent(set.set)
      if (k === "tilematrix") return z
      if (k === "tilerow") return "{y}"
      if (k === "tilecol") return "{x}"
      if (k === "style") return encodeURIComponent(style)
      const dim = Object.keys(dims).find((d) => d.toLowerCase() === k)
      return dim ? encodeURIComponent(dims[dim]) : m
    })
  } else if (caps.kvpGetTile) {
    encoding = "kvp"
    const q = [
      "SERVICE=WMTS", "REQUEST=GetTile", "VERSION=1.0.0",
      `LAYER=${encodeURIComponent(layer.identifier)}`,
      `STYLE=${encodeURIComponent(style)}`,
      `TILEMATRIXSET=${encodeURIComponent(set.set)}`,
      `TILEMATRIX=${encodeURIComponent(set.pattern.prefix)}{z}${encodeURIComponent(set.pattern.suffix)}`,
      "TILEROW={y}", "TILECOL={x}",
      `FORMAT=${encodeURIComponent(format)}`,
      ...Object.entries(dims).map(([k, v]) => `${encodeURIComponent(k.toUpperCase())}=${encodeURIComponent(v)}`),
    ]
    // The endpoint may already carry parameters (IGN's "…/wmts?SERVICE=WMTS&"):
    // drop the ones we set ourselves.
    const base = caps.kvpGetTile.replace(/([?&])(service|request|version)=[^&]*&?/gi, "$1")
    url = base + q.join("&")
  } else {
    throw new Error("The service lists neither a RESTful tile template for this layer nor a KVP GetTile endpoint.")
  }
  if (/\{(?!z\}|x\}|y\})[^}]+\}/.test(url)) {
    const left = /\{(?!z\}|x\}|y\})([^}]+)\}/.exec(url)?.[1]
    throw new Error(`The tile template has a {${left}} the capabilities give no value for.`)
  }
  if (set.kind === "epsg3395") url = `epsg3395://${encodeURIComponent(url)}/{z}/{x}/{y}`

  const attribution = caps.provider ? (caps.providerSite ? `<a href="${caps.providerSite}" target="_blank" rel="noopener">${escapeHtml(caps.provider)}</a>` : escapeHtml(caps.provider)) : undefined
  return { url, minzoom: set.minzoom, maxzoom: set.maxzoom, tileSize: set.tileSize, matrixSet: set.set, style, format, encoding, kind: set.kind, bounds: layer.bbox, attribution, dimensions: dims }
}

function placeholderCount(template: string, dims: Record<string, string>): number {
  const keys = Object.keys(dims).map((d) => d.toLowerCase())
  return [...template.matchAll(/\{([^}]+)\}/g)].filter((m) => keys.includes(m[1].toLowerCase())).length
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

// --- Fetching ------------------------------------------------------------

const cache = new Map<string, Promise<WmtsCapabilities>>()

/** Fetch and parse, cached per URL for the session (GIBS' document is 6 MB).
 *  A network failure is explained: the browser says only "Failed to fetch"
 *  when the server sends no Access-Control-Allow-Origin. */
export function fetchWmtsCapabilities(raw: string, signal?: AbortSignal): Promise<WmtsCapabilities> {
  const url = wmtsCapabilitiesUrl(raw)
  const hit = cache.get(url)
  if (hit) return hit
  const p = (async () => {
    let res: Response
    try {
      res = await fetch(url, { signal })
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e
      throw new Error(`Could not read the capabilities from ${new URL(url).host}: the server is unreachable, or it does not allow this site to read it (no Access-Control-Allow-Origin header, CORS). A capabilities document a browser cannot read cannot be listed here; if you have the tile template ({z}/{x}/{y} or TileMatrix/TileRow/TileCol), add it as a TMS/XYZ source instead: tiles are often served with CORS when the capabilities are not.`)
    }
    if (!res.ok) throw new Error(`The service answered HTTP ${res.status} for its capabilities.`)
    return parseWmtsCapabilities(await res.text(), url)
  })()
  cache.set(url, p)
  p.catch(() => cache.delete(url))
  return p
}

/** A STAC web-map-links `wmts` link, or an asset of the WMTS media type. */
export interface StacWmtsRef { href: string; layers: string[]; dimensions?: Record<string, string>; title?: string }
export function stacWmtsRefs(obj: { links?: { rel: string; href: string; type?: string; title?: string; [k: string]: unknown }[]; assets?: Record<string, { href: string; type?: string; title?: string; roles?: string[]; [k: string]: unknown }> } | undefined): StacWmtsRef[] {
  if (!obj) return []
  const out: StacWmtsRef[] = []
  const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : [])
  const isWmts = (rel: string | undefined, type: string | undefined, href: string) =>
    rel === "wmts" || /application\/vnd\.ogc\.wmts\+xml/i.test(type ?? "") || /WMTSCapabilities\.xml|[?&]service=wmts|gibs\.earthdata\.nasa\.gov\/wmts\//i.test(href)
  for (const l of obj.links ?? []) {
    if (!l.href || !isWmts(l.rel, l.type, l.href)) continue
    const dims = l["wmts:dimensions"] as Record<string, unknown> | undefined
    out.push({ href: l.href, layers: asList(l["wmts:layer"]), dimensions: dims ? Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, String(v)])) : undefined, title: l.title })
  }
  for (const [key, a] of Object.entries(obj.assets ?? {})) {
    if (!a.href || !isWmts(undefined, a.type, a.href)) continue
    out.push({ href: a.href, layers: asList(a["wmts:layer"]), title: a.title ?? key })
  }
  return out
}

/** One layer of a STAC wmts ref as a tile source; the STAC dimension values
 *  (wmts:dimensions, e.g. STYLE or TIME) override the defaults. */
export async function resolveStacWmts(ref: StacWmtsRef, layerId: string | undefined, signal?: AbortSignal): Promise<{ caps: WmtsCapabilities; layer: WmtsLayer; source: WmtsTileSource }> {
  const caps = await fetchWmtsCapabilities(ref.href, signal)
  const layer = layerId ? caps.layers.find((l) => l.identifier === layerId) : caps.layers.length === 1 ? caps.layers[0] : undefined
  if (!layer) throw new Error(layerId ? `The service has no layer "${layerId}".` : "Pick a layer.")
  const choice: WmtsChoice = { dimensions: {} }
  for (const [k, v] of Object.entries(ref.dimensions ?? {})) {
    if (/^style$/i.test(k)) choice.style = v
    else if (/^format$/i.test(k)) choice.format = v
    else if (/^tilematrixset$/i.test(k)) choice.matrixSet = v
    else { const d = layer.dimensions.find((x) => x.identifier.toLowerCase() === k.toLowerCase()); choice.dimensions![d?.identifier ?? k] = v }
  }
  return { caps, layer, source: buildWmtsTileSource(caps, layer, choice) }
}
