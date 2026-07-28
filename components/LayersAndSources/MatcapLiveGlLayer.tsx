// React wrapper for lib/matcap-live-gl-layer.ts's MatcapLiveLayer — the
// "Fast" (live-uniform, perspective-aware) alternative to MatcapSource/
// MatcapRasterLayer's raster-protocol pipeline. Mirrors PhongLiveGlLayer.tsx
// closely (see that file's header) — mounted imperatively via
// map.addLayer/removeLayer since react-map-gl's declarative <Layer> doesn't
// support `type: "custom"`: a full remount only when the upstream DEM
// changes (every cached normal texture would otherwise be for the wrong
// terrain), material/rotation/exaggeration/opacity changes go through
// updateOptions() instead.
import { useEffect, useRef } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import type { CustomLayerInterface } from "maplibre-gl"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import { MatcapLiveLayer as MatcapLiveLayerImpl, type MatcapLiveOptions } from "@/lib/matcap-live-gl-layer"
import { useClientDemUpstream } from "./MapSources"
import { LAYER_SLOTS } from "./MapLayers"

const LIVE_LAYER_ID = "matcap-live"

export function MatcapLiveGlLayer({
  mapRef, enabled,
  matcapUrl, rotationDeg, exaggeration, opacity,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
  mapRef: React.RefObject<MapRef>
  enabled: boolean
  matcapUrl: string
  rotationDeg: number
  exaggeration: number
  opacity: number
  terrainSource: TerrainSource | string
  customTerrainSources: CustomTerrainSource[]
  mapboxKey: string
  maptilerKey: string
  titilerEndpoint: string
}) {
  const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const layerRef = useRef<MatcapLiveLayerImpl | null>(null)

  useEffect(() => {
    if (!enabled || !clientUpstream) return
    const map = mapRef.current?.getMap()
    if (!map) return

    const options: MatcapLiveOptions = {
      upstreamTemplate: clientUpstream.template,
      encoding: clientUpstream.encoding,
      tileSize: clientUpstream.tileSize,
      minzoom: clientUpstream.minzoom,
      maxzoom: clientUpstream.maxzoom,
      matcapUrl, rotationDeg, exaggeration, opacity,
    }
    const layer = new MatcapLiveLayerImpl(LIVE_LAYER_ID, options)
    layerRef.current = layer
    let cancelled = false
    let rafHandle: number | null = null

    // The LAYER_SLOTS.MATCAP marker must already exist for `beforeId` to
    // resolve — retry across frames rather than assuming a single effect
    // run wins the race (same reasoning as PhongLiveGlLayer.tsx).
    const tryAddLayer = () => {
      if (cancelled) return
      if (!map.getLayer(LIVE_LAYER_ID) && map.getLayer(LAYER_SLOTS.MATCAP)) {
        map.addLayer(layer as unknown as CustomLayerInterface, LAYER_SLOTS.MATCAP)
        return
      }
      if (!map.getLayer(LIVE_LAYER_ID)) rafHandle = requestAnimationFrame(tryAddLayer)
    }
    tryAddLayer()

    const onStyleData = () => {
      if (!map.getLayer(LIVE_LAYER_ID)) tryAddLayer()
    }
    map.on("styledata", onStyleData)

    return () => {
      cancelled = true
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
      map.off("styledata", onStyleData)
      layerRef.current = null
      if (map.getLayer(LIVE_LAYER_ID)) map.removeLayer(LIVE_LAYER_ID)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientUpstream?.template, clientUpstream?.encoding, clientUpstream?.tileSize, clientUpstream?.minzoom, clientUpstream?.maxzoom, mapRef])

  useEffect(() => {
    layerRef.current?.updateOptions({ matcapUrl, rotationDeg, exaggeration, opacity })
  }, [matcapUrl, rotationDeg, exaggeration, opacity])

  return null
}
