import type React from "react"
import { useMemo } from "react"
import { Source, Layer } from "react-map-gl/maplibre"
import type { FeatureCollection } from "geojson"
import { useAtomValue } from "jotai"
import { drawingFeaturesAtom, drawingLayersAtom, resolveLayer } from "@/components/TerrainControlPanel/TerraDrawSystem"

const SOURCE_ID = "drawing-mirror"

/**
 * Read-only copy of the Terra Draw drawings on the secondary views. Terra
 * Draw itself is bound to the primary map (view A) - it owns the editing
 * interaction, the selection handles and the OPFS persistence - so the other
 * views render the same features from drawingFeaturesAtom as plain GeoJSON
 * layers, styled with each drawing layer's colours and width. Hidden layers
 * are skipped, and edits show up here as soon as they land in the atom.
 */
export const DrawingMirrorLayer: React.FC = () => {
  const features = useAtomValue(drawingFeaturesAtom)
  const layers = useAtomValue(drawingLayersAtom)
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
  if (!data.features.length) return null
  return (
    <Source id={SOURCE_ID} type="geojson" data={data}>
      <Layer id={`${SOURCE_ID}-fill`} type="fill" filter={["==", ["geometry-type"], "Polygon"]} paint={{ "fill-color": ["get", "_fill"] }} />
      <Layer id={`${SOURCE_ID}-line`} type="line" filter={["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]]}
        layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": ["get", "_stroke"], "line-width": ["get", "_width"] }} />
      <Layer id={`${SOURCE_ID}-point`} type="circle" filter={["==", ["geometry-type"], "Point"]}
        paint={{ "circle-color": ["get", "_fill"], "circle-stroke-color": ["get", "_stroke"], "circle-stroke-width": ["get", "_width"], "circle-radius": 5 }} />
    </Source>
  )
}
