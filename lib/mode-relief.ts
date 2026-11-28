// How each derived mode (slope, aspect, LRM, sky-view factor...) is coloured:
// the colour relief settings of its layer, read from the app's state. One
// table for the map (TerrainViewer.tsx) and the tile service (tile-server/direct.mjs).
// The session-only ramp override is added by the map, not here.
import type { ColorReliefConfig } from "@/lib/layer-paints"
import type { CustomRampStop } from "@/lib/color-ramps"
import { CURVATURE_ENCODE_SCALE } from "@/lib/curvature-protocol"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = Record<string, any>

export const MODE_RELIEF: Record<string, (state: State) => ColorReliefConfig> = {
  slope: (state) => ({
    colorRamp: state.slopeColorRamp,
    customStops: state.slopeCustomStops,
    customStopsDiscrete: state.slopeCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.slopeMinDegrees,
    maxElevation: state.slopeMaxDegrees,
    colorReliefOpacity: state.slopeOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.slopeInvertColorRamp,
  }),
  aspect: (state) => ({
    colorRamp: state.aspectColorRamp,
    customStops: state.aspectCustomStops,
    customStopsDiscrete: state.aspectCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.aspectMinDegrees,
    maxElevation: state.aspectMaxDegrees,
    colorReliefOpacity: state.aspectOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.aspectInvertColorRamp,
    shiftDegrees: state.aspectShiftDegrees,
  }),
  tri: (state) => ({
    colorRamp: state.triColorRamp,
    customStops: state.triCustomStops,
    customStopsDiscrete: state.triCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.triMin,
    maxElevation: state.triMax,
    colorReliefOpacity: state.triOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.triInvertColorRamp,
  }),
  curvature: (state) => ({
    colorRamp: state.curvatureColorRamp,
    // The curvature:// protocol wire-encodes its value ×CURVATURE_ENCODE_SCALE
    // for finer Terrarium quantization (see curvature-protocol.ts) — the raw
    // ["elevation"] this color-relief layer reads back is scaled the same
    // way, so custom stops (authored in ordinary curvature units, like every
    // other curvature field here) need the same factor applied to line up.
    customStops: state.curvatureCustomStops?.map((s: CustomRampStop) => ({ ...s, value: s.value * CURVATURE_ENCODE_SCALE })),
    customStopsDiscrete: state.curvatureCustomStopsDiscrete,
    customHypsoMinMax: true,
    // The slider/state itself (curvatureMin/Max) stays in ordinary curvature units.
    minElevation: state.curvatureMin * CURVATURE_ENCODE_SCALE,
    maxElevation: state.curvatureMax * CURVATURE_ENCODE_SCALE,
    colorReliefOpacity: state.curvatureOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.curvatureInvertColorRamp,
  }),
  tpi: (state) => ({
    colorRamp: state.tpiColorRamp,
    customStops: state.tpiCustomStops,
    customStopsDiscrete: state.tpiCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.tpiMin,
    maxElevation: state.tpiMax,
    colorReliefOpacity: state.tpiOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.tpiInvertColorRamp,
  }),
  lrm: (state) => ({
    colorRamp: state.lrmColorRamp,
    customStops: state.lrmCustomStops,
    customStopsDiscrete: state.lrmCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.lrmMin,
    maxElevation: state.lrmMax,
    colorReliefOpacity: state.lrmOpacity * state.reliefVisualizationOpacity,
    invertColorRamp: state.lrmInvertColorRamp,
  }),
  // The view's terrain minus a second source, in metres (lib/ndsm-mode.ts).
  ndsm: (state) => ({
    colorRamp: state.ndsmColorRamp,
    customStops: state.ndsmCustomStops,
    customStopsDiscrete: state.ndsmCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.ndsmMin,
    maxElevation: state.ndsmMax,
    colorReliefOpacity: state.ndsmOpacity * state.reliefVisualizationOpacity,
    invertColorRamp: state.ndsmInvertColorRamp,
  }),
  roughness: (state) => ({
    colorRamp: state.roughnessColorRamp,
    customStops: state.roughnessCustomStops,
    customStopsDiscrete: state.roughnessCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.roughnessMin,
    maxElevation: state.roughnessMax,
    colorReliefOpacity: state.roughnessOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.roughnessInvertColorRamp,
  }),
  shapeIndex: (state) => ({
    colorRamp: state.shapeIndexColorRamp,
    // Shape Index is still wire-encoded through the shared curvature://
    // protocol, which applies CURVATURE_ENCODE_SCALE to every mode's value
    // uniformly (see curvature-protocol.ts) — the raw ["elevation"] this
    // color-relief layer reads back is in that ×1000-scaled space, same as
    // curvatureReliefPaint above, even though the slider/state itself
    // (shapeIndexMin/Max, custom stop values) stays in ordinary [-1, 1]
    // shape-index units.
    customStops: state.shapeIndexCustomStops?.map((s: CustomRampStop) => ({ ...s, value: s.value * CURVATURE_ENCODE_SCALE })),
    customStopsDiscrete: state.shapeIndexCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.shapeIndexMin * CURVATURE_ENCODE_SCALE,
    maxElevation: state.shapeIndexMax * CURVATURE_ENCODE_SCALE,
    colorReliefOpacity: state.shapeIndexOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.shapeIndexInvertColorRamp,
  }),
  blobness: (state) => ({
    colorRamp: state.blobnessColorRamp,
    customStops: state.blobnessCustomStops,
    customStopsDiscrete: state.blobnessCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.blobnessMin,
    maxElevation: state.blobnessMax,
    colorReliefOpacity: state.blobnessOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.blobnessInvertColorRamp,
  }),
  eigenRatio: (state) => ({
    colorRamp: state.eigenRatioColorRamp,
    customStops: state.eigenRatioCustomStops,
    customStopsDiscrete: state.eigenRatioCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.eigenRatioMin,
    maxElevation: state.eigenRatioMax,
    colorReliefOpacity: state.eigenRatioOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.eigenRatioInvertColorRamp,
  }),
  orientation: (state) => ({
    colorRamp: state.orientationColorRamp,
    customStops: state.orientationCustomStops,
    customStopsDiscrete: state.orientationCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.orientationMin,
    maxElevation: state.orientationMax,
    colorReliefOpacity: state.orientationOpacity * state.terrainAnalysisOpacity,
    invertColorRamp: state.orientationInvertColorRamp,
  }),
  svf: (state) => ({
    colorRamp: state.svfColorRamp,
    customStops: state.svfCustomStops,
    customStopsDiscrete: state.svfCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.svfMin,
    maxElevation: state.svfMax,
    colorReliefOpacity: state.svfOpacity * state.reliefVisualizationOpacity,
    invertColorRamp: state.svfInvertColorRamp,
  }),
  openness: (state) => ({
    colorRamp: state.opennessColorRamp,
    customStops: state.opennessCustomStops,
    customStopsDiscrete: state.opennessCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.opennessMin,
    maxElevation: state.opennessMax,
    colorReliefOpacity: state.opennessOpacity * state.reliefVisualizationOpacity,
    invertColorRamp: state.opennessInvertColorRamp,
  }),
  localDominance: (state) => ({
    colorRamp: state.localDominanceColorRamp,
    customStops: state.localDominanceCustomStops,
    customStopsDiscrete: state.localDominanceCustomStopsDiscrete,
    customHypsoMinMax: true,
    minElevation: state.localDominanceMin,
    maxElevation: state.localDominanceMax,
    colorReliefOpacity: state.localDominanceOpacity * state.reliefVisualizationOpacity,
    invertColorRamp: state.localDominanceInvertColorRamp,
  }),
}
