"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat, parseAsStringLiteral, parseAsArrayOf } from "nuqs"
import Map, {
  NavigationControl,
  GeolocateControl,
  type MapRef,
  ScaleControl,
} from "react-map-gl/maplibre"
import { TerrainControlPanel, isSidebarOpenAtom } from "./TerrainControlPanel/TerrainControlPanel"

import GeocoderControl from "./MapControls/GeocoderControl"
import { COLOR_RAMP_IDS } from "@/lib/color-ramps"
import {HILLSHADE_METHODS, type TerrainSource } from "@/lib/terrain-types"
import { useAtom } from "jotai"
import {
  mapboxKeyAtom, maptilerKeyAtom, customTerrainSourcesAtom, titilerEndpointAtom, skyConfigAtom, customBasemapSourcesAtom, highResTerrainAtom,
  activeProjectConfigAtom, useCogProtocolVsTitilerAtom, tellsBetaEnabledAtom,
  type CustomTerrainSource, type CustomBasemapSource,
} from "@/lib/settings-atoms"
import { MAX_BOUNDS_MODES, unionBounds, bufferBounds, resolveCustomSourceBounds, type LngLatBoundsTuple } from "@/lib/max-bounds"
import { sectionOpenAtom } from "./TerrainControlPanel/TerrainControlPanel"
import { getProjectConfig } from "@/lib/project-config"
import { useTheme } from "@/lib/controls-utils"
import { terrainSources } from "@/lib/terrain-sources"
import { BUILTIN_BASEMAP_OPTIONS } from "./TerrainControlPanel/raster-basemap-section"
import customSourcesData from "@/lib/custom-sources.json"

const SAMPLE_TERRAIN_SOURCES = customSourcesData["SAMPLE_TERRAIN_SOURCES"] as CustomTerrainSource[]
const SAMPLE_BASEMAP_SOURCES = customSourcesData["SAMPLE_BASEMAPS_SOURCES"] as CustomBasemapSource[]
import { MinimapControl } from "./MapControls/MinimapControl";
import { useIsMobile } from '@/hooks/use-mobile'

import maplibregl from 'maplibre-gl'
import { cogProtocol, getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import { float32demProtocol } from '@/lib/float32dem-protocol'
import { slopeProtocol } from '@/lib/slope-protocol'
import { aspectProtocol } from '@/lib/aspect-protocol'
import { triProtocol } from '@/lib/tri-protocol'
import { curvatureProtocol } from '@/lib/curvature-protocol'
import { tpiProtocol } from '@/lib/tpi-protocol'
import { roughnessProtocol } from '@/lib/roughness-protocol'
import { lrmProtocol } from '@/lib/lrm-protocol'
import { blobnessProtocol } from '@/lib/blobness-protocol'
import { tellsProtocol } from '@/lib/tells-protocol'

import { TerrainSources, RasterBasemapSource, OverlayBasemapSources, SlopeSource, AspectSource, TriSource, CurvatureSource, TpiSource, LrmSource, RoughnessSource, BlobnessSource, TellsSource } from "./LayersAndSources/MapSources"
import {
  LayerOrderSlots,
  RasterLayer,
  OverlayBasemapLayers,
  BackgroundLayer,
  HillshadeLayer,
  ColorReliefLayer,
  SlopeReliefLayer,
  AspectReliefLayer,
  TriReliefLayer,
  CurvatureReliefLayer,
  TpiReliefLayer,
  LrmReliefLayer,
  RoughnessReliefLayer,
  BlobnessReliefLayer,
  TellsMarkersLayer,
  LAYER_SLOTS,
  computeHillshadePaint,
  computeColorReliefPaint,
} from "./LayersAndSources/MapLayers"
import { ContoursLayer } from "./LayersAndSources/ContoursLayer"
import { GraticuleLayer } from "./LayersAndSources/GraticuleLayer"

import { createParser } from 'nuqs'
import { parseAsColor } from "@/lib/nuqs-parser-color"

const parseAsFloatPrecise = createParser({
  parse: (value) => {
    const num = parseFloat(value)
    return isNaN(num) ? null : parseFloat(num.toFixed(6)) // 4 decimals
  },
  serialize: (value) => value.toFixed(4)
})

// Not exported: a non-component export here breaks React Fast Refresh (Vite
// falls back to full remounting this whole tree on every edit), which was
// causing spurious mid-teardown crashes in ContoursLayer/TerraDraw during dev.
const VIEW_MODES = ['2d', 'globe', '3d'] as const
const SLOPE_SOURCE_MODES = ['plantopo', 'client'] as const
const CURVATURE_MODES = ['combined', 'profile', 'plan', 'det-hessian'] as const

export function TerrainViewer() {
  const mapARef = useRef<MapRef>(null)
  const mapBRef = useRef<MapRef>(null)
  const isSyncing = useRef(false)
  const [mapLibreReady, setMapLibreReady] = useState(false)
  const [mapALoaded, setMapALoaded] = useState(false)
  const [mapBLoaded, setMapBLoaded] = useState(false)
  const viewStateUpdateTimer = useRef<NodeJS.Timeout | null>(null)
  const isMobile = useIsMobile()

  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources, setCustomBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
  const [highResTerrain] = useAtom(highResTerrainAtom)
  const [tellsBetaEnabled] = useAtom(tellsBetaEnabledAtom)
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [activeProjectConfig, setActiveProjectConfig] = useAtom(activeProjectConfigAtom)
  const [, setSectionOpen] = useAtom(sectionOpenAtom)
  const hasAppliedEmbedConfig = useRef(false)

  const [state, setState] = useQueryStates({
    // Embed/project convenience params: `project` looks up a named preset in
    // lib/projects.json (see lib/project-config.ts); terrainUrl/basemapUrl let an
    // embedder point straight at a raw tile/COG URL without registering a custom
    // source first — see the embed-config effect below. Note this object's key
    // order does NOT control the resulting URL's param order (nuqs extends
    // whatever's already in location.search plus queued-update insertion order) —
    // `project` is put first in the actual URL via src/main.tsx's
    // processUrlSearchParams instead.
    project: parseAsString.withDefault(""),
    terrainUrl: parseAsString.withDefault(""),
    basemapUrl: parseAsString.withDefault(""),
    // Explicit source type for terrainUrl/basemapUrl when it's a raw URL (not an
    // existing source id) — type can't always be inferred from the URL shape alone
    // (e.g. a titiler VRT vs a plain COG both being a bare https URL). Falls back
    // to the existing includes("{z}") heuristic when omitted.
    terrainType: parseAsString.withDefault(""),
    basemapType: parseAsString.withDefault(""),
    viewMode: parseAsStringLiteral(VIEW_MODES).withDefault("3d"),
    splitScreen: parseAsBoolean.withDefault(false),
    sourceA: parseAsString.withDefault("mapterhorn"), // can have custom id in addition to @/lib/terrain-sources
    sourceB: parseAsString.withDefault("maptiler"),   // can have custom id in addition to @/lib/terrain-sources
    basemapSource: parseAsString.withDefault("esri"), // can have custom id in addition to @/lib/terrain-sources
    basemapPerView: parseAsBoolean.withDefault(true),
    basemapSourceA: parseAsString.withDefault("esri"),
    basemapSourceB: parseAsString.withDefault("google"),
    // 'overlay'-role custom basemap sources currently stacked on top of the active
    // basemap (see basemap-byod-section.tsx's checkbox list) — shared across A/B,
    // only meaningful in split-or-radio basemap mode (basemapPerView).
    overlayBasemapIds: parseAsArrayOf(parseAsString).withDefault([]),
    // colorRamp: parseAsString.withDefault("mby"),
    colorRamp: parseAsStringLiteral(COLOR_RAMP_IDS).withDefault("mby"),
    showHillshade: parseAsBoolean.withDefault(true),
    hillshadeOpacity: parseAsFloat.withDefault(1.0),
    showColorRelief: parseAsBoolean.withDefault(false),
    colorReliefOpacity: parseAsFloat.withDefault(0.35),
    // Master toggle for the merged "Slope and More" viz mode (see
    // slope-and-more-section.tsx) — mirrors showContoursAndGraticules. Slope is the
    // only sub-mode on by default; aspect/TRI/curvature default off, matching the
    // old standalone-Slope-toggle behavior the first time this is turned on.
    showSlopeAndMore: parseAsBoolean.withDefault(false),
    // Master opacity for the whole "Slope and More" viz mode — composites (multiplies)
    // with each sub-mode's own opacity below, rather than replacing it.
    slopeAndMoreOpacity: parseAsFloat.withDefault(1.0),
    showSlope: parseAsBoolean.withDefault(true),
    slopeOpacity: parseAsFloat.withDefault(1.0),
    slopeColorRamp: parseAsString.withDefault("slope-plantopo"),
    slopeSourceMode: parseAsStringLiteral(SLOPE_SOURCE_MODES).withDefault("client"),
    slopeMinDegrees: parseAsFloat.withDefault(0),
    slopeMaxDegrees: parseAsFloat.withDefault(55),
    slopeInvertColorRamp: parseAsBoolean.withDefault(false),
    showAspect: parseAsBoolean.withDefault(false),
    aspectOpacity: parseAsFloat.withDefault(0.5),
    aspectColorRamp: parseAsString.withDefault("aspect-compass"),
    aspectMinDegrees: parseAsFloat.withDefault(0),
    aspectMaxDegrees: parseAsFloat.withDefault(360),
    aspectInvertColorRamp: parseAsBoolean.withDefault(false),
    showTri: parseAsBoolean.withDefault(false),
    triOpacity: parseAsFloat.withDefault(1.0),
    triColorRamp: parseAsString.withDefault("tri-default"),
    triMin: parseAsFloat.withDefault(0),
    triMax: parseAsFloat.withDefault(50),
    triInvertColorRamp: parseAsBoolean.withDefault(false),
    showCurvature: parseAsBoolean.withDefault(false),
    curvatureOpacity: parseAsFloat.withDefault(1.0),
    curvatureMode: parseAsStringLiteral(CURVATURE_MODES).withDefault("combined"),
    curvatureColorRamp: parseAsString.withDefault("curvature-diverging"),
    curvatureMin: parseAsFloat.withDefault(-20),
    curvatureMax: parseAsFloat.withDefault(20),
    curvatureInvertColorRamp: parseAsBoolean.withDefault(false),
    curvatureSymmetric: parseAsBoolean.withDefault(true),
    showTpi: parseAsBoolean.withDefault(false),
    tpiOpacity: parseAsFloat.withDefault(1.0),
    tpiColorRamp: parseAsString.withDefault("tpi-diverging"),
    tpiMin: parseAsFloat.withDefault(-20),
    tpiMax: parseAsFloat.withDefault(20),
    tpiInvertColorRamp: parseAsBoolean.withDefault(false),
    tpiSymmetric: parseAsBoolean.withDefault(true),
    showLrm: parseAsBoolean.withDefault(false),
    lrmOpacity: parseAsFloat.withDefault(1.0),
    lrmColorRamp: parseAsString.withDefault("lrm-diverging"),
    lrmMin: parseAsFloat.withDefault(-20),
    lrmMax: parseAsFloat.withDefault(20),
    lrmInvertColorRamp: parseAsBoolean.withDefault(false),
    lrmSymmetric: parseAsBoolean.withDefault(true),
    lrmRadius: parseAsFloat.withDefault(16),
    showRoughness: parseAsBoolean.withDefault(false),
    roughnessOpacity: parseAsFloat.withDefault(1.0),
    roughnessColorRamp: parseAsString.withDefault("roughness-default"),
    roughnessMin: parseAsFloat.withDefault(0),
    roughnessMax: parseAsFloat.withDefault(50),
    roughnessInvertColorRamp: parseAsBoolean.withDefault(false),
    showBlobness: parseAsBoolean.withDefault(false),
    blobnessOpacity: parseAsFloat.withDefault(1.0),
    blobnessColorRamp: parseAsString.withDefault("blobness-default"),
    blobnessMin: parseAsFloat.withDefault(0),
    blobnessMax: parseAsFloat.withDefault(50),
    blobnessInvertColorRamp: parseAsBoolean.withDefault(false),
    showTells: parseAsBoolean.withDefault(false),
    tellSize: parseAsFloat.withDefault(100),
    tellMinRelief: parseAsFloat.withDefault(0.3),
    tellBlobnessMin: parseAsFloat.withDefault(5),
    tellPlanMin: parseAsFloat.withDefault(0),
    tellDetHessianMin: parseAsFloat.withDefault(0),
    showContoursAndGraticules: parseAsBoolean.withDefault(false),
    showContours: parseAsBoolean.withDefault(true),
    showContourLabels: parseAsBoolean.withDefault(true),
    showGraticules: parseAsBoolean.withDefault(false),
    showRasterBasemap: parseAsBoolean.withDefault(false),
    showBackground: parseAsBoolean.withDefault(false),
    // Viz-mode master opacity (the "Raster Basemap" checkbox's own slider) — composites
    // (multiplies) with basemapSourceOpacity below for the single/split basemap layer,
    // same pattern as Slope-and-More's master-vs-submode opacity. Overlay layers use
    // this value directly (100% × master), since they have no solo slider of their own.
    rasterBasemapOpacity: parseAsFloat.withDefault(1.0),
    // Basemap-solo opacity (the "Basemap Opacity" slider inside the Basemap Source
    // section) — only affects the single/split basemap layer, not overlays.
    basemapSourceOpacity: parseAsFloat.withDefault(1.0),
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
    // shadowColor: parseAsString.withDefault("#000000"),
    // highlightColor: parseAsString.withDefault("#FFFFFF"),
    // accentColor: parseAsString.withDefault("#808080"),
    shadowColor: parseAsColor().withDefault("#000000"),
    highlightColor: parseAsColor().withDefault("#FFFFFF"),
    accentColor: parseAsColor().withDefault("#808080"),
    // graticuleColor: parseAsString.withDefault("#000"),
    // graticuleColor: parseAsString, // don't use default to sync with theme
    hillshadeExag: parseAsFloat.withDefault(1.0),
    contourMinor: parseAsFloat.withDefault(50),
    contourMajor: parseAsFloat.withDefault(200),
    customHypsoMinMax: parseAsBoolean.withDefault(false),
    minElevation: parseAsFloat.withDefault(0),
    maxElevation: parseAsFloat.withDefault(8100),
    hypsoSliderMinBound: parseAsFloat.withDefault(-8000),
    hypsoSliderMaxBound: parseAsFloat.withDefault(5000),
    graticuleWidth: parseAsFloat.withDefault(1.0),
    showGraticuleLabels: parseAsBoolean.withDefault(false),
    graticuleDensity: parseAsFloat.withDefault(0),
    minimapMinimized: parseAsBoolean.withDefault(true),
    // Keyframe/360 animation state (animDuration, animLoopMode, animSmoothCamera,
    // animPlaying, animPlaying360, animPose1, animPose2Delta) lives in its own nuqs
    // hook inside CameraUtilities.tsx, not in this shared bag.
    invertColorRamp: parseAsBoolean.withDefault(false),
    // Max map bounds (Settings > Map Bounds) — constrains pan/zoom rather than a
    // one-shot camera fly like the smart-zoom/fit-to-bounds features above.
    // "terrain"/"raster"/"union" are resolved asynchronously from the active
    // source(s) (see the maxBounds effect below and lib/max-bounds.ts);
    // "custom" uses the four WSNE fields directly.
    maxBoundsMode: parseAsStringLiteral(MAX_BOUNDS_MODES).withDefault("none"),
    maxBoundsBuffer: parseAsFloat.withDefault(0),
    maxBoundsWest: parseAsFloat.withDefault(-180),
    maxBoundsSouth: parseAsFloat.withDefault(-85),
    maxBoundsEast: parseAsFloat.withDefault(180),
    maxBoundsNorth: parseAsFloat.withDefault(85),
  },
  {
    history: 'replace', // push to remember past interactions, or replace to avoid cluttering history
    limitUrlUpdates: {
      method: 'throttle', // throttle or debounce debounce correctly fires only have paused setState, but flashes
      timeMs: 500
    }
  })


  const [skyConfig] = useAtom(skyConfigAtom)

  // Compute hillshade paint with useMemo to prevent recalculation
  const hillshadePaint = useMemo(
    () => computeHillshadePaint(state),
    [ state.hillshadeMethod, state.illuminationDir, state.illuminationAlt, state.hillshadeOpacity, state.shadowColor, state.highlightColor, state.hillshadeExag, state.accentColor ]
  )

  const colorReliefPaint = useMemo(
    () => computeColorReliefPaint(state),
    [ state.colorRamp, state.customHypsoMinMax, state.minElevation, state.maxElevation, state.colorReliefOpacity, state.invertColorRamp ]
  )

  // Slope reuses the exact same paint-computation as the hypsometric tint above — a
  // color-relief layer doesn't care whether "elevation" means meters or slope degrees —
  // just fed its own (differently-named) state fields, always remapped to its own min/max
  // range since a 0-8000m elevation ramp's stops would be meaningless applied verbatim to
  // a 0-55° slope domain. Opacity composites (multiplies) with the "Slope and More"
  // master opacity rather than replacing it — see VisualizationModesSection.
  const slopeReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.slopeColorRamp,
      customHypsoMinMax: true,
      minElevation: state.slopeMinDegrees,
      maxElevation: state.slopeMaxDegrees,
      colorReliefOpacity: state.slopeOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.slopeInvertColorRamp,
    }),
    [ state.slopeColorRamp, state.slopeMinDegrees, state.slopeMaxDegrees, state.slopeOpacity, state.slopeAndMoreOpacity, state.slopeInvertColorRamp ]
  )

  // Aspect/TRI/curvature: same trick as slope above, just with their own state fields.
  const aspectReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.aspectColorRamp,
      customHypsoMinMax: true,
      minElevation: state.aspectMinDegrees,
      maxElevation: state.aspectMaxDegrees,
      colorReliefOpacity: state.aspectOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.aspectInvertColorRamp,
    }),
    [ state.aspectColorRamp, state.aspectMinDegrees, state.aspectMaxDegrees, state.aspectOpacity, state.slopeAndMoreOpacity, state.aspectInvertColorRamp ]
  )

  const triReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.triColorRamp,
      customHypsoMinMax: true,
      minElevation: state.triMin,
      maxElevation: state.triMax,
      colorReliefOpacity: state.triOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.triInvertColorRamp,
    }),
    [ state.triColorRamp, state.triMin, state.triMax, state.triOpacity, state.slopeAndMoreOpacity, state.triInvertColorRamp ]
  )

  const curvatureReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.curvatureColorRamp,
      customHypsoMinMax: true,
      minElevation: state.curvatureMin,
      maxElevation: state.curvatureMax,
      colorReliefOpacity: state.curvatureOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.curvatureInvertColorRamp,
    }),
    [ state.curvatureColorRamp, state.curvatureMin, state.curvatureMax, state.curvatureOpacity, state.slopeAndMoreOpacity, state.curvatureInvertColorRamp ]
  )

  const tpiReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.tpiColorRamp,
      customHypsoMinMax: true,
      minElevation: state.tpiMin,
      maxElevation: state.tpiMax,
      colorReliefOpacity: state.tpiOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.tpiInvertColorRamp,
    }),
    [ state.tpiColorRamp, state.tpiMin, state.tpiMax, state.tpiOpacity, state.slopeAndMoreOpacity, state.tpiInvertColorRamp ]
  )

  const lrmReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.lrmColorRamp,
      customHypsoMinMax: true,
      minElevation: state.lrmMin,
      maxElevation: state.lrmMax,
      colorReliefOpacity: state.lrmOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.lrmInvertColorRamp,
    }),
    [ state.lrmColorRamp, state.lrmMin, state.lrmMax, state.lrmOpacity, state.slopeAndMoreOpacity, state.lrmInvertColorRamp ]
  )

  const roughnessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.roughnessColorRamp,
      customHypsoMinMax: true,
      minElevation: state.roughnessMin,
      maxElevation: state.roughnessMax,
      colorReliefOpacity: state.roughnessOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.roughnessInvertColorRamp,
    }),
    [ state.roughnessColorRamp, state.roughnessMin, state.roughnessMax, state.roughnessOpacity, state.slopeAndMoreOpacity, state.roughnessInvertColorRamp ]
  )

  const blobnessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.blobnessColorRamp,
      customHypsoMinMax: true,
      minElevation: state.blobnessMin,
      maxElevation: state.blobnessMax,
      colorReliefOpacity: state.blobnessOpacity * state.slopeAndMoreOpacity,
      invertColorRamp: state.blobnessInvertColorRamp,
    }),
    [ state.blobnessColorRamp, state.blobnessMin, state.blobnessMax, state.blobnessOpacity, state.slopeAndMoreOpacity, state.blobnessInvertColorRamp ]
  )

  const tellsOptions = useMemo(
    () => ({
      tellSizeMeters: state.tellSize,
      minReliefMeters: state.tellMinRelief,
      blobnessMin: state.tellBlobnessMin,
      planMin: state.tellPlanMin,
      detHessianMin: state.tellDetHessianMin,
    }),
    [ state.tellSize, state.tellMinRelief, state.tellBlobnessMin, state.tellPlanMin, state.tellDetHessianMin ]
  )

  // Check MapLibre availability
  useEffect(() => {
    setMapLibreReady(true)
  }, [])

  // Register the COG protocol
  useEffect(() => {
    maplibregl.addProtocol('cog', cogProtocol)
    maplibregl.addProtocol('float32dem', float32demProtocol)
    maplibregl.addProtocol('slope', slopeProtocol)
    maplibregl.addProtocol('aspect', aspectProtocol)
    maplibregl.addProtocol('tri', triProtocol)
    maplibregl.addProtocol('curvature', curvatureProtocol)
    maplibregl.addProtocol('tpi', tpiProtocol)
    maplibregl.addProtocol('lrm', lrmProtocol)
    maplibregl.addProtocol('roughness', roughnessProtocol)
    maplibregl.addProtocol('blobness', blobnessProtocol)
    maplibregl.addProtocol('tells', tellsProtocol)
  }, [])

  // Applies a `?project=` preset (lib/projects.json) and/or terrainUrl/basemapUrl
  // convenience params on first load only — guarded by the ref so it never fights
  // the user's own subsequent state changes or section toggles.
  useEffect(() => {
    if (hasAppliedEmbedConfig.current) return
    hasAppliedEmbedConfig.current = true

    const projectConfig = getProjectConfig(state.project)
    setActiveProjectConfig(projectConfig)

    const searchParams = new URLSearchParams(window.location.search)
    const stateOverrides: Record<string, unknown> = {}

    if (projectConfig?.initialState) {
      for (const [key, value] of Object.entries(projectConfig.initialState)) {
        if (!searchParams.has(key)) stateOverrides[key] = value
      }
    }
    if (projectConfig?.initialViewMode && !searchParams.has("viewMode")) {
      stateOverrides.viewMode = projectConfig.initialViewMode
    }

    // terrainUrl/basemapUrl can carry either an id of a source the visitor's browser
    // (or the sample library) already knows about, or a raw tile/COG URL to
    // register on the fly — check for an id match first so e.g.
    // `?terrainUrl=mapterhorn` or `?terrainUrl=dura-w-05mm` just selects the
    // existing source instead of wastefully re-registering it as a new "embedded"
    // one keyed off its own id-as-a-string (which isn't a valid URL anyway).
    if (state.terrainUrl) {
      const value = state.terrainUrl
      const isKnownId = value in ((terrainSources as any) ?? {})
        || customTerrainSources.some((s) => s.id === value)
        || SAMPLE_TERRAIN_SOURCES.some((s) => s.id === value)
      if (isKnownId) {
        const sample = SAMPLE_TERRAIN_SOURCES.find((s) => s.id === value)
        if (sample && !customTerrainSources.some((s) => s.id === value)) {
          setCustomTerrainSources((prev) => [...prev.filter((s) => s.id !== value), sample])
        }
        if (!searchParams.has("sourceA")) stateOverrides.sourceA = value
      } else {
        const embedId = "__embed_terrain__"
        const type = (state.terrainType || (value.includes("{z}") ? "terrarium" : "cog")) as CustomTerrainSource["type"]
        setCustomTerrainSources((prev) => [
          ...prev.filter((s) => s.id !== embedId),
          { id: embedId, name: "Embedded Terrain", url: value, type },
        ])
        if (!searchParams.has("sourceA")) stateOverrides.sourceA = embedId
      }
    }
    if (state.basemapUrl) {
      const value = state.basemapUrl
      const isKnownId = BUILTIN_BASEMAP_OPTIONS.some((o) => o.value === value)
        || customBasemapSources.some((s) => s.id === value)
        || SAMPLE_BASEMAP_SOURCES.some((s) => s.id === value)
      if (isKnownId) {
        const sample = SAMPLE_BASEMAP_SOURCES.find((s) => s.id === value)
        if (sample && !customBasemapSources.some((s) => s.id === value)) {
          setCustomBasemapSources((prev) => [...prev.filter((s) => s.id !== value), sample])
        }
        if (!searchParams.has("basemapSource")) stateOverrides.basemapSource = value
      } else {
        const embedId = "__embed_basemap__"
        const type = (state.basemapType || (value.includes("{z}") ? "tms" : "cog")) as CustomBasemapSource["type"]
        setCustomBasemapSources((prev) => [
          ...prev.filter((s) => s.id !== embedId),
          { id: embedId, name: "Embedded Basemap", url: value, type },
        ])
        if (!searchParams.has("basemapSource")) stateOverrides.basemapSource = embedId
      }
    }

    // Seed any custom sources this project depends on (merge by id — same
    // semantics as the "Load Sample" buttons) so referencing them in initialState
    // (e.g. sourceA: "dura-w-05mm") works even for a visitor whose browser has
    // never seen them before.
    if (projectConfig?.customTerrainSources?.length) {
      const ids = new Set(projectConfig.customTerrainSources.map((s) => s.id))
      setCustomTerrainSources((prev) => [...prev.filter((s) => !ids.has(s.id)), ...projectConfig.customTerrainSources!])
    }
    if (projectConfig?.customBasemapSources?.length) {
      const ids = new Set(projectConfig.customBasemapSources.map((s) => s.id))
      setCustomBasemapSources((prev) => [...prev.filter((s) => !ids.has(s.id)), ...projectConfig.customBasemapSources!])
    }

    if (Object.keys(stateOverrides).length > 0) setState(stateOverrides)

    if (projectConfig?.initialSections) {
      setSectionOpen((prev) => ({ ...prev, ...projectConfig.initialSections }))
    }

    if (typeof projectConfig?.initialSidebarOpen === "boolean") {
      setIsSidebarOpen(projectConfig.initialSidebarOpen)
    }

    if (projectConfig?.initialBounds) {
      const [west, south, east, north] = projectConfig.initialBounds
      const flyToBounds = () => mapARef.current?.fitBounds([[west, south], [east, north]], { padding: 50, duration: 0 })
      const map = mapARef.current?.getMap()
      if (map?.isStyleLoaded()) flyToBounds()
      else map?.once("load", flyToBounds)
    }

    // Reads the actual bbox out of the COG rather than a hardcoded literal — needed
    // for "fakegeo" COGs (see project-config.ts) whose embedded bounds are an
    // arbitrary synthetic anchor, not real-world coordinates, so no hardcoded
    // initialBounds could be correct ahead of time.
    if (projectConfig?.autoZoomToSource) {
      const key = projectConfig.autoZoomToSource
      const sourceId = (stateOverrides[key] as string | undefined) ?? state[key]
      const pool = key === "sourceA" ? projectConfig.customTerrainSources : projectConfig.customBasemapSources
      const source = pool?.find((s) => s.id === sourceId)
      if (source?.type === "cog") {
        getCogMetadata(source.url).then((metadata: any) => {
          const bbox = metadata.bbox
          if (bbox && mapARef.current) {
            const [west, south, east, north] = bbox
            mapARef.current.fitBounds([[west, south], [east, north]], { padding: 50, duration: 0 })
          }
        }).catch((err: unknown) => console.error("Failed to auto-zoom to project source bounds:", err))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Map B is fully interactive too (drag/scroll/rotate), so sync has to run both ways —
  // otherwise panning or zooming map B directly desyncs it from map A with nothing to
  // bring it back, since only A's own moves used to propagate to B.
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

  const onMoveB = useCallback((evt: any) => {
    if (!isSyncing.current && state.splitScreen && mapARef.current) {
      isSyncing.current = true
      mapARef.current.getMap().jumpTo({
        center: [evt.viewState.longitude, evt.viewState.latitude],
        zoom: evt.viewState.zoom,
        bearing: evt.viewState.bearing,
        pitch: evt.viewState.pitch,
      })
      setTimeout(() => { isSyncing.current = false }, 50)
    }
  }, [state.splitScreen])

  const commitViewState = useCallback((evt: any) => {
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
  }, [setState])

  const onMoveEndA = useCallback((evt: any) => {
    if (!isSyncing.current) commitViewState(evt)
  }, [commitViewState])

  const onMoveEndB = useCallback((evt: any) => {
    if (!isSyncing.current) commitViewState(evt)
  }, [commitViewState])

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

  const { theme } = useTheme()
  // const theme = state.theme
  // const themeColor = theme === 'light' ? '#fff' : '#000'
  // const themeAntiColor = theme === 'light' ? '#000' : '#fff'

  const themeColor = useMemo(
    () => theme === 'light' ? '#fff' : '#000',
    [theme]
  )

  const themeAntiColor = useMemo(
    () => theme === 'light' ? '#000' : '#fff',
    [theme]
  )
  
  // const effectiveGraticuleColor = state.graticuleColor ?? themeColor

  // matchThemeColors only overrides the *applied* color here — the atom's
  // skyColor/horizonColor/fogColor always keep the user's last custom picks, so
  // toggling this off restores them instead of losing them (see
  // background-options-section.tsx's handleMatchThemeToggle).
  const getSkyConfig = () => ({
    'sky-color': skyConfig.matchThemeColors ? themeColor : skyConfig.skyColor,
    'sky-horizon-blend': skyConfig.skyHorizonBlend,
    'horizon-color': skyConfig.matchThemeColors ? themeColor : skyConfig.horizonColor,
    'horizon-fog-blend': skyConfig.horizonFogBlend,
    'fog-color': skyConfig.matchThemeColors ? themeColor : skyConfig.fogColor,
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

  // For graticule color - only update URL when graticules are shown
  // useEffect(() => {
  //   if (state.showContoursAndGraticules && state.showGraticules) {
  //     setState({ graticuleColor: themeColor })
  //   }
  // }, [themeColor, state.showContoursAndGraticules, state.showGraticules, state.graticuleColor])
  // useEffect(() => {
  //   // If graticules are shown and no custom color is set, use theme color
  //   if (state.showContoursAndGraticules && state.showGraticules && !state.graticuleColor) {
  //     setState({ graticuleColor: themeColor })
  //   }
    
  //   // When theme changes, update color ONLY if it matches the old theme color
  //   // (meaning user hasn't customized it)
  //   if (state.graticuleColor === (themeColor === '#fff' ? '#000' : '#fff')) {
  //     setState({ graticuleColor: themeColor })
  //   }
  // }, [themeColor, state.showContoursAndGraticules, state.showGraticules, state.graticuleColor, setState])

  // useEffect(() => {
  //   // Force update on mount if no color is set
  //     setState({ graticuleColor: themeAntiColor })
  // }, []) // Run once on mount

  // useEffect(() => {
  //   // Then sync on theme changes
  //     setState({ graticuleColor: themeAntiColor })
  // }, [themeAntiColor, setState])


  // ----------------------------------------
  // Handle terrain source changes and sync terrain with view mode changes
  // ----------------------------------------
  const applyTerrain = useCallback((map: maplibregl.Map, viewMode: string) => {
    // Remove terrain in 2D mode
    if (viewMode === '2d') {
      map.setTerrain(null)
      return
    }
    
    // Apply terrain in 3D/globe mode
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
  // const applyTerrain = useCallback((map: maplibregl.Map, viewMode: string) => {
  //   if (viewMode === '2d') {
  //     map.setTerrain(null)
  //     return
  //   }
    
  //   const apply = () => {
  //     if (map.getSource('terrainSource')) {
  //       map.setTerrain({
  //         source: 'terrainSource',
  //         exaggeration: state.exaggeration || 1,
  //       })
  //       map.off('sourcedata', apply)
  //     }
  //   }
    
  //   if (map.getSource('terrainSource')) {
  //     map.setTerrain({ source: 'terrainSource', exaggeration: state.exaggeration || 1 })
  //   } else {
  //     map.off('sourcedata', apply) // Clean up any existing listener first
  //     map.on('sourcedata', apply)
  //   }
    
  //   return () => {
  //     map.off('sourcedata', apply)
  //   }
  // }, [state.exaggeration])

  // Sync terrain for Map A
  useEffect(() => {
    const map = mapARef.current?.getMap()
    if (!map || !mapALoaded) return
    applyTerrain(map, state.viewMode)
  }, [state.exaggeration, state.sourceA, state.viewMode, highResTerrain, mapALoaded, applyTerrain])
  // useEffect(() => {
  //   const map = mapARef.current?.getMap()
  //   if (!map || !mapALoaded) return
  //   return applyTerrain(map, state.viewMode)
  // }, [state.exaggeration, state.sourceA, state.viewMode, highResTerrain, mapALoaded, applyTerrain])

  // Sync terrain for Map B
  useEffect(() => {
    if (!state.splitScreen) return
    const map = mapBRef.current?.getMap()
    if (!map || !mapBLoaded) return
    applyTerrain(map, state.viewMode)
  }, [state.exaggeration, state.sourceB, state.viewMode, highResTerrain, mapBLoaded, state.splitScreen, applyTerrain])

  // Reset mapBLoaded when split screen is toggled off
  useEffect(() => {
    if (!state.splitScreen) {
      setMapBLoaded(false)
    }
  }, [state.splitScreen])
  
  // ----------------------------------------

  const [zoomRangeA, setZoomRangeA] = useState<{ minzoom: number; maxzoom: number; isCustom: boolean } | null>(null)
  const [zoomRangeB, setZoomRangeB] = useState<{ minzoom: number; maxzoom: number; isCustom: boolean } | null>(null)
  const [zoomRangeBasemap, setZoomRangeBasemap] = useState<{ minzoom: number; maxzoom: number; isCustom: boolean } | null>(null)

  // Only include a range in the computation if it came from a custom source — checked
  // directly against the id (a builtin source reporting a coincidental maxzoom of 20
  // shouldn't be mistaken for "no custom range" the way a fallback-value heuristic would).
  const isTerrainCustom = customTerrainSources.some(s => s.id === state.sourceA)
  // effectiveMinZoom/effectiveMaxZoom below are driven by the primary map only, so the
  // "active basemap" for zoom purposes is always map A's — basemapSourceA in per-view
  // mode, basemapSource otherwise.
  const activeBasemapSourceA = state.basemapPerView ? state.basemapSourceA : state.basemapSource
  const activeBasemapSourceB = state.basemapPerView ? state.basemapSourceB : state.basemapSource
  const isBasemapCustom = customBasemapSources.some(s => s.id === activeBasemapSourceA)

  // Shift the vanishing point left so it stays centered in the visible (non-obscured)
  // portion of the map when the floating sidebar covers the right edge.
  // Widths match the sidebar's own w-96/right-4 (desktop) and w-80 (mobile) classes.
  const mapPadding = useMemo(
    () => ({ top: 0, bottom: 0, left: 0, right: isSidebarOpen ? (isMobile ? 320 : 400) : 0 }),
    [isSidebarOpen, isMobile],
  )

  // Ease the padding change imperatively (matching the sidebar's own CSS transition
  // duration) rather than passing `padding` as a declarative prop — react-map-gl applies
  // prop changes via an instant jumpTo, which snaps the vanishing point instead of easing it.
  useEffect(() => {
    if (mapALoaded && mapARef.current) mapARef.current.getMap().easeTo({ padding: mapPadding, duration: 300 })
    if (mapBLoaded && mapBRef.current) mapBRef.current.getMap().easeTo({ padding: mapPadding, duration: 300 })
  }, [mapPadding, mapALoaded, mapBLoaded])

  const effectiveMaxZoom = useMemo(() => {
      const candidates = [
          isTerrainCustom && zoomRangeA ? zoomRangeA.maxzoom : null,
          isBasemapCustom && zoomRangeBasemap ? zoomRangeBasemap.maxzoom : null,
      ].filter((v): v is number => v !== null)
      return candidates.length > 0 ? Math.max(...candidates) : 22
  }, [zoomRangeA, zoomRangeBasemap, isTerrainCustom, isBasemapCustom])

  const effectiveMinZoom = useMemo(() => {
      const candidates = [
          isTerrainCustom && zoomRangeA ? zoomRangeA.minzoom : null,
          isBasemapCustom && zoomRangeBasemap ? zoomRangeBasemap.minzoom : null,
      ].filter((v): v is number => v !== null)
      return candidates.length > 0 ? Math.min(...candidates) : 0
  }, [zoomRangeA, zoomRangeBasemap, isTerrainCustom, isBasemapCustom])

  // Resolves the "Map Bounds" setting into an actual LngLatBoundsLike, async since
  // "terrain"/"raster"/"union" need a COG/tilejson metadata fetch (see
  // lib/max-bounds.ts) — same fallback chain as the Terrain Source panel's own
  // "Fit to bounds" button, just constraining pan/zoom instead of one-shot flying
  // the camera. Re-resolves whenever the active source or mode/buffer changes;
  // stale in-flight resolutions are dropped via the `cancelled` flag.
  const [resolvedMaxBounds, setResolvedMaxBounds] = useState<LngLatBoundsTuple | null>(null)

  useEffect(() => {
    if (state.maxBoundsMode === "none") {
      setResolvedMaxBounds(null)
      return
    }
    if (state.maxBoundsMode === "custom") {
      setResolvedMaxBounds([state.maxBoundsWest, state.maxBoundsSouth, state.maxBoundsEast, state.maxBoundsNorth])
      return
    }

    let cancelled = false
    const terrainSourceObj = customTerrainSources.find((s) => s.id === state.sourceA)
    const basemapSourceObj = customBasemapSources.find((s) => s.id === activeBasemapSourceA)
    const resolveOpts = { useCogProtocolVsTitiler, titilerEndpoint }

    ;(async () => {
      let bounds: LngLatBoundsTuple | null = null
      if (state.maxBoundsMode === "terrain") {
        bounds = await resolveCustomSourceBounds(terrainSourceObj, resolveOpts)
      } else if (state.maxBoundsMode === "raster") {
        bounds = await resolveCustomSourceBounds(basemapSourceObj, resolveOpts)
      } else if (state.maxBoundsMode === "union") {
        const [terrainBounds, rasterBounds] = await Promise.all([
          resolveCustomSourceBounds(terrainSourceObj, resolveOpts),
          resolveCustomSourceBounds(basemapSourceObj, resolveOpts),
        ])
        bounds = unionBounds(terrainBounds, rasterBounds)
      }
      if (!cancelled) setResolvedMaxBounds(bounds ? bufferBounds(bounds, state.maxBoundsBuffer) : null)
    })()

    return () => { cancelled = true }
  }, [
    state.maxBoundsMode, state.maxBoundsBuffer, state.maxBoundsWest, state.maxBoundsSouth, state.maxBoundsEast, state.maxBoundsNorth,
    state.sourceA, activeBasemapSourceA, customTerrainSources, customBasemapSources, useCogProtocolVsTitiler, titilerEndpoint,
  ])

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
          onMove={isPrimary ? onMoveA : onMoveB}
          onMoveEnd={isPrimary ? onMoveEndA : onMoveEndB}
          onLoad={() => {
            if (isPrimary) setMapALoaded(true)
            else setMapBLoaded(true)
            const map = isPrimary ? mapARef.current : mapBRef.current
            const mapInstance = map?.getMap()
            if (!mapInstance) return

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




            // // Override all texture bindings to use LINEAR
            // const gl = (mapInstance.painter as any).context.gl
            // const originalBindTexture = gl.bindTexture
            // gl.bindTexture = function(target: number, texture: WebGLTexture) {
            //   originalBindTexture.call(this, target, texture)
            //   if (target === gl.TEXTURE_2D) {
            //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            //     console.log('🔥 Forced LINEAR filtering')
            //   }
            // }

          }}
          sky={state.showBackground ? getSkyConfig() : getNoSkyConfig()}
          minPitch={0}
          maxPitch={state.viewMode === "2d" ? 0 : 85}
          rollEnabled={state.viewMode !== "2d"}
          // pitchWithRotate is a maplibre-gl-js *construction-time-only* option — there's no
          // imperative setter, so gating it on viewMode meant a map first created in "2d" mode
          // (pitchWithRotate baked in as false) stayed locked out of right-click-drag pitch
          // forever after switching to 3d/globe. maxPitch=0 already fully enforces the 2d
          // pitch lock, so this can just stay true and let maxPitch do the gating.
          pitchWithRotate={true}
          dragRotate={state.viewMode !== "2d"}
          // touchZoomRotate={state.viewMode !== "2d"}
          touchZoomRotate={true}
          // terrain={{
          //   source: "terrainSource",
          //   exaggeration: state.exaggeration || 1,
          // }}
          projection={state.viewMode === "globe" ? "globe" : "mercator"}
          canvasContextAttributes={{ preserveDrawingBuffer: true }}
          // pixelRatio={window.devicePixelRatio * 1.5}  // supersample (default is 1×)
          // pixelRatio={1.}  // supersample (default is 1×)
          pixelRatio={window.devicePixelRatio}  // supersample (default is 1×)
          // maxZoom={22}
          minZoom={effectiveMinZoom}
          maxZoom={effectiveMaxZoom}
          maxBounds={resolvedMaxBounds ?? undefined}

        >
          {/* Sources */}
          <TerrainSources
            source={source}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            customTerrainSources={customTerrainSources}
            titilerEndpoint={titilerEndpoint}
            onZoomRangeChange={isPrimary ? setZoomRangeA : setZoomRangeB}
          />
          <RasterBasemapSource
            basemapSource={isPrimary ? activeBasemapSourceA : activeBasemapSourceB}
            mapboxKey={mapboxKey}
            customBasemapSources={customBasemapSources}
            titilerEndpoint={titilerEndpoint}
            onZoomRangeChange={isPrimary ? setZoomRangeBasemap : undefined}
          />
          {state.basemapPerView && state.showRasterBasemap && (
            <OverlayBasemapSources
              overlayIds={state.overlayBasemapIds}
              customBasemapSources={customBasemapSources}
              titilerEndpoint={titilerEndpoint}
            />
          )}
          {/* Mounted whenever the "Slope and More" master is on — regardless of which
              specific sub-mode checkbox is checked — so toggling an individual
              sub-mode off and back on doesn't tear down maplibre's tile cache for it.
              SlopeReliefLayer etc (below) control per-mode visibility via
              layout.visibility instead of unmounting, for the same reason. */}
          <SlopeSource
            enabled={state.showSlopeAndMore}
            sourceMode={state.slopeSourceMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <AspectSource
            enabled={state.showSlopeAndMore}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <TriSource
            enabled={state.showSlopeAndMore}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <CurvatureSource
            enabled={state.showSlopeAndMore}
            mode={state.curvatureMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <TpiSource
            enabled={state.showSlopeAndMore}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <LrmSource
            enabled={state.showSlopeAndMore}
            radius={state.lrmRadius}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <RoughnessSource
            enabled={state.showSlopeAndMore}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <BlobnessSource
            enabled={state.showSlopeAndMore}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          {isPrimary && (
            <TellsSource
              enabled={state.showSlopeAndMore && state.showTells && tellsBetaEnabled}
              terrainSource={state.sourceA}
              customTerrainSources={customTerrainSources}
              mapboxKey={mapboxKey}
              maptilerKey={maptilerKey}
              titilerEndpoint={titilerEndpoint}
              tellsOptions={tellsOptions}
            />
          )}

          {/* Layers */}
          <LayerOrderSlots />

          {skyConfig.backgroundLayerActive && (
            <BackgroundLayer theme={theme as any} mapRef={mapARef as any} />
          )}
          <RasterLayer
            showRasterBasemap={state.showRasterBasemap}
            rasterBasemapOpacity={state.rasterBasemapOpacity * state.basemapSourceOpacity}
          />
          {state.basemapPerView && state.showRasterBasemap && (
            <OverlayBasemapLayers overlayIds={state.overlayBasemapIds} opacity={state.rasterBasemapOpacity} />
          )}
          <ColorReliefLayer
            showColorRelief={state.showColorRelief}
            colorReliefPaint={colorReliefPaint}
          />
          <SlopeReliefLayer showSlopeAndMore={state.showSlopeAndMore} showSlope={state.showSlope} slopeReliefPaint={slopeReliefPaint} />
          <AspectReliefLayer showSlopeAndMore={state.showSlopeAndMore} showAspect={state.showAspect} aspectReliefPaint={aspectReliefPaint} />
          <TriReliefLayer showSlopeAndMore={state.showSlopeAndMore} showTri={state.showTri} triReliefPaint={triReliefPaint} />
          <CurvatureReliefLayer showSlopeAndMore={state.showSlopeAndMore} showCurvature={state.showCurvature} curvatureReliefPaint={curvatureReliefPaint} />
          <TpiReliefLayer showSlopeAndMore={state.showSlopeAndMore} showTpi={state.showTpi} tpiReliefPaint={tpiReliefPaint} />
          <LrmReliefLayer showSlopeAndMore={state.showSlopeAndMore} showLrm={state.showLrm} lrmReliefPaint={lrmReliefPaint} />
          <RoughnessReliefLayer showSlopeAndMore={state.showSlopeAndMore} showRoughness={state.showRoughness} roughnessReliefPaint={roughnessReliefPaint} />
          <BlobnessReliefLayer showSlopeAndMore={state.showSlopeAndMore} showBlobness={state.showBlobness} blobnessReliefPaint={blobnessReliefPaint} />
          {isPrimary && <TellsMarkersLayer showTells={state.showSlopeAndMore && state.showTells && tellsBetaEnabled} />}
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
              mapLoaded={mapALoaded}
              theme={theme}
            />
          )}

          {/* Graticules — primary map only */}
          {isPrimary && state.showGraticules && (
            <GraticuleLayer
              showGraticules={state.showContoursAndGraticules && state.showGraticules}
              graticuleColor={themeAntiColor}
              // graticuleColor={effectiveGraticuleColor}
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
              {!activeProjectConfig?.hideMapControls?.includes("geocoder") && (
                <GeocoderControl
                  position="top-left"
                  placeholder="Search and press Enter"
                  // A small dot instead of maplibre-gl-geocoder's default big pin,
                  // matching the Elevation Picker's point markers for visual consistency.
                  marker={{
                    children: (
                      <div
                        style={{
                          width: 14, height: 14, borderRadius: "50%",
                          border: "2px solid white", boxShadow: "0 0 4px rgba(0,0,0,0.6)",
                          background: "#3b82f6",
                        }}
                      />
                    ),
                  }}
                  showResultsWhileTyping={true}
                  zoom={14}
                  flyTo={{ speed: 5 }}
                  showResultMarkers={false}
                  limit={10}
                  minLength={3}
                />
              )}
              {!activeProjectConfig?.hideMapControls?.includes("zoom") && (
                <NavigationControl position="top-left" />
              )}
              {!activeProjectConfig?.hideMapControls?.includes("geolocate") && (
                <GeolocateControl position="top-left" />
              )}

              {/* Minimap — no parentMap prop: it picks up the parent map via react-map-gl's
                  useMap() context, which is available as soon as the Map mounts rather than
                  waiting for mapALoaded (the 'load' event). Gating on mapALoaded needlessly
                  serialized the minimap's own load after the main map's, doubling perceived
                  load time instead of loading both concurrently. */}
              {!activeProjectConfig?.hideMapControls?.includes("minimap") && (
                <MinimapControl
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
                />
              )}

              {!activeProjectConfig?.hideMapControls?.includes("scale") && (
                <ScaleControl position="bottom-left" unit="metric" maxWidth={250} />
              )}

            </>
          )}
        </Map>
      )
    },
    [
      state.lat, state.lng, state.zoom, state.pitch, state.bearing, state.viewMode, state.exaggeration,
      state.basemapSource, state.basemapPerView, state.basemapSourceA, state.basemapSourceB, state.overlayBasemapIds,
      state.showRasterBasemap, state.rasterBasemapOpacity, state.basemapSourceOpacity, state.showHillshade,
      state.showColorRelief, state.showSlopeAndMore, state.showSlope, state.slopeSourceMode, state.showContours, state.showContoursAndGraticules, state.showContourLabels,
      state.showAspect, state.showTri, state.showCurvature, state.curvatureMode, state.showTpi, state.showLrm, state.lrmRadius, state.showRoughness, state.showBlobness,
      state.showTells, tellsOptions,
      state.showBackground, state.showGraticules, state.graticuleWidth, state.minimapMinimized,
      state.graticuleDensity, state.showGraticuleLabels, state.sourceB, state.splitScreen,
      state.sourceA, state.contourMinor, state.contourMajor,
      activeBasemapSourceA, activeBasemapSourceB,
      hillshadePaint, colorReliefPaint, slopeReliefPaint, aspectReliefPaint, triReliefPaint, curvatureReliefPaint,
      tpiReliefPaint, lrmReliefPaint, roughnessReliefPaint, blobnessReliefPaint,
      mapboxKey, maptilerKey, customTerrainSources, customBasemapSources, titilerEndpoint,
      mapALoaded, onMoveA, onMoveEndA, onMoveB, onMoveEndB,
      skyConfig.skyColor, skyConfig.skyHorizonBlend, skyConfig.horizonColor, skyConfig.horizonFogBlend,
      skyConfig.fogColor, skyConfig.fogGroundBlend, skyConfig.matchThemeColors, skyConfig.backgroundLayerActive,
      activeProjectConfig,
      themeColor,
      effectiveMinZoom, effectiveMaxZoom, setZoomRangeBasemap, resolvedMaxBounds
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
        mapLoaded={mapALoaded}
      />
    </div>
  )
}