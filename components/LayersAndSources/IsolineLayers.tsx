// The Iso-line (Contours & GeoGrid): a line from any measure's tiles
// (lib/isoline-measures.ts). Two modes: at a value, the isoband:// vector
// tiles (lib/isoband-protocol.ts) hold the polygons of the area at or above
// the value and their boundary, drawn as a fill and a line from the same
// geometry; every interval, the contour engine (ContoursLayer) over the
// measure tiles themselves (slope every 10°, a curvature every 1). One
// component so the terrain upstream hook runs once for everything.
import { memo } from "react"
import { Source, Layer } from "react-map-gl/maplibre"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import { useClientDemUpstream, type DerivedModeParams, type LightingParams } from "./MapSources"
import { ContoursLayer } from "./ContoursLayer"
import { LAYER_SLOTS } from "./MapLayers"
import { buildIsobandProtocolUrl } from "@/lib/isoband-protocol"
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
  // A WMS (no fixed pyramid) serves any zoom: 19 keeps a LiDAR DSM as sharp
  // in the line as in the shading.
  const maxzoom = Math.min(measureDem.maxzoom ?? 19, 19)
  if (mode === "value") {
    const url = buildIsobandProtocolUrl(measureDem.template, measureDem.encoding, measureDem.tileSize, value * scale)
    return (
      <Source id="isoline-band-source" key={`isoline-band-${measureDem.template}`} type="vector" tiles={[url]} maxzoom={maxzoom}>
        {fill && (
          <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-fill" type="fill" source="isoline-band-source" source-layer="isoband"
            paint={{ "fill-color": color, "fill-opacity": fillOpacity, "fill-antialias": false }} />
        )}
        <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-lines" type="line" source="isoline-band-source" source-layer="isoline"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": color, "line-width": weight, "line-opacity": 0.9 }} />
      </Source>
    )
  }
  const step = Math.max(1e-6, interval * scale)
  return (
    <ContoursLayer
      idPrefix="isoline"
      showContours
      showContourLabels={false}
      sourceId={String(terrainSource)}
      dem={measureDem}
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
  )
})
IsolineLayers.displayName = "IsolineLayers"
