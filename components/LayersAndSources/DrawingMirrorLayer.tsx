import type React from "react"
import { useMemo } from "react"
import { Source, Layer } from "react-map-gl/maplibre"
import type { FeatureCollection } from "geojson"
import { useAtomValue } from "jotai"
import {
  drawingFeaturesAtom, drawingLayersAtom, drawingsOpacityAtom, drawingsVisibleAtom, resolveLayer,
  iteratorHighlightAtom, ITERATOR_ACCENT,
} from "@/components/TerrainControlPanel/TerraDrawSystem"

const SOURCE_ID = "drawing-mirror"

/**
 * Read-only copy of the Terra Draw drawings on the secondary views. Terra
 * Draw itself is bound to the primary map (view A) - it owns the editing
 * interaction, the selection handles and the OPFS persistence - so the other
 * views render the same features from drawingFeaturesAtom as plain GeoJSON
 * layers, styled with each drawing layer's colours and width. Hidden layers
 * are skipped, and edits show up here as soon as they land in the atom.
 *
 * The Drawings panel's "Show drawings" checkbox and opacity slider apply here
 * too: unchecked renders nothing, and the slider value goes on the fill, line
 * and circle paint the same way setTerraDrawOpacity puts it on A's td-*
 * layers (fill-opacity, line-opacity, circle-opacity + circle-stroke-opacity).
 */
export const DrawingMirrorLayer: React.FC = () => {
  const features = useAtomValue(drawingFeaturesAtom)
  const layers = useAtomValue(drawingLayersAtom)
  const visible = useAtomValue(drawingsVisibleAtom)
  const opacity = useAtomValue(drawingsOpacityAtom)
  const data = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: features.flatMap((f) => {
      const layer = resolveLayer(layers, f)
      if (layer.hidden) return []
      return [{ type: "Feature" as const, geometry: f.geometry, properties: {
        ...f.properties, _stroke: layer.strokeColor, _fill: layer.fillColor, _width: layer.strokeWidth,
      } }]
    }),
  }), [features, layers])
  if (!visible || !data.features.length) return null
  return (
    <Source id={SOURCE_ID} type="geojson" data={data}>
      <Layer id={`${SOURCE_ID}-fill`} type="fill" filter={["==", ["geometry-type"], "Polygon"]}
        paint={{ "fill-color": ["get", "_fill"], "fill-opacity": opacity }} />
      <Layer id={`${SOURCE_ID}-line`} type="line" filter={["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]]}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": ["get", "_stroke"], "line-width": ["get", "_width"], "line-opacity": opacity }} />
      <Layer id={`${SOURCE_ID}-point`} type="circle" filter={["==", ["geometry-type"], "Point"]}
        paint={{
          "circle-color": ["get", "_fill"], "circle-stroke-color": ["get", "_stroke"], "circle-stroke-width": ["get", "_width"], "circle-radius": 5,
          "circle-opacity": opacity, "circle-stroke-opacity": opacity,
        }} />
    </Source>
  )
}

const HIGHLIGHT_ID = "iterator-highlight"

/**
 * The feature the Feature Iterator is on, drawn over the drawings of every
 * view (A included) in the selection accent: a ring around a point, a wider
 * stroke on a line or a polygon outline. It follows the Drawings panel's
 * show checkbox and opacity slider, and its layer's own checkbox. A plain layer rather than Terra
 * Draw's own selection, which would show edit handles on every step.
 */
export const IteratorHighlightLayer: React.FC = () => {
  const feature = useAtomValue(iteratorHighlightAtom)
  const visible = useAtomValue(drawingsVisibleAtom)
  // The Drawings opacity slider applies to the ring as it does to the features.
  const opacity = useAtomValue(drawingsOpacityAtom)
  const data = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: feature?.geometry ? [{ type: "Feature" as const, geometry: feature.geometry, properties: {} }] : [],
  }), [feature])
  if (!visible || !data.features.length) return null
  return (
    <Source id={HIGHLIGHT_ID} type="geojson" data={data}>
      <Layer id={`${HIGHLIGHT_ID}-line`} type="line" filter={["!=", ["geometry-type"], "Point"]}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": ITERATOR_ACCENT, "line-width": 5, "line-opacity": opacity }} />
      <Layer id={`${HIGHLIGHT_ID}-point`} type="circle" filter={["==", ["geometry-type"], "Point"]}
        paint={{ "circle-color": ITERATOR_ACCENT, "circle-opacity": 0.25 * opacity, "circle-radius": 11, "circle-stroke-color": ITERATOR_ACCENT, "circle-stroke-width": 3, "circle-stroke-opacity": opacity }} />
    </Source>
  )
}
