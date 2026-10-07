// The Iso-line (Contours & GeoGrid): a line from any measure's tiles
// (lib/isoline-measures.ts). Two modes: at a value, the isoband:// vector
// tiles (lib/isoband-protocol.ts) hold the polygons of the area at or above
// the value and their boundary, drawn as a fill and a line from the same
// geometry; every interval, the contour engine (ContoursLayer) over the
// measure tiles themselves (slope every 10°, a curvature every 1). One
// component so the terrain upstream hook runs once for everything.
import { memo, useEffect } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import { useClientDemUpstream, type DerivedModeParams, type LightingParams } from "./MapSources"
import { ContoursLayer } from "./ContoursLayer"
import { LAYER_SLOTS } from "./MapLayers"
import { buildIsobandProtocolUrl } from "@/lib/isoband-protocol"
import { isolineMeasure, isolineMeasureDem, type IsolineMeasureId } from "@/lib/isoline-measures"

export const IsolineLayers = memo(({
  enabled, mode, measure, value, interval, fill, cliff = false, fillOpacity, color, weight,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, derived, lighting, mapLoaded, theme,
}: {
  enabled: boolean
  mode: "value" | "interval"
  measure: IsolineMeasureId
  value: number
  interval: number
  fill: boolean
  /** Slope at a value: cliff teeth along the line, into the steep area. */
  cliff?: boolean
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
  const { current: mapRef } = useMap()
  // The tooth: a small triangle in the line's colour, one image per colour,
  // placed along the line by the symbol layer below.
  const toothImage = `isoline-cliff-tooth-${color}`
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !cliff || map.hasImage(toothImage)) return
    const w = 18, h = 14, c = document.createElement("canvas"); c.width = w; c.height = h
    const g = c.getContext("2d")!
    g.fillStyle = color; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w / 2, h); g.closePath(); g.fill()
    map.addImage(toothImage, g.getImageData(0, 0, w, h), { pixelRatio: 1 })
  }, [mapRef, cliff, color, toothImage])
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
      <>
      <Source id="isoline-band-source" key={`isoline-band-${measureDem.template}`} type="vector" tiles={[url]} maxzoom={maxzoom}>
        {fill && (
          <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-fill" type="fill" source="isoline-band-source" source-layer="isoband"
            paint={{ "fill-color": color, "fill-opacity": fillOpacity, "fill-antialias": false }} />
        )}
        <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-lines" type="line" source="isoline-band-source" source-layer="isoline"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": color, "line-width": weight, "line-opacity": cliff && measure === "slope" ? 0.35 : 0.9 }} />
      </Source>
      {cliff && measure === "slope" && (
        // Cliff hatching on a simplified edge: the same iso-slope traced on
        // the measure blurred over 4 px, with runs under 40 px dropped, so
        // the line is the outline of the steep areas rather than every
        // wiggle and speck of the full-resolution slope (whose teeth
        // pointed every which way). A tooth every 28 px, hanging off the
        // steep side of the ring.
        <Source id="isoline-cliff-source" key={`isoline-cliff-${measureDem.template}`} type="vector" tiles={[buildIsobandProtocolUrl(measureDem.template, measureDem.encoding, measureDem.tileSize, value * scale, { smooth: 4, minLength: 40 })]} maxzoom={maxzoom}>
          <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-cliff-line" type="line" source="isoline-cliff-source" source-layer="isoline"
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{ "line-color": color, "line-width": weight + 0.5, "line-opacity": 0.95 }} />
          <Layer beforeId={LAYER_SLOTS.CONTOURS} id="isoline-cliff-teeth" type="symbol" source="isoline-cliff-source" source-layer="isoline"
            layout={{ "symbol-placement": "line", "symbol-spacing": 28, "icon-image": toothImage, "icon-size": 1, "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-offset": [0, 8], "icon-padding": 0 }}
            paint={{ "icon-opacity": 0.9 }} />
        </Source>
      )}
      </>
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
