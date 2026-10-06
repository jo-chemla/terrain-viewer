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
}

const has = (u: string, re: RegExp) => re.test(u)
const lowerParams = (u: string) => { try { return new URL(u).searchParams } catch { return new URLSearchParams(u.split("?")[1] ?? "") } }
const param = (u: string, name: string) => { for (const [k, v] of lowerParams(u)) if (k.toLowerCase() === name) return v; return null }

/** From the URL alone; null when its shape says nothing certain. */
export function detectFromUrl(raw: string, target: DetectTarget): DetectedSource | null {
  const url = raw.trim()
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
    const withBbox = url.replace(/([?&]bbox=)[^&]*/i, "$1{bbox-epsg-3857}")
    return target === "basemap"
      ? { type: "wms", url: withBbox, label: "WMS GetMap request" }
      : { type: "wms-raw", url: withBbox, label: "WMS GetMap request", note: "Read as raw Float32 elevation: the service must deliver GeoTIFF or BIL values, not a coloured picture." }
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
  if (has(url, /\.pmtiles($|\?)/i) && !url.startsWith("pmtiles://")) {
    const t = `pmtiles://${url}/{z}/{x}/{y}`
    return target === "basemap" ? { type: "tms", url: t, label: "PMTiles archive" } : { type: "terrarium", url: t, label: "PMTiles archive", note: "Encoding guessed as Terrarium; switch to TerrainRGB if heights look wrong." }
  }
  if (has(url, /\{z\}|\{x\}|\{y\}|\{-y\}|\{quadkey\}|\{s\}/i)) {
    if (target === "basemap") return { type: "tms", url, label: "XYZ tile template" }
    const rgb = has(url, /terrain-?rgb|mapbox\.terrain|terrainrgb/i)
    return { type: rgb ? "terrainrgb" : "terrarium", url, label: "XYZ tile template", note: rgb ? undefined : "Encoding guessed as Terrarium; switch to TerrainRGB if heights look wrong." }
  }

  // Files.
  if (has(url, /\.vrt($|\?)/i) && target === "terrain") return { type: "vrt", url, label: "GDAL VRT mosaic" }
  if (has(url, /\.lerc($|\?)|\/ImageServer\/tile\//i) && target === "terrain") return { type: "lerc", url, label: "ArcGIS LERC tiles" }
  if (has(url, /\.tiff?($|\?)/i)) return { type: "cog", url, label: "Cloud Optimized GeoTIFF" }
  if (has(url, /tilejson|\/tiles\.json($|\?)/i)) return { type: "tilejson", url, label: "TileJSON" }

  // STAC.
  if (has(url, /\/(catalog|collection)\.json($|\?)|\/stac(\/|$|\?)|stac\.[a-z]/i)) {
    return { type: "stac", url, label: "STAC catalog", note: "STAC search is a beta: switch it on in Settings → Beta if the type is missing." }
  }

  // Catalog pages.
  if (has(url, /qms\.nextgis\.com/i) && target === "basemap") return { type: "qms", url, label: "NextGIS QMS" }
  return null
}

/** The response, read once, when the URL's shape said nothing. */
export async function detectByFetching(raw: string, target: DetectTarget, signal?: AbortSignal): Promise<DetectedSource | null> {
  const url = raw.trim()
  if (!/^https?:\/\//i.test(url)) return null
  const timeout = AbortSignal.timeout(6000)
  const sig = signal && "any" in AbortSignal ? (AbortSignal as any).any([signal, timeout]) : timeout
  let res: Response
  try { res = await fetch(url, { signal: sig, headers: { Range: "bytes=0-65535" } }) } catch { return null }
  if (!res.ok && res.status !== 206) return null
  const ct = (res.headers.get("content-type") ?? "").toLowerCase()
  if (/image\/tiff|application\/octet-stream.*tif|geotiff/.test(ct)) return { type: "cog", url, label: "GeoTIFF (by its content type)" }
  const text = await res.text().catch(() => "")
  const head = text.slice(0, 4000)
  if (/WMS_Capabilities|WMT_MS_Capabilities/.test(head)) return { type: "wms-picker", url: url.split("?")[0], label: "WMS GetCapabilities", note: "Its layers are listed below: pick one." }
  if (/<Capabilities[^>]*wmts/i.test(head)) return { type: target === "basemap" ? "wms" : "terrarium", url, label: "WMTS capabilities", note: "Give the tile template with {z}/{x}/{y} rather than the capabilities." }
  if (/<VRTDataset/i.test(head) && target === "terrain") return { type: "vrt", url, label: "GDAL VRT mosaic" }
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (json) {
    if (json.stac_version) return { type: "stac", url, label: `STAC ${json.type ?? "document"}`, note: "STAC search is a beta: switch it on in Settings → Beta if the type is missing." }
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
