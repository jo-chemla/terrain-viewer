// A QGIS project of the tile service: every layer of the app as an XYZ layer,
// stacked as the map stacks them (top of the tree drawn on top) and grouped
// as the app's panel groups them where that order allows, over the view's
// basemap. Every layer is loaded; the ones the view switches on start
// checked, and every layer's address carries the view's own settings (ramps,
// opacities, radii, the terrain source), so the project opens configured as
// the view was. Raster tiles are asked with background=none, so checked
// layers stack as in the map. Served as /qgis.qgz?<the view's parameters>,
// the tile service's or the app's own (a share link's query, as is);
// `node qgis-project.mjs [base] [out.qgz]` writes the generic one (nothing
// but the Google hybrid basemap checked).
import { deflateRawSync, crc32 } from "node:zlib"
import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MODES } from "./url.mjs"

/** The layer tree, top of the list drawn on top (the map's order: the
 *  direct engine's layersOf, read from the top). An item is
 *  `[mode, name, form]`, form "raster", "vector" or "both" (the raster as
 *  the app draws it, then the same features as vector tiles, unchecked). A
 *  group of one layer is written as the layer alone. */
export const QGIS_TREE = [
  { group: "Overlays", items: [["contours", "Contours", "both"], ["planeSlicer", "Plane slicer", "both"], ["moundDetector", "Mound candidates", "both"], ["graticules", "Graticule", "both"], ["isoline", "Iso-line", "both"]] },
  { group: "Lighting Effects", items: [["buildingShadows", "Building shadows"], ["shadows", "Terrain shadows"], ["phong", "Phong"], ["matcap", "Matcap"]] },
  { items: [["hillshade", "Hillshade"]] },
  { group: "Relief Visualization", items: [["localDominance", "Local Dominance"], ["openness", "Openness"], ["svf", "Sky View Factor"], ["lrm", "Local Relief Model"]] },
  { group: "Terrain Analysis", groups: [
    { group: "Principal Components", items: [["orientation", "Dominant Orientation"], ["eigenRatio", "Eigenvalue Ratio"], ["blobness", "Blobness"]] },
    { group: "Neighborhood statistics", items: [["shapeIndex", "Shape Index"], ["roughness", "Roughness"], ["tpi", "Topographic Position"], ["tri", "Terrain Ruggedness"]] },
    { group: "Surface derivatives", items: [["curvature", "Curvature"], ["aspect", "Aspect"], ["slope", "Slope"]] },
  ] },
  { items: [["colorRelief", "Elevation Hypso"]] },
]
const GOOGLE_HYBRID = "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
const VECTOR = new Set(["contours", "isoline", "moundDetector", "planeSlicer", "graticules"])
// The layers drawn as shading over the others (their pixels mostly half
// transparent): in QGIS, opaque tiles multiplied over the layers under them.
const SHADING = new Set(["hillshade", "phong", "shadows", "buildingShadows"])

// What switches a layer on, and what shapes the whole view rather than one
// layer: left out of every layer's address (each layer asks for its own
// mode), so a layer draws only itself.
const SWITCHES = new Set([
  ...Object.values(MODES).flatMap((m) => Object.keys(m)),
  "modes", "background", "tile_format", "tilesize", "appMode", "showBackground", "splitStyle", "split", "vizViews",
  "viewMode", "pitch", "bearing", "lat", "lng", "zoom", "place", "sidebarCollapsed",
])
// The basemap's own parameters: only the basemap layer carries them.
const BASEMAP = /^(basemap|overlayBasemapIds|overlays|historicalActiveSource|date|imagery|rasterBasemap|pillBasemap|showCaptureDatePill)/i
// Per-view fields of views B to H: one view here.
const OTHER_VIEW = /^(terrainSource|source|basemapSource|overlayBasemapIds|historicalActiveSource|date)[B-H]$/

/** The view a query describes, as the project reads it: the layers it
 *  switches on (`active`, names of url.mjs plus "basemap"), whether it says
 *  anything at all (`generic` when not: the plain project, the Google
 *  hybrid basemap alone checked), the parameters every layer keeps and the
 *  basemap's own, and the camera for the project's extent. `activeLayers`:
 *  direct.mjs's, which reads the app's URL parameters over its defaults. */
export async function readView(view = {}, rest = new URLSearchParams(), activeLayers) {
  const given = [...rest.keys()].filter((k) => !/^(mapboxKey|maptilerKey|cesiumIonKey|background|tile_format)$/.test(k))
  const generic = !given.length && !Object.keys(view).length
  const active = new Set()
  let showBasemap = false
  let state = {}
  if (activeLayers) {
    const r = await activeLayers({ ...view, imageryUrl: undefined, imagerySource: undefined }, rest)
    state = r.state
    if (!generic) {
      for (const l of r.layers) active.add(l)
      showBasemap = !!state.showRasterBasemap || !!view.imageryUrl || !!view.imagerySource
    }
  }
  // Each layer's opacity, the view's or the app's default: set on the QGIS
  // layer, its tiles asked opaque (see qgisProjectXml).
  const opacity = {}
  for (const [mode, sw] of Object.entries(MODES)) {
    const key = [`${mode}Opacity`, ...Object.keys(sw).filter((k) => k.startsWith("show")).map((k) => `${k[4].toLowerCase()}${k.slice(5)}Opacity`)].find((k) => k in state)
    if (key) opacity[mode] = { key, value: Math.max(0, Math.min(1, Number(state[key]) || 0)) }
  }
  const keep = new URLSearchParams(), basemap = new URLSearchParams()
  if (view.terrainSource) keep.set("terrainSource", view.terrainSource)
  for (const [k, v] of rest) {
    if (OTHER_VIEW.test(k)) continue
    if (BASEMAP.test(k)) { basemap.set(k, v); continue }
    if (SWITCHES.has(k)) continue
    keep.set(k, v)
  }
  for (const k of ["imageryUrl", "imagerySource", "imageryDate"]) if (view[k]) basemap.set(k, view[k])
  return { generic, active, showBasemap, keep, basemap, opacity, camera: { lat: view.lat, lng: view.lng, zoom: view.zoom } }
}

/** The view's basemap as a tile template QGIS can read itself (faster than
 *  the app drawing it): an XYZ address given as imageryUrl or as the app's
 *  basemapSource. null for the app's named and dated sources. */
function directBasemap(basemap) {
  for (const k of ["imageryUrl", "basemapSource", "basemapSourceA"]) {
    const v = basemap.get(k)
    if (v && /^https?:\/\//i.test(v) && /\{z\}/.test(v) && /\{x\}/.test(v) && /\{y\}/.test(v)) return v
  }
  return null
}

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c])
// QGIS's XYZ data source: key=value pairs, the tile address percent-encoded.
const xyz = (url, zmax, extra = "") => `type=xyz&url=${encodeURIComponent(url).replace(/%2F/g, "/").replace(/%3A/g, ":")}&zmax=${zmax}&zmin=0${extra}`
const SRS = `<spatialrefsys nativeFormat="Wkt"><wkt>PROJCRS["WGS 84 / Pseudo-Mercator",BASEGEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4326]],CONVERSION["Popular Visualisation Pseudo-Mercator",METHOD["Popular Visualisation Pseudo Mercator",ID["EPSG",1024]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["False easting",0,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Web mapping and visualisation."],AREA["World between 85.06°S and 85.06°N."],BBOX[-85.06,-180,85.06,180]],ID["EPSG",3857]]</wkt><proj4>+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs</proj4><srsid>3857</srsid><srid>3857</srid><authid>EPSG:3857</authid><description>WGS 84 / Pseudo-Mercator</description><projectionacronym>merc</projectionacronym><ellipsoidacronym>EPSG:7030</ellipsoidacronym><geographicflag>false</geographicflag></spatialrefsys>`

/** The project's XML (.qgs). `base`: the service's address; `read`: the
 *  view (readView). */
export function qgisProjectXml(base, read) {
  const { generic, active, showBasemap, keep, basemap, opacity = {}, camera } = read ?? { generic: true, active: new Set(), showBasemap: false, keep: new URLSearchParams(), basemap: new URLSearchParams(), camera: {} }
  const layers = []
  let n = 0
  // style: a raster layer's opacity and blend mode, written as QGIS stores
  // them (the renderer's opacity; QPainter's composition mode, 13 = Multiply).
  const add = (name, source, provider, type, checked, style) => {
    // QGIS's own form of a layer id: a name and a UUID, here a stable one.
    const h = createHash("sha1").update(`${++n}|${source}`).digest("hex")
    const id = `${name.replace(/\W+/g, "_")}_${h.slice(0, 8)}_${h.slice(8, 12)}_${h.slice(12, 16)}_${h.slice(16, 20)}_${h.slice(20, 32)}`
    const pipe = style ? `<pipe><rasterrenderer type="multibandcolor" opacity="${style.opacity ?? 1}" alphaBand="4" redBand="1" greenBand="2" blueBand="3" nodataColor=""><rasterTransparency/></rasterrenderer></pipe><blendMode>${style.blend ?? 0}</blendMode>` : ""
    layers.push(`<maplayer type="${type}" autoRefreshTime="0" refreshOnNotifyEnabled="0"><id>${id}</id><datasource>${esc(source)}</datasource><layername>${esc(name)}</layername><srs>${SRS}</srs><provider>${provider}</provider>${pipe}</maplayer>`)
    return `<layer-tree-layer id="${id}" name="${esc(name)}" source="${esc(source)}" providerKey="${provider}" checked="${checked ? "Qt::Checked" : "Qt::Unchecked"}" expanded="0"><customproperties/></layer-tree-layer>`
  }
  // QGIS draws neighbouring XYZ tiles a pixel over each other, so a tile
  // with partial transparency shows a line along every tile edge (measured
  // 2026-11-23: a step of 36 grey levels at the edges against a median of
  // 10). The tiles are therefore asked opaque: a mode at its full opacity
  // (opacity=1 in the address, the view's opacity set on the QGIS layer,
  // where it can be changed); the shading layers, transparent by design
  // (SHADING), on the map's background and multiplied over what is under
  // them. The overlays stay transparent: lines on nothing, where an edge
  // rarely has any.
  const raster = (mode, name) => {
    const q = new URLSearchParams(keep)
    let style
    if (SHADING.has(mode)) style = { opacity: opacity[mode]?.value ?? 1, blend: 13 }
    else if (!VECTOR.has(mode) && opacity[mode]) { q.set(opacity[mode].key, "1"); style = { opacity: opacity[mode].value } }
    const bg = SHADING.has(mode) ? "" : "&background=none"
    const kept = q.toString()
    return add(name, xyz(`${base}/tiles/{z}/{x}/{y}.png?modes=${mode}${bg}${kept ? "&" + kept : ""}`, 22, "&tilePixelRatio=1"), "wms", "raster", active.has(mode), style)
  }
  const kept = keep.toString()
  const vector = (mode, name, checked) => add(name, xyz(`${base}/tiles/{z}/{x}/{y}.pbf?modes=${mode}${kept ? "&" + kept : ""}`, 15), "xyzvectortiles", "vector-tile", checked)
  const item = ([mode, name, form = "raster"]) => {
    if (form === "vector") return vector(mode, name, active.has(mode))
    return form === "both" && VECTOR.has(mode) ? raster(mode, name) + vector(mode, `${name} (vector tiles)`, false) : raster(mode, name)
  }
  const group = (g) => {
    const inner = [...(g.groups ?? []).map(group), ...(g.items ?? []).map(item)].join("")
    if (!g.group) return inner
    return `<layer-tree-group name="${esc(g.group)}" checked="Qt::Checked" expanded="1"><customproperties/>${inner}</layer-tree-group>`
  }
  const tree = QGIS_TREE.map(group)
  // The basemap, under everything: as the app draws it (the view's named or
  // dated source and its overlays, by the browser engine), the same as a
  // plain XYZ layer when the view gives one, and Google's hybrid.
  const direct = directBasemap(basemap)
  const asDrawn = new URLSearchParams(basemap)
  asDrawn.set("showRasterBasemap", "true")
  const bm = [
    add("Basemap and overlays (as in the view)", xyz(`${base}/tiles/{z}/{x}/{y}.jpg?modes=basemap&${asDrawn.toString()}`, 20, "&tilePixelRatio=1"), "wms", "raster", showBasemap && !direct),
    ...(direct ? [add("Basemap (XYZ)", xyz(direct, 20), "wms", "raster", showBasemap)] : []),
    add("Google Hybrid", xyz(GOOGLE_HYBRID, 20), "wms", "raster", generic),
  ]
  tree.push(`<layer-tree-group name="Basemap" checked="Qt::Checked" expanded="1"><customproperties/>${bm.join("")}</layer-tree-group>`)
  // The view's camera (an 1280 x 800 window at its zoom), or the Alps
  // around the Matterhorn, as the docs' examples.
  let extent = `<xmin>730000</xmin><ymin>5730000</ymin><xmax>800000</xmax><ymax>5780000</ymax>`
  if (Number.isFinite(camera.lat) && Number.isFinite(camera.lng)) {
    const R = 6378137, x = (camera.lng * Math.PI / 180) * R, y = Math.log(Math.tan(Math.PI / 4 + (camera.lat * Math.PI) / 360)) * R
    const m = (2 * Math.PI * R) / (512 * 2 ** (camera.zoom ?? 12))
    extent = `<xmin>${(x - 640 * m).toFixed(1)}</xmin><ymin>${(y - 400 * m).toFixed(1)}</ymin><xmax>${(x + 640 * m).toFixed(1)}</xmax><ymax>${(y + 400 * m).toFixed(1)}</ymax>`
  }
  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="Terrain Viewer" version="3.40.0">
<homePath path=""/>
<title>Terrain Viewer</title>
<projectCrs>${SRS}</projectCrs>
<layer-tree-group><customproperties/>${tree.join("")}</layer-tree-group>
<mapcanvas name="theMapCanvas" annotationsVisible="1"><units>meters</units><extent>${extent}</extent><rotation>0</rotation><destinationsrs>${SRS}</destinationsrs><rendermaptile>0</rendermaptile></mapcanvas>
<projectlayers>${layers.join("")}</projectlayers>
<properties name="properties"><properties name="SpatialRefSys"><properties name="ProjectionsEnabled" type="int">1</properties></properties></properties>
</qgis>
`
}

// Which of the app's URL parameters set a mode, beyond those named after it
// (slopeColorRamp, svfRadius...): the shared ones its panel shows with it.
const MODE_PARAMS = {
  hillshade: /^(hillshade|illumination|shadowColor$|highlightColor$|accentColor$)/,
  colorRelief: /^(colorRelief|colorRamp$|invertColorRamp$|customHypsoMinMax$|hypso|minElevation$|maxElevation$)/,
  contours: /^(contour|showContourLabels$)/,
  graticules: /^(graticule|showGraticuleLabels$)/,
  moundDetector: /^tells?[A-Z]/,
  shadows: /^(shadow(?!Color)|light[A-Z])/,
  buildingShadows: /^(buildingShadow|light[A-Z])/,
}
// Left out: the switches (but the label ones), the hand-drawn ramps (stops
// as JSON), the panel's own state.
const NOT_A_SETTING = /^show(?!ContourLabels|GraticuleLabels)|CustomStops|^hypsoSlider|^tellsFrozen$|^tellsMarkersVisible$/

/** The modes as the QGIS plugin (qgis-plugin/) builds its panel: the tree of
 *  QGIS_TREE (the app's panel groups, top drawn on top), each mode with its
 *  form (raster, vector, both), whether it is shading (opaque tiles,
 *  multiplied), the parameter that holds its opacity, and its settings with
 *  their types and defaults, from the app's URL reference (`params`, the
 *  `params` of generated/url-params.json). Served as /modes. */
export function modesCatalog(params) {
  const constant = (d) => typeof d === "string" && /^[A-Z][A-Z0-9_]+$/.test(d)
  const forMode = (mode) => {
    const re = MODE_PARAMS[mode] ?? new RegExp(`^${mode}(?=[A-Z])`)
    return params.filter((p) => re.test(p.key) && !NOT_A_SETTING.test(p.key) && p.type !== "ramp-stops")
      .map(({ key, type, enum: values, default: d, note }) => ({ key, type, ...(values ? { enum: values } : {}), ...(d !== undefined && d !== null && !constant(d) ? { default: d } : {}), ...(note ? { note } : {}) }))
  }
  const item = ([mode, name, form = "raster"]) => {
    const settings = forMode(mode)
    // shadowOpacity, buildingShadowOpacity: the singular.
    const opacity = settings.find((p) => p.key === `${mode}Opacity` || p.key === `${mode.replace(/s$/, "")}Opacity`)?.key
    return { id: mode, name, form, shading: SHADING.has(mode), vector: VECTOR.has(mode), switches: MODES[mode], ...(opacity ? { opacityKey: opacity } : {}), settings: settings.filter((p) => p.key !== opacity) }
  }
  const group = (g) => ({ ...(g.group ? { group: g.group } : {}), ...(g.groups ? { groups: g.groups.map(group) } : {}), ...(g.items ? { items: g.items.map(item) } : {}) })
  return QGIS_TREE.map(group)
}

/** A view (a share link's query, read by readView) as the plugin takes it:
 *  the modes it switches on, each one's opacity, the parameters every layer
 *  keeps (the terrain source among them) and the camera. */
export function viewForPlugin(read) {
  const { active, keep, opacity, camera } = read
  return { active: [...active], opacity: Object.fromEntries(Object.entries(opacity).map(([m, o]) => [m, o.value])), params: Object.fromEntries(keep), camera }
}

/** A .qgz: a zip holding the project's .qgs. */
export function qgisProject(base, read) {
  const name = Buffer.from("terrain-viewer.qgs"), data = Buffer.from(qgisProjectXml(base, read)), packed = deflateRawSync(data)
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
  writeFileSync(out, qgisProject(base, null))
  console.log("wrote", out)
}
