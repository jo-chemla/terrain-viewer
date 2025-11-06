"use client"

import { useCallback, useEffect, useRef, useState, memo } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat } from "nuqs"
import Map, { Source, Layer, NavigationControl, GeolocateControl, type MapRef } from "react-map-gl/maplibre"
import "@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css"
import { TerrainControls } from "./terrain-controls"
import { GeocoderControl } from "./geocoder-control"
import { terrainSources } from "@/lib/terrain-sources"
import { colorRamps } from "@/lib/color-ramps"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import mlcontour from "maplibre-contour"
import { useAtom } from "jotai"
import { mapboxKeyAtom, maptilerKeyAtom } from "@/lib/settings-atoms"

// Memoized Sources Component - loads once per source change
const TerrainSources = memo(({
  source,
  mapboxKey,
  maptilerKey
}: {
  source: TerrainSource
  mapboxKey: string
  maptilerKey: string
}) => {
  const getTilesUrl = (key: TerrainSource) => {
    const sourceConfig: TerrainSourceConfig = terrainSources[key]
    let tileUrl = sourceConfig.sourceConfig.tiles[0] || ""
    if (key === 'mapbox') {
      tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
    } else if (key === 'maptiler') {
      tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
    }
    return tileUrl
  }

  const sourceConfig = { ...terrainSources[source].sourceConfig }
  sourceConfig.tiles = [getTilesUrl(source)]

  return (
    <>
      <Source id="terrainSource" key={`terrain-${source}`} {...sourceConfig} />
      <Source id="hillshadeSource" key={`hillshade-${source}`} {...sourceConfig} />
    </>
  )
})
TerrainSources.displayName = "TerrainSources"

// Memoized Raster Source
const RasterBasemapSource = memo(({
  terrainSource,
  mapboxKey
}: {
  terrainSource: string
  mapboxKey: string
}) => {
  const terrainRasterUrls: Record<string, string> = {
    osm: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
    googlesat: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    google: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    esri: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    mapbox: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=${mapboxKey || "pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw"}`,
    bing: `https://t0.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=854&mkt=en-US&token=Atq2nTytWfkqXjxxCDSsSPeT3PXjAl_ODeu3bnJRN44i3HKXs2DDCmQPA5u0M9z1`,
  }

  return (
    <Source
      id="terrain-raster-source"
      key={`raster-${terrainSource}`}
      type="raster"
      tiles={[terrainRasterUrls[terrainSource] || terrainRasterUrls.google]}
      tileSize={256}
    />
  )
})
RasterBasemapSource.displayName = "RasterBasemapSource"

// Memoized Raster Layer
const RasterLayer = memo(({
  showRasterBasemap,
  rasterBasemapOpacity
}: {
  showRasterBasemap: boolean
  rasterBasemapOpacity: number
}) => {
  return (
    <Layer
      id="terrain-raster"
      type="raster"
      source="terrain-raster-source"
      paint={{
        "raster-opacity": rasterBasemapOpacity,
      }}
      layout={{
        visibility: showRasterBasemap ? "visible" : "none",
      }}
    />
  )
})
RasterLayer.displayName = "RasterLayer"

// Memoized Hillshade Layer
const HillshadeLayer = memo(({
  showHillshade,
  hillshadePaint
}: {
  showHillshade: boolean
  hillshadePaint: any
}) => {
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

// Memoized Color Relief Layer
const ColorReliefLayer = memo(({
  showColorRelief,
  colorReliefPaint
}: {
  showColorRelief: boolean
  colorReliefPaint: any
}) => {
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
})
ColorReliefLayer.displayName = "ColorReliefLayer"

// Memoized Contour Layers
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : { r: 0, g: 0, b: 0 }
}

export function TerrainViewer() {
  const mapARef = useRef<MapRef>(null)
  const mapBRef = useRef<MapRef>(null)
  const isSyncing = useRef(false)
  const [mapLibreReady, setMapLibreReady] = useState(false)
  const [contoursInitialized, setContoursInitialized] = useState(false)
  const demSourceRef = useRef<any>(null)
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const initAttemptsRef = useRef(0)
  const viewStateUpdateTimer = useRef<NodeJS.Timeout | null>(null)

  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)

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
    showRasterBasemap: parseAsBoolean.withDefault(false),
    rasterBasemapOpacity: parseAsFloat.withDefault(1.0),
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
  })

  // Compute hillshade paint with useMemo to prevent recalculation
  const hillshadePaint = (() => {
    const paint: any = {}

    const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
    const supportsIlluminationAltitude = ["combined", "basic"].includes(state.hillshadeMethod)
    const supportsShadowColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
    const supportsHighlightColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
    const supportsAccentColor = state.hillshadeMethod === "standard"
    const supportsExaggeration = ["standard", "combined", "multidirectional", "multidir-colors", "aspect-multidir"].includes(state.hillshadeMethod)

    if (state.hillshadeMethod === "multidirectional") {
      paint["hillshade-method"] = "multidirectional"
      paint["hillshade-exaggeration"] = 0.5
    } else if (state.hillshadeMethod === "multidir-colors") {
      paint["hillshade-method"] = "multidirectional"
      paint["hillshade-highlight-color"] = ["#FF4000", "#FFFF00", "#40ff00", "#00FF80"]
      paint["hillshade-shadow-color"] = ["#00bfff", "#0000ff", "#bf00ff", "#FF0080"]
      paint["hillshade-illumination-direction"] = [270, 315, 0, 45]
      paint["hillshade-illumination-altitude"] = [30, 30, 30, 30]
    } else if (state.hillshadeMethod === "aspect-multidir") {
      paint["hillshade-method"] = "multidirectional"
      paint["hillshade-highlight-color"] = ["#CC0000", "#0000CC"]
      paint["hillshade-shadow-color"] = ["#00CCCC", "#CCCC00"]
      paint["hillshade-illumination-direction"] = [0, 270]
      paint["hillshade-illumination-altitude"] = [30, 30]
    } else {
      if (supportsIlluminationDirection) {
        paint["hillshade-illumination-direction"] = state.illuminationDir
      }
      if (supportsShadowColor) {
        const shadowRgb = hexToRgb(state.shadowColor)
        paint["hillshade-shadow-color"] = `rgba(${shadowRgb.r}, ${shadowRgb.g}, ${shadowRgb.b}, ${state.hillshadeOpacity})`
      }
      if (supportsHighlightColor) {
        const highlightRgb = hexToRgb(state.highlightColor)
        paint["hillshade-highlight-color"] = `rgba(${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}, ${state.hillshadeOpacity})`
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
  })()

  const colorReliefPaint = (() => {
    const ramp = colorRamps[state.colorRamp]
    if (!ramp) return {}

    return {
      "color-relief-opacity": state.colorReliefOpacity,
      "color-relief-color": ramp.colors,
    }
  })()

  // Check MapLibre availability
  useEffect(() => {
    const checkMapLibre = () => {
      if (typeof window !== "undefined" && (window as any).maplibregl) {
        console.log("[TerrainViewer] MapLibre ready")
        setMapLibreReady(true)
      } else {
        setTimeout(checkMapLibre, 100)
      }
    }
    checkMapLibre()
  }, [])

  // Initialize contours - FIXED with proper checks
  useEffect(() => {
    const initContours = async () => {
      // Wait for all dependencies
      if (!mapARef.current || !mapLibreReady || !mapsLoaded) {
        console.log("[Contours] Waiting for dependencies:", {
          hasMapRef: !!mapARef.current,
          mapLibreReady,
          mapsLoaded
        })
        return
      }

      // Check if already initialized
      if (contoursInitialized) {
        console.log("[Contours] Already initialized")
        return
      }

      // Check attempt limit
      if (initAttemptsRef.current >= 5) {
        console.error("[Contours] Failed after 5 attempts")
        return
      }

      initAttemptsRef.current += 1
      console.log("[Contours] Initializing (attempt", initAttemptsRef.current, ")...")

      try {
        const map = mapARef.current.getMap()

        // Wait for map to be fully loaded and styled
        if (!map.isStyleLoaded()) {
          console.log("[Contours] Waiting for style to load...")
          setTimeout(() => setContoursInitialized(false), 1000)
          return
        }

        const maplibregl = (window as any).maplibregl
        if (!maplibregl) {
          console.error("[Contours] maplibregl not available")
          return
        }

        const source = terrainSources[state.sourceA as TerrainSource]
        if (!source?.sourceConfig?.tiles?.[0]) {
          console.error("[Contours] No source tiles")
          return
        }

        // Get DemSource constructor
        let DemSource = mlcontour.DemSource || (mlcontour as any).default?.DemSource
        if (!DemSource && typeof mlcontour === "function") {
          DemSource = mlcontour as any
        }

        if (!DemSource || typeof DemSource !== "function") {
          console.error("[Contours] DemSource not found")
          return
        }

        // Get tile URL with API keys
        let tileUrl = source.sourceConfig.tiles[0]
        if (state.sourceA === 'mapbox') {
          tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
        } else if (state.sourceA === 'maptiler') {
          tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
        }

        console.log("[Contours] Creating DemSource with URL:", tileUrl)

        demSourceRef.current = new DemSource({
          url: tileUrl,
          encoding: source.encoding === "terrainrgb" ? "mapbox" : "terrarium",
          maxzoom: source.sourceConfig.maxzoom || 14,
          worker: true,
          cacheSize: 100,
          timeoutMs: 10000,
        })

        demSourceRef.current.setupMaplibre(maplibregl)

        // Remove existing source if present
        if (map.getSource("contour-source")) {
          console.log("[Contours] Removing existing source")
          if (map.getLayer("contour-lines")) map.removeLayer("contour-lines")
          if (map.getLayer("contour-labels")) map.removeLayer("contour-labels")
          map.removeSource("contour-source")
        }

        // Add contour source
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

        console.log("[Contours] Initialized successfully")
        setContoursInitialized(true)
      } catch (error) {
        console.error("[Contours] Initialization error:", error)
        // Retry after delay
        setTimeout(() => {
          if (initAttemptsRef.current < 5) {
            setContoursInitialized(false)
          }
        }, 2000)
      }
    }

    // Trigger initialization with delay to ensure map is ready
    if (mapsLoaded && !contoursInitialized && initAttemptsRef.current < 5) {
      const timer = setTimeout(initContours, 1000)
      return () => clearTimeout(timer)
    }
  }, [contoursInitialized, mapLibreReady, mapsLoaded, state.sourceA, state.contourMinor, state.contourMajor, mapboxKey, maptilerKey])

  // Sync maps in split screen
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
    [state.splitScreen]
  )

  // Update URL with debounce to avoid excessive re-renders
  const onMoveEndA = useCallback(
    (evt: any) => {
      if (!isSyncing.current) {
        // Clear existing timer
        if (viewStateUpdateTimer.current) {
          clearTimeout(viewStateUpdateTimer.current)
        }

        // Debounce URL update
        viewStateUpdateTimer.current = setTimeout(() => {
          const newState = {
            lat: parseFloat(evt.viewState.latitude.toFixed(4)),
            lng: parseFloat(evt.viewState.longitude.toFixed(4)),
            zoom: parseFloat(evt.viewState.zoom.toFixed(2)),
            pitch: parseFloat(evt.viewState.pitch.toFixed(1)),
            bearing: parseFloat(evt.viewState.bearing.toFixed(1)),
          }
          setState(newState, { shallow: true })
        }, 500) // Update URL 500ms after movement stops
      }
    },
    [setState]
  )

  const getMapBounds = useCallback(() => {
    if (!mapARef.current) return { west: -180, south: -90, east: 180, north: 90 }
    const bounds = mapARef.current.getMap().getBounds()
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }
  }, [])

  // Reset to north-up 2D view when switching to 2D mode frmo free rotation in 3D
  useEffect(() => {
    if (mapARef.current && state.viewMode === "2d") {
      const map = mapARef.current.getMap();

      map.easeTo({
        bearing: 0,   // North up
        pitch: 0,     // Flat
        duration: 500 // Smooth transition
      });
    }
  }, [state.viewMode]);

  const renderMap = useCallback((source: TerrainSource, mapId: string) => {
    const isPrimary = mapId === "map-a"

    return (
      <Map
        ref={isPrimary ? mapARef : mapBRef}
        mapLib={(window as any).maplibregl}
        initialViewState={{
          latitude: state.lat,
          longitude: state.lng,
          zoom: state.zoom,
          pitch: state.viewMode === "2d" ? 0 : state.pitch,
          bearing: state.viewMode === "2d" ? 0 : state.bearing,
        }}
        onMove={isPrimary ? onMoveA : undefined}
        onMoveEnd={isPrimary ? onMoveEndA : undefined}
        onLoad={() => {
          if (isPrimary) {
            console.log("[TerrainViewer] Map A loaded")
            setMapsLoaded(true)
          }

          [mapARef, mapBRef].forEach(
            mapRef => mapRef?.current?.getMap().setTerrain({
              source: "terrainSource",
              exaggeration: state.exaggeration || 1,
            })
          )
        }}
        sky={{
          'sky-horizon-blend': 0.2,
          'horizon-fog-blend': 0.9,
          'fog-ground-blend': 0.5
        }}
        maxPitch={state.viewMode === "2d" ? 0 : 85}
        rollEnabled={state.viewMode !== "2d"}
        pitchWithRotate={state.viewMode !== "2d"}
        dragRotate={state.viewMode !== "2d"}
        touchZoomRotate={state.viewMode !== "2d"}
        terrain={{
          source: "terrainSource",
          exaggeration: state.exaggeration || 1,
        }}
        projection={state.viewMode === "globe" ? "globe" : "mercator"}
        canvasContextAttributes={{
          preserveDrawingBuffer: true,
        }}
      // mapStyle={{
      //   version: 8,
      //   sources: {},
      //   layers: [],
      // }}
      >
        <TerrainSources source={source} mapboxKey={mapboxKey} maptilerKey={maptilerKey} />
        <RasterBasemapSource terrainSource={state.terrainSource} mapboxKey={mapboxKey} />
        <RasterLayer showRasterBasemap={state.showRasterBasemap} rasterBasemapOpacity={state.rasterBasemapOpacity} />
        <HillshadeLayer showHillshade={state.showHillshade} hillshadePaint={hillshadePaint} />
        <ColorReliefLayer showColorRelief={state.showColorRelief} colorReliefPaint={colorReliefPaint} />

        {contoursInitialized && isPrimary && <ContourLayers showContours={state.showContours} />}

        {
          isPrimary && (
            <>
              <GeocoderControl position="top-left" placeholder="Search and press Enter" />
              <NavigationControl position="top-left" />
              <GeolocateControl position="top-left" />
            </>
          )
        }
      </Map >
    )
  }, [
    state.lat,
    state.lng,
    state.zoom,
    state.pitch,
    state.bearing,
    state.viewMode,
    state.exaggeration,
    state.terrainSource,
    state.showRasterBasemap,
    state.rasterBasemapOpacity,
    state.showHillshade,
    state.showColorRelief,
    state.showContours,
    hillshadePaint,
    colorReliefPaint,
    mapboxKey,
    maptilerKey,
    contoursInitialized,
    onMoveA,
    onMoveEndA,
  ])

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
        {state.splitScreen && (
          <div className="flex-1">
            {renderMap(state.sourceB as TerrainSource, "map-b")}
          </div>
        )}
      </div>
      <TerrainControls
        state={state}
        setState={setState}
        getMapBounds={getMapBounds}
        mapRef={mapARef}
      />
    </div>
  )
}