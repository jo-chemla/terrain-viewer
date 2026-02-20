"use client"

import { useEffect, useRef, useCallback } from "react"
import { useMap, Layer } from "react-map-gl/maplibre"
import type { LayerSpecification } from "react-map-gl/maplibre"
import maplibregl from "maplibre-gl"
import mlcontour from "maplibre-contour"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import {LAYER_SLOTS} from "./MapLayers"

// ─── Layer definitions (moved here from MapLayers.tsx) ───────────────────────

export const contourLinesLayerDef = (
  showContours: boolean,
  theme: string,
): LayerSpecification => ({
  id: "contour-lines",
  type: "line",
  source: "contour-source",
  "source-layer": "contours",
  paint: {
    "line-color":
      theme === "light" ? "rgba(0,0,0, 50%)" : "rgba(255,255,255, 50%)",
    "line-width": ["match", ["get", "level"], 1, 1, 0.5],
  },
  layout: {
    visibility: showContours ? "visible" : "none",
  },
})

export const contourLabelsLayerDef = (
  showContours: boolean,
  theme: string,
): LayerSpecification => ({
  id: "contour-labels",
  type: "symbol",
  source: "contour-source",
  "source-layer": "contours",
  filter: [">", ["get", "level"], 0],
  paint: {
    "text-halo-color": theme === "light" ? "#ffffff" : "#000000",
    "text-halo-width": 1,
    "text-color": theme === "light" ? "#000000" : "#ffffff",
  },
  layout: {
    "symbol-placement": "line",
    "text-size": 10,
    "text-field": ["concat", ["number-format", ["get", "ele"], {}], "m"],
    "text-font": ["Noto Sans Bold"],
    visibility: showContours ? "visible" : "none",
  },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function removeLayers(map: maplibregl.Map) {
  if (map.getLayer("contour-labels")) map.removeLayer("contour-labels")
  if (map.getLayer("contour-lines")) map.removeLayer("contour-lines")
  if (map.getSource("contour-source")) map.removeSource("contour-source")
}

function buildTileUrl(
  sourceId: string,
  customTerrainSources: CustomTerrainSource[],
  titilerEndpoint: string,
  mapboxKey: string,
  maptilerKey: string,
): { tileUrl: string; encoding: string; maxzoom: number } | null {
  const customSource = customTerrainSources.find((s) => s.id === sourceId)

  if (customSource) {
    if (customSource.type === "cog") {
      return {
        tileUrl: `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(customSource.url)}`,
        encoding: "mapbox",
        maxzoom: 14,
      }
    }
    return {
      tileUrl: customSource.url,
      encoding: customSource.type === "terrarium" ? "terrarium" : "mapbox",
      maxzoom: 14,
    }
  }

  const source = (terrainSources as any)[sourceId as TerrainSource]
  if (!source?.sourceConfig?.tiles?.[0]) return null

  let tileUrl: string = source.sourceConfig.tiles[0]
  if (sourceId === "mapbox") tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
  else if (sourceId === "maptiler") tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")

  return {
    tileUrl,
    encoding: source.encoding === "terrainrgb" ? "mapbox" : "terrarium",
    maxzoom: source.sourceConfig.maxzoom || 14,
  }
}

function buildThresholds(minor, major) {
  return {
    // low zoom: only major contours (level 0)
    2:  [major],
    // mid zoom: major (level 1) and minor (level 0)  
    10: [minor, major],
  };
}


function buildContourProtocolUrl(
  demSource: any,
  contourMinor: number,
  contourMajor: number,
): string {
  return demSource.contourProtocolUrl({
    multiplier: 1,
    // thresholds: {
    //   11: [contourMajor, contourMajor * 5],
    //   12: [contourMinor, contourMajor],
    //   14: [contourMinor / 2, contourMajor],
    //   15: [contourMinor / 5, contourMinor],
    // },
    thresholds: buildThresholds(contourMinor, contourMajor),

    contourLayer: "contours",
    elevationKey: "ele",
    levelKey: "level",
    extent: 4096,
    buffer: 1,
    overzoom: 1,
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContoursLayerProps {
  /** Whether the overall contours feature is toggled on */
  showContours: boolean
  /** Whether contour labels are visible */
  showContourLabels: boolean
  /** Active terrain source id — used to build tile URLs */
  sourceId: string
  contourMinor: number
  contourMajor: number
  /** Passed through to tile URL resolution */
  mapboxKey: string
  maptilerKey: string
  customTerrainSources: CustomTerrainSource[]
  titilerEndpoint: string
  /** Set to true once the parent map has fired its `load` event */
  mapsLoaded: boolean
  theme: string
}

// ─── Component ────────────────────────────────────────────────────────────────

const MAX_INIT_ATTEMPTS = 5

export function ContoursLayer({
  showContours,
  showContourLabels,
  sourceId,
  contourMinor,
  contourMajor,
  mapboxKey,
  maptilerKey,
  customTerrainSources,
  titilerEndpoint,
  mapsLoaded,
  theme,
}: ContoursLayerProps) {
  const { current: mapRef } = useMap()

  const demSourceRef = useRef<any>(null)
  const initializedRef = useRef(false)
  const initAttemptsRef = useRef(0)

  // Track latest thresholds so the threshold-update effect can read them without
  // being listed as a dep of the init effect.
  const thresholdsRef = useRef({ contourMinor, contourMajor })
  thresholdsRef.current = { contourMinor, contourMajor }

  // ── Reset when terrain source changes ──────────────────────────────────────
  useEffect(() => {
    initializedRef.current = false
    initAttemptsRef.current = 0
    demSourceRef.current = null
  }, [sourceId])

  // ── Init: register DemSource + add contour-source to map ───────────────────
  useEffect(() => {
    if (!mapRef || !mapsLoaded) return
    if (initializedRef.current) return
    if (initAttemptsRef.current >= MAX_INIT_ATTEMPTS) return

    const map = mapRef.getMap()

    const tryInit = async () => {
      if (initializedRef.current) return
      if (initAttemptsRef.current >= MAX_INIT_ATTEMPTS) return

      initAttemptsRef.current += 1

      if (!map.isStyleLoaded()) {
        setTimeout(tryInit, 1000)
        return
      }

      const resolved = buildTileUrl(
        sourceId,
        customTerrainSources,
        titilerEndpoint,
        mapboxKey,
        maptilerKey,
      )
      if (!resolved) return

      try {
        const DemSource =
          (mlcontour as any).DemSource ??
          (mlcontour as any).default?.DemSource ??
          mlcontour

        const dem = new DemSource({
          url: resolved.tileUrl,
          encoding: resolved.encoding,
          maxzoom: resolved.maxzoom,
          worker: true,
          cacheSize: 100,
          timeoutMs: 10000,
        })

        dem.setupMaplibre(maplibregl)
        demSourceRef.current = dem

        // Clean up any stale layers/source before adding fresh ones
        removeLayers(map)

        const { contourMinor: minor, contourMajor: major } = thresholdsRef.current

        map.addSource("contour-source", {
          type: "vector",
          tiles: [buildContourProtocolUrl(dem, minor, major)],
          maxzoom: 15,
        })

        // Layers are rendered declaratively via <Layer> below once initialized.
        initializedRef.current = true
        // Force a re-render so the Layer elements mount now that the source exists.
        // We do this by setting a piece of ref-free state — but since this component
        // intentionally avoids useState to prevent extra renders, we use a custom
        // trick: dispatch a no-op to trigger React reconciliation.
        // Actually the simplest approach: keep a tiny forceUpdate.
        forceUpdateRef.current?.()
      } catch (err) {
        console.error("[ContoursLayer] Init error:", err)
        if (initAttemptsRef.current < MAX_INIT_ATTEMPTS) {
          setTimeout(tryInit, 2000)
        }
      }
    }

    const timer = setTimeout(tryInit, 1000)
    return () => clearTimeout(timer)
  }, [mapsLoaded, sourceId, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint, mapRef])

  // ── Update thresholds when contourMinor/contourMajor change ───────────────
  useEffect(() => {
    if (!mapRef || !initializedRef.current || !demSourceRef.current) return
    const map = mapRef.getMap()
    if (!map.isStyleLoaded()) return

    removeLayers(map)

    map.addSource("contour-source", {
      type: "vector",
      tiles: [buildContourProtocolUrl(demSourceRef.current, contourMinor, contourMajor)],
      maxzoom: 15,
    })

    // Re-add layers imperatively so they exist before the declarative <Layer>
    // elements re-mount (avoids a flash where source exists but layers don't).
    map.addLayer(contourLinesLayerDef(showContours, theme) as any)
    map.addLayer(contourLabelsLayerDef(showContours && showContourLabels, theme) as any)
  }, [contourMinor, contourMajor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!mapRef) return
      const map = mapRef.getMap()
      removeLayers(map)
      demSourceRef.current = null
      initializedRef.current = false
    }
  }, [mapRef])

  // ── forceUpdate shim ───────────────────────────────────────────────────────
  // We need to trigger a re-render after async init so the <Layer> elements mount.
  const [, setTick] = useForceUpdate()
  const forceUpdateRef = useRef<(() => void) | null>(null)
  forceUpdateRef.current = () => setTick((n) => n + 1)

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!initializedRef.current) return null

  return (
    <>
      <Layer
        beforeId={LAYER_SLOTS.CONTOURS}
        {...contourLinesLayerDef(showContours, theme)}
        key={"contour-lines-" + theme}
      />
      <Layer
        beforeId={LAYER_SLOTS.CONTOURS}
        {...contourLabelsLayerDef(showContours && showContourLabels, theme)}
        key={"contour-labels-" + theme}
      />
    </>
  )
}

// ─── Tiny hook to force re-render ─────────────────────────────────────────────
import { useState } from "react"
function useForceUpdate(): [number, React.Dispatch<React.SetStateAction<number>>] {
  return useState(0)
}