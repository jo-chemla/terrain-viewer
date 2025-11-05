"use client"

import { useCallback, useEffect, useRef, useState, useMemo, memo } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat } from "nuqs"
import Map, { Source, Layer, NavigationControl, GeolocateControl, type MapRef } from "react-map-gl/maplibre"
import "@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css"
import { TerrainControls } from "./terrain-controls"
import { GeocoderControl } from "./geocoder-control"
import { terrainSources } from "@/lib/terrain-sources"
import { colorRamps } from "@/lib/color-ramps"
import type { TerrainSource } from "@/lib/terrain-types"

const TerrainSources = memo(({ source }: { source: TerrainSource }) => {
  const sourceConfig = terrainSources[source].sourceConfig

  return (
    <>
      <Source id="terrainSource" key={`terrain-${source}`} {...sourceConfig} />
      <Source id="hillshadeSource" key={`hillshade-${source}`} {...sourceConfig} />
    </>
  )
})
TerrainSources.displayName = "TerrainSources"

const RasterSource = memo(
  ({ terrainSource, terrainRasterUrls }: { terrainSource: string; terrainRasterUrls: Record<string, string> }) => {
    return (
      <Source
        id="terrain-raster-source"
        key={`raster-${terrainSource}`}
        type="raster"
        tiles={[terrainRasterUrls[terrainSource] || terrainRasterUrls.google]}
        tileSize={256}
      />
    )
  },
)
RasterSource.displayName = "RasterSource"

const RasterLayer = memo(({ showTerrain, terrainOpacity }: { showTerrain: boolean; terrainOpacity: number }) => {
  return (
    <Layer
      id="terrain-raster"
      type="raster"
      source="terrain-raster-source"
      paint={{
        "raster-opacity": terrainOpacity,
      }}
      layout={{
        visibility: showTerrain ? "visible" : "none",
      }}
    />
  )
})
RasterLayer.displayName = "RasterLayer"

const HillshadeLayer = memo(({ showHillshade, hillshadePaint }: { showHillshade: boolean; hillshadePaint: any }) => {
  return (
    <Layer
      id="hillshade"
      type="hillshade"
      source="hillshadeSource"
      paint={hillshadePaint}
      layout={{
        visibility: showHillshade ? "visible" : "none",
      }}
    />
  )
})
HillshadeLayer.displayName = "HillshadeLayer"

const ColorReliefLayer = memo(
  ({ showColorRelief, colorReliefPaint }: { showColorRelief: boolean; colorReliefPaint: any }) => {
    if (!showColorRelief) return null

    return (
      <Layer
        id="color-relief"
        type="color-relief"
        source="hillshadeSource"
        paint={colorReliefPaint}
        layout={{
          visibility: "visible",
        }}
      />
    )
  },
)
ColorReliefLayer.displayName = "ColorReliefLayer"

const ContourLayers = memo(({ showContours }: { showContours: boolean }) => {
  return (
    <>
      <Layer
        id="contour-lines"
        type="line"
        source="contour-source"
        source-layer="contours"
        paint={{
          "line-color": "rgba(0,0,0, 50%)",
          "line-width": ["match", ["get", "level"], 1, 1, 0.5],
        }}
        layout={{
          visibility: showContours ? "visible" : "none",
        }}
      />
      <Layer
        id="contour-labels"
        type="symbol"
        source="contour-source"
        source-layer="contours"
        filter={[">", ["get", "level"], 0]}
        layout={{
          "symbol-placement": "line",
          "text-size": 10,
          "text-field": ["concat", ["number-format", ["get", "ele"], {}], "m"],
          "text-font": ["Noto Sans Bold"],
          visibility: showContours ? "visible" : "none",
        }}
        paint={{
          "text-halo-color": "white",
          "text-halo-width": 1,
        }}
      />
    </>
  )
})
ContourLayers.displayName = "ContourLayers"

export function TerrainViewer() {
  const mapARef = useRef<MapRef>(null)
  const mapBRef = useRef<MapRef>(null)
  const isSyncing = useRef(false)
  const [mapLibreReady, setMapLibreReady] = useState(false)
  const [contoursInitialized, setContoursInitialized] = useState(false)
  const demSourceRef = useRef<any>(null)
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const initAttemptsRef = useRef(0)

  const terrainRasterUrls: Record<string, string> = {
    osm: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
    google: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    esri: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    mapbox: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw`,
  }

  const [state, setState] = useQueryStates({
    viewMode: parseAsString.withDefault("3d"),
    splitScreen: parseAsBoolean.withDefault(false),
    sourceA: parseAsString.withDefault("mapterhorn"),
    sourceB: parseAsString.withDefault("maptiler"),
    showHillshade: parseAsBoolean.withDefault(true),
    hillshadeOpacity: parseAsFloat.withDefault(1.0),
    showColorRelief: parseAsBoolean.withDefault(false),
    colorReliefOpacity: parseAsFloat.withDefault(0.35),
    showContours: parseAsBoolean.withDefault(false),
    colorRamp: parseAsString.withDefault("hypsometric"),
    showTerrain: parseAsBoolean.withDefault(false),
    terrainOpacity: parseAsFloat.withDefault(1.0),
    terrainSource: parseAsString.withDefault("google"),
    exaggeration: parseAsFloat.withDefault(1),
    lat: parseAsFloat.withDefault(45.9763),
    lng: parseAsFloat.withDefault(7.6586),
    zoom: parseAsFloat.withDefault(12.5),
    pitch: parseAsFloat.withDefault(60),
    bearing: parseAsFloat.withDefault(0),
    illuminationDir: parseAsFloat.withDefault(315),
    illuminationAlt: parseAsFloat.withDefault(45),
    shadowColor: parseAsString.withDefault("#000000"),
    highlightColor: parseAsString.withDefault("#FFFFFF"),
    accentColor: parseAsString.withDefault("#808080"),
    hillshadeExag: parseAsFloat.withDefault(1.0),
    hillshadeMethod: parseAsString.withDefault("combined"),
    contourMinor: parseAsFloat.withDefault(50),
    contourMajor: parseAsFloat.withDefault(200),
    minElevation: parseAsFloat.withDefault(0),
    maxElevation: parseAsFloat.withDefault(4000),
    mapboxKey: parseAsString.withDefault(""),
    googleKey: parseAsString.withDefault(""),
    maptilerKey: parseAsString.withDefault(""),
    titilerEndpoint: parseAsString.withDefault("https://titiler.xyz"),
    maxResolution: parseAsFloat.withDefault(1024),
  })

  const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsIlluminationAltitude = ["combined", "basic"].includes(state.hillshadeMethod)
  const supportsShadowColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsHighlightColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsAccentColor = state.hillshadeMethod === "standard"
  const supportsExaggeration = ["standard", "combined", "multidirectional", "multidir-colors"].includes(
    state.hillshadeMethod,
  )

  const hillshadePaint = useMemo(() => {
    const paint: any = {}

    if (state.hillshadeMethod === "multidirectional") {
      paint["hillshade-method"] = "multidirectional"
      paint["hillshade-exaggeration"] = 0.5
    } else if (state.hillshadeMethod === "multidir-colors") {
      paint["hillshade-method"] = "multidirectional"
      paint["hillshade-highlight-color"] = ["#FF4000", "#FFFF00", "#40ff00", "#00FF80"]
      paint["hillshade-shadow-color"] = ["#00bfff", "#0000ff", "#bf00ff", "#FF0080"]
      paint["hillshade-illumination-direction"] = [270, 315, 0, 45]
      paint["hillshade-illumination-altitude"] = [30, 30, 30, 30]
    } else {
      if (supportsIlluminationDirection) {
        paint["hillshade-illumination-direction"] = state.illuminationDir
      }
      if (supportsShadowColor) {
        const shadowRgb = hexToRgb(state.shadowColor)
        paint["hillshade-shadow-color"] =
          `rgba(${shadowRgb.r}, ${shadowRgb.g}, ${shadowRgb.b}, ${state.hillshadeOpacity})`
      }
      if (supportsHighlightColor) {
        const highlightRgb = hexToRgb(state.highlightColor)
        paint["hillshade-highlight-color"] =
          `rgba(${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}, ${state.hillshadeOpacity})`
      }
      if (supportsIlluminationAltitude) {
        paint["hillshade-illumination-altitude"] = state.illuminationAlt
      }
      if (supportsExaggeration) {
        paint["hillshade-exaggeration"] = state.hillshadeExag
      }
      if (supportsAccentColor) {
        paint["hillshade-accent-color"] = state.accentColor
      }
      if (state.hillshadeMethod !== "standard") {
        paint["hillshade-method"] = state.hillshadeMethod
      }
    }

    return paint
  }, [
    state.illuminationDir,
    state.shadowColor,
    state.highlightColor,
    state.illuminationAlt,
    state.hillshadeExag,
    state.accentColor,
    state.hillshadeMethod,
    state.hillshadeOpacity,
    supportsIlluminationDirection,
    supportsIlluminationAltitude,
    supportsShadowColor,
    supportsHighlightColor,
    supportsAccentColor,
    supportsExaggeration,
  ])

  const colorReliefPaint = useMemo(() => {
    const ramp = colorRamps[state.colorRamp]
    if (!ramp) return {}

    return {
      "color-relief-opacity": state.colorReliefOpacity,
      "color-relief-color": ramp.colors,
    }
  }, [state.colorRamp, state.colorReliefOpacity])

  useEffect(() => {
    const checkMapLibre = () => {
      if (typeof window !== "undefined" && (window as any).maplibregl) {
        setMapLibreReady(true)
      } else {
        setTimeout(checkMapLibre, 100)
      }
    }
    checkMapLibre()
  }, [])

  useEffect(() => {
    const initContours = async () => {
      if (!mapARef.current || contoursInitialized || !mapLibreReady || !mapsLoaded) {
        console.log("[v0] Contours init skipped:", {
          hasMap: !!mapARef.current,
          contoursInitialized,
          mapLibreReady,
          mapsLoaded,
          attempts: initAttemptsRef.current,
        })
        return
      }

      if (initAttemptsRef.current >= 5) {
        console.error("[v0] Contours initialization failed after 5 attempts")
        return
      }

      initAttemptsRef.current += 1

      try {
        console.log("[v0] Initializing contours (attempt", initAttemptsRef.current, ")...")
        const mlcontour = await import("maplibre-contour")
        const maplibregl = (window as any).maplibregl

        if (!maplibregl) {
          console.error("[v0] maplibregl not found on window")
          return
        }

        const source = terrainSources[state.sourceA as TerrainSource]
        if (!source?.sourceConfig?.tiles?.[0]) {
          console.log("[v0] No source tiles found")
          return
        }

        let DemSource = mlcontour.DemSource
        if (!DemSource && (mlcontour as any).default) {
          DemSource = (mlcontour as any).default.DemSource || (mlcontour as any).default
        }
        if (!DemSource && typeof mlcontour === "function") {
          DemSource = mlcontour as any
        }
        if (!DemSource && (mlcontour as any).DemSource) {
          DemSource = (mlcontour as any).DemSource
        }

        if (!DemSource || typeof DemSource !== "function") {
          console.error("[v0] DemSource not found or not a constructor. Available keys:", Object.keys(mlcontour))
          console.error("[v0] mlcontour type:", typeof mlcontour)
          console.error("[v0] mlcontour.default:", (mlcontour as any).default)
          return
        }

        console.log("[v0] Creating DemSource with:", {
          url: source.sourceConfig.tiles[0],
          encoding: source.encoding === "terrainrgb" ? "mapbox" : "terrarium",
        })

        demSourceRef.current = new DemSource({
          url: source.sourceConfig.tiles[0],
          encoding: source.encoding === "terrainrgb" ? "mapbox" : "terrarium",
          maxzoom: source.sourceConfig.maxzoom || 14,
          worker: true,
          cacheSize: 100,
          timeoutMs: 10000,
        })

        demSourceRef.current.setupMaplibre(maplibregl)

        const map = mapARef.current.getMap()

        if (map.getSource("contour-source")) {
          console.log("[v0] Contour source already exists, removing...")
          map.removeSource("contour-source")
        }

        map.addSource("contour-source", {
          type: "vector",
          tiles: [
            demSourceRef.current.contourProtocolUrl({
              multiplier: 1,
              thresholds: {
                11: [state.contourMajor, state.contourMajor * 5],
                12: [state.contourMinor, state.contourMajor],
                14: [state.contourMinor / 2, state.contourMajor],
                15: [state.contourMinor / 5, state.contourMinor],
              },
              contourLayer: "contours",
              elevationKey: "ele",
              levelKey: "level",
              extent: 4096,
              buffer: 1,
            }),
          ],
          maxzoom: 15,
        })

        console.log("[v0] Contours initialized successfully")
        setContoursInitialized(true)
      } catch (error) {
        console.error("[v0] Failed to initialize contours:", error)
        setTimeout(() => {
          setContoursInitialized(false)
        }, 2000)
      }
    }

    if (mapsLoaded && !contoursInitialized && initAttemptsRef.current < 5) {
      const timer = setTimeout(initContours, 3000)
      return () => clearTimeout(timer)
    }
  }, [contoursInitialized, mapLibreReady, mapsLoaded, state.sourceA, state.contourMinor, state.contourMajor])

  const onMoveEndA = useCallback(
    (evt: any) => {
      if (!isSyncing.current) {
        const newState = {
          lat: Number.parseFloat(evt.viewState.latitude.toFixed(4)),
          lng: Number.parseFloat(evt.viewState.longitude.toFixed(4)),
          zoom: Number.parseFloat(evt.viewState.zoom.toFixed(2)),
          pitch: Number.parseFloat(evt.viewState.pitch.toFixed(1)),
          bearing: Number.parseFloat(evt.viewState.bearing.toFixed(1)),
        }
        setState(newState, { shallow: true })
      }
    },
    [setState],
  )

  const onMoveA = useCallback(
    (evt: any) => {
      if (!isSyncing.current && state.splitScreen && mapBRef.current) {
        isSyncing.current = true
        mapBRef.current.getMap().jumpTo({
          center: [evt.viewState.longitude, evt.viewState.latitude],
          zoom: evt.viewState.zoom,
          bearing: evt.viewState.bearing,
          pitch: evt.viewState.pitch,
        })
        setTimeout(() => {
          isSyncing.current = false
        }, 50)
      }
    },
    [state.splitScreen],
  )

  const getMapBounds = () => {
    if (!mapARef.current) return { west: -180, south: -90, east: 180, north: 90 }
    const bounds = mapARef.current.getMap().getBounds()
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }
  }

  const renderMap = (source: TerrainSource, mapId: string) => {
    return (
      <Map
        ref={mapId === "map-a" ? mapARef : mapBRef}
        mapLib={(window as any).maplibregl}
        initialViewState={{
          latitude: state.lat,
          longitude: state.lng,
          zoom: state.zoom,
          pitch: state.viewMode === "2d" ? 0 : state.pitch,
          bearing: state.viewMode === "2d" ? 0 : state.bearing,
        }}
        onMove={mapId === "map-a" ? onMoveA : undefined}
        onMoveEnd={mapId === "map-a" ? onMoveEndA : undefined}
        onLoad={() => {
          if (mapId === "map-a") {
            console.log("[v0] Map A loaded")
            setMapsLoaded(true)
          }
        }}
        maxPitch={state.viewMode === "2d" ? 0 : 85}
        pitchWithRotate={state.viewMode !== "2d"}
        dragRotate={state.viewMode !== "2d"}
        touchZoomRotate={state.viewMode !== "2d"}
        terrain={{
          source: "terrainSource",
          exaggeration: state.exaggeration,
        }}
        projection={state.viewMode === "globe" ? "globe" : "mercator"}
        preserveDrawingBuffer={true}
        mapStyle={{
          version: 8,
          sources: {},
          layers: [],
        }}
      >
        <TerrainSources source={source} />
        <RasterSource terrainSource={state.terrainSource} terrainRasterUrls={terrainRasterUrls} />
        <RasterLayer showTerrain={state.showTerrain} terrainOpacity={state.terrainOpacity} />
        <HillshadeLayer showHillshade={state.showHillshade} hillshadePaint={hillshadePaint} />
        <ColorReliefLayer showColorRelief={state.showColorRelief} colorReliefPaint={colorReliefPaint} />

        {contoursInitialized && mapId === "map-a" && <ContourLayers showContours={state.showContours} />}

        {mapId === "map-a" && (
          <>
            <GeocoderControl position="top-left" placeholder="Search and press Enter" />
            <NavigationControl position="top-left" />
            <GeolocateControl position="top-left" />
          </>
        )}
      </Map>
    )
  }

  if (!mapLibreReady) {
    return (
      <div className="relative h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <div className="text-lg font-medium">Loading MapLibre GL...</div>
          <div className="text-sm text-muted-foreground">Please wait</div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-full">
      <div className="absolute inset-0 flex">
        <div className={state.splitScreen ? "flex-1" : "w-full"}>
          {renderMap(state.sourceA as TerrainSource, "map-a")}
        </div>
        {state.splitScreen && <div className="flex-1">{renderMap(state.sourceB as TerrainSource, "map-b")}</div>}
      </div>
      <TerrainControls state={state} setState={setState} getMapBounds={getMapBounds} mapRef={mapARef} />
    </div>
  )
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: Number.parseInt(result[1], 16),
        g: Number.parseInt(result[2], 16),
        b: Number.parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}
