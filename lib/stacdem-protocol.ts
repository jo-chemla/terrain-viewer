// stacdem:// — dynamic lunar terrain from a base COG + per-strip STAC COGs.
//
// SKELETON (feature-flag-less, not yet user-reachable): the resolution-ladder
// protocol designed in docs/content/docs/dev/moon-lola.mdx. One maplibre
// raster-dem source that serves:
//   z <  detailMinZoom : windows of a global/base DEM COG (EPSG:3857-labeled
//                        "fake mercator", see the docs page) — its overview
//                        pyramid makes whole-Moon views a few range requests.
//   z >= detailMinZoom : Kaguya TC stereo DTM strips (USGS `astrogeo-ard` S3,
//                        CORS ✓) warped over the base and composited, so ~10 m
//                        detail appears only where the viewport actually is.
//
// Strip discovery is two-tier, in order:
//   1. tindex  — a FlatGeobuf tile index (built by
//      .github/workflows/build-kaguya-tindex.yml, schema after gdaltindex/
//      `pdal tindex`: `location` = COG href, `srs` = proj4 string). FlatGeobuf's
//      packed R-tree lets the browser bbox-query the REMOTE file via HTTP range
//      requests — no full download, no gpkg.
//   2. live STAC search — POST {searchUrl}/search with the tile bbox; used when
//      no tindex is configured, and as the refresh path when a bbox turns up
//      nothing in the index (e.g. the index predates newly published strips).
//
// Reprojection is NOT hand-rolled: `geowarp` (GeoTIFF.js ecosystem) does the
// per-pixel warp/resample; we only supply proj4 converter functions built from
// the strip's proj4 string (already computed server-side into the tindex `srs`
// column, so the client never parses user-defined lunar geokeys).
// (Evaluated and rejected: kylebarron/deck.gl-raster — GPU band-math for
// deck.gl, archived, superseded by @developmentseed/deck.gl-raster, and not a
// warp engine; geotiff-tile — higher-level sibling of geowarp, viable, but
// geowarp's explicit inputs fit a maplibre protocol handler better.)

import { fromUrl } from "geotiff"
import proj4 from "proj4"
import { elevationToTerrarium } from "./elevation-encoding"

export interface StacDemSourceConfig {
  /** EPSG:3857-labeled base DEM COG (fake/angular mercator — see docs). */
  baseDemUrl: string
  /** FlatGeobuf tindex URL (CORS + range requests required). */
  tindexUrl?: string
  /** STAC API root, e.g. "https://stac.astrogeology.usgs.gov/api". */
  stacSearchUrl?: string
  stacCollections?: string[]
  /** First zoom at which strips are fetched (default 10). */
  detailMinZoom?: number
  /** How fake-mercator tile coords map to lunar lon/lat (docs: "three tricks"). */
  mapping: "angular" | "metric-polar" | "truepos"
  tileSize?: number
}

// Configs are registered by id and referenced as stacdem://{id}/{z}/{x}/{y} —
// same indirection the viz protocols use for their (non-serializable) options.
const sources = new Map<string, StacDemSourceConfig>()
export function registerStacDemSource(id: string, config: StacDemSourceConfig): void {
  sources.set(id, config)
}

const EARTH_R = 6378137
const MOON_R = 1737400
const DEG = Math.PI / 180

/** Inverse of the "fake mercator" mappings: fake-3857 meters -> lunar lon/lat.
 *  Verified against gdaltransform for the angular case (ob_tran o_lat_p=0
 *  o_lon_p=180): stere(0,0)->(0,0); stere(0,+304km)->(0,-1118869); (+304km,0)
 *  ->(-1113174,0) — i.e. a pure 180° rotation, chirality preserved. */
function fakeMercatorToMoonLonLat(x: number, y: number, mapping: StacDemSourceConfig["mapping"]): [number, number] {
  switch (mapping) {
    case "truepos": {
      // Plain inverse web mercator; lunar lon/lat == the map's lon/lat.
      return [x / (EARTH_R * DEG), Math.atan(Math.sinh(y / EARTH_R)) / DEG]
    }
    case "metric-polar": {
      // Fake meters ARE south-polar-stereographic meters on the Moon sphere
      // (variant A, k0=1, lat_0=-90): invert it directly.
      const rho = Math.hypot(x, y)
      const lat = -90 + (2 * Math.atan(rho / (2 * MOON_R))) / DEG
      const lon = Math.atan2(x, y) / DEG
      return [lon, lat]
    }
    case "angular": {
      // Inverse mercator to rotated lon/lat (1 lunar deg == 1 earth deg),
      // then undo the ob_tran pole rotation (new pole at lunar (0°E, 0°N),
      // o_lon_p=180): south pole -> (0,0), 180° rotation of azimuths.
      const lonR = x / (EARTH_R * DEG)
      const latR = Math.atan(Math.sinh(y / EARTH_R)) / DEG
      const lr = lonR * DEG
      const pr = latR * DEG
      // Rotated (0,0) must give lat=-90; rotated (0, -10°) -> lat=-80, lon 0;
      // rotated (-10°, 0) -> lat=-80, lon 90 (matches the test vectors above).
      const sinLat = -Math.cos(pr) * Math.cos(lr)
      const lat = Math.asin(sinLat) / DEG
      const lon = Math.atan2(Math.sin(lr) * Math.cos(pr), -Math.sin(pr)) / DEG
      return [lon, lat]
    }
  }
}

function tileBboxMercator(z: number, x: number, y: number): [number, number, number, number] {
  const worldSize = 2 * 20037508.342789244
  const tile = worldSize / Math.pow(2, z)
  return [
    -20037508.342789244 + x * tile,
    20037508.342789244 - (y + 1) * tile,
    -20037508.342789244 + (x + 1) * tile,
    20037508.342789244 - y * tile,
  ]
}

/** Lunar lon/lat bbox of a fake-mercator tile (samples the edges — the
 *  mappings aren't affine, corners alone under-cover near the pole). */
function tileMoonBbox(z: number, x: number, y: number, mapping: StacDemSourceConfig["mapping"]): [number, number, number, number] {
  const [mx0, my0, mx1, my1] = tileBboxMercator(z, x, y)
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const N = 8
  for (let i = 0; i <= N; i++) {
    for (const [px, py] of [
      [mx0 + ((mx1 - mx0) * i) / N, my0], [mx0 + ((mx1 - mx0) * i) / N, my1],
      [mx0, my0 + ((my1 - my0) * i) / N], [mx1, my0 + ((my1 - my0) * i) / N],
    ]) {
      const [lon, lat] = fakeMercatorToMoonLonLat(px, py, mapping)
      w = Math.min(w, lon); e = Math.max(e, lon)
      s = Math.min(s, lat); n = Math.max(n, lat)
    }
  }
  // TODO(polar): a tile containing the pole itself needs lat clamped to -90
  // and the full lon range — detect via point-in-tile of the pole's fake xy.
  return [w, s, e, n]
}

interface StripRecord {
  location: string
  /** proj4 string of the strip's CRS (tindex `srs` column / STAC projjson). */
  srs: string
  gsd: number
  projTransform?: number[]
  projShape?: number[]
}

/** Tier 1: bbox-query the remote FlatGeobuf tindex via HTTP range requests. */
async function queryTindex(url: string, bbox: [number, number, number, number]): Promise<StripRecord[]> {
  const { geojson } = await import("flatgeobuf")
  const out: StripRecord[] = []
  const iter = geojson.deserialize(url, { minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3] })
  for await (const feature of iter as AsyncIterable<{ properties: Record<string, unknown> }>) {
    const p = feature.properties
    out.push({
      location: String(p.location),
      srs: String(p.srs),
      gsd: Number(p.gsd ?? NaN),
      projTransform: p.proj_transform ? JSON.parse(String(p.proj_transform)) : undefined,
      projShape: p.proj_shape ? JSON.parse(String(p.proj_shape)) : undefined,
    })
  }
  return out
}

/** Tier 2: live STAC search — no tindex needed, and the refresh path when the
 *  index has no hits for a bbox (viewport outgrew what was indexed/loaded). */
async function queryStacLive(
  searchUrl: string, collections: string[] | undefined,
  bbox: [number, number, number, number], signal: AbortSignal,
): Promise<StripRecord[]> {
  const res = await fetch(`${searchUrl}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bbox, collections, limit: 200 }),
    signal,
  })
  if (!res.ok) throw new Error(`STAC search failed: ${res.status}`)
  const fc = await res.json()
  return (fc.features ?? []).flatMap((f: any) => {
    const dtm = f.assets?.dtm?.href
    const wkt = f.properties?.["proj:wkt2"]
    if (!dtm || !wkt) return []
    // TODO(crs): derive a proj4 string from proj:projjson (eqc + polar stere
    // are the only two families in this catalog). The tindex path avoids this
    // entirely — its `srs` column is precomputed with pyproj.
    return [{
      location: dtm, srs: "",
      gsd: Number(f.properties?.gsd ?? NaN),
      projTransform: f.properties?.["proj:transform"],
      projShape: f.properties?.["proj:shape"],
    }]
  })
}

/** Read a window of the base COG covering the tile (base is EPSG:3857-labeled,
 *  so this is a plain aligned window read at the best-fitting overview). */
async function readBaseTile(
  baseDemUrl: string, z: number, x: number, y: number, size: number,
): Promise<Float32Array> {
  const [mx0, my0, mx1, my1] = tileBboxMercator(z, x, y)
  const tiff = await fromUrl(baseDemUrl)
  const full = await tiff.getImage(0)
  const [ox, , , oy] = [full.getOrigin()[0], 0, 0, full.getOrigin()[1]]
  const fullRes = full.getResolution()[0]
  const targetRes = (mx1 - mx0) / size
  // Best overview: finest level whose resolution is still <= 2x target.
  const count = await tiff.getImageCount()
  let img = full
  for (let i = 1; i < count; i++) {
    const cand = await tiff.getImage(i)
    const res = fullRes * (full.getWidth() / cand.getWidth())
    if (res <= targetRes * 2) img = cand
    else break
  }
  const res = fullRes * (full.getWidth() / img.getWidth())
  const window = [
    Math.floor((mx0 - ox) / res), Math.floor((oy - my1) / res),
    Math.ceil((mx1 - ox) / res), Math.ceil((oy - my0) / res),
  ]
  const rasters = await img.readRasters({ window, width: size, height: size, fillValue: NaN })
  return new Float32Array(rasters[0] as ArrayLike<number>)
}

/** Warp one strip COG onto the tile grid with geowarp (bilinear), writing only
 *  where the strip has data. `elev` is mutated in place. */
async function warpStripOntoTile(
  strip: StripRecord, z: number, x: number, y: number, size: number,
  mapping: StacDemSourceConfig["mapping"], elev: Float32Array,
): Promise<void> {
  if (!strip.srs || !strip.projTransform || !strip.projShape) return // live-search TODO(crs)
  const toStrip = proj4("+proj=longlat +R=" + MOON_R + " +no_defs", strip.srs)
  const [a, b, , d, , f] = [
    strip.projTransform[1], strip.projTransform[2], 0,
    strip.projTransform[0], 0, strip.projTransform[3],
  ]
  void b
  // Strip pixel window covering the tile: project the tile's moon bbox corners.
  const [w, s, e, n] = tileMoonBbox(z, x, y, mapping)
  const corners = [[w, s], [w, n], [e, s], [e, n]].map((pt) => toStrip.forward(pt as [number, number]))
  const xs = corners.map((c) => (c[0] - d) / a)
  const ys = corners.map((c) => (c[1] - strip.projTransform![3]) / f)
  void ys; void xs
  const tiff = await fromUrl(strip.location)
  const img = await tiff.getImage(0)
  // TODO(warp): clamp the window to the strip, readRasters({window}), then
  //   const geowarp = (await import("geowarp")).default
  //   geowarp({ in_data: [stripWindow], in_bbox, in_srs: undefined,
  //             out_bbox: tileMercatorBbox, out_height: size, out_width: size,
  //             method: "bilinear", inverse: fakeXY => toStrip.forward(
  //               fakeMercatorToMoonLonLat(fakeXY[0], fakeXY[1], mapping)),
  //             in_no_data: NaN })
  // and copy finite outputs into `elev` (strips are LOLA-controlled, so no
  // vertical shim needed; edge feathering is a follow-up).
  void img; void elev; void size
}

async function encodeTerrariumPng(elev: Float32Array, size: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext("2d")!
  const imageData = ctx.createImageData(size, size)
  for (let i = 0; i < elev.length; i++) {
    const v = isFinite(elev[i]) ? elev[i] : 0
    const [r, g, b, alpha] = elevationToTerrarium(v)
    imageData.data[i * 4] = r
    imageData.data[i * 4 + 1] = g
    imageData.data[i * 4 + 2] = b
    imageData.data[i * 4 + 3] = alpha
  }
  ctx.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return new Uint8Array(await blob.arrayBuffer())
}

/** stacdem://{sourceId}/{z}/{x}/{y} -> terrarium PNG (raster-dem, encoding
 *  "terrarium"). Register with maplibre wrapped in withTileResultCache. */
export async function stacdemProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const m = params.url.match(/^stacdem:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/)
  if (!m) throw new Error(`stacdem: bad url ${params.url}`)
  const [, id, zs, xs, ys] = m
  const config = sources.get(id)
  if (!config) throw new Error(`stacdem: unregistered source "${id}"`)
  const z = +zs, x = +xs, y = +ys
  const size = config.tileSize ?? 256

  const elev = await readBaseTile(config.baseDemUrl, z, x, y, size)

  if (z >= (config.detailMinZoom ?? 10)) {
    const bbox = tileMoonBbox(z, x, y, config.mapping)
    let strips: StripRecord[] = []
    if (config.tindexUrl) strips = await queryTindex(config.tindexUrl, bbox)
    if (!strips.length && config.stacSearchUrl)
      strips = await queryStacLive(config.stacSearchUrl, config.stacCollections, bbox, abortController.signal)
    // Coarsest first so finer strips overwrite where they overlap.
    strips.sort((p, q) => (q.gsd || 0) - (p.gsd || 0))
    for (const strip of strips)
      await warpStripOntoTile(strip, z, x, y, size, config.mapping, elev)
  }

  return { data: await encodeTerrariumPng(elev, size) }
}
