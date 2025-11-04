"use client"

import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat } from "nuqs"
import Map, { Source, Layer, NavigationControl, GeolocateControl, type MapRef } from "react-map-gl/maplibre"
import "@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css"
import { TerrainControls } from "./terrain-controls"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource } from "@/lib/terrain-types"

export function TerrainViewer() {
  const mapARef = useRef<MapRef>(null)
  const mapBRef = useRef<MapRef>(null)
  const isSyncing = useRef(false)
  const [geocoderLoaded, setGeocoderLoaded] = useState(false)
  const [mapLibreReady, setMapLibreReady] = useState(false)
  const [contoursInitialized, setContoursInitialized] = useState(false)
  const demSourceRef = useRef<any>(null)

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
    colorReliefOpacity: parseAsFloat.withDefault(1.0),
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
    hillshadeMethod: parseAsString.withDefault("standard"),
    contourMinor: parseAsFloat.withDefault(50),
    contourMajor: parseAsFloat.withDefault(200),
    mapboxKey: parseAsString.withDefault(""),
    googleKey: parseAsString.withDefault(""),
    maptilerKey: parseAsString.withDefault(""),
    titilerEndpoint: parseAsString.withDefault("https://titiler.xyz"),
    maxResolution: parseAsFloat.withDefault(4096),
  })

  const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsIlluminationAltitude = ["combined", "basic"].includes(state.hillshadeMethod)
  const supportsShadowColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsHighlightColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsAccentColor = state.hillshadeMethod === "standard"
  const supportsExaggeration = ["standard", "combined", "multidirectional"].includes(state.hillshadeMethod)

  const hillshadePaint = useMemo(() => {
    const paint: any = {}

    if (state.hillshadeMethod === "multidirectional") {
      // Multidirectional with multiple colored light sources
      paint["hillshade-method"] = "multidirectional"
      paint["hillshade-highlight-color"] = ["#ff8080", "#80ff80", "#80c0ff"]
      paint["hillshade-shadow-color"] = ["#4040ff", "#8000ff", "#0040ff"]
      paint["hillshade-illumination-direction"] = [300, 60, 180]
      paint["hillshade-illumination-altitude"] = [45, 45, 30]
      if (supportsExaggeration) {
        paint["hillshade-exaggeration"] = state.hillshadeExag
      }
    } else {
      if (supportsIlluminationDirection) {
        paint["hillshade-illumination-direction"] = state.illuminationDir
      }
      if (supportsShadowColor) {
        paint["hillshade-shadow-color"] = state.shadowColor
      }
      if (supportsHighlightColor) {
        paint["hillshade-highlight-color"] = state.highlightColor
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
    supportsIlluminationDirection,
    supportsIlluminationAltitude,
    supportsShadowColor,
    supportsHighlightColor,
    supportsAccentColor,
    supportsExaggeration,
  ])

  const colorReliefPaint = useMemo(() => {
    return {
      "hillshade-illumination-direction": 0,
      "hillshade-exaggeration": 0,
      "hillshade-shadow-color": "#000000",
      "hillshade-highlight-color": "#FFFFFF",
    }
  }, [])

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
    const loadGeocoder = async () => {
      if (!mapARef.current || geocoderLoaded || !mapLibreReady) return

      try {
        const MaplibreGeocoder = (await import("@maplibre/maplibre-gl-geocoder")).default
        const geocoder = new MaplibreGeocoder({
          forwardGeocode: async (config: any) => {
            const features = []
            try {
              const request = `https://nominatim.openstreetmap.org/search?q=${config.query}&format=geojson&polygon_geojson=1&addressdetails=1`
              const response = await fetch(request)
              const geojson = await response.json()
              for (const feature of geojson.features) {
                const center = [
                  feature.bbox[0] + (feature.bbox[2] - feature.bbox[0]) / 2,
                  feature.bbox[1] + (feature.bbox[3] - feature.bbox[1]) / 2,
                ]
                const point = {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: center,
                  },
                  place_name: feature.properties.display_name,
                  properties: feature.properties,
                  text: feature.properties.display_name,
                  place_type: ["place"],
                  center,
                }
                features.push(point)
              }
            } catch (e) {
              console.error(`Failed to forwardGeocode with error: ${e}`)
            }

            return {
              features,
            }
          },
        })
        mapARef.current.getMap().addControl(geocoder, "top-left")
        setGeocoderLoaded(true)
      } catch (error) {
        console.error("Failed to load geocoder:", error)
      }
    }

    if (mapARef.current && !geocoderLoaded && mapLibreReady) {
      setTimeout(loadGeocoder, 1000)
    }
  }, [geocoderLoaded, mapLibreReady])

  useEffect(() => {
    const initContours = async () => {
      if (!mapARef.current || contoursInitialized || !mapLibreReady) return

      try {
        const mlcontour = await import("maplibre-contour")
        const maplibregl = (window as any).maplibregl

        const source = terrainSources[state.sourceA as TerrainSource]
        if (!source?.sourceConfig?.tiles?.[0]) return

        demSourceRef.current = new (mlcontour as any).DemSource({
          url: source.sourceConfig.tiles[0],
          encoding: source.encoding === "terrainrgb" ? "mapbox" : "terrarium",
          maxzoom: source.sourceConfig.maxzoom || 14,
          worker: true,
          cacheSize: 100,
          timeoutMs: 10000,
        })

        demSourceRef.current.setupMaplibre(maplibregl)

        const map = mapARef.current.getMap()
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

        setContoursInitialized(true)
      } catch (error) {
        console.error("Failed to initialize contours:", error)
      }
    }

    if (mapARef.current && !contoursInitialized && mapLibreReady) {
      setTimeout(initContours, 2000)
    }
  }, [contoursInitialized, mapLibreReady, state.sourceA, state.contourMinor, state.contourMajor])

  const onMoveEndA = useCallback(
    (evt: any) => {
      if (!isSyncing.current) {
        setState({
          lat: Number.parseFloat(evt.viewState.latitude.toFixed(4)),
          lng: Number.parseFloat(evt.viewState.longitude.toFixed(4)),
          zoom: Number.parseFloat(evt.viewState.zoom.toFixed(2)),
          pitch: Number.parseFloat(evt.viewState.pitch.toFixed(1)),
          bearing: Number.parseFloat(evt.viewState.bearing.toFixed(1)),
        })
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

  const getSourceConfig = useMemo(() => {
    return (source: TerrainSource) => terrainSources[source].sourceConfig
  }, [])

  const renderMap = (source: TerrainSource, mapId: string) => {
    const sourceConfig = getSourceConfig(source)

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
        maxPitch={state.viewMode === "2d" ? 0 : 85}
        pitchWithRotate={state.viewMode !== "2d"}
        dragRotate={state.viewMode !== "2d"}
        touchZoomRotate={state.viewMode !== "2d"}
        terrain={
          state.viewMode === "3d" || state.viewMode === "globe"
            ? {
                source: "terrainSource",
                exaggeration: state.exaggeration,
              }
            : undefined
        }
        projection={state.viewMode === "globe" ? "globe" : "mercator"}
        mapStyle={{
          version: 8,
          sources: {},
          layers: [],
        }}
      >
        <Source id="terrainSource" key={`terrain-${source}`} {...sourceConfig} />

        <Source id="hillshadeSource" key={`hillshade-${source}`} {...sourceConfig} />

        <Source
          id="terrain-raster-source"
          key={`raster-${state.terrainSource}`}
          type="raster"
          tiles={[terrainRasterUrls[state.terrainSource] || terrainRasterUrls.google]}
          tileSize={256}
        />

        <Layer
          id="terrain-raster"
          type="raster"
          source="terrain-raster-source"
          paint={{
            "raster-opacity": state.terrainOpacity,
          }}
          layout={{
            visibility: state.showTerrain ? "visible" : "none",
          }}
        />

        <Layer
          id="hillshade"
          type="hillshade"
          source="hillshadeSource"
          paint={hillshadePaint}
          layout={{
            visibility: state.showHillshade ? "visible" : "none",
          }}
        />

        <Layer
          id="color-relief"
          type="hillshade"
          source="hillshadeSource"
          paint={colorReliefPaint}
          layout={{
            visibility: state.showColorRelief ? "visible" : "none",
          }}
        />

        {contoursInitialized && mapId === "map-a" && (
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
                visibility: state.showContours ? "visible" : "none",
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
                visibility: state.showContours ? "visible" : "none",
              }}
              paint={{
                "text-halo-color": "white",
                "text-halo-width": 1,
              }}
            />
          </>
        )}

        {mapId === "map-a" && (
          <>
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
