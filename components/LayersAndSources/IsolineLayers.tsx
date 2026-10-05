// The Iso-line (Contours & GeoGrid): a second contour engine beside the
// contours, over any measure's tiles (lib/isoline-measures.ts). Two modes:
// one line where the measure crosses a value (threshold:// turns the measure
// into two plateaus; a raster fill of the area above comes from the same
// tiles so it stops at the line), or a line every interval of the measure
// (the contour engine over the measure tiles themselves: slope every 10°, a
// sky-view factor every 0.05). One component so the terrain upstream hook
// runs once for the line and the fill.
import { memo } from "react"
import { Source, Layer } from "react-map-gl/maplibre"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import { useClientDemUpstream, type DerivedModeParams, type LightingParams } from "./MapSources"
import { ContoursLayer } from "./ContoursLayer"
import { LAYER_SLOTS } from "./MapLayers"
import { buildThresholdProtocolUrl, THRESHOLD_CONTOUR_INTERVAL } from "@/lib/threshold-protocol"
import { isolineMeasure, isolineMeasureDem, type IsolineMeasureId } from "@/lib/isoline-measures"

export const IsolineLayers = memo(({
  enabled, mode, measure, value, interval, fill, fillOpacity, color, weight,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, derived, lighting, mapLoaded, theme,
}: {
  enabled: boolean
  mode: "value" | "interval"
  measure: IsolineMeasureId
  value: number
  interval: number
  fill: boolean
  fillOpacity: number
  color: string
  weight: number
  terrainSource: TerrainSource | string
  customTerrainSources: CustomTerrainSource[]
  mapboxKey: string
  maptilerKey: string
  titilerEndpoint: string
  derived: DerivedModeParams
  lighting: LightingParams
  mapLoaded: boolean
  theme: string
}) => {
  const up = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  if (!enabled || !up) return null
  const m = isolineMeasure(measure)
  const measureDem = isolineMeasureDem(measure, up, derived, lighting)
  if (!measureDem) return null
  const scale = m.scale(derived)
  const encodedValue = value * scale
  const atValue = mode === "value"
  const dem = atValue
    ? { ...measureDem, template: buildThresholdProtocolUrl(measureDem.template, measureDem.encoding, measureDem.tileSize, encodedValue), encoding: "terrarium" as const }
    : measureDem
  const step = atValue ? THRESHOLD_CONTOUR_INTERVAL : Math.max(1e-6, interval * scale)
  const fillUrl = atValue && fill ? buildThresholdProtocolUrl(measureDem.template, measureDem.encoding, measureDem.tileSize, encodedValue, { color, opacity: fillOpacity }) : null
  return (
    <>
      {fillUrl && (
        <Source id="isolineFillSource" key={`isolineFill-${measureDem.template}`} type="raster" tiles={[fillUrl]} tileSize={measureDem.tileSize} maxzoom={measureDem.maxzoom}>
          <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-fill" type="raster" source="isolineFillSource" paint={{ "raster-opacity": 1, "raster-resampling": "linear", "raster-fade-duration": 0 }} />
        </Source>
      )}
      <ContoursLayer
        idPrefix="isoline"
        showContours
        showContourLabels={false}
        sourceId={String(terrainSource)}
        dem={dem}
        referenceMode="absolute"
        lrmRadius={derived.lrmRadius}
        contourMinor={step}
        contourMajor={step}
        contourWeight={weight}
        contourColor={color}
        mapboxKey={mapboxKey}
        maptilerKey={maptilerKey}
        customTerrainSources={customTerrainSources}
        titilerEndpoint={titilerEndpoint}
        mapLoaded={mapLoaded}
        theme={theme}
      />
    </>
  )
})
IsolineLayers.displayName = "IsolineLayers"
