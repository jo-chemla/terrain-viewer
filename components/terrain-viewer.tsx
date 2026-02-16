"use client"

import { useCallback, useEffect, useRef, useState, memo } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat } from "nuqs"
import Map, {
  Source,
  Layer,
  NavigationControl,
  GeolocateControl,
  SkySpecification,
  ScaleControl,
  type MapRef,
  type LayerSpecification,
} from "react-map-gl/maplibre"
import "@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css"
import { TerrainControlPanel } from "./TerrainControlPanel/TerrainControlPanel"
import GeocoderControl from "./geocoder-control"
import { terrainSources } from "@/lib/terrain-sources"
import { colorRampsFlat, remapColorRampStops } from "@/lib/color-ramps"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import mlcontour from "maplibre-contour"
import { useAtom } from "jotai"
import {
  mapboxKeyAtom, maptilerKeyAtom, customTerrainSourcesAtom, titilerEndpointAtom, useCogProtocolVsTitilerAtom, skyConfigAtom, customBasemapSourcesAtom,
} from "@/lib/settings-atoms"
import { themeAtom } from "@/lib/settings-atoms"

import maplibregl, { type RasterDEMSourceSpecification } from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { GeoGrid } from 'geogrid-maplibre-gl';
import * as MaplibreGrid from 'maplibre-grid';


import { TerrainSources, RasterBasemapSource } from "./MapSources"
import {
  RasterLayer,
  BackgroundLayer,
  HillshadeLayer,
  ColorReliefLayer,
  ContourLayers,
  contourLinesLayerDef,
  contourLabelsLayerDef
} from "./MapLayers"


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
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)

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
    showBackground: parseAsBoolean.withDefault(false),
    rasterBasemapOpacity: parseAsFloat.withDefault(1.0),
    basemapSource: parseAsString.withDefault("esri"),
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
    customHypsoMinMax: parseAsBoolean.withDefault(false),
    customMin: parseAsFloat.withDefault(0),
    customMax: parseAsFloat.withDefault(8100),
  })

  // This could be renamed ephemeralState, stores backgroundLayerActive, sky etc
  const [skyConfig, setSkyConfig] = useAtom(skyConfigAtom)

  // Compute hillshade paint with useMemo to prevent recalculation
  const hillshadePaint = (() => {
    const paint: any = {}

    const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
    const supportsIlluminationAltitude = ["combined", "basic"].includes(state.hillshadeMethod)
    const supportsShadowColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
    const supportsHighlightColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
    const supportsAccentColor = state.hillshadeMethod === "standard"
    const supportsExaggeration = [
      "standard",
      "combined",
      "multidirectional",
      "multidir-colors",
      "aspect-multidir",
    ].includes(state.hillshadeMethod)

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
  })()

  const colorReliefPaint = (() => {
    const ramp = colorRampsFlat[state.colorRamp]
    if (!ramp) return {}

    let colors
    if (state.customHypsoMinMax) {
      colors = remapColorRampStops(
        ramp.colors,
        state.customMin,
        state.customMax
      )
    } else {
      colors = ramp.colors
    }
    return {
      "color-relief-opacity": state.colorReliefOpacity,
      "color-relief-color": colors,
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

        // // // WIP Try adding geogrid graticules

        // setTimeout(() => {
        //   const map2 = mapARef.current.getMap()
        //   const geogrid = new GeoGrid({
        //     map: map2,
        //     // beforeLayerId: 'labels',
        //     // gridStyle: {
        //     //   color: 'rgba(255, 255, 255, 0.5)',
        //     //   width: 2,
        //     //   dasharray: [5, 10]
        //     // },
        //     // labelStyle: {
        //     //   color: 'rgba(255, 255, 255, 0.5)',
        //     //   fontSize: '18',
        //     //   textShadow: '0 0 10px rgba(0, 0, 0)'
        //     // },
        //     zoomLevelRange: [0, 20],
        //     gridDensity: (zoomLevel) => 10,
        //     // formatLabels: (degreesFloat) => Math.floor(degreesFloat).toString()
        //   });
        //   console.log('geogrid initialized')
        //   // // On some event
        //   // geogrid.remove();
        //   // // On another event
        //   // geogrid.add();
        //   // console.log(('geogrid re-added'))
        //   // const grid = new MaplibreGrid.Grid({
        //   //   gridWidth: 10,
        //   //   gridHeight: 10,
        //   //   units: 'degrees',
        //   //   paint: {
        //   //     'line-opacity': 1,
        //   //     'line-color': 'red',
        //   //     'line-width': 10
        //   //   }
        //   // });
        //   // map.addControl(grid);
        // }, 5000)


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
  }, [
    contoursInitialized,
    mapLibreReady,
    mapsLoaded,
    state.sourceA,
    state.contourMinor,
    state.contourMajor,
    mapboxKey,
    maptilerKey,
  ])


  useEffect(() => {
    const map = mapARef.current?.getMap();
    if (!map) return;

    // More dirty, remove layer, then source, then re-add, but will update state properly
    if (map.getLayer("contour-labels")) {
      map.removeLayer("contour-labels")
    }
    if (map.getLayer("contour-lines")) {
      map.removeLayer("contour-lines")
    }
    if (map.getSource("contour-source")) {
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
    });
    map.addLayer(contourLinesLayerDef(state.showContours))
    map.addLayer(contourLabelsLayerDef(state.showContours))

  }, [state.contourMinor, state.contourMajor])


  // Register the COG protocol on the same maplibregl instance used by the Map component.
  useEffect(() => {
    maplibregl.addProtocol('cog', cogProtocol)
    console.log("[COG] maplibre-cog-protocol registered")
  }, []);


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
            lat: Number.parseFloat(evt.viewState.latitude.toFixed(4)),
            lng: Number.parseFloat(evt.viewState.longitude.toFixed(4)),
            zoom: Number.parseFloat(evt.viewState.zoom.toFixed(2)),
            pitch: Number.parseFloat(evt.viewState.pitch.toFixed(1)),
            bearing: Number.parseFloat(evt.viewState.bearing.toFixed(1)),
          }
          setState(newState, { shallow: true })
        }, 500)
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
        bearing: 0,
        pitch: 0,
        duration: 500
      });
    }
  }, [state.viewMode]);

  const [theme, _] = useAtom(themeAtom)
  const themeColor = theme === 'light' ? '#ffffff' : '#000000'

  const getSkyConfig = () => ({
    'sky-color': skyConfig.skyColor,
    'sky-horizon-blend': skyConfig.skyHorizonBlend,
    'horizon-color': skyConfig.horizonColor,
    'horizon-fog-blend': skyConfig.horizonFogBlend,
    'fog-color': skyConfig.fogColor,
    'fog-ground-blend': skyConfig.fogGroundBlend
  })
  const getNoSkyConfig = () => ({
    'sky-color': themeColor,
    'sky-horizon-blend': 0,
    'horizon-fog-blend': 1,
    'fog-ground-blend': 1
  })

  const sky: SkySpecification = getSkyConfig()

  const renderMap = useCallback(
    (source: TerrainSource | string, mapId: string) => {
      const isPrimary = mapId === "map-a"

      return (
        <Map
          ref={isPrimary ? mapARef : mapBRef}
          // mapLib={(window as any).maplibregl}
          mapLib={maplibregl}
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

            [mapARef, mapBRef].forEach((mapRef) =>
              mapRef?.current?.getMap().setTerrain({
                source: "terrainSource",
                exaggeration: state.exaggeration || 1,
              })
            )
          }}
          sky={state.showBackground ? getSkyConfig() : getNoSkyConfig()}
          // sky={undefined}
          minPitch={0}
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
        >
          {/* Sources */}
          <TerrainSources
            source={source}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            customTerrainSources={customTerrainSources}
            titilerEndpoint={titilerEndpoint}
          />
          {/* <RasterBasemapSource terrainSource={state.terrainSource} mapboxKey={mapboxKey} /> */}
          <RasterBasemapSource
            basemapSource={state.basemapSource}
            mapboxKey={mapboxKey}
            customBasemapSources={customBasemapSources}
            titilerEndpoint={titilerEndpoint}
          />

          {/* Layers */}
          {skyConfig.backgroundLayerActive && <BackgroundLayer theme={theme} mapRef={mapARef} />}
          <RasterLayer showRasterBasemap={state.showRasterBasemap} rasterBasemapOpacity={state.rasterBasemapOpacity} />
          <HillshadeLayer showHillshade={state.showHillshade} hillshadePaint={hillshadePaint} />
          <ColorReliefLayer showColorRelief={state.showColorRelief} colorReliefPaint={colorReliefPaint} />
          {contoursInitialized && isPrimary && <ContourLayers showContours={state.showContours} />}

          {isPrimary && (
            <>
              <GeocoderControl position="top-left" placeholder="Search and press Enter" marker={false} showResultsWhileTyping={true} zoom={14} flyTo={{ speed: 5 }} showResultMarkers={false} limit={10} minLength={3} />
              {/* flyToSpeed={10}  */}
              <NavigationControl position="top-left" />
              <GeolocateControl position="top-left" />
              <ScaleControl position="bottom-left" unit="metric" maxWidth={250} />
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
    state.basemapSource,
    state.showRasterBasemap,
    state.rasterBasemapOpacity,
    state.showHillshade,
    state.showColorRelief,
    state.showContours,
    state.showBackground,
    hillshadePaint,
    colorReliefPaint,
    mapboxKey,
    maptilerKey,
    contoursInitialized,
    customBasemapSources,
    titilerEndpoint,
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
          {renderMap(state.sourceA as TerrainSource | string, "map-a")}
        </div>
        {state.splitScreen && (
          <div className="flex-1">{renderMap(state.sourceB as TerrainSource | string, "map-b")}</div>
        )}
      </div>
      <TerrainControlPanel state={state} setState={setState} getMapBounds={getMapBounds} mapRef={mapARef} />
    </div>
  )
}
