// The app's overlay layers for the tile service's direct engine
// (direct.mjs), re-exported by app-render.ts: the iso-line (isoband
// vector tiles and the measure tiles under them), the mound detector's
// vector tiles, the plane slicer's paint, the graticule spacing and the
// marker colours. The protocols that read other protocols (an iso-line on
// slope, the mound detector on elevation, contours of the local relief
// model) fetch them through the app's registry, as in the browser, so
// registerDerivedProtocols() registers them there.
import { registerProtocol, dispatchTile } from "../lib/protocol-registry"
import { slopeProtocol } from "../lib/slope-protocol"
import { aspectProtocol } from "../lib/aspect-protocol"
import { triProtocol } from "../lib/tri-protocol"
import { curvatureProtocol } from "../lib/curvature-protocol"
import { tpiProtocol } from "../lib/tpi-protocol"
import { roughnessProtocol } from "../lib/roughness-protocol"
import { blobnessProtocol } from "../lib/blobness-protocol"
import { lrmProtocol } from "../lib/lrm-protocol"
import { svfProtocol } from "../lib/svf-protocol"
import { opennessProtocol } from "../lib/openness-protocol"
import { localDominanceProtocol } from "../lib/local-dominance-protocol"
import { matcapProtocol } from "../lib/matcap-protocol"
import { phongProtocol } from "../lib/phong-protocol"
import { shadowProtocol } from "../lib/shadow-protocol"
import { thresholdProtocol, lumaProtocol } from "../lib/threshold-protocol"
import { isobandProtocol } from "../lib/isoband-protocol"
import { tellsProtocol } from "../lib/tells-protocol"

let registered = false
/** The derived-mode, lighting, iso-line and mound detector protocols, under
 *  the schemes TerrainViewer.tsx gives them. */
export function registerDerivedProtocols(): void {
  if (registered) return
  registered = true
  const all: [string, any][] = [
    ["slope", slopeProtocol], ["aspect", aspectProtocol], ["tri", triProtocol], ["curvature", curvatureProtocol],
    ["tpi", tpiProtocol], ["roughness", roughnessProtocol], ["blobness", blobnessProtocol], ["lrm", lrmProtocol],
    ["svf", svfProtocol], ["openness", opennessProtocol], ["local-dominance", localDominanceProtocol],
    ["matcap", matcapProtocol], ["phong", phongProtocol], ["shadow", shadowProtocol],
    ["threshold", thresholdProtocol], ["luma", lumaProtocol], ["isoband", isobandProtocol], ["tells", tellsProtocol],
  ]
  for (const [scheme, handler] of all) registerProtocol(scheme, handler)
}

export { dispatchTile as dispatchAppTile }
export { buildIsobandProtocolUrl } from "../lib/isoband-protocol"
export { buildTellsProtocolUrl, TELLS_MEASURED_SCALE_MULTIPLIER_DEFAULT } from "../lib/tells-protocol"
export { isolineMeasure, isolineMeasureDem } from "../lib/isoline-measures"
export { computePlaneSlicerPaint } from "../lib/layer-paints"
export { computePropertyRampExpression } from "../lib/color-ramps"
export { niceGraticuleDensity } from "../lib/graticule-density"
