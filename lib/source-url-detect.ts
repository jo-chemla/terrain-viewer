// "Auto" in the Add Basemap and Add Terrain dialogs: what kind of source a
// pasted URL is, so the dialog can switch to the matching type with the URL
// already in its field. The URL's own shape answers most of the time
// (placeholders, extensions, OGC request parameters, known hosts); when it
// says nothing, the start of the response is read once (content type, JSON
// keys, XML root) with a short timeout.

export type DetectTarget = "basemap" | "terrain"

export interface DetectedSource {
  /** The dialog type to switch to; "unsupported" when the URL was
   *  recognised but this dialog cannot take it (the note says why). */
  type: string
  /** The URL to put in that type's field (normalised: a bbox placeholder, a
   *  PMTiles template…). */
  url: string
  /** Shown above the field: what was recognised. */
  label: string
  /** A caveat to show with it (a guessed encoding, a beta type…). */
  note?: string
  /** IIIF maps: start on Allmaps' tile server (a slow image server). */
  allmapsTiles?: boolean
}

const has = (u: string, re: RegExp) => re.test(u)
const lowerParams = (u: string) => { try { return new URL(u).searchParams } catch { return new URLSearchParams(u.split("?")[1] ?? "") } }
const param = (u: string, name: string) => { for (const [k, v] of lowerParams(u)) if (k.toLowerCase() === name) return v; return null }

/** A page about the data, turned into the data's own URL: an Allmaps viewer
 *  link (the map's annotation), a Source Cooperative repository page (its
 *  files are on data.source.coop), a stac-map or STAC Browser link (the
 *  catalog they show). */
export function normalizeSourceUrl(raw: string): string {
  let url = raw.trim()
  // viewer.allmaps.org/?url=<image or manifest>&map=<annotation>: the map.
  if (/^https?:\/\/viewer\.allmaps\.org\//i.test(url)) { const q = lowerParams(url); url = q.get("map") ?? q.get("url") ?? url }
  // source.coop/<account>/<repo>/<path…> → data.source.coop/<account>/<repo>/<path…>
  const sc = /^https?:\/\/(?:www\.)?source\.coop\/([^/?#]+)\/([^/?#]+)(\/[^?#]*)?/i.exec(url)
  if (sc) {
    const file = sc[3] && /\.[a-z0-9]+$/i.test(sc[3]) ? sc[3] : "/catalog.json"
    url = `https://data.source.coop/${sc[1]}/${sc[2]}${file}`
  }
  // developmentseed.org/stac-map/?href=<catalog>
  if (/stac-map/i.test(url)) { const href = lowerParams(url).get("href"); if (href) url = href }
  // radiantearth.github.io/stac-browser/#/external/<host>/<path>
  const sb = /stac-browser\/#\/external\/(.+)$/i.exec(url)
  if (sb) url = `https://${sb[1].replace(/^https?:\/\//i, "")}`
  return url
}

/** A pasted GetMap request as the app can tile it: the bbox placeholder,
 *  Web Mercator (a request copied from a national portal is in its own
 *  CRS, Lambert-93 say, and the placeholder's bbox is Web Mercator, so the
 *  CRS has to follow), and one tile's width and height. Other parameters
 *  (layers, styles, format, version, transparent) stay as pasted. A plain
 *  string rewrite, not `new URL(…)`: that would percent-encode every brace. */
export function templateWmsGetMap(url: string, tileSize = 256): string {
  let out = url.replace(/([?&]bbox=)[^&]*/i, "$1{bbox-epsg-3857}")
  out = out.replace(/([?&](?:srs|crs)=)[^&]*/i, "$1EPSG:3857")
  if (!/[?&](srs|crs)=/i.test(out)) out += `&${/version=1\.3/i.test(out) ? "CRS" : "SRS"}=EPSG:3857`
  out = out.replace(/([?&]width=)[^&]*/i, `$1${tileSize}`).replace(/([?&]height=)[^&]*/i, `$1${tileSize}`)
  if (!/[?&]width=/i.test(out)) out += `&WIDTH=${tileSize}`
  if (!/[?&]height=/i.test(out)) out += `&HEIGHT=${tileSize}`
  return out
}

/** From the URL alone; null when its shape says nothing certain. */
export function detectFromUrl(raw: string, target: DetectTarget): DetectedSource | null {
  const url = normalizeSourceUrl(raw)
  if (!url) return null
  const service = (param(url, "service") ?? "").toLowerCase()
  const request = (param(url, "request") ?? "").toLowerCase()

  // Allmaps and IIIF: a Georeference Annotation (or something Allmaps can
  // find one for). Basemaps only: a warped map is an overlay.
  if (has(url, /annotations\.allmaps\.org|allmaps\.org\/(maps|images|manifests)\//i)) {
    return target === "basemap"
      ? { type: "iiif", url, label: "Allmaps Georeference Annotation" }
      : { type: "unsupported", url, label: "An Allmaps annotation", note: "A georeferenced map is a picture, not elevation: add it with Add Basemap." }
  }
  if (has(url, /\/manifests?(\.json)?($|\?|\/)|\/info\.json($|\?)|\/iiif\//i) && target === "basemap") {
    return { type: "iiif", url: `https://annotations.allmaps.org/?url=${encodeURIComponent(url)}`, label: "IIIF manifest or image", note: "Looked up in Allmaps: it drapes only if someone georeferenced it there." }
  }

  // OGC services.
  if (service === "wms" && request === "getcapabilities" || (!request && service === "wms")) {
    return { type: "wms-picker", url: url.split("?")[0], label: "WMS GetCapabilities", note: "Its layers are listed below: pick one." }
  }
  if (service === "wms" && request === "getmap" || has(url, /\{bbox-epsg-3857\}/)) {
    const pastedCrs = param(url, "srs") ?? param(url, "crs")
    const changed = pastedCrs && !/3857|900913/.test(pastedCrs) ? `The request was in ${pastedCrs}: asked in EPSG:3857 instead, 256 px tiles. ` : ""
    return target === "basemap"
      ? { type: "wms", url: templateWmsGetMap(url, 256), label: "WMS GetMap request", note: changed || undefined }
      : { type: "wms-raw", url: templateWmsGetMap(url, 514), label: "WMS GetMap request", note: `${changed}Read as raw Float32 elevation: the service must deliver GeoTIFF or BIL values, not a coloured picture.` }
  }
  if (service === "wmts" || has(url, /WMTSCapabilities\.xml/i)) {
    return { type: target === "basemap" ? "wms" : "terrarium", url, label: "WMTS service", note: "Give the tile template with {z}/{x}/{y} (TileMatrix, TileCol, TileRow) rather than the capabilities." }
  }

  // ArcGIS REST.
  const arc = /^(.*\/(?:Image|Map)Server)\b/i.exec(url)
  if (arc) {
    const base = arc[1]
    if (/ImageServer/i.test(base)) {
      return target === "basemap"
        ? { type: "wms", url: `${base}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image`, label: "ArcGIS ImageServer" }
        : { type: "wms-raw", url: `${base}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=514,514&format=tiff&pixelType=F32&f=image`, label: "ArcGIS ImageServer", note: "Read as raw Float32 elevation through exportImage." }
    }
    return { type: target === "basemap" ? "tms" : "terrarium", url: `${base}/tile/{z}/{y}/{x}`, label: "ArcGIS MapServer (cached tiles)", note: target === "terrain" ? "Elevation from a MapServer needs an encoded DEM; most are pictures." : undefined }
  }

  // Tile templates.
  if (has(url, /\.pmtiles($|[?#])/i) && !url.startsWith("pmtiles://")) {
    const t = `pmtiles://${url}/{z}/{x}/{y}`
    return target === "basemap" ? { type: "tms", url: t, label: "PMTiles archive" } : { type: "terrarium", url: t, label: "PMTiles archive", note: "Encoding guessed as Terrarium; switch to TerrainRGB if heights look wrong." }
  }
  if (has(url, /\{z\}|\{x\}|\{y\}|\{-y\}|\{quadkey\}|\{s\}/i)) {
    if (target === "basemap") return { type: "tms", url, label: "XYZ tile template" }
    const rgb = has(url, /terrain-?rgb|mapbox\.terrain|terrainrgb/i)
    return { type: rgb ? "terrainrgb" : "terrarium", url, label: "XYZ tile template", note: rgb ? undefined : "Encoding guessed as Terrarium; switch to TerrainRGB if heights look wrong." }
  }

  // Files.
  if (has(url, /\.vrt($|[?#])/i) && target === "terrain") return { type: "vrt", url, label: "GDAL VRT mosaic" }
  if (has(url, /\.lerc($|[?#])|\/ImageServer\/tile\//i) && target === "terrain") return { type: "lerc", url, label: "ArcGIS LERC tiles" }
  if (has(url, /\.tiff?($|[?#])/i)) return { type: "cog", url, label: "Cloud Optimized GeoTIFF" }
  if (has(url, /tilejson|\/tiles\.json($|[?#])/i)) return { type: "tilejson", url, label: "TileJSON" }

  // STAC.
  if (has(url, /\/(catalog|collection)\.json($|[?#])|\/stac(\/|$|\?)|stac\.[a-z]/i)) {
    return { type: "stac", url, label: "STAC catalog", note: "Opened as a custom catalog in the STAC search." }
  }

  // Catalog pages.
  if (has(url, /qms\.nextgis\.com/i) && target === "basemap") return { type: "qms", url, label: "NextGIS QMS" }
  return null
}

/** What the headers alone say: the content type, or the file name of a
 *  Content-Disposition (a GeoTIFF served from a path without extension). */
function detectFromHeaders(res: Response, url: string, target: DetectTarget): DetectedSource | null {
  const ct = (res.headers.get("content-type") ?? "").toLowerCase()
  const cd = res.headers.get("content-disposition") ?? ""
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd)?.[1] ?? ""
  if (/image\/tiff|geotiff/.test(ct) || /\.tiff?$/i.test(name)) return { type: "cog", url, label: "GeoTIFF (by its headers)" }
  if (/\.vrt$/i.test(name) && target === "terrain") return { type: "vrt", url, label: "GDAL VRT mosaic (by its headers)" }
  if (/\.pmtiles$/i.test(name)) return detectFromUrl(name, target) && { type: target === "basemap" ? "tms" : "terrarium", url: `pmtiles://${url}/{z}/{x}/{y}`, label: "PMTiles archive (by its headers)" }
  return null
}

/** The response, when the URL's shape said nothing: its headers first (a
 *  HEAD, nothing downloaded), then the first bytes of the body (one small
 *  Range request: a TIFF's magic number, JSON keys, an XML root). A whole
 *  COG is never fetched. */
export async function detectByFetching(raw: string, target: DetectTarget, signal?: AbortSignal): Promise<DetectedSource | null> {
  const url = normalizeSourceUrl(raw)
  if (!/^https?:\/\//i.test(url)) return null
  const timeout = AbortSignal.timeout(6000)
  const sig = signal && "any" in AbortSignal ? (AbortSignal as any).any([signal, timeout]) : timeout
  // A David Rumsey detail page: Allmaps keys the annotation by the IIIF
  // image's URL (the first 16 hex digits of its SHA-1), so the map's page is
  // enough to ask whether it was georeferenced.
  const rumsey = /davidrumsey\.com\/luna\/servlet\/(?:detail|iiif)\/(RUMSEY~[0-9~]+)/i.exec(url)
  if (rumsey) {
    const image = `https://www.davidrumsey.com/luna/servlet/iiif/${rumsey[1]}`
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(image)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16)
    const annotation = `https://annotations.allmaps.org/images/${hex}`
    const page = await fetch(annotation, { signal: sig }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!page) return { type: "unsupported", url, label: "A David Rumsey map", note: "Not georeferenced in Allmaps (no annotation for its IIIF image), so it cannot be draped. Georeference it on editor.allmaps.org first." }
    if (target !== "basemap") return { type: "unsupported", url: annotation, label: "A David Rumsey map", note: "A georeferenced map is a picture, not elevation: add it with Add Basemap." }
    // Rumsey's own IIIF server answers a tile in half a second or in two
    // minutes, uncached: Allmaps' tile server warps the map server-side and
    // caches the tiles, so the second visit is fast.
    const mapId = /\/maps\/([0-9a-f]{16})/.exec(String((page.items?.[0] ?? page).id ?? ""))?.[1]
    return { type: "iiif", url: mapId ? `https://annotations.allmaps.org/maps/${mapId}` : annotation, label: "David Rumsey map, georeferenced in Allmaps", allmapsTiles: true, note: "Drawn from Allmaps' tile server (cached, much faster than Rumsey's own image server); switch Draw it to the browser for the sharpest warp." }
  }
  try {
    const head = await fetch(url, { method: "HEAD", signal: sig })
    if (head.ok) { const d = detectFromHeaders(head, url, target); if (d) return d }
  } catch { /* HEAD refused or blocked: the Range GET below */ }
  let res: Response
  try { res = await fetch(url, { signal: sig, headers: { Range: "bytes=0-65535" } }) } catch { return null }
  if (!res.ok && res.status !== 206) return null
  const byHeaders = detectFromHeaders(res, url, target)
  if (byHeaders) return byHeaders
  const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0))
  const bytes = new Uint8Array(buf)
  // TIFF magic: "II*\0" (little endian) or "MM\0*", BigTIFF "II+\0" / "MM\0+".
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && (bytes[2] === 0x2a || bytes[2] === 0x2b) && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && (bytes[3] === 0x2a || bytes[3] === 0x2b)))) {
    return { type: "cog", url, label: "GeoTIFF (by its first bytes)" }
  }
  if (bytes.length >= 7 && String.fromCharCode(...bytes.slice(0, 7)) === "PMTiles") {
    return { type: target === "basemap" ? "tms" : "terrarium", url: `pmtiles://${url}/{z}/{x}/{y}`, label: "PMTiles archive (by its first bytes)" }
  }
  const text = new TextDecoder().decode(bytes)
  const head = text.slice(0, 4000)
  if (/WMS_Capabilities|WMT_MS_Capabilities/.test(head)) return { type: "wms-picker", url: url.split("?")[0], label: "WMS GetCapabilities", note: "Its layers are listed below: pick one." }
  if (/<Capabilities[^>]*wmts/i.test(head)) return { type: target === "basemap" ? "wms" : "terrarium", url, label: "WMTS capabilities", note: "Give the tile template with {z}/{x}/{y} rather than the capabilities." }
  if (/<VRTDataset/i.test(head) && target === "terrain") return { type: "vrt", url, label: "GDAL VRT mosaic" }
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (json) {
    if (json.stac_version) return { type: "stac", url, label: `STAC ${json.type ?? "document"}`, note: "Opened as a custom catalog in the STAC search." }
    if (json.tilejson || Array.isArray(json.tiles)) return { type: "tilejson", url, label: "TileJSON" }
    if (json.type === "AnnotationPage" || json.type === "Annotation" || json.motivation === "georeferencing") {
      return target === "basemap" ? { type: "iiif", url, label: "Georeference Annotation" } : { type: "unsupported", url, label: "A Georeference Annotation", note: "A georeferenced map is a picture, not elevation: add it with Add Basemap." }
    }
    if ((json["@context"] && String(json["@context"]).includes("iiif")) && target === "basemap") {
      return { type: "iiif", url: `https://annotations.allmaps.org/?url=${encodeURIComponent(url)}`, label: "IIIF document", note: "Looked up in Allmaps: it drapes only if someone georeferenced it there." }
    }
    if (json.mosaicjson) return { type: "cog", url, label: "MosaicJSON", note: "MosaicJSON is read through titiler." }
  }
  return null
}

/** A name to start from: the layer or the file, else the host. */
export function nameFromUrl(raw: string): string {
  try {
    const u = new URL(raw.replace(/^pmtiles:\/\//, ""))
    const inner = u.hostname === "annotations.allmaps.org" && u.searchParams.get("url")
    if (inner) return nameFromUrl(inner)
    const layer = [...u.searchParams].find(([k]) => /^layers?$/i.test(k))?.[1]
    if (layer) return layer.split(",")[0]
    const segs = decodeURIComponent(u.pathname).split("/").filter((s) => s && !/^\{.*\}(\.\w+)?$/.test(s) && !/^(wms|tile|tiles|rest|services|v1|api|stac|exportImage)$/i.test(s))
    const last = segs.at(-1)?.replace(/\.(tiff?|vrt|json|pmtiles|png|jpe?g|webp|xml)$/i, "")
    const generic = !last || /^(catalog|collection|manifest|info|tilejson|ImageServer|MapServer|maps|images)$/i.test(last)
    const host = u.hostname.replace(/^www\./, "")
    return generic ? (segs.length > 1 ? `${segs.at(-2)} (${host})` : host) : last
  } catch { return "" }
}
