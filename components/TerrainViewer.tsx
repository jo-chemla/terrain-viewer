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
import { COLOR_RAMP_IDS, computePropertyRampExpression, parseAsCustomRampStops, DEFAULT_SLOPE_CUSTOM_STOPS } from "@/lib/color-ramps"
import {HILLSHADE_METHODS, type TerrainSource } from "@/lib/terrain-types"
import { useAtom, useSetAtom } from "jotai"
import {
  mapboxKeyAtom, maptilerKeyAtom, customTerrainSourcesAtom, titilerEndpointAtom, skyConfigAtom, customBasemapSourcesAtom, highResTerrainAtom,
  activeProjectConfigAtom, useCogProtocolVsTitilerAtom, cacheVizTilesAtom,
  type CustomTerrainSource, type CustomBasemapSource,
} from "@/lib/settings-atoms"
import { hydrateAllPersistedCogs, localFileId, localFileVersionAtom } from "@/lib/local-file-store"
import { withTileResultCache, setTileResultCacheEnabled } from "@/lib/tile-result-cache"
import { MAX_BOUNDS_MODES, unionBounds, bufferBounds, resolveCustomSourceBounds, type LngLatBoundsTuple } from "@/lib/max-bounds"
import { sectionOpenAtom } from "./TerrainControlPanel/TerrainControlPanel"
import { getProjectConfig } from "@/lib/project-config"
import { useTheme } from "@/lib/controls-utils"
import { track } from "@/lib/analytics"
import { terrainSources } from "@/lib/terrain-sources"
import { BUILTIN_BASEMAP_OPTIONS } from "./TerrainControlPanel/raster-basemap-section"
import customSourcesData from "@/lib/custom-sources.json"

const SAMPLE_TERRAIN_SOURCES = customSourcesData["SAMPLE_TERRAIN_SOURCES"] as CustomTerrainSource[]
const SAMPLE_BASEMAP_SOURCES = customSourcesData["SAMPLE_BASEMAPS_SOURCES"] as CustomBasemapSource[]
import { MinimapControl } from "./MapControls/MinimapControl";
import { LightControlOverlay } from "./MapControls/LightControlOverlay";
import { useIsMobile } from '@/hooks/use-mobile'

import maplibregl from 'maplibre-gl'
import { cogProtocol, getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import { cogContourProtocol } from '@/lib/cog-contour-protocol'
import { float32demProtocol } from '@/lib/float32dem-protocol'
import { slopeProtocol } from '@/lib/slope-protocol'
import { aspectProtocol } from '@/lib/aspect-protocol'
import { triProtocol } from '@/lib/tri-protocol'
import { curvatureProtocol, CURVATURE_ENCODE_SCALE } from '@/lib/curvature-protocol'
import { tpiProtocol } from '@/lib/tpi-protocol'
import { roughnessProtocol } from '@/lib/roughness-protocol'
import { lrmProtocol } from '@/lib/lrm-protocol'
import { blobnessProtocol } from '@/lib/blobness-protocol'
import { svfProtocol } from '@/lib/svf-protocol'
import { opennessProtocol } from '@/lib/openness-protocol'
import { localDominanceProtocol } from '@/lib/local-dominance-protocol'
import { tellsProtocol } from '@/lib/tells-protocol'
import { normalsProtocol } from '@/lib/normals-protocol'
import { matcapProtocol } from '@/lib/matcap-protocol'
import { phongProtocol } from '@/lib/phong-protocol'
import { MATCAP_TEXTURES, DEFAULT_MATCAP_ID } from '@/lib/matcap-textures'

import { TerrainSources, RasterBasemapSource, OverlayBasemapSources, SlopeSource, AspectSource, TriSource, CurvatureSource, TpiSource, LrmSource, RoughnessSource, BlobnessSource, SvfSource, OpennessSource, LocalDominanceSource, TellsSource, MatcapSource, PhongSource } from "./LayersAndSources/MapSources"
import { PhongLiveGlLayer } from "./LayersAndSources/PhongLiveGlLayer"
import {
  LayerOrderSlots,
  RasterLayer,
  OverlayBasemapLayers,
  BackgroundLayer,
  HillshadeLayer,
  MatcapRasterLayer,
  PhongRasterLayer,
  ColorReliefLayer,
  SlopeReliefLayer,
  AspectReliefLayer,
  TriReliefLayer,
  CurvatureReliefLayer,
  TpiReliefLayer,
  LrmReliefLayer,
  RoughnessReliefLayer,
  BlobnessReliefLayer,
  SvfReliefLayer,
  OpennessReliefLayer,
  LocalDominanceReliefLayer,
  TellsMarkersLayer,
  TellsUnfilteredLoaderLayer,
  TellsInspectPopup,
  TELLS_MEASURED_SCALE_MULTIPLIER_DEFAULT,
  PlaneSlicerLayer,
  LAYER_SLOTS,
  computeHillshadePaint,
  computeColorReliefPaint,
  computePlaneSlicerPaint,
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
const OPENNESS_MODES = ['positive', 'negative'] as const
const PLANE_SLICER_REFERENCE_MODES = ['absolute', 'lrm'] as const
const PLANE_SLICER_SIDES = ['above', 'below'] as const
const TELLS_STYLES = ['outline', 'byBlobness', 'byPlan', 'byDetHessian', 'byLrm'] as const
const TELL_VETO_RESOLUTIONS = ['fine', 'coarse'] as const

function matcapUrlFor(textureId: string): string {
  return (MATCAP_TEXTURES.find((t) => t.id === textureId) ?? MATCAP_TEXTURES.find((t) => t.id === DEFAULT_MATCAP_ID)!).url
}

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
  const bumpLocalFileVersion = useSetAtom(localFileVersionAtom)
  // One-shot, on mount: repopulate this session's in-memory local-file-store
  // (see its header comment) from OPFS for every "cog-local" source already
  // in customTerrainSourcesAtom or customBasemapSourcesAtom, so a persisted
  // local COG is usable again without the "Re-select file…" prompt. Only
  // needs to run once — sources added *after* mount get their File registered
  // live by the normal pick flow (custom-terrain-source-modal.tsx /
  // custom-basemap-modal.tsx), not through this path.
  useEffect(() => {
    const ids = [...customTerrainSources, ...customBasemapSources]
      .filter((s) => s.type === "cog-local")
      .map((s) => localFileId(s.url))
    if (ids.length === 0) return
    let cancelled = false
    hydrateAllPersistedCogs(ids, () => {
      if (!cancelled) bumpLocalFileVersion((v) => v + 1)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
  const [highResTerrain] = useAtom(highResTerrainAtom)
  // Latches true the first time the detector is turned on (showTellsDetector),
  // and then stays true — this is TellsSource's mount gate instead of
  // showTellsDetector itself, so toggling the detector (or just its markers'
  // visibility, tellsMarkersVisible — a separate, independent flag) back off
  // never unmounts the vector source / discards its already-fetched tiles the
  // way tying the source's `enabled` directly to either flag would.
  const [tellsEverActivated, setTellsEverActivated] = useState(false)
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
    // Native MapLibre Hillshade — its own independent viz mode, entirely
    // separate from "Lighting Effects" (Matcap/Phong) below. Paint built by
    // computeHillshadePaint (MapLayers.tsx) from hillshadeMethod/
    // illuminationDir/illuminationAlt/shadowColor/highlightColor/
    // hillshadeExag/accentColor further down this block.
    showHillshade: parseAsBoolean.withDefault(true),
    hillshadeOpacity: parseAsFloat.withDefault(1.0),
    // "Lighting Effects" viz mode — master toggle/opacity, housing two
    // sub-modes: Matcap first, Phong second (see
    // lighting-effects-options-section.tsx). Composites (multiplies) with
    // each sub-mode's own opacity below, same master-vs-submode pattern as
    // Relief Visualization's LRM/SVF/Openness.
    showLightingEffects: parseAsBoolean.withDefault(false),
    lightingEffectsOpacity: parseAsFloat.withDefault(1.0),
    // "Matcap" sub-mode (lib/matcap-protocol.ts) — a plain raster overlay
    // (draped over 3D terrain the same automatic way the raster basemap is)
    // that looks up color from a material-capture image using the surface
    // normal as UV, instead of a directional light.
    showMatcap: parseAsBoolean.withDefault(false),
    matcapOpacity: parseAsFloat.withDefault(1.0),
    matcapTextureId: parseAsString.withDefault(DEFAULT_MATCAP_ID),
    // "Sphere Rotation" — spins the matcap lookup independently of the map's
    // own bearing (a raster tile is baked once per z/x/y, so it can't track
    // live bearing the way a real-time GPU shader could).
    matcapRotationDeg: parseAsFloat.withDefault(0),
    // "Phong" sub-mode (lib/phong-protocol.ts) — a plain raster overlay doing
    // real ambient+diffuse+specular shading from a compass-fixed light
    // (state.illuminationDir/illuminationAlt below — the same fields the
    // on-map "hold L, drag" light control uses). Albedo intentionally has no
    // field of its own — it reuses rasterBasemapOpacity directly, per the
    // request that spawned this ("Albedo (raster basemap opacity)").
    showPhong: parseAsBoolean.withDefault(true),
    phongOpacity: parseAsFloat.withDefault(1.0),
    phongDiffuseStrength: parseAsFloat.withDefault(0.8),
    phongSpecularStrength: parseAsFloat.withDefault(0.2),
    // Off (default): illuminationDir is a compass azimuth, fixed to the
    // world, matching maplibre's own hillshade illumination-direction — the
    // light doesn't move when you rotate the map. On: the light is fixed
    // relative to the CAMERA instead — illuminationDir + the map's own
    // bearing is baked into the phong:// tile as its effective azimuth (see
    // the PhongSource lightDir prop below), so the light appears to stay
    // "over your shoulder" as you spin the view. state.bearing only settles
    // 500ms after a rotate gesture ends (see commitViewState) rather than
    // updating continuously mid-drag, so this doesn't turn map rotation into
    // a rapid-fire tile-recompute trigger the way it would if bearing were
    // live-tracked.
    phongLightRelativeToCamera: parseAsBoolean.withDefault(false),
    // "raster" (default): lib/phong-protocol.ts's plain raster-tile pipeline —
    // drapes correctly over 3D terrain exaggeration AND globe, but every
    // light/strength/exaggeration change costs a real tile refetch (~150ms
    // debounced). "live": lib/phong-live-gl-layer.ts's CustomLayerInterface —
    // instant GPU-uniform updates, zero refetch, but flat-only (no terrain
    // drape, no globe — see that file's header for why not) and only
    // meaningful outside "globe" view mode; see lighting-effects-options-
    // section.tsx for the UI toggle exposing this trade-off directly.
    phongRenderer: parseAsStringLiteral(["raster", "live"] as const).withDefault("raster"),
    // "Datetime-based" light: when on, illuminationDir/illuminationAlt are
    // driven from a physically-plausible sun position (see lib/solar-position.ts)
    // computed from the viewport-center lat/lng + these day-of-year (1–365) and
    // time-of-day (local solar hours, 0–24) values, instead of the free XY-pad
    // pick. The XY pad still just reflects the resulting illuminationDir/Alt.
    phongLightUseDatetime: parseAsBoolean.withDefault(false),
    phongLightDayOfYear: parseAsFloat.withDefault(172), // ~summer solstice
    phongLightTimeOfDay: parseAsFloat.withDefault(15),  // mid-afternoon
    showColorRelief: parseAsBoolean.withDefault(false),
    colorReliefOpacity: parseAsFloat.withDefault(0.35),
    // Master toggles for what used to be one merged "Slope and More" viz mode,
    // now split into Terrain Analysis (surface derivatives + neighborhood
    // statistics: Slope/Aspect/Curvature/Det Hessian/Blobness/TPI/TRI/Roughness —
    // see terrain-analysis-section.tsx) and Relief Visualization (multi-scale
    // relief/visibility: LRM/SVF/Openness — see relief-visualization-section.tsx).
    // Each mirrors showContoursAndGraticules's master-toggle pattern. Slope is the
    // only Terrain Analysis sub-mode on by default; the rest default off, matching
    // the old standalone-Slope-toggle behavior the first time this is turned on.
    showTerrainAnalysis: parseAsBoolean.withDefault(false),
    // Master opacity for Terrain Analysis — composites (multiplies) with each
    // sub-mode's own opacity below, rather than replacing it.
    terrainAnalysisOpacity: parseAsFloat.withDefault(1.0),
    showReliefVisualization: parseAsBoolean.withDefault(false),
    reliefVisualizationOpacity: parseAsFloat.withDefault(1.0),
    showSlope: parseAsBoolean.withDefault(true),
    slopeOpacity: parseAsFloat.withDefault(1.0),
    slopeColorRamp: parseAsString.withDefault("slope-plantopo"),
    slopeSourceMode: parseAsStringLiteral(SLOPE_SOURCE_MODES).withDefault("client"),
    slopeMinDegrees: parseAsFloat.withDefault(0),
    slopeMaxDegrees: parseAsFloat.withDefault(55),
    slopeInvertColorRamp: parseAsBoolean.withDefault(false),
    // Only read when slopeColorRamp === "custom" — see computeColorReliefPaint's
    // dedicated branch for that ramp id in MapLayers.tsx.
    slopeCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    // When the custom ramp is selected, render its stops as hard discrete bands
    // (each color holds until the next stop) instead of a continuous gradient.
    slopeCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showAspect: parseAsBoolean.withDefault(false),
    aspectOpacity: parseAsFloat.withDefault(0.5),
    aspectColorRamp: parseAsString.withDefault("aspect-compass"),
    aspectMinDegrees: parseAsFloat.withDefault(0),
    aspectMaxDegrees: parseAsFloat.withDefault(360),
    aspectShiftDegrees: parseAsFloat.withDefault(0),
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
    showLrm: parseAsBoolean.withDefault(true),
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
    showSvf: parseAsBoolean.withDefault(false),
    svfOpacity: parseAsFloat.withDefault(1.0),
    svfColorRamp: parseAsString.withDefault("svf-default"),
    svfMin: parseAsFloat.withDefault(0),
    svfMax: parseAsFloat.withDefault(100),
    svfInvertColorRamp: parseAsBoolean.withDefault(false),
    svfRadius: parseAsFloat.withDefault(8),
    showOpenness: parseAsBoolean.withDefault(false),
    opennessOpacity: parseAsFloat.withDefault(1.0),
    opennessColorRamp: parseAsString.withDefault("openness-default"),
    opennessMin: parseAsFloat.withDefault(-15),
    opennessMax: parseAsFloat.withDefault(15),
    opennessInvertColorRamp: parseAsBoolean.withDefault(false),
    opennessSymmetric: parseAsBoolean.withDefault(true),
    opennessRadius: parseAsFloat.withDefault(8),
    opennessMode: parseAsStringLiteral(OPENNESS_MODES).withDefault("positive"),
    // Local Dominance (Hesse 2016) — Relief Visualization mode, see
    // lib/local-dominance-protocol.ts. Mean downward view angle onto the terrain
    // over the [min,max]-radius annulus; grayscale, dark=depression/light=mound.
    // Range in degrees, defaulting to the local-dominance-default ramp's own
    // stops (small positive baseline on flat ground, hence the asymmetric range).
    showLocalDominance: parseAsBoolean.withDefault(false),
    localDominanceOpacity: parseAsFloat.withDefault(1.0),
    localDominanceColorRamp: parseAsString.withDefault("local-dominance-default"),
    localDominanceMin: parseAsFloat.withDefault(-5),
    localDominanceMax: parseAsFloat.withDefault(15),
    localDominanceInvertColorRamp: parseAsBoolean.withDefault(false),
    localDominanceMinRadius: parseAsFloat.withDefault(8),
    localDominanceMaxRadius: parseAsFloat.withDefault(32),
    // Plane Slicer — Tools: Elevation Picker sub-section. Paints one solid color
    // above or below a chosen elevation/LRM-height plane. See PlaneSlicerLayer/
    // computePlaneSlicerPaint in MapLayers.tsx.
    showPlaneSlicer: parseAsBoolean.withDefault(false),
    planeSlicerReferenceMode: parseAsStringLiteral(PLANE_SLICER_REFERENCE_MODES).withDefault("absolute"),
    // Absolute and LRM keep independent threshold values — the two reference
    // frames have wildly different natural ranges (metres of real elevation vs.
    // ±metres of local relief), so switching between them restores each mode's
    // own last value instead of dragging one number across both. planeSlicerValue
    // is the Absolute one; planeSlicerValueLrm the LRM one. The active value is
    // picked by planeSlicerReferenceMode (see planeSlicerPaint / plane-slicer-fields).
    planeSlicerValue: parseAsFloat.withDefault(0),
    planeSlicerValueLrm: parseAsFloat.withDefault(0),
    planeSlicerSide: parseAsStringLiteral(PLANE_SLICER_SIDES).withDefault("below"),
    planeSlicerColor: parseAsString.withDefault("#3388ff"),
    planeSlicerOpacity: parseAsFloat.withDefault(0.6),
    // Experimental — opt-in via Settings (or ?tellsBeta=true directly) so it doesn't
    // clutter Visualization Modes for everyone by default.
    tellsBeta: parseAsBoolean.withDefault(false),
    // Master on/off (Visualization Modes' "Tells (Mound Detector)" checkbox) —
    // gates the sidebar's Mound Candidates section as well as the map layer.
    // Independent from tellsMarkersVisible below: this is "is the detector
    // active at all", not "are its markers currently painted".
    showTellsDetector: parseAsBoolean.withDefault(false),
    // Mound Candidates section's own "Show mound candidates" checkbox — a pure
    // paint-visibility toggle for markers already being computed, independent
    // of showTellsDetector so it can't also collapse the section it lives in,
    // and independent of tellsStyle so switching color-by styles never needs
    // to remember/restore a "last visible style" the way a single combined
    // hidden|outline|byLrm|... field used to require.
    tellsMarkersVisible: parseAsBoolean.withDefault(true),
    tellsStyle: parseAsStringLiteral(TELLS_STYLES).withDefault("outline"),
    tellsOutlineColor: parseAsColor().withDefault("#ef4444"),
    // Only meaningful with tellMeasureScale on: draw each marker at
    // tellsScaleMultiplier x its measured diameter (real-world meters,
    // zoom-scaled) instead of fixed px.
    tellsScaleMarkers: parseAsBoolean.withDefault(true),
    tellsScaleMultiplier: parseAsFloat.withDefault(TELLS_MEASURED_SCALE_MULTIPLIER_DEFAULT),
    tellSize: parseAsFloat.withDefault(100),
    tellRadius: parseAsFloat.withDefault(4),
    tellMinRelief: parseAsFloat.withDefault(1.5),
    tellBlobnessMin: parseAsFloat.withDefault(0),
    tellPlanMin: parseAsFloat.withDefault(0),
    tellDetHessianMin: parseAsFloat.withDefault(0),
    tellMeasureScale: parseAsBoolean.withDefault(true),
    tellVetoResolution: parseAsStringLiteral(TELL_VETO_RESOLUTIONS).withDefault("coarse"),
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
    // Multiplies both major and minor contour line-width — default (1) keeps
    // today's major-vs-minor ratio, 2/4 make both proportionally bolder.
    contourWeight: parseAsFloat.withDefault(1),
    // Contour line / graticule colors — empty string means "auto" (theme-adaptive:
    // the contour lines fall back to translucent black/white by theme, the grid to
    // themeAntiColor). A non-empty hex from the color pickers (contour-options-
    // section.tsx) overrides that and stops adapting to the theme.
    contourColor: parseAsString.withDefault(""),
    customHypsoMinMax: parseAsBoolean.withDefault(false),
    minElevation: parseAsFloat.withDefault(0),
    maxElevation: parseAsFloat.withDefault(8100),
    hypsoSliderMinBound: parseAsFloat.withDefault(-8000),
    hypsoSliderMaxBound: parseAsFloat.withDefault(5000),
    graticuleWidth: parseAsFloat.withDefault(1.0),
    graticuleColor: parseAsString.withDefault(""),
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
  // a 0-55° slope domain. Opacity composites (multiplies) with the "Terrain Analysis"
  // master opacity rather than replacing it — see VisualizationModesSection.
  const slopeReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.slopeColorRamp,
      customStops: state.slopeCustomStops,
      customStopsDiscrete: state.slopeCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.slopeMinDegrees,
      maxElevation: state.slopeMaxDegrees,
      colorReliefOpacity: state.slopeOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.slopeInvertColorRamp,
    }),
    [ state.slopeColorRamp, state.slopeCustomStops, state.slopeCustomStopsDiscrete, state.slopeMinDegrees, state.slopeMaxDegrees, state.slopeOpacity, state.terrainAnalysisOpacity, state.slopeInvertColorRamp ]
  )

  // Aspect/TRI/curvature: same trick as slope above, just with their own state fields.
  const aspectReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.aspectColorRamp,
      customHypsoMinMax: true,
      minElevation: state.aspectMinDegrees,
      maxElevation: state.aspectMaxDegrees,
      colorReliefOpacity: state.aspectOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.aspectInvertColorRamp,
      shiftDegrees: state.aspectShiftDegrees,
    }),
    [ state.aspectColorRamp, state.aspectMinDegrees, state.aspectMaxDegrees, state.aspectOpacity, state.terrainAnalysisOpacity, state.aspectInvertColorRamp, state.aspectShiftDegrees ]
  )

  const triReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.triColorRamp,
      customHypsoMinMax: true,
      minElevation: state.triMin,
      maxElevation: state.triMax,
      colorReliefOpacity: state.triOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.triInvertColorRamp,
    }),
    [ state.triColorRamp, state.triMin, state.triMax, state.triOpacity, state.terrainAnalysisOpacity, state.triInvertColorRamp ]
  )

  const curvatureReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.curvatureColorRamp,
      customHypsoMinMax: true,
      // The curvature:// protocol wire-encodes its value ×CURVATURE_ENCODE_SCALE
      // for finer Terrarium quantization (see curvature-protocol.ts) — the raw
      // ["elevation"] this color-relief layer reads back is scaled the same
      // way, so the ramp's min/max need the same factor to line up. The
      // slider/state itself (curvatureMin/Max) stays in ordinary curvature units.
      minElevation: state.curvatureMin * CURVATURE_ENCODE_SCALE,
      maxElevation: state.curvatureMax * CURVATURE_ENCODE_SCALE,
      colorReliefOpacity: state.curvatureOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.curvatureInvertColorRamp,
    }),
    [ state.curvatureColorRamp, state.curvatureMin, state.curvatureMax, state.curvatureOpacity, state.terrainAnalysisOpacity, state.curvatureInvertColorRamp ]
  )

  const tpiReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.tpiColorRamp,
      customHypsoMinMax: true,
      minElevation: state.tpiMin,
      maxElevation: state.tpiMax,
      colorReliefOpacity: state.tpiOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.tpiInvertColorRamp,
    }),
    [ state.tpiColorRamp, state.tpiMin, state.tpiMax, state.tpiOpacity, state.terrainAnalysisOpacity, state.tpiInvertColorRamp ]
  )

  const lrmReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.lrmColorRamp,
      customHypsoMinMax: true,
      minElevation: state.lrmMin,
      maxElevation: state.lrmMax,
      colorReliefOpacity: state.lrmOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.lrmInvertColorRamp,
    }),
    [ state.lrmColorRamp, state.lrmMin, state.lrmMax, state.lrmOpacity, state.reliefVisualizationOpacity, state.lrmInvertColorRamp ]
  )

  const planeSlicerPaint = useMemo(
    () => computePlaneSlicerPaint({
      value: state.planeSlicerReferenceMode === "lrm" ? state.planeSlicerValueLrm : state.planeSlicerValue,
      side: state.planeSlicerSide,
      color: state.planeSlicerColor,
      opacity: state.planeSlicerOpacity,
    }),
    [ state.planeSlicerReferenceMode, state.planeSlicerValue, state.planeSlicerValueLrm, state.planeSlicerSide, state.planeSlicerColor, state.planeSlicerOpacity ]
  )

  const roughnessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.roughnessColorRamp,
      customHypsoMinMax: true,
      minElevation: state.roughnessMin,
      maxElevation: state.roughnessMax,
      colorReliefOpacity: state.roughnessOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.roughnessInvertColorRamp,
    }),
    [ state.roughnessColorRamp, state.roughnessMin, state.roughnessMax, state.roughnessOpacity, state.terrainAnalysisOpacity, state.roughnessInvertColorRamp ]
  )

  const blobnessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.blobnessColorRamp,
      customHypsoMinMax: true,
      minElevation: state.blobnessMin,
      maxElevation: state.blobnessMax,
      colorReliefOpacity: state.blobnessOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.blobnessInvertColorRamp,
    }),
    [ state.blobnessColorRamp, state.blobnessMin, state.blobnessMax, state.blobnessOpacity, state.terrainAnalysisOpacity, state.blobnessInvertColorRamp ]
  )

  const svfReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.svfColorRamp,
      customHypsoMinMax: true,
      minElevation: state.svfMin,
      maxElevation: state.svfMax,
      colorReliefOpacity: state.svfOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.svfInvertColorRamp,
    }),
    [ state.svfColorRamp, state.svfMin, state.svfMax, state.svfOpacity, state.reliefVisualizationOpacity, state.svfInvertColorRamp ]
  )

  const opennessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.opennessColorRamp,
      customHypsoMinMax: true,
      minElevation: state.opennessMin,
      maxElevation: state.opennessMax,
      colorReliefOpacity: state.opennessOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.opennessInvertColorRamp,
    }),
    [ state.opennessColorRamp, state.opennessMin, state.opennessMax, state.opennessOpacity, state.reliefVisualizationOpacity, state.opennessInvertColorRamp ]
  )

  const localDominanceReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.localDominanceColorRamp,
      customHypsoMinMax: true,
      minElevation: state.localDominanceMin,
      maxElevation: state.localDominanceMax,
      colorReliefOpacity: state.localDominanceOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.localDominanceInvertColorRamp,
    }),
    [ state.localDominanceColorRamp, state.localDominanceMin, state.localDominanceMax, state.localDominanceOpacity, state.reliefVisualizationOpacity, state.localDominanceInvertColorRamp ]
  )

  // circle-color expressions for the tells color-by marker styles, built from
  // the SAME ramp/range/invert state as the corresponding Slope-and-More layer
  // (byPlan and byDetHessian both follow the Curvature controls, byLrm follows
  // LRM, byBlobness follows Blobness) so tuning a mode's ramp re-colors the
  // markers identically instead of drifting against a hardcoded palette.
  const tellsColorByPaints = useMemo(
    () => ({
      byBlobness: computePropertyRampExpression(state.blobnessColorRamp, state.blobnessMin, state.blobnessMax, state.blobnessInvertColorRamp, "blobness"),
      // byPlan runs the curvature ramp INVERTED relative to the layer's own
      // setting: the tells "plan" tag is positive outward convexity, while the
      // curvature layer's convention is negative=convex — without the flip, the
      // most mound-like candidates land on the ramp's valley-colored end.
      byPlan: computePropertyRampExpression(state.curvatureColorRamp, state.curvatureMin, state.curvatureMax, !state.curvatureInvertColorRamp, "plan"),
      byDetHessian: computePropertyRampExpression(state.curvatureColorRamp, state.curvatureMin, state.curvatureMax, state.curvatureInvertColorRamp, "detHessian"),
      byLrm: computePropertyRampExpression(state.lrmColorRamp, state.lrmMin, state.lrmMax, state.lrmInvertColorRamp, "a"),
    }),
    [
      state.blobnessColorRamp, state.blobnessMin, state.blobnessMax, state.blobnessInvertColorRamp,
      state.curvatureColorRamp, state.curvatureMin, state.curvatureMax, state.curvatureInvertColorRamp,
      state.lrmColorRamp, state.lrmMin, state.lrmMax, state.lrmInvertColorRamp,
    ]
  )

  const tellsOptions = useMemo(
    () => ({
      tellSizeMeters: state.tellSize,
      radiusPx: state.tellRadius,
      minReliefMeters: state.tellMinRelief,
      blobnessMin: state.tellBlobnessMin,
      planMin: state.tellPlanMin,
      detHessianMin: state.tellDetHessianMin,
      measureScale: state.tellMeasureScale,
      vetoResolution: state.tellVetoResolution,
    }),
    [ state.tellSize, state.tellRadius, state.tellMinRelief, state.tellBlobnessMin, state.tellPlanMin, state.tellDetHessianMin, state.tellMeasureScale, state.tellVetoResolution ]
  )

  useEffect(() => {
    if (state.showTellsDetector) setTellsEverActivated(true)
  }, [state.showTellsDetector]
  )

  // Check MapLibre availability
  useEffect(() => {
    setMapLibreReady(true)
  }, [])

  // ─── Feature-usage analytics (umami custom events) ─────────────────────────
  // Discrete, intentional-action events — a viz mode switched on, the view mode
  // or Phong renderer changed, a terrain source picked — so the dashboard shows
  // what people actually USE, distinct from the (query-param-driven) pageview
  // stream. A ref snapshot fires events only on real transitions and skips the
  // initial mount, so defaults / URL-restored state aren't miscounted as usage.
  const analyticsPrev = useRef<Record<string, unknown> | null>(null)
  useEffect(() => {
    // Master viz-mode toggles (the "Visualization Modes" checkboxes) vs the
    // sub-modes housed inside them — tracked as separate event names so the
    // dashboard can tell "opened Relief Visualization" from "used SVF".
    const VIZ_MASTERS = [
      "showHillshade", "showColorRelief", "showRasterBasemap", "showContoursAndGraticules", "showBackground",
      "showLightingEffects", "showReliefVisualization", "showTerrainAnalysis",
    ] as const
    const VIZ_SUBMODES = [
      "showMatcap", "showPhong",
      "showLrm", "showSvf", "showOpenness", "showLocalDominance",
      "showSlope", "showAspect", "showTri", "showCurvature", "showTpi", "showRoughness", "showBlobness",
      "showContours", "showGraticules",
    ] as const
    const activeBasemap = state.basemapPerView ? state.basemapSourceA : state.basemapSource
    const prev = analyticsPrev.current
    const snapshot: Record<string, unknown> = {
      viewMode: state.viewMode, phongRenderer: state.phongRenderer,
      sourceA: state.sourceA, basemap: activeBasemap, splitScreen: state.splitScreen,
      // A few discrete sub-mode settings worth knowing which values people pick
      // (not every slider — just the categorical choices).
      hillshadeMethod: state.hillshadeMethod,
      slopeColorRamp: state.slopeColorRamp, curvatureMode: state.curvatureMode,
    }
    for (const k of [...VIZ_MASTERS, ...VIZ_SUBMODES]) snapshot[k] = state[k]
    snapshot.showPlaneSlicer = state.showPlaneSlicer
    snapshot.showTellsDetector = state.showTellsDetector

    if (prev) {
      // Only the false→true edge — "turned it on" is the usage signal; off is noise.
      for (const k of VIZ_MASTERS) if (state[k] && !prev[k]) track("viz-mode", { mode: k.replace(/^show/, "") })
      for (const k of VIZ_SUBMODES) if (state[k] && !prev[k]) track("viz-sub-mode", { mode: k.replace(/^show/, "") })
      if (state.showPlaneSlicer && !prev.showPlaneSlicer) track("tools-elevation-picker", { mode: "plane-slicer" })
      if (state.showTellsDetector && !prev.showTellsDetector) track("tools-tells", {})
      if (state.viewMode !== prev.viewMode) track("view-mode", { mode: state.viewMode })
      if (state.phongRenderer !== prev.phongRenderer) track("phong-renderer", { renderer: state.phongRenderer })
      if (state.splitScreen !== prev.splitScreen) track("tools-split-screen", { enabled: state.splitScreen })
      if (state.sourceA !== prev.sourceA) {
        track("source-terrain", { source: state.sourceA, custom: customTerrainSources.some((s) => s.id === state.sourceA) })
      }
      if (activeBasemap !== prev.basemap) {
        track("source-basemap", { source: activeBasemap, custom: customBasemapSources.some((s) => s.id === activeBasemap) })
      }
      if (state.hillshadeMethod !== prev.hillshadeMethod) track("options-hillshade", { method: state.hillshadeMethod })
      if (state.slopeColorRamp !== prev.slopeColorRamp) track("options-terrain-analysis", { setting: "slopeColorRamp", value: state.slopeColorRamp })
      if (state.curvatureMode !== prev.curvatureMode) track("options-terrain-analysis", { setting: "curvatureMode", value: state.curvatureMode })
    }
    analyticsPrev.current = snapshot
  }, [state, customTerrainSources, customBasemapSources])

  // "User added a new source" — a growth in the persisted custom-source lists.
  // The baseline is captured on the first run (jotai atomWithStorage hydrates
  // synchronously, so mount-time restores aren't miscounted as fresh adds).
  const prevTerrainCount = useRef<number | null>(null)
  const prevBasemapCount = useRef<number | null>(null)
  useEffect(() => {
    if (prevTerrainCount.current !== null && customTerrainSources.length > prevTerrainCount.current) {
      track("source-add", { kind: "terrain", type: customTerrainSources[customTerrainSources.length - 1]?.type })
    }
    prevTerrainCount.current = customTerrainSources.length
  }, [customTerrainSources])
  useEffect(() => {
    if (prevBasemapCount.current !== null && customBasemapSources.length > prevBasemapCount.current) {
      track("source-add", { kind: "basemap", type: customBasemapSources[customBasemapSources.length - 1]?.type })
    }
    prevBasemapCount.current = customBasemapSources.length
  }, [customBasemapSources])

  // Register the COG protocol. All in-house derived protocols go through
  // withTileResultCache so hiding/re-showing a mode (which makes maplibre drop
  // and re-request its tiles) replays finished bytes instead of recomputing —
  // cog is the external geomatico handler with its own fetch semantics, left bare.
  useEffect(() => {
    maplibregl.addProtocol('cog', cogProtocol)
    // Own fetch semantics (delegates to a dedicated Worker) same as 'cog' — see
    // lib/cog-contour-protocol.ts for why this can't be maplibre-contour's own
    // DemSource/worker path.
    maplibregl.addProtocol('cog-contour', cogContourProtocol)
    maplibregl.addProtocol('float32dem', withTileResultCache(float32demProtocol))
    maplibregl.addProtocol('slope', withTileResultCache(slopeProtocol))
    maplibregl.addProtocol('aspect', withTileResultCache(aspectProtocol))
    maplibregl.addProtocol('tri', withTileResultCache(triProtocol))
    maplibregl.addProtocol('curvature', withTileResultCache(curvatureProtocol))
    maplibregl.addProtocol('tpi', withTileResultCache(tpiProtocol))
    maplibregl.addProtocol('lrm', withTileResultCache(lrmProtocol))
    maplibregl.addProtocol('roughness', withTileResultCache(roughnessProtocol))
    maplibregl.addProtocol('blobness', withTileResultCache(blobnessProtocol))
    maplibregl.addProtocol('svf', withTileResultCache(svfProtocol))
    maplibregl.addProtocol('openness', withTileResultCache(opennessProtocol))
    maplibregl.addProtocol('local-dominance', withTileResultCache(localDominanceProtocol))
    maplibregl.addProtocol('tells', withTileResultCache(tellsProtocol))
    // Not wrapped in withTileResultCache — this is a debug-only registration,
    // not consumed by any mounted Source (see its own header comment):
    // pointing a plain raster Source at `normals://...` visually sanity-
    // checks a normal map's output independent of matcap:// / phong://'s own
    // further per-pixel transform of that same normal data.
    maplibregl.addProtocol('normals', normalsProtocol)
    // Plain raster protocols, like every derived mode above — see
    // lib/matcap-protocol.ts / lib/phong-protocol.ts's headers for why these
    // are CPU-computed raster tiles (draped over 3D terrain AND globe
    // automatically, like the raster basemap) rather than a custom WebGL
    // layer with its own mesh/projection matrix.
    maplibregl.addProtocol('matcap', withTileResultCache(matcapProtocol))
    maplibregl.addProtocol('phong', withTileResultCache(phongProtocol))
  }, [])

  // Keep the module-level cache flag in sync with the persisted Settings switch
  // (protocol handlers run outside React, so they can't read the atom directly).
  const [cacheVizTiles] = useAtom(cacheVizTilesAtom)
  useEffect(() => {
    setTileResultCacheEnabled(cacheVizTiles)
  }, [cacheVizTiles])

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

  // 2D is a strict nadir, north-up top-down view: reset bearing + pitch to 0 on
  // entry (rotation/pitch are also disabled while in 2D — see the Map props).
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

  // <Map minZoom/maxZoom> are left as fixed constants (see the JSX below) rather
  // than driven declaratively from effectiveMinZoom/effectiveMaxZoom: react-map-
  // gl's _updateSettings applies a changed (min, max) pair as two separate calls
  // — map.setMinZoom(newMin) before map.setMaxZoom(newMax) — each validated
  // against the map's CURRENT (not-yet-updated) other bound. Switching from one
  // narrow custom-source zoom range to another whose minzoom exceeds the
  // previous maxzoom (e.g. a BYOD source capped at z14 to a local COG whose
  // native resolution starts at z15) throws "minZoom must be between -2 and the
  // current maxZoom" — the new minZoom is valid against the new maxZoom, just
  // not yet against the old one. A two-phase "widen then narrow on next tick"
  // React-state workaround was tried here and still raced under rapid source
  // switching (zoomRangeA/zoomRangeBasemap can each retrigger independently).
  // Applying both bounds imperatively — querying the map's actual live current
  // maxZoom right before choosing which setter to call first — sidesteps the
  // ordering assumption entirely instead of trying to out-time it.
  const applySafeZoomBounds = useCallback((map: maplibregl.Map, minZoom: number, maxZoom: number) => {
    if (minZoom > map.getMaxZoom()) {
      map.setMaxZoom(maxZoom)
      map.setMinZoom(minZoom)
    } else {
      map.setMinZoom(minZoom)
      map.setMaxZoom(maxZoom)
    }
  }, [])

  useEffect(() => {
    if (mapALoaded && mapARef.current) applySafeZoomBounds(mapARef.current.getMap(), effectiveMinZoom, effectiveMaxZoom)
    if (mapBLoaded && mapBRef.current) applySafeZoomBounds(mapBRef.current.getMap(), effectiveMinZoom, effectiveMaxZoom)
  }, [effectiveMinZoom, effectiveMaxZoom, mapALoaded, mapBLoaded, applySafeZoomBounds])

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
      // "live" (lib/phong-live-gl-layer.ts) now projects through MapLibre's own
      // per-frame shaderData prelude, so it renders correctly under BOTH
      // mercator and globe — no globe fallback needed anymore. It's still
      // flat-only (no terrain-elevation drape); that trade-off is unchanged.
      const effectivePhongRenderer = state.phongRenderer

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
          // 2D is a locked nadir top-down view: no pitch (maxPitch 0) and no
          // rotation (dragRotate off, roll off). 3D/globe stay free.
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
          // Fixed constants — see applySafeZoomBounds above for why the real
          // effectiveMinZoom/effectiveMaxZoom are applied imperatively instead.
          minZoom={-2}
          maxZoom={22}
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
          {/* Mounted whenever their group's master is on — regardless of which
              specific sub-mode checkbox is checked — so toggling an individual
              sub-mode off and back on doesn't tear down maplibre's tile cache for it.
              SlopeReliefLayer etc (below) control per-mode visibility via
              layout.visibility instead of unmounting, for the same reason. Slope/
              Aspect/TRI/Curvature/Det Hessian/TPI/Roughness/Blobness gate on
              showTerrainAnalysis; LRM/SVF/Openness gate on showReliefVisualization. */}
          <SlopeSource
            enabled={state.showTerrainAnalysis}
            sourceMode={state.slopeSourceMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <AspectSource
            enabled={state.showTerrainAnalysis}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <TriSource
            enabled={state.showTerrainAnalysis}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <CurvatureSource
            enabled={state.showTerrainAnalysis}
            mode={state.curvatureMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <TpiSource
            enabled={state.showTerrainAnalysis}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <LrmSource
            // Also mounted for Plane Slicer's LRM reference mode, independent of
            // Relief Visualization's own master toggle — otherwise a
            // `source="lrmSource"` on PlaneSlicerLayer could point at a source
            // id that was never actually added to the map.
            enabled={state.showReliefVisualization || (state.showPlaneSlicer && state.planeSlicerReferenceMode === "lrm")}
            radius={state.lrmRadius}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <RoughnessSource
            enabled={state.showTerrainAnalysis}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <BlobnessSource
            enabled={state.showTerrainAnalysis}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <SvfSource
            enabled={state.showReliefVisualization}
            radius={state.svfRadius}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <OpennessSource
            enabled={state.showReliefVisualization}
            radius={state.opennessRadius}
            mode={state.opennessMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <LocalDominanceSource
            enabled={state.showReliefVisualization}
            minRadius={state.localDominanceMinRadius}
            maxRadius={state.localDominanceMaxRadius}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <MatcapSource
            enabled={state.showLightingEffects && state.showMatcap}
            matcapUrl={matcapUrlFor(state.matcapTextureId)}
            rotationDeg={state.matcapRotationDeg}
            // Reapplied live to the cached (unexaggerated) normal map inside
            // matcapProtocol regardless of view mode — even flat 2D shading
            // should get correspondingly stronger contrast at higher
            // exaggeration, same reasoning as MatcapGlLayer's own historical
            // drapeEnabled/exaggeration split.
            exaggeration={state.exaggeration}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <PhongSource
            enabled={state.showLightingEffects && state.showPhong && effectivePhongRenderer === "raster"}
            diffuseStrength={state.phongDiffuseStrength}
            specularStrength={state.phongSpecularStrength}
            // 3D Slow (raster) is always ABSOLUTE — a per-frame camera headlamp
            // isn't possible here (it would bake the settled bearing into every
            // tile URL and re-fetch on each rotate, not a real headlamp), so the
            // Light Anchor toggle is disabled + forced to Absolute in this mode
            // (see lighting-effects-options-section.tsx). Only the live 2D Fast
            // layer honours phongLightRelativeToCamera.
            lightDir={state.illuminationDir}
            lightAlt={state.illuminationAlt}
            exaggeration={state.exaggeration}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <PhongLiveGlLayer
            mapRef={isPrimary ? mapARef : mapBRef}
            enabled={state.showLightingEffects && state.showPhong && effectivePhongRenderer === "live"}
            diffuseStrength={state.phongDiffuseStrength}
            specularStrength={state.phongSpecularStrength}
            // Raw compass azimuth + a relative flag: the live layer adds the
            // CURRENT map bearing itself every frame (headlamp that tracks
            // through the whole rotate gesture), instead of us baking in the
            // settled bearing here the way the raster layer must.
            lightDir={state.illuminationDir}
            lightAlt={state.illuminationAlt}
            lightRelativeToCamera={state.phongLightRelativeToCamera}
            exaggeration={state.exaggeration}
            opacity={state.phongOpacity * state.lightingEffectsOpacity}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          {isPrimary && (
            <TellsSource
              enabled={state.tellsBeta && tellsEverActivated}
              terrainSource={state.sourceA}
              customTerrainSources={customTerrainSources}
              mapboxKey={mapboxKey}
              maptilerKey={maptilerKey}
              titilerEndpoint={titilerEndpoint}
              tellsOptions={tellsOptions}
            />
          )}
          {isPrimary && (
            <TellsSource
              enabled={state.tellsBeta && tellsEverActivated}
              terrainSource={state.sourceA}
              customTerrainSources={customTerrainSources}
              mapboxKey={mapboxKey}
              maptilerKey={maptilerKey}
              titilerEndpoint={titilerEndpoint}
              tellsOptions={tellsOptions}
              variant="unfiltered"
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
            <OverlayBasemapLayers overlayIds={state.overlayBasemapIds} opacity={state.rasterBasemapOpacity} customBasemapSources={customBasemapSources} />
          )}
          <ColorReliefLayer
            showColorRelief={state.showColorRelief}
            colorReliefPaint={colorReliefPaint}
          />
          <SlopeReliefLayer enabled={state.showTerrainAnalysis} showSlope={state.showSlope} slopeReliefPaint={slopeReliefPaint} />
          <AspectReliefLayer enabled={state.showTerrainAnalysis} showAspect={state.showAspect} aspectReliefPaint={aspectReliefPaint} />
          <TriReliefLayer enabled={state.showTerrainAnalysis} showTri={state.showTri} triReliefPaint={triReliefPaint} />
          <CurvatureReliefLayer enabled={state.showTerrainAnalysis} showCurvature={state.showCurvature} curvatureReliefPaint={curvatureReliefPaint} />
          <TpiReliefLayer enabled={state.showTerrainAnalysis} showTpi={state.showTpi} tpiReliefPaint={tpiReliefPaint} />
          <LrmReliefLayer enabled={state.showReliefVisualization} showLrm={state.showLrm} lrmReliefPaint={lrmReliefPaint} />
          <RoughnessReliefLayer enabled={state.showTerrainAnalysis} showRoughness={state.showRoughness} roughnessReliefPaint={roughnessReliefPaint} />
          <BlobnessReliefLayer enabled={state.showTerrainAnalysis} showBlobness={state.showBlobness} blobnessReliefPaint={blobnessReliefPaint} />
          <SvfReliefLayer enabled={state.showReliefVisualization} showSvf={state.showSvf} svfReliefPaint={svfReliefPaint} />
          <OpennessReliefLayer enabled={state.showReliefVisualization} showOpenness={state.showOpenness} opennessReliefPaint={opennessReliefPaint} />
          <LocalDominanceReliefLayer enabled={state.showReliefVisualization} showLocalDominance={state.showLocalDominance} localDominanceReliefPaint={localDominanceReliefPaint} />
          <PlaneSlicerLayer enabled={state.showPlaneSlicer} referenceMode={state.planeSlicerReferenceMode} planeSlicerPaint={planeSlicerPaint} />
          {isPrimary && (
            <TellsMarkersLayer
              enabled={state.tellsBeta}
              visible={state.showTellsDetector && state.tellsMarkersVisible}
              style={state.tellsStyle}
              outlineColor={state.tellsOutlineColor}
              sizeByMeasuredScale={state.tellMeasureScale && state.tellsScaleMarkers}
              scaleMultiplier={state.tellsScaleMultiplier}
              latDeg={state.lat}
              colorByPaints={tellsColorByPaints}
            />
          )}
          {isPrimary && <TellsUnfilteredLoaderLayer enabled={state.tellsBeta && tellsEverActivated} />}
          {isPrimary && (
            <TellsInspectPopup
              mapRef={mapARef as any}
              active={mapALoaded && state.tellsBeta}
            />
          )}
          <MatcapRasterLayer
            enabled={state.showLightingEffects && state.showMatcap}
            opacity={state.lightingEffectsOpacity * state.matcapOpacity}
          />
          <PhongRasterLayer
            enabled={state.showLightingEffects && state.showPhong && state.phongRenderer === "raster"}
            opacity={state.lightingEffectsOpacity * state.phongOpacity}
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
              contourWeight={state.contourWeight}
              contourColor={state.contourColor || undefined}
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
              graticuleColor={state.graticuleColor || themeAntiColor}
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

              {!activeProjectConfig?.hideMapControls?.includes("scale") && (
                <ScaleControl position="bottom-left" unit="metric" maxWidth={250} />
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

            </>
          )}
        </Map>
      )
    },
    [
      state.lat, state.lng, state.zoom, state.pitch, state.bearing, state.viewMode, state.exaggeration,
      state.basemapSource, state.basemapPerView, state.basemapSourceA, state.basemapSourceB, state.overlayBasemapIds,
      state.showRasterBasemap, state.rasterBasemapOpacity, state.basemapSourceOpacity,
      state.showHillshade, state.hillshadeMethod, state.shadowColor, state.highlightColor, state.hillshadeExag, state.accentColor,
      state.showLightingEffects, state.lightingEffectsOpacity,
      // Same "toggle it on but nothing shows until I pan or edit a slider"
      // desync as the tellsBeta comment below — these plain raster Sources/
      // Layers only ever refreshed on a map move because none of their own
      // state was actually in this dependency list.
      state.showMatcap, state.matcapOpacity, state.matcapTextureId, state.matcapRotationDeg,
      state.showPhong, state.phongOpacity, state.phongDiffuseStrength, state.phongSpecularStrength, state.phongLightRelativeToCamera, state.phongRenderer,
      state.illuminationDir, state.illuminationAlt,
      state.showColorRelief, state.showTerrainAnalysis, state.showReliefVisualization, state.showSlope, state.slopeSourceMode, state.showContours, state.showContoursAndGraticules, state.showContourLabels,
      state.showAspect, state.showTri, state.showCurvature, state.curvatureMode, state.showTpi, state.showLrm, state.lrmRadius, state.showRoughness, state.showBlobness,
      state.showSvf, state.svfRadius, state.showOpenness, state.opennessRadius, state.opennessMode,
      state.showLocalDominance, state.localDominanceMinRadius, state.localDominanceMaxRadius,
      state.showPlaneSlicer, state.planeSlicerReferenceMode, planeSlicerPaint,
      // tellsBeta/tellsEverActivated gate the tells layer+source mounts: leaving
      // them out of these deps was the "toggle it on but nothing shows until I
      // pan or edit a slider" desync — the memoized JSX simply never re-rendered.
      state.tellsStyle, state.showTellsDetector, state.tellsMarkersVisible, tellsOptions, state.tellsBeta, tellsEverActivated,
      tellsColorByPaints, state.tellsOutlineColor, state.tellsScaleMarkers, state.tellsScaleMultiplier, state.tellMeasureScale,
      state.showBackground, state.showGraticules, state.graticuleWidth, state.minimapMinimized,
      state.graticuleDensity, state.showGraticuleLabels, state.sourceB, state.splitScreen,
      state.sourceA, state.contourMinor, state.contourMajor, state.contourWeight,
      state.contourColor, state.graticuleColor,
      activeBasemapSourceA, activeBasemapSourceB,
      hillshadePaint, colorReliefPaint, slopeReliefPaint, aspectReliefPaint, triReliefPaint, curvatureReliefPaint,
      tpiReliefPaint, lrmReliefPaint, roughnessReliefPaint, blobnessReliefPaint, svfReliefPaint, opennessReliefPaint, localDominanceReliefPaint,
      mapboxKey, maptilerKey, customTerrainSources, customBasemapSources, titilerEndpoint,
      mapALoaded, onMoveA, onMoveEndA, onMoveB, onMoveEndB,
      skyConfig.skyColor, skyConfig.skyHorizonBlend, skyConfig.horizonColor, skyConfig.horizonFogBlend,
      skyConfig.fogColor, skyConfig.fogGroundBlend, skyConfig.matchThemeColors, skyConfig.backgroundLayerActive,
      activeProjectConfig,
      themeColor,
      setZoomRangeBasemap, resolvedMaxBounds
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
      <LightControlOverlay state={state} setState={setState} mapRef={mapARef as any} />
      <TerrainControlPanel
        state={state}
        setState={setState}
        getMapBounds={getMapBounds}
        mapRef={mapARef as any}
      />
    </div>
  )
}