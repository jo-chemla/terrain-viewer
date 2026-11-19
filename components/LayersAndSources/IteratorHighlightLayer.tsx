import type React from "react"
import { useMemo } from "react"
import { Source, Layer } from "react-map-gl/maplibre"
import type { FeatureCollection } from "geojson"
import { useAtomValue } from "jotai"
import {
  drawingsOpacityAtom, drawingsVisibleAtom, iteratorHighlightAtom, ITERATOR_ACCENT,
} from "@/components/TerrainControlPanel/TerraDrawSystem"

const HIGHLIGHT_ID = "iterator-highlight"

/**
 * The feature the Feature Iterator is on, drawn on every view in the
 * selection accent: a ring around a point, a wider stroke on a line or a
 * polygon outline. It follows the Drawings panel's show checkbox and opacity
 * slider, and its layer's own checkbox. A plain layer rather than Terra
 * Draw's own selection, which would show edit handles on every step.
 *
 * The drawings themselves are Terra Draw's td-* layers, which its adapter
 * adds to every view (lib/terra-draw-multi-map-adapter.ts) and keeps on top,
 * so the ring sits under the feature it surrounds.
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
