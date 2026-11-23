// The app's own tile computations, bundled for Node by build.mjs into
// generated/app-render.mjs for the tile service's direct engine
// (direct.mjs): the derived-mode and lighting protocols, the paint
// functions of the map's layers, and the per-mode colour settings. One
// source of truth: a direct tile is computed by the code the map runs.
export { buildSlopeProtocolUrl, slopeProtocol } from "../lib/slope-protocol"
export { buildAspectProtocolUrl, aspectProtocol } from "../lib/aspect-protocol"
export { buildTriProtocolUrl, triProtocol } from "../lib/tri-protocol"
export { buildCurvatureProtocolUrl, curvatureProtocol, CURVATURE_ENCODE_SCALE } from "../lib/curvature-protocol"
export { buildTpiProtocolUrl, tpiProtocol } from "../lib/tpi-protocol"
export { buildRoughnessProtocolUrl, roughnessProtocol } from "../lib/roughness-protocol"
export { buildBlobnessProtocolUrl, blobnessProtocol } from "../lib/blobness-protocol"
export { buildLrmProtocolUrl, lrmProtocol } from "../lib/lrm-protocol"
export { buildSvfProtocolUrl, svfProtocol } from "../lib/svf-protocol"
export { buildOpennessProtocolUrl, opennessProtocol } from "../lib/openness-protocol"
export { buildLocalDominanceProtocolUrl, localDominanceProtocol } from "../lib/local-dominance-protocol"
export { buildMatcapProtocolUrl, matcapProtocol } from "../lib/matcap-protocol"
export { buildPhongProtocolUrl, phongProtocol } from "../lib/phong-protocol"
export { buildShadowProtocolUrl, shadowProtocol } from "../lib/shadow-protocol"
// The OSM building footprints the building shadows sweep (BuildingShadowLayer.tsx).
export { requestBuildingTile, BUILDING_TILE_ZOOM, BUILDING_TILE_BUFFER } from "../lib/building-tiles"
export { computeColorReliefPaint, computeHillshadePaint } from "../lib/layer-paints"
export { MODE_RELIEF } from "../lib/mode-relief"
export { MATCAP_TEXTURES, DEFAULT_MATCAP_ID } from "../lib/matcap-textures"
export { parseAsCustomRampStops, DEFAULT_SLOPE_CUSTOM_STOPS, DEFAULT_SHAPE_INDEX_CUSTOM_STOPS } from "../lib/color-ramps"
export * from "./app-sources"
export * from "./app-overlays"
