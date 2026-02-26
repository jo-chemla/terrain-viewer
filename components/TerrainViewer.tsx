"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat, parseAsStringLiteral } from "nuqs"
import Map, {
  NavigationControl,
  GeolocateControl,
  type MapRef,
  type SkySpecification,
  ScaleControl,
} from "react-map-gl/maplibre"
import { TerrainControlPanel } from "./TerrainControlPanel/TerrainControlPanel"
import { DEFAULT_ANIM_STATE, type AnimState, LOOP_MODES } from "./TerrainControlPanel/CameraUtilities"

import GeocoderControl from "./MapControls/GeocoderControl"
import { terrainSources } from "@/lib/terrain-sources"
import { COLOR_RAMP_IDS, colorRampsFlat, remapColorRampStops } from "@/lib/color-ramps"
import {HILLSHADE_METHODS, type TerrainSource } from "@/lib/terrain-types"
import { useAtom } from "jotai"
import {
  mapboxKeyAtom, maptilerKeyAtom, customTerrainSourcesAtom, titilerEndpointAtom, skyConfigAtom, customBasemapSourcesAtom, themeAtom, highResTerrainAtom
} from "@/lib/settings-atoms"
import { MinimapControl } from "./MapControls/MinimapControl";
import { useIsMobile } from '@/hooks/use-mobile'

import maplibregl from 'maplibre-gl'
import { cogProtocol } from '@geomatico/maplibre-cog-protocol'

import { TerrainSources, RasterBasemapSource } from "./LayersAndSources/MapSources"
import {
  LayerOrderSlots, 
  RasterLayer,
  BackgroundLayer,
  HillshadeLayer,
  ColorReliefLayer,
  LAYER_SLOTS,
} from "./LayersAndSources/MapLayers"
import { ContoursLayer } from "./LayersAndSources/ContoursLayer"
import { GraticuleLayer } from "./LayersAndSources/GraticuleLayer"

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

import { createParser } from 'nuqs'

const parseAsFloatPrecise = createParser({
  parse: (value) => {
    const num = parseFloat(value)
    return isNaN(num) ? null : parseFloat(num.toFixed(6)) // 4 decimals
  },
  serialize: (value) => value.toFixed(4)
})

export const VIEW_MODES = ['2d', 'globe', '3d'] as const

export function TerrainViewer() {
  const mapARef = useRef<MapRef>(null)
  const mapBRef = useRef<MapRef>(null)
  const isSyncing = useRef(false)
  const [mapLibreReady, setMapLibreReady] = useState(false)
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const viewStateUpdateTimer = useRef<NodeJS.Timeout | null>(null)
  const isMobile = useIsMobile()

  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [highResTerrain] = useAtom(highResTerrainAtom)

  const [state, setState] = useQueryStates({
    viewMode: parseAsStringLiteral(VIEW_MODES).withDefault("3d"),
    splitScreen: parseAsBoolean.withDefault(false),
    sourceA: parseAsString.withDefault("mapterhorn"), // can have custom id in addition to @/lib/terrain-sources
    sourceB: parseAsString.withDefault("maptiler"),   // can have custom id in addition to @/lib/terrain-sources
    basemapSource: parseAsString.withDefault("esri"), // can have custom id in addition to @/lib/terrain-sources
    // colorRamp: parseAsString.withDefault("mby"),
    colorRamp: parseAsStringLiteral(COLOR_RAMP_IDS).withDefault("mby"),
    showHillshade: parseAsBoolean.withDefault(true),
    hillshadeOpacity: parseAsFloat.withDefault(1.0),
    showColorRelief: parseAsBoolean.withDefault(false),
    colorReliefOpacity: parseAsFloat.withDefault(0.35),
    showContoursAndGraticules: parseAsBoolean.withDefault(false),
    showContours: parseAsBoolean.withDefault(true),
    showContourLabels: parseAsBoolean.withDefault(true),
    showGraticules: parseAsBoolean.withDefault(false),
    showRasterBasemap: parseAsBoolean.withDefault(false),
    showBackground: parseAsBoolean.withDefault(false),
    rasterBasemapOpacity: parseAsFloat.withDefault(1.0),
    exaggeration: parseAsFloat.withDefault(1),
    lat: parseAsFloat.withDefault(45.9763),
    lng: parseAsFloat.withDefault(7.6586),
    zoom: parseAsFloat.withDefault(12.5),
    // -- try getting out of pitch 0 loop in 3d
    // pitch: parseAsFloat.withDefault(60.001),
    pitch: parseAsFloatPrecise.withDefault(60),
    bearing: parseAsFloat.withDefault(0),
    // --
    hillshadeMethod: parseAsStringLiteral(HILLSHADE_METHODS).withDefault("combined"),
    illuminationDir: parseAsFloat.withDefault(315),
    illuminationAlt: parseAsFloat.withDefault(45),
    shadowColor: parseAsString.withDefault("#000000"),
    highlightColor: parseAsString.withDefault("#FFFFFF"),
    accentColor: parseAsString.withDefault("#808080"),
    graticuleColor: parseAsString.withDefault("#cccccc"),
    hillshadeExag: parseAsFloat.withDefault(1.0),
    contourMinor: parseAsFloat.withDefault(50),
    contourMajor: parseAsFloat.withDefault(200),
    customHypsoMinMax: parseAsBoolean.withDefault(false),
    minElevation: parseAsFloat.withDefault(0),
    maxElevation: parseAsFloat.withDefault(8100),
    hypsoSliderMinBound: parseAsFloat.withDefault(0),
    hypsoSliderMaxBound: parseAsFloat.withDefault(8100),
    graticuleWidth: parseAsFloat.withDefault(1.0),
    showGraticuleLabels: parseAsBoolean.withDefault(false),
    graticuleDensity: parseAsFloat.withDefault(0),
    minimapMinimized: parseAsBoolean.withDefault(true),
    animDuration: parseAsFloat.withDefault(3),
    animLoopMode: parseAsStringLiteral(LOOP_MODES).withDefault("bounce"),
    animSmoothCamera: parseAsBoolean.withDefault(false),
  })

  const [skyConfig] = useAtom(skyConfigAtom)

  // Sync URL state with animState
  const [animState, setAnimState] = useState<AnimState>({
    ...DEFAULT_ANIM_STATE,
    durationSec: state.animDuration,
    loopMode: state.animLoopMode as "none" | "forward" | "bounce",
    smoothCamera: state.animSmoothCamera,
  })

  // Update animState when URL params change
  useEffect(() => {
    setAnimState(prev => ({
      ...prev,
      durationSec: state.animDuration,
      loopMode: state.animLoopMode as "none" | "forward" | "bounce",
      smoothCamera: state.animSmoothCamera,
    }))
  }, [state.animDuration, state.animLoopMode, state.animSmoothCamera])

  // Custom setAnimState that syncs back to URL
  const setAnimStateWithSync = useCallback((updater: React.SetStateAction<AnimState>) => {
    setAnimState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      
      // Sync relevant fields back to URL
      const updates: any = {}
      if (next.durationSec !== prev.durationSec) updates.animDuration = next.durationSec
      if (next.loopMode !== prev.loopMode) updates.animLoopMode = next.loopMode
      if (next.smoothCamera !== prev.smoothCamera) updates.animSmoothCamera = next.smoothCamera
      
      if (Object.keys(updates).length > 0) {
        setState(updates, { shallow: true })
      }
      
      return next
    })
  }, [setState])

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
      if (supportsIlluminationDirection) paint["hillshade-illumination-direction"] = state.illuminationDir
      if (supportsShadowColor) {
        const shadowRgb = hexToRgb(state.shadowColor)
        paint["hillshade-shadow-color"] = `rgba(${shadowRgb.r}, ${shadowRgb.g}, ${shadowRgb.b}, ${state.hillshadeOpacity})`
      }
      if (supportsHighlightColor) {
        const highlightRgb = hexToRgb(state.highlightColor)
        paint["hillshade-highlight-color"] = `rgba(${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}, ${state.hillshadeOpacity})`
      }
      if (supportsIlluminationAltitude) paint["hillshade-illumination-altitude"] = state.illuminationAlt
      if (supportsExaggeration) paint["hillshade-exaggeration"] = state.hillshadeExag
      if (supportsAccentColor) paint["hillshade-accent-color"] = state.accentColor
      if (state.hillshadeMethod !== "standard") paint["hillshade-method"] = state.hillshadeMethod
    }

    // paint["resampling"] = 'linear' 
    paint["hillshade-illumination-anchor"] = 'map' 

    return paint
  })()

  const colorReliefPaint = (() => {
    const ramp = colorRampsFlat[state.colorRamp]
    if (!ramp) return {}

    let colors
    if (state.customHypsoMinMax) {
      colors = remapColorRampStops(ramp.colors, state.minElevation, state.maxElevation)
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
    setMapLibreReady(true)
  }, [])

  // Register the COG protocol
  useEffect(() => {
    maplibregl.addProtocol('cog', cogProtocol)
    
  }, [])


  // Handle dynamic viewport height for mobile browsers
  useEffect(() => {
    if (!isMobile) return

    const setVH = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }

    setVH()
    window.addEventListener('resize', setVH)
    window.addEventListener('orientationchange', setVH)

    return () => {
      window.removeEventListener('resize', setVH)
      window.removeEventListener('orientationchange', setVH)
    }
  }, [isMobile])

  const onMoveA = useCallback((evt: any) => {
    if (!isSyncing.current && state.splitScreen && mapBRef.current) {
      isSyncing.current = true
      mapBRef.current.getMap().jumpTo({
        center: [evt.viewState.longitude, evt.viewState.latitude],
        zoom: evt.viewState.zoom,
        bearing: evt.viewState.bearing,
        pitch: evt.viewState.pitch,
      })
      setTimeout(() => { isSyncing.current = false }, 50)
    }
  }, [state.splitScreen])

  const onMoveEndA = useCallback((evt: any) => {
    if (!isSyncing.current) {
      if (viewStateUpdateTimer.current) clearTimeout(viewStateUpdateTimer.current)
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
  }, [setState])

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

  // Reset to north-up 2D view when switching to 2D mode
  useEffect(() => {
    if (mapARef.current && state.viewMode === "2d") {
      const map = mapARef.current.getMap()
      map.easeTo({ bearing: 0, pitch: 0, duration: 500 })
    }
  }, [state.viewMode])

  const [theme] = useAtom(themeAtom)
  const themeColor = theme === 'light' ? '#fff' : '#000'
  const themeAntiColor = theme === 'light' ? '#000' : '#fff'

  const getSkyConfig = () => ({
    'sky-color': skyConfig.skyColor,
    'sky-horizon-blend': skyConfig.skyHorizonBlend,
    'horizon-color': skyConfig.horizonColor,
    'horizon-fog-blend': skyConfig.horizonFogBlend,
    'fog-color': skyConfig.fogColor,
    'fog-ground-blend': skyConfig.fogGroundBlend,
  })

  const getNoSkyConfig = () => ({
    'sky-color': themeColor,
    'sky-horizon-blend': 0,
    'horizon-fog-blend': 1,
    'fog-ground-blend': 1,
  })

  const graticuleLabelColor = themeAntiColor
  const graticuleLabelTextShadow = [
    '-1px -1px 0', '1px -1px 0',
    '-1px 1px 0', '1px 1px 0',
    '-2px 0 0', '2px 0 0',
    '0 -2px 0', '0 2px 0',
  ].map((shadow) => shadow + themeColor).join(', ')

  useEffect(() => {
    if (themeColor) setState({ graticuleColor: themeColor })
  }, [themeColor])

  // Handle terrain source changes and sync terrain with view mode changes
  const applyTerrain = useCallback((map: maplibregl.Map) => {
    const apply = () => {
      if (map.getSource('terrainSource')) {
        map.setTerrain({
          source: 'terrainSource',
          exaggeration: state.exaggeration || 1,
        })
        map.off('sourcedata', apply)
      }
    }
    if (map.getSource('terrainSource')) {
      map.setTerrain({ source: 'terrainSource', exaggeration: state.exaggeration || 1 })
    } else {
      map.on('sourcedata', apply)
    }
  }, [state.exaggeration])

  // Sync terrain when exaggeration, source, or highResTerrain changes
  useEffect(() => {
    const map = mapARef.current?.getMap()
    if (!map || !mapsLoaded) return
    applyTerrain(map)
  }, [state.exaggeration, state.sourceA, highResTerrain, mapsLoaded, applyTerrain])

  // Also sync on viewMode changes (2d removes terrain, 3d/globe restores it)
  useEffect(() => {
    const map = mapARef.current?.getMap()
    if (!map || !mapsLoaded) return
    if (state.viewMode === '2d') {
      map.setTerrain(null)
    } else {
      applyTerrain(map)
    }
  }, [state.viewMode, mapsLoaded, applyTerrain])

  const renderMap = useCallback(
    (source: TerrainSource | string, mapId: string) => {
      const isPrimary = mapId === "map-a"

      return (
        <Map
          ref={isPrimary ? mapARef : mapBRef}
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
            if (isPrimary) setMapsLoaded(true)
            // const map = isPrimary ? mapARef.current : mapBRef.current
            // const mapInstance = map?.getMap()
            // if (!mapInstance) return
            // const applyTerrain = () => {
            //   if (mapInstance.getSource("terrainSource")) {
            //     mapInstance.setTerrain({
            //       source: "terrainSource",
            //       exaggeration: state.exaggeration || 1,
            //     })
            //     mapInstance.off('sourcedata', applyTerrain)
            //   }
            // }
            // mapInstance.on('sourcedata', applyTerrain)
            // applyTerrain()
          }}
          sky={state.showBackground ? getSkyConfig() : getNoSkyConfig()}
          minPitch={0}
          maxPitch={state.viewMode === "2d" ? 0 : 85}
          rollEnabled={state.viewMode !== "2d"}
          pitchWithRotate={state.viewMode !== "2d"}
          dragRotate={state.viewMode !== "2d"}
          // touchZoomRotate={state.viewMode !== "2d"}
          touchZoomRotate={true}
          // terrain={{
          //   source: "terrainSource",
          //   exaggeration: state.exaggeration || 1,
          // }}
          projection={state.viewMode === "globe" ? "globe" : "mercator"}
          canvasContextAttributes={{ preserveDrawingBuffer: true }}
          pixelRatio={window.devicePixelRatio * 1.5}  // supersample (default is 1×)
        >
          {/* Sources */}
          <TerrainSources
            source={source}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            customTerrainSources={customTerrainSources}
            titilerEndpoint={titilerEndpoint}
          />
          <RasterBasemapSource
            basemapSource={state.basemapSource}
            mapboxKey={mapboxKey}
            customBasemapSources={customBasemapSources}
            titilerEndpoint={titilerEndpoint}
          />

          {/* Layers */}
          <LayerOrderSlots />

          {skyConfig.backgroundLayerActive && (
            <BackgroundLayer theme={theme as any} mapRef={mapARef as any} />
          )}
          <RasterLayer
            showRasterBasemap={state.showRasterBasemap}
            rasterBasemapOpacity={state.rasterBasemapOpacity}
          />
          <ColorReliefLayer
            showColorRelief={state.showColorRelief}
            colorReliefPaint={colorReliefPaint}
          />
          <HillshadeLayer
            showHillshade={state.showHillshade}
            hillshadePaint={hillshadePaint}
          />

          {/* Contours — self-contained, primary map only */}
          {isPrimary && (
            <ContoursLayer
              showContours={state.showContoursAndGraticules && state.showContours}
              showContourLabels={state.showContourLabels}
              sourceId={state.sourceA}
              contourMinor={state.contourMinor}
              contourMajor={state.contourMajor}
              mapboxKey={mapboxKey}
              maptilerKey={maptilerKey}
              customTerrainSources={customTerrainSources}
              titilerEndpoint={titilerEndpoint}
              mapsLoaded={mapsLoaded}
              theme={theme}
            />
          )}

          {/* Graticules — primary map only */}
          {isPrimary && state.showGraticules && (
            <GraticuleLayer
              showGraticules={state.showContoursAndGraticules && state.showGraticules}
              graticuleColor={state.graticuleColor}
              graticuleWidth={state.graticuleWidth}
              showLabels={state.showGraticuleLabels}
              labelColor={graticuleLabelColor}
              labelTextShadow={graticuleLabelTextShadow}
              gridDensity={state.graticuleDensity || undefined}
              beforeLayerId={LAYER_SLOTS.CONTOURS}  
            />
          )}

          {isPrimary && (
            <>
              <GeocoderControl
                position="top-left"
                placeholder="Search and press Enter"
                marker={false}
                showResultsWhileTyping={true}
                zoom={14}
                flyTo={{ speed: 5 }}
                showResultMarkers={false}
                limit={10}
                minLength={3}
              />
              <NavigationControl position="top-left" />
              <GeolocateControl position="top-left" />

              {/* Minimap */}
              {mapsLoaded && mapARef.current && (<MinimapControl
                parentMap={mapARef.current.getMap()}
                position="bottom-left"
                mode="dynamic"
                initBounds={[[-150, -30], [150, 50]]}
                // mode="dynamic"
                zoomLevelOffset={-6}
                // mode="static" interactive = true only works in static mode 
                interactive={true}
                interactions={{
                  dragPan: true,
                  scrollZoom: true,
                  boxZoom: true,
                }}
                width={260}
                height={180}
                showFrustum={false}
                // showFootprint={true}
                minimized={state.minimapMinimized}
                onMinimizedChange={(v) => setState({ minimapMinimized: v })}
                footprintFillPaint={{
                  "fill-color": "#3b82f6",
                  "fill-opacity": 0.15,
                }}
                footprintLinePaint={{
                  "line-color": "#2563eb",
                  "line-width": 2.5,
                }}
                frustumFillPaint={{
                  "fill-color": "#f59e0b",
                  "fill-opacity": 0.2,
                }}
                frustumLinePaint={{
                  "line-color": "#ea580c",
                  "line-width": 2,
                  "line-dasharray": [3, 2],
                }}
                style={{
                  version: 8,
                  sources: {
                    basemap: {
                      type: "raster",
                      tiles: [
                        "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      ],
                      tileSize: 256,
                    },
                  },
                  layers: [
                    {
                      id: "basemap",
                      type: "raster",
                      source: "basemap",
                    },
                  ],
                }}
              />)} 

              
              <ScaleControl position="bottom-left" unit="metric" maxWidth={250} />

            </>
          )}
        </Map>
      )
    },
    [
      state.lat, state.lng, state.zoom, state.pitch, state.bearing, state.viewMode, state.exaggeration,
      state.basemapSource, state.showRasterBasemap, state.rasterBasemapOpacity, state.showHillshade,
      state.showColorRelief, state.showContours, state.showContoursAndGraticules, state.showContourLabels,
      state.showBackground, state.showGraticules, state.graticuleColor, state.graticuleWidth,
      state.sourceA, state.contourMinor, state.contourMajor,
      hillshadePaint, colorReliefPaint,
      mapboxKey, maptilerKey, customTerrainSources, customBasemapSources, titilerEndpoint,
      mapsLoaded, onMoveA, onMoveEndA,
      theme, skyConfig.backgroundLayerActive,
    ],
  )

  if (!mapLibreReady) return null

  return (
    <div 
      className="relative w-full"
      style={{
        height: isMobile ? 'calc(var(--vh, 1vh) * 100)' : '100vh'
      }}
    >
      <div className="absolute inset-0 flex">
        <div className={state.splitScreen ? "flex-1" : "w-full"}>
          {renderMap(state.sourceA, "map-a")}
        </div>
        {state.splitScreen && (
          <div className="flex-1">{renderMap(state.sourceB, "map-b")}</div>
        )}
      </div>
      <TerrainControlPanel
        state={state}
        setState={setState}
        getMapBounds={getMapBounds}
        mapRef={mapARef as any}
        mapsLoaded={mapsLoaded}
        animState={animState}
        setAnimState={setAnimStateWithSync}
      />
    </div>
  )
}