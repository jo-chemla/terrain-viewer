// A QGIS project of the tile service: every mode as an XYZ layer, grouped as
// the app's panel groups them (Visualization Modes, Relief Visualization,
// Terrain Analysis and its three sub-groups, Lighting Effects, Contours +
// GeoGrid), every mode unchecked, over a Google hybrid basemap. Raster tiles
// are asked with background=none, so checked layers stack as in the map.
// Served as /qgis.qgz (the view's parameters kept in every layer's address);
// `node qgis-project.mjs [base] [out.qgz]` writes one.
import { deflateRawSync, crc32 } from "node:zlib"
import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The layer tree, top of the list drawn on top (the map's order). */
export const QGIS_TREE = [
  { group: "Contours + GeoGrid", items: [["contours", "Contours"], ["isoline", "Iso-line"], ["graticules", "Graticule"]] },
  { group: "Mound Detector", items: [["moundDetector", "Mound candidates"]] },
  { group: "Plane Slicer", items: [["planeSlicer", "Plane slicer"]] },
  { group: "Lighting Effects", items: [["phong", "Phong"], ["matcap", "Matcap"], ["shadows", "Building shadows"]] },
  { group: "Terrain Analysis", groups: [
    { group: "Surface derivatives", items: [["slope", "Slope"], ["aspect", "Aspect"], ["curvature", "Curvature"]] },
    { group: "Neighborhood statistics", items: [["tpi", "Topographic Position"], ["tri", "Terrain Ruggedness"], ["roughness", "Roughness"], ["shapeIndex", "Shape Index"]] },
    { group: "Principal Components", items: [["blobness", "Blobness"], ["eigenRatio", "Eigenvalue Ratio"], ["orientation", "Dominant Orientation"]] },
  ] },
  { group: "Relief Visualization", items: [["lrm", "Local Relief Model"], ["svf", "Sky View Factor"], ["openness", "Openness"], ["localDominance", "Local Dominance"]] },
  { group: "Visualization Modes", items: [["hillshade", "Hillshade"], ["colorRelief", "Elevation Hypso"]] },
  { group: "Vector tiles", vector: true, items: [["contours", "Contours (vector)"], ["isoline", "Iso-line (vector)"], ["moundDetector", "Mound candidates (vector)"], ["graticules", "Graticule (vector)"]] },
]
const GOOGLE_HYBRID = "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c])
// QGIS's XYZ data source: key=value pairs, the tile address percent-encoded.
const xyz = (url, zmax, extra = "") => `type=xyz&url=${encodeURIComponent(url).replace(/%2F/g, "/").replace(/%3A/g, ":")}&zmax=${zmax}&zmin=0${extra}`
const SRS = `<spatialrefsys nativeFormat="Wkt"><wkt>PROJCRS["WGS 84 / Pseudo-Mercator",BASEGEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4326]],CONVERSION["Popular Visualisation Pseudo-Mercator",METHOD["Popular Visualisation Pseudo Mercator",ID["EPSG",1024]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["False easting",0,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Web mapping and visualisation."],AREA["World between 85.06°S and 85.06°N."],BBOX[-85.06,-180,85.06,180]],ID["EPSG",3857]]</wkt><proj4>+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs</proj4><srsid>3857</srsid><srid>3857</srid><authid>EPSG:3857</authid><description>WGS 84 / Pseudo-Mercator</description><projectionacronym>merc</projectionacronym><ellipsoidacronym>EPSG:7030</ellipsoidacronym><geographicflag>false</geographicflag></spatialrefsys>`

/** The project's XML (.qgs). `base`: the service's address; `query`: the
 *  view's parameters (terrainSource, the app's parameters, keys), kept in
 *  every layer's tile address. */
export function qgisProjectXml(base, query = new URLSearchParams()) {
  const q = new URLSearchParams(query)
  for (const k of ["modes", "background", "tile_format"]) q.delete(k)
  const keep = q.toString()
  const layers = [], tree = []
  let n = 0
  const add = (name, source, provider, type, checked) => {
    // QGIS's own form of a layer id: a name and a UUID, here a stable one.
    const h = createHash("sha1").update(`${++n}|${source}`).digest("hex")
    const id = `${name.replace(/\W+/g, "_")}_${h.slice(0, 8)}_${h.slice(8, 12)}_${h.slice(12, 16)}_${h.slice(16, 20)}_${h.slice(20, 32)}`
    layers.push(`<maplayer type="${type}" autoRefreshTime="0" refreshOnNotifyEnabled="0"><id>${id}</id><datasource>${esc(source)}</datasource><layername>${esc(name)}</layername><srs>${SRS}</srs><provider>${provider}</provider></maplayer>`)
    return `<layer-tree-layer id="${id}" name="${esc(name)}" source="${esc(source)}" providerKey="${provider}" checked="${checked ? "Qt::Checked" : "Qt::Unchecked"}" expanded="0"><customproperties/></layer-tree-layer>`
  }
  const raster = ([mode, name]) => add(name, xyz(`${base}/tiles/{z}/{x}/{y}.png?modes=${mode}&background=none${keep ? "&" + keep : ""}`, 22, "&tilePixelRatio=1"), "wms", "raster", false)
  const vector = ([mode, name]) => add(name, xyz(`${base}/tiles/{z}/{x}/{y}.pbf?modes=${mode}${keep ? "&" + keep : ""}`, 15), "xyzvectortiles", "vector-tile", false)
  const group = (g) => {
    const inner = [...(g.groups ?? []).map(group), ...(g.items ?? []).map(g.vector ? vector : raster)].join("")
    return `<layer-tree-group name="${esc(g.group)}" checked="Qt::Checked" expanded="${g.vector ? 0 : 1}"><customproperties/>${inner}</layer-tree-group>`
  }
  for (const g of QGIS_TREE) tree.push(group(g))
  tree.push(`<layer-tree-group name="Basemaps" checked="Qt::Checked" expanded="1"><customproperties/>${add("Google Hybrid", xyz(GOOGLE_HYBRID, 20), "wms", "raster", true)}</layer-tree-group>`)
  // The Alps around the Matterhorn, as the docs' examples.
  const extent = `<extent><xmin>730000</xmin><ymin>5730000</ymin><xmax>800000</xmax><ymax>5780000</ymax></extent>`
  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="Terrain Viewer" version="3.40.0">
<homePath path=""/>
<title>Terrain Viewer</title>
<projectCrs>${SRS}</projectCrs>
<layer-tree-group><customproperties/>${tree.join("")}</layer-tree-group>
<mapcanvas name="theMapCanvas" annotationsVisible="1"><units>meters</units>${extent}<rotation>0</rotation><destinationsrs>${SRS}</destinationsrs><rendermaptile>0</rendermaptile></mapcanvas>
<projectlayers>${layers.join("")}</projectlayers>
<properties name="properties"><properties name="SpatialRefSys"><properties name="ProjectionsEnabled" type="int">1</properties></properties></properties>
</qgis>
`
}

/** A .qgz: a zip holding the project's .qgs. */
export function qgisProject(base, query) {
  const name = Buffer.from("terrain-viewer.qgs"), data = Buffer.from(qgisProjectXml(base, query)), packed = deflateRawSync(data)
  const crc = crc32(data), head = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22)
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8); head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28)
  const size = 46 + name.length, at = 30 + name.length + packed.length
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(at, 16)
  return Buffer.concat([head, name, packed, central, name, end])
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const base = (process.argv[2] || "http://localhost:3400").replace(/\/$/, "")
  const out = process.argv[3] || "terrain-viewer.qgz"
  writeFileSync(out, qgisProject(base))
  console.log("wrote", out)
}
