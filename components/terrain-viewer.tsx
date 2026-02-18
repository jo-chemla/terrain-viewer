"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat } from "nuqs"
import Map, {
  NavigationControl,
  GeolocateControl,
  type MapRef,
  type SkySpecification,
  ScaleControl,
} from "react-map-gl/maplibre"
import { TerrainControlPanel } from "./TerrainControlPanel/TerrainControlPanel"
import GeocoderControl from "./geocoder-control"
import { terrainSources } from "@/lib/terrain-sources"
import { colorRampsFlat, remapColorRampStops } from "@/lib/color-ramps"
import type { TerrainSource } from "@/lib/terrain-types"
import mlcontour from "maplibre-contour"
import { useAtom } from "jotai"
import {
  mapboxKeyAtom, maptilerKeyAtom, customTerrainSourcesAtom, titilerEndpointAtom, skyConfigAtom, customBasemapSourcesAtom, themeAtom
} from "@/lib/settings-atoms"

import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

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

import { GraticuleLayer } from "./GraticuleLayer"

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
    showContoursAndGraticules: parseAsBoolean.withDefault(false),
    showContours: parseAsBoolean.withDefault(true),
    showContourLabels: parseAsBoolean.withDefault(true),
    showGraticules: parseAsBoolean.withDefault(false),
    colorRamp: parseAsString.withDefault("mby"),
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
    customHypsoMinMax: parseAsBoolean.withDefault(false),
    minElevation: parseAsFloat.withDefault(0),
    maxElevation: parseAsFloat.withDefault(8100),
    hypsoSliderMinBound: parseAsFloat.withDefault(0),
    hypsoSliderMaxBound: parseAsFloat.withDefault(8100),
    graticuleColor: parseAsString.withDefault("#cccccc"),
    graticuleWidth: parseAsFloat.withDefault(1.0),
    showGraticuleLabels: parseAsBoolean.withDefault(false),
    graticuleDensity: parseAsFloat.withDefault(0),
  })

  const [skyConfig] = useAtom(skyConfigAtom)

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

  useEffect(() => {
    setContoursInitialized(false)
    initAttemptsRef.current = 0
  }, [state.sourceA])

  useEffect(() => {
    const initContours = async () => {
      if (!mapARef.current || !mapsLoaded || contoursInitialized) return
      if (initAttemptsRef.current >= 5) return

      initAttemptsRef.current += 1
      try {
        const map = mapARef.current.getMap()
        if (!map.isStyleLoaded()) {
          setTimeout(() => setContoursInitialized(false), 1000)
          return
        }

        const customSource = customTerrainSources.find(s => s.id === state.sourceA)
        let tileUrl = ""
        let encoding = "mapbox"
        let maxzoom = 14

        if (customSource) {
          if (customSource.type === 'cog') {
            tileUrl = `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(customSource.url)}`
            encoding = "mapbox"
          } else {
            tileUrl = customSource.url
            encoding = customSource.type === "terrarium" ? "terrarium" : "mapbox"
          }
        } else {
          const source = (terrainSources as any)[state.sourceA as TerrainSource]
          if (!source?.sourceConfig?.tiles?.[0]) return
          tileUrl = source.sourceConfig.tiles[0]
          if (state.sourceA === 'mapbox') tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
          else if (state.sourceA === 'maptiler') tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
          encoding = source.encoding === "terrainrgb" ? "mapbox" : "terrarium"
          maxzoom = source.sourceConfig.maxzoom || 14
        }

        let DemSource = (mlcontour as any).DemSource || (mlcontour as any).default?.DemSource || mlcontour

        demSourceRef.current = new DemSource({
          url: tileUrl,
          encoding: encoding,
          maxzoom: maxzoom,
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
          if (initAttemptsRef.current < 5) setContoursInitialized(false)
        }, 2000)
      }
    }

    // Trigger initialization with delay to ensure map is ready
    if (mapsLoaded && !contoursInitialized && initAttemptsRef.current < 5) {
      const timer = setTimeout(initContours, 1000)
      return () => clearTimeout(timer)
    }
  }, [contoursInitialized, mapsLoaded, state.sourceA, state.contourMinor, state.contourMajor, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint])


  useEffect(() => {
    const map = mapARef.current?.getMap();
    if (!map || !demSourceRef.current) return;

    if (map.getLayer("contour-labels")) map.removeLayer("contour-labels")
    if (map.getLayer("contour-lines")) map.removeLayer("contour-lines")
    if (map.getSource("contour-source")) map.removeSource("contour-source")

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
    // maplibregl.addProtocol('grid', GridProtocol);
  }, []);


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

  // Reset to north-up 2D view when switching to 2D mode frmo free rotation in 3D
  useEffect(() => {
    if (mapARef.current && state.viewMode === "2d") {
      const map = mapARef.current.getMap();
      map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    }
  }, [state.viewMode]);

  const [theme] = useAtom(themeAtom)
  const themeColor = theme === 'light' ? '#fff' : '#000'
  const themeAntiColor = theme === 'light' ? '#000' : '#fff'

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

  const graticuleLabelColor = themeAntiColor
  const graticuleLabelTextShadow = [
    // '-1px -1px 0 #fff',
    '-1px -1px 0',
    '1px -1px 0',
    '-1px 1px 0',
    '1px 1px 0',
    '-2px 0 0',
    '2px 0 0',
    '0 -2px 0',
    '0 2px 0'
  ].map((shadow) =>
    shadow + themeColor
  ).join(', ')
  useEffect(() => {
    if (themeColor) setState({ graticuleColor: themeColor })
  }, [themeColor])

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
            const map = isPrimary ? mapARef.current : mapBRef.current;
            map?.getMap().setTerrain({
              source: "terrainSource",
              exaggeration: state.exaggeration || 1,
            })
          }}
          sky={state.showBackground ? getSkyConfig() : getNoSkyConfig()}
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
          {skyConfig.backgroundLayerActive && <BackgroundLayer theme={theme as any} mapRef={mapARef as any} />}
          <RasterLayer showRasterBasemap={state.showRasterBasemap} rasterBasemapOpacity={state.rasterBasemapOpacity} />
          <ColorReliefLayer showColorRelief={state.showColorRelief} colorReliefPaint={colorReliefPaint} />
          <HillshadeLayer showHillshade={state.showHillshade} hillshadePaint={hillshadePaint} />
          {contoursInitialized && isPrimary && <ContourLayers showContours={state.showContoursAndGraticules && state.showContours} showContourLabels={state.showContourLabels} theme={theme} />}
          {isPrimary && state.showGraticules && <GraticuleLayer
            showGraticules={state.showContoursAndGraticules && state.showGraticules}
            graticuleColor={state.graticuleColor}
            graticuleWidth={state.graticuleWidth}
            showLabels={state.showGraticuleLabels}
            labelColor={graticuleLabelColor}
            labelTextShadow={graticuleLabelTextShadow}
            gridDensity={state.graticuleDensity || undefined}
          />}


          {isPrimary && (
            <>
              <GeocoderControl position="top-left" placeholder="Search and press Enter" marker={false} showResultsWhileTyping={true} zoom={14} flyTo={{ speed: 5 }} showResultMarkers={false} limit={10} minLength={3} />
              <NavigationControl position="top-left" />
              <GeolocateControl position="top-left" />
              <ScaleControl position="bottom-left" unit="metric" maxWidth={250} />
            </>
          )}
        </Map >
      )
    }, [
    state.lat, state.lng, state.zoom, state.pitch, state.bearing, state.viewMode, state.exaggeration,
    state.basemapSource, state.showRasterBasemap, state.rasterBasemapOpacity, state.showHillshade,
    state.showColorRelief, state.showContours, state.showBackground, state.showGraticules,
    state.graticuleColor, state.graticuleWidth, hillshadePaint, colorReliefPaint,
    mapboxKey, maptilerKey, contoursInitialized, customBasemapSources, titilerEndpoint, onMoveA, onMoveEndA,
    theme, skyConfig.backgroundLayerActive
  ])

  if (!mapLibreReady) return null

  return (
    <div className="relative h-screen w-full">
      <div className="absolute inset-0 flex">
        <div className={state.splitScreen ? "flex-1" : "w-full"}>
          {renderMap(state.sourceA, "map-a")}
        </div>
        {state.splitScreen && (
          <div className="flex-1">{renderMap(state.sourceB, "map-b")}</div>
        )}
      </div>
      <TerrainControlPanel state={state} setState={setState} getMapBounds={getMapBounds} mapRef={mapARef as any} mapsLoaded={mapsLoaded} />
    </div>
  )
}
