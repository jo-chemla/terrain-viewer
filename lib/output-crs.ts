// Output CRS for the raster exports (historical batch, DEM, layer renders,
// snapshot world files). The pixels of every export in the app are a Web
// Mercator grid (the tiles' and the map's); nothing here warps them. What
// changes with the chosen CRS is the georeferencing only: the output grid's
// corners are projected into the target CRS and an affine transform
// (origin, pixel size, rotation/shear) is fitted through them. In EPSG:3857
// that transform is exact; in any other CRS the Mercator grid is not an
// affine image of the target grid, so the fit is off by a residual that
// grows with the footprint - measured at the corners and the centre and
// reported, never hidden (see affineForGrid).
//
// proj4 definitions: 4326 and 3857 built in, UTM zones generated, any other
// EPSG code fetched from epsg.io once per session.
import proj4 from "proj4"

export interface GeoBbox { west: number; south: number; east: number; north: number }

/** Where the pixels of an export are, in a CRS: GDAL's geotransform
 *  convention, X = x0 + a*col + b*row and Y = y0 + d*col + e*row, with col
 *  and row counted from the top-left corner of the top-left pixel. */
export interface GridGeoref {
  epsg: number
  /** Geographic (degrees, GeographicTypeGeoKey) rather than projected. */
  geographic: boolean
  geoTransform: [x0: number, a: number, b: number, y0: number, d: number, e: number]
  /** Rotation or shear terms present: the GeoTIFF needs ModelTransformation
   *  rather than ModelPixelScale + ModelTiepoint. */
  rotated: boolean
  /** Largest distance, in pixels, between a sampled point's true projected
   *  position and where the affine puts it (corners and centre). 0 when
   *  the grid is exactly affine in the CRS (EPSG:3857). */
  maxResidualPx: number
}

/** Residual (pixels, at the corners) past which an unwarped export in a
 *  CRS is reported as a warning; below it the residual is only noted. */
export const RESIDUAL_WARNING_PX = 20

/** The warning for a residual past RESIDUAL_WARNING_PX, else null. */
export function residualWarning(epsg: number, maxResidualPx: number, smaller = "AOI"): string | null {
  if (maxResidualPx <= RESIDUAL_WARNING_PX) return null
  return `Footprint too large for an unwarped export in EPSG:${epsg}: up to ${maxResidualPx.toFixed(1)} px off at the corners, use EPSG:3857 or a smaller ${smaller}.`
}

/** The quiet note for a residual within the threshold. */
export function residualNote(maxResidualPx: number): string {
  return maxResidualPx < 0.05 ? "under 0.05 px off at the corners" : `about ${maxResidualPx.toFixed(1)} px off at the corners, fine for most uses`
}

/** How the output CRS is chosen: one code for every file, or a UTM zone per
 *  target from its own centre. */
export type OutputCrsChoice = { kind: "epsg"; epsg: number } | { kind: "utm" }

const R = 6378137

/** The UTM zone that holds a point: 326xx north of the equator, 327xx south. */
export function suggestUtmEpsg(lng: number, lat: number): number {
  const zone = Math.min(60, Math.max(1, Math.floor((((lng + 180) % 360 + 360) % 360) / 6) + 1))
  return (lat >= 0 ? 32600 : 32700) + zone
}

export function utmZoneOf(epsg: number): { zone: number; south: boolean } | null {
  if (epsg > 32600 && epsg <= 32660) return { zone: epsg - 32600, south: false }
  if (epsg > 32700 && epsg <= 32760) return { zone: epsg - 32700, south: true }
  return null
}

/** "EPSG:32637 (UTM 37N)", "EPSG:3857 (Web Mercator)", "EPSG:4326 (WGS 84)". */
export function crsLabel(epsg: number): string {
  if (epsg === 3857) return "EPSG:3857 (Web Mercator)"
  if (epsg === 4326) return "EPSG:4326 (WGS 84)"
  const utm = utmZoneOf(epsg)
  if (utm) return `EPSG:${epsg} (UTM ${utm.zone}${utm.south ? "S" : "N"})`
  return `EPSG:${epsg}`
}

const DEFS = new Map<number, string>([
  [4326, "+proj=longlat +datum=WGS84 +no_defs"],
  [3857, "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],
])
const DEF_REQUESTS = new Map<number, Promise<string>>()

export function isGeographicDef(def: string): boolean {
  return /\+proj=longlat\b/.test(def)
}

/** The proj4 definition already known for a code, or undefined until
 *  projDef() has resolved it. */
export function cachedProjDef(epsg: number): string | undefined {
  if (DEFS.has(epsg)) return DEFS.get(epsg)
  const utm = utmZoneOf(epsg)
  if (utm) {
    const def = `+proj=utm +zone=${utm.zone}${utm.south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`
    DEFS.set(epsg, def)
    return def
  }
  return undefined
}

/** The proj4 definition of an EPSG code: built in for 4326 and 3857,
 *  generated for the UTM zones, fetched from epsg.io for everything else
 *  (once per session). Rejects with a readable message when the code is
 *  unknown or the lookup fails. */
export async function projDef(epsg: number): Promise<string> {
  const known = cachedProjDef(epsg)
  if (known) return known
  if (!Number.isInteger(epsg) || epsg <= 0) throw new Error(`EPSG:${epsg} is not a valid code`)
  if (!DEF_REQUESTS.has(epsg)) {
    DEF_REQUESTS.set(epsg, (async () => {
      let response: Response
      try {
        response = await fetch(`https://epsg.io/${epsg}.proj4`)
      } catch {
        throw new Error(`EPSG:${epsg}: unknown code, or epsg.io could not be reached to look it up`)
      }
      if (!response.ok) throw new Error(`EPSG:${epsg}: unknown code (epsg.io answered ${response.status})`)
      let def = (await response.text()).trim()
      if (!def.startsWith("+")) throw new Error(`EPSG:${epsg}: epsg.io returned no proj4 definition`)
      // proj4js cannot load a grid file; the published Helmert shift (when
      // the definition carries one) is what is left.
      def = def.replace(/\+nadgrids=\S+\s*/g, "").trim()
      DEFS.set(epsg, def)
      return def
    })().catch((err) => { DEF_REQUESTS.delete(epsg); throw err }))
  }
  return DEF_REQUESTS.get(epsg)!
}

/** A lon/lat bbox as Web Mercator metres. */
export function toMercator(b: GeoBbox): GeoBbox {
  const x = (lon: number) => (R * lon * Math.PI) / 180
  const y = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return { west: x(b.west), south: y(b.south), east: x(b.east), north: y(b.north) }
}

function mercatorToLonLat(x: number, y: number): [number, number] {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)]
}

/** The exact, axis-aligned georef of a grid whose bbox is already in the
 *  CRS (a Web Mercator grid in 3857, a lon/lat raster in 4326). */
export function georefFromBbox(bbox: GeoBbox, epsg: number, width: number, height: number, geographic = epsg === 4326): GridGeoref {
  return {
    epsg, geographic,
    geoTransform: [bbox.west, (bbox.east - bbox.west) / width, 0, bbox.north, 0, -(bbox.north - bbox.south) / height],
    rotated: false, maxResidualPx: 0,
  }
}

/** Least-squares affine X = x0 + a*c + b*r through (c, r) -> X samples;
 *  the 3x3 normal equations solved by Cramer's rule. */
function fitAffine(samples: { c: number; r: number; v: number }[]): [number, number, number] {
  let n = 0, sc = 0, sr = 0, scc = 0, scr = 0, srr = 0, sv = 0, scv = 0, srv = 0
  for (const { c, r, v } of samples) {
    n++; sc += c; sr += r; scc += c * c; scr += c * r; srr += r * r; sv += v; scv += c * v; srv += r * v
  }
  const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  const A = [n, sc, sr, sc, scc, scr, sr, scr, srr]
  const dA = det3(A)
  const x0 = det3([sv, sc, sr, scv, scc, scr, srv, scr, srr]) / dA
  const a = det3([n, sv, sr, sc, scv, scr, sr, srv, srr]) / dA
  const b = det3([n, sc, sv, sc, scc, scv, sr, scr, srv]) / dA
  return [x0, a, b]
}

/**
 * Georeferencing of a Web Mercator pixel grid (its extent as a lon/lat
 * bbox) in a target CRS: the four corners projected through proj4 and an
 * affine fitted through them, with the residual measured at the corners
 * and the centre. EPSG:3857 is exact and needs no definition; every other
 * code needs its proj4 definition (see projDef / cachedProjDef).
 */
export function affineForGrid(bbox: GeoBbox, width: number, height: number, epsg: number, def?: string): GridGeoref {
  if (epsg === 3857) return georefFromBbox(toMercator(bbox), 3857, width, height, false)
  const definition = def ?? cachedProjDef(epsg)
  if (!definition) throw new Error(`EPSG:${epsg}: no definition loaded (call projDef first)`)
  const geographic = isGeographicDef(definition)
  const merc = toMercator(bbox)
  const pxW = (merc.east - merc.west) / width
  const pxH = (merc.north - merc.south) / height
  const toTarget = proj4(DEFS.get(4326)!, definition)
  const project = (c: number, r: number): [number, number] => {
    const [lon, lat] = mercatorToLonLat(merc.west + c * pxW, merc.north - r * pxH)
    const [X, Y] = toTarget.forward([lon, lat])
    if (!Number.isFinite(X) || !Number.isFinite(Y)) throw new Error(`EPSG:${epsg}: the footprint does not project (outside the CRS's area)`)
    return [X, Y]
  }
  const corners: [number, number][] = [[0, 0], [width, 0], [0, height], [width, height]]
  const samples = corners.map(([c, r]) => { const [X, Y] = project(c, r); return { c, r, X, Y } })
  const [x0, a, b] = fitAffine(samples.map((s) => ({ c: s.c, r: s.r, v: s.X })))
  const [y0, d, e] = fitAffine(samples.map((s) => ({ c: s.c, r: s.r, v: s.Y })))
  const geoTransform: GridGeoref["geoTransform"] = [x0, a, b, y0, d, e]
  // Residual in pixels: where the affine's inverse puts the true projected
  // point, against the pixel it came from.
  const det = a * e - b * d
  let maxResidualPx = 0
  for (const [c, r] of [...corners, [width / 2, height / 2] as [number, number]]) {
    const [X, Y] = project(c, r)
    const dx = X - x0, dy = Y - y0
    const col = (e * dx - b * dy) / det
    const row = (-d * dx + a * dy) / det
    maxResidualPx = Math.max(maxResidualPx, Math.hypot(col - c, row - r))
  }
  const rotated = Math.abs(b) > 1e-9 * Math.abs(a) || Math.abs(d) > 1e-9 * Math.abs(e)
  return { epsg, geographic, geoTransform, rotated, maxResidualPx }
}

/** The six lines of an ESRI world file (.pgw/.jgw/.tfw): x scale, y skew,
 *  x skew, y scale, then the CENTRE of the top-left pixel. */
export function worldFileFor(g: GridGeoref): string {
  const [x0, a, b, y0, d, e] = g.geoTransform
  return [a, d, b, e, x0 + a / 2 + b / 2, y0 + d / 2 + e / 2].map((v) => v.toFixed(12)).join("\n")
}

/** The GeoKeyDirectory entry (tag 34735) for a CRS: pixel-is-area, projected
 *  (ProjectedCSTypeGeoKey) or geographic (GeographicTypeGeoKey). */
export function geoKeyDirectoryFor(epsg: number, geographic: boolean): number[] {
  return geographic
    ? [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, epsg]
    : [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg]
}

/** ModelTransformation (tag 34264): the affine as a 4x4 row-major matrix. */
export function modelTransformationFor(g: GridGeoref): number[] {
  const [x0, a, b, y0, d, e] = g.geoTransform
  return [a, b, 0, x0, d, e, 0, y0, 0, 0, 0, 0, 0, 0, 0, 1]
}

/** Pixel size of the affine, in CRS units (the mean of the two axes'
 *  scales, rotation included). */
export function pixelSizeOf(g: GridGeoref): [number, number] {
  const [, a, b, , d, e] = g.geoTransform
  return [Math.hypot(a, d), Math.hypot(b, e)]
}

export const WKT_4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
export const WKT_3857 = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]'

const WKTS = new Map<number, string>([[4326, WKT_4326], [3857, WKT_3857]])

/** WKT1 of a CRS for a .prj: built in for 4326, 3857 and the UTM zones,
 *  fetched from epsg.io for everything else. */
export async function crsWkt(epsg: number): Promise<string> {
  const known = WKTS.get(epsg)
  if (known) return known
  const utm = utmZoneOf(epsg)
  if (utm) {
    const wkt = `PROJCS["WGS 84 / UTM zone ${utm.zone}${utm.south ? "S" : "N"}",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${utm.zone * 6 - 183}],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",${utm.south ? 10000000 : 0}],UNIT["metre",1],AUTHORITY["EPSG","${epsg}"]]`
    WKTS.set(epsg, wkt)
    return wkt
  }
  let response: Response
  try { response = await fetch(`https://epsg.io/${epsg}.wkt`) } catch { throw new Error(`EPSG:${epsg}: epsg.io could not be reached to look up its WKT`) }
  if (!response.ok) throw new Error(`EPSG:${epsg}: unknown code (epsg.io answered ${response.status})`)
  const wkt = (await response.text()).trim()
  WKTS.set(epsg, wkt)
  return wkt
}

/** The code a choice resolves to for a target centred at (lng, lat). */
export function resolveOutputCrs(choice: OutputCrsChoice | undefined, lng: number, lat: number): number {
  if (!choice) return 3857
  return choice.kind === "utm" ? suggestUtmEpsg(lng, lat) : choice.epsg
}

/** A Web Mercator bbox back to lon/lat. */
export function fromMercator(b: GeoBbox): GeoBbox {
  const [west, south] = mercatorToLonLat(b.west, b.south)
  const [east, north] = mercatorToLonLat(b.east, b.north)
  return { west, south, east, north }
}

/** The stored export CRS setting (exportCrsAtom): an EPSG code as text, or
 *  "utm" for the zone of the export's own centre. */
export function parseCrsSetting(value: string): OutputCrsChoice {
  if (value === "utm") return { kind: "utm" }
  const epsg = Number.parseInt(value, 10)
  return { kind: "epsg", epsg: Number.isInteger(epsg) && epsg > 0 ? epsg : 3857 }
}

/** Georef of a Web Mercator grid (bbox in metres) for a CRS choice:
 *  resolves the definition (epsg.io for unknown codes) and fits the affine. */
export async function georefForMercatorGrid(mercBbox: GeoBbox, width: number, height: number, choice: OutputCrsChoice): Promise<GridGeoref> {
  const bbox = fromMercator(mercBbox)
  const epsg = resolveOutputCrs(choice, (bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2)
  if (epsg !== 3857) await projDef(epsg)
  return affineForGrid(bbox, width, height, epsg)
}
