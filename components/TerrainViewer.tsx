"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat, parseAsInteger, parseAsStringLiteral, parseAsArrayOf } from "nuqs"
import Map, {
  type MapRef,
  ScaleControl,
  AttributionControl,
} from "react-map-gl/maplibre"
import { TerrainControlPanel, isSidebarOpenAtom } from "./TerrainControlPanel/TerrainControlPanel"

import GeocoderControl from "./MapControls/GeocoderControl"
import NavigationControlThemed from "./MapControls/NavigationControlThemed"
import GeolocateControlThemed from "./MapControls/GeolocateControlThemed"
import { COLOR_RAMP_IDS, computePropertyRampExpression, parseAsCustomRampStops, DEFAULT_SLOPE_CUSTOM_STOPS, DEFAULT_SHAPE_INDEX_CUSTOM_STOPS, rampSessionOverridesAtom, type CustomRampStop } from "@/lib/color-ramps"
import {HILLSHADE_METHODS, type TerrainSource } from "@/lib/terrain-types"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  mapboxKeyAtom, maptilerKeyAtom, hereKeyAtom, planetKeyAtom, customTerrainSourcesAtom, titilerEndpointAtom, customBasemapSourcesAtom, highResTerrainAtom,
  activeProjectConfigAtom, useCogProtocolVsTitilerAtom, cacheVizTilesAtom, tellsBetaEnabledAtom, sunShadowBetaEnabledAtom, historicalBetaEnabledAtom,
  appModeAtom, type AppMode, isHistoricalHostname, isProdHostname,
  type CustomTerrainSource, type CustomBasemapSource,
} from "@/lib/settings-atoms"
import { hydrateAllPersistedCogs, localFileId, localFileVersionAtom } from "@/lib/local-file-store"
import { withTileResultCache, setTileResultCacheEnabled } from "@/lib/tile-result-cache"
import { withSlowTileStats, resetSlowTileProgress } from "@/lib/tile-timing-stats"
import { MAX_BOUNDS_MODES, unionBounds, bufferBounds, resolveCustomSourceBounds, type LngLatBoundsTuple } from "@/lib/max-bounds"
import { sectionOpenAtom } from "./TerrainControlPanel/TerrainControlPanel"
import { getProjectConfig } from "@/lib/project-config"
import { useTheme } from "@/lib/controls-utils"
import { track } from "@/lib/analytics"
import { terrainSources } from "@/lib/terrain-sources"
import { BUILTIN_BASEMAP_OPTIONS, BASEMAP_SHORT_LABELS } from "./TerrainControlPanel/raster-basemap-section"
import { HistoricalTimelinePanel, SOURCE_CONFIG } from "./TerrainControlPanel/historical-timeline-panel"
import { isHistoricalSourceActive, resolveActiveHistoricalSource, TIMELINE_SOURCE_IDS } from "@/lib/historical-sources"
import { useEsriLiveCaptureDate } from "@/lib/wayback"
import { useDebouncedValue } from "./TerrainControlPanel/use-debounced-state"
import customSourcesData from "@/lib/custom-sources.json"

const SAMPLE_TERRAIN_SOURCES = customSourcesData["SAMPLE_TERRAIN_SOURCES"] as CustomTerrainSource[]
const SAMPLE_BASEMAP_SOURCES = customSourcesData["SAMPLE_BASEMAPS_SOURCES"] as CustomBasemapSource[]
import { MinimapInternal } from "./MapControls/MinimapControl";
import { LightControlOverlay } from "./MapControls/LightControlOverlay";
import { HistogramMatchFilter } from "./MapControls/HistogramMatchFilter";
import { COLOR_SPACES } from "@/lib/histogram-matching";
import { HistoricalTimelineToggle } from "./MapControls/HistoricalTimelineToggle";
import { SplitPill } from "./MapControls/SplitResizeHandle";
import { useIsMobile } from '@/hooks/use-mobile'
import { getSidebarFootprintPx, MAP_CTRL_EDGE_MARGIN_PX, splitRatioAtom, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, clamp, historicalTimelinePanelHeightAtom, sideColorOverridesAtom, colorizeMapBordersAtom, colorizeMapBordersInsetAtom } from "@/lib/layout-constants"
import { GRID_LAYOUTS, GRID_LAYOUT_IDS, VIEW_IDS, viewFieldName, sourceFieldName, bottomRightView, rightmostViewsPerRow, SIDE_COLORS, SPLIT_STYLES, BLEND_MODES, type ViewId, type GridLayoutId } from "@/lib/grid-layouts"
import { cn } from "@/lib/utils"

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
import { shadowProtocol } from '@/lib/shadow-protocol'
import { MATCAP_TEXTURES, DEFAULT_MATCAP_ID } from '@/lib/matcap-textures'

import { TerrainSources, RasterBasemapSource, OverlayBasemapSources, SlopeSource, AspectSource, TriSource, CurvatureSource, TpiSource, LrmSource, RoughnessSource, ShapeIndexSource, BlobnessSource, EigenRatioSource, OrientationSource, SvfSource, OpennessSource, LocalDominanceSource, TellsSource, MatcapSource, PhongSource, ShadowSource } from "./LayersAndSources/MapSources"
import { PhongLiveGlLayer } from "./LayersAndSources/PhongLiveGlLayer"
import { MatcapLiveGlLayer } from "./LayersAndSources/MatcapLiveGlLayer"
import {
  LayerOrderSlots,
  RasterLayer,
  OverlayBasemapLayers,
  BackgroundLayer,
  HillshadeLayer,
  MatcapRasterLayer,
  PhongRasterLayer,
  ShadowRasterLayer,
  ColorReliefLayer,
  SlopeReliefLayer,
  AspectReliefLayer,
  TriReliefLayer,
  CurvatureReliefLayer,
  TpiReliefLayer,
  LrmReliefLayer,
  RoughnessReliefLayer,
  ShapeIndexReliefLayer,
  BlobnessReliefLayer,
  EigenRatioReliefLayer,
  OrientationReliefLayer,
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
const APP_MODES = ['terrain', 'historical'] as const
// Shared by both the CSS-var minimap/scale clearance (see
// measuredPanelClearance below) and the camera bottom-padding correction
// (mapPaddingFor) — one gap value, not two independently-guessed ones.
const PANEL_CLEARANCE_GAP_PX = 16
// Shared by the map-padding ease and the pane-geometry CSS transition, so the
// camera's vanishing-point shift and the panes' own resize stay in step when a
// side/bottom panel opens or closes.
const PADDING_EASE_MS = 200
// How far the camera's target height may sit off the ground under it before
// the terrain settle bothers re-anchoring (metres). Sized to be well below
// anything visible at normal pitch/zoom, while still being comfortably above
// the sub-metre wobble between one re-anchor's chosen center and the next —
// see resettleTerrainElevation for why an exact test would never converge.
const ELEVATION_SETTLE_EPSILON_M = 1
const SLOPE_SOURCE_MODES = ['plantopo', 'client'] as const
// 'shape-index' stays a valid internal curvature:// mode (ShapeIndexSource
// below reads it directly) even though nothing in the UI exposes setting
// curvatureMode to it anymore — it moved to its own standalone toggle instead
// of living in Curvature's mode dropdown.
const CURVATURE_MODES = ['combined', 'profile', 'plan', 'det-hessian', 'casorati', 'shape-index'] as const
const OPENNESS_MODES = ['positive', 'negative'] as const
const HORIZON_PRECISIONS = ['precise', 'fast'] as const
// Shared by Plane Slicer, Contours, and the Elevation Picker — all three read
// elevation off either real altitude ("absolute") or LRM's height above/below
// the local neighborhood mean ("lrm", see lib/lrm-protocol.ts).
const PLANE_SLICER_REFERENCE_MODES = ['absolute', 'lrm'] as const
const PLANE_SLICER_SIDES = ['above', 'below'] as const
const TELLS_STYLES = ['outline', 'byBlobness', 'byPlan', 'byDetHessian', 'byLrm'] as const
const TELL_VETO_RESOLUTIONS = ['fine', 'coarse'] as const

function matcapUrlFor(textureId: string): string {
  return (MATCAP_TEXTURES.find((t) => t.id === textureId) ?? MATCAP_TEXTURES.find((t) => t.id === DEFAULT_MATCAP_ID)!).url
}

// The full nuqs parser config for every field this app persists to the URL —
// hoisted to module scope (rather than inline inside useQueryStates below) so
// lib/bookmarks.ts's restoreBookmarkInPlace can reuse the exact same parsers to
// turn a saved query string back into typed state without a page reload.
export const QUERY_STATE_PARSERS = {
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
    // Which sidebar layout the ModePicker (TerrainControlPanel.tsx) shows —
    // "historical" strips it down to just basemap browsing. Shareable/
    // bookmarkable like every other field here; appModeAtom below only
    // remembers the last choice for a fresh session with no URL param.
    appMode: parseAsStringLiteral(APP_MODES).withDefault("terrain"),
    // Master split control — replaces the old plain splitScreen boolean.
    // "off" keeps every *A-only default exactly as before (no behavior change
    // for existing single-map bookmarks missing this param entirely).
    splitStyle: parseAsStringLiteral(SPLIT_STYLES).withDefault("off"),
    // Only meaningful once splitStyle !== "off"; "overlay" always behaves as
    // "2x1" regardless of this value (see the splitContainer render below).
    gridLayout: parseAsStringLiteral(GRID_LAYOUT_IDS).withDefault("2x1"),
    // "overlay"-only: pane B's CSS mix-blend-mode + opacity against pane A.
    splitBlendMode: parseAsStringLiteral(BLEND_MODES).withDefault("normal"),
    // Lets a picked blend mode be toggled off (falls back to plain "normal")
    // without losing/resetting it — a quick way to flip back and forth
    // between a blended and a plain overlay comparison for the same picked
    // mode, instead of re-selecting "Normal" and then the real mode again.
    splitBlendModeEnabled: parseAsBoolean.withDefault(true),
    overlayOpacity: parseAsFloat.withDefault(1.0),
    // "overlay"-only: "Match Colors (View A as reference)" — live-samples
    // both panes' CURRENTLY RENDERED canvases (whatever tiles are actually
    // loaded in the viewport, re-sampled at most once/second) and recolors
    // pane B onto pane A's histogram via a per-channel CSS LUT filter, so a
    // color-graded mismatch between two imagery sources doesn't read as a
    // seam under the overlay clip/blend. Applies to EVERY non-A active view
    // (overlay: just B; grid/side-by-side: each of B..H independently), all
    // matched onto A. See HistogramMatchFilter.tsx.
    matchColorsToA: parseAsBoolean.withDefault(false),
    // Which color space the matching above is computed/applied in — "rgb"
    // (default) is a live CSS filter; the others are a real per-pixel JS
    // conversion, capped to a low working resolution (see
    // HistogramMatchFilter.tsx's WORKING_MAX_DIM) since they're much more
    // expensive than the RGB path.
    matchColorsColorSpace: parseAsStringLiteral(COLOR_SPACES).withDefault("rgb"),
    // Compare and Blend's "Show Capture Date" toggle — a small per-view pill
    // for whichever views are actually on a dated historical source. "date"
    // shows just the formatted date; "source-date" prefixes it with that
    // source's short brand name (historical-timeline-panel.tsx's
    // SOURCE_CONFIG[...].shortLabel, e.g. "ESRI", "Google"). See the per-pane
    // render below for placement (bottom-left / bottom-center / top-center
    // depending on grid shape and whether the timeline panel is docked below it).
    // "auto" (the default) resolves to "source-date" while split/blend is
    // active and "off" otherwise — kept as a distinct literal (rather than
    // flipping the default) so an explicit "off" chosen by the user is never
    // resurrected by turning split back on. The sidebar toggle only ever
    // shows/writes the three explicit values (see comparison-mix-section.tsx).
    showCaptureDatePill: parseAsStringLiteral(["auto", "off", "date", "source-date"] as const).withDefault("auto"),
    sourceA: parseAsString.withDefault("mapterhorn"), // can have custom id in addition to @/lib/terrain-sources
    sourceB: parseAsString.withDefault("aws"),   // aws needs no API key, unlike maptiler/mapbox — safe default for a fresh visitor's first split view
    // C-H only ever matter for gridLayout "2x2"/"3x1"/"3x2"/"4x1"/"4x2" — same
    // shape as sourceA/B, just extra slots so bigger grids need no schema change.
    sourceC: parseAsString.withDefault("aws"),
    sourceD: parseAsString.withDefault("mapterhorn"),
    sourceE: parseAsString.withDefault("maptiler"),
    sourceF: parseAsString.withDefault("aws"),
    sourceG: parseAsString.withDefault("mapterhorn"),
    sourceH: parseAsString.withDefault("maptiler"),
    basemapSource: parseAsString.withDefault("esri"), // can have custom id in addition to @/lib/terrain-sources
    basemapPerView: parseAsBoolean.withDefault(true),
    basemapSourceA: parseAsString.withDefault("esri"),
    basemapSourceB: parseAsString.withDefault("google"),
    basemapSourceC: parseAsString.withDefault("esri"),
    basemapSourceD: parseAsString.withDefault("google"),
    basemapSourceE: parseAsString.withDefault("esri"),
    basemapSourceF: parseAsString.withDefault("google"),
    basemapSourceG: parseAsString.withDefault("esri"),
    basemapSourceH: parseAsString.withDefault("google"),
    // 'overlay'-role custom basemap sources currently stacked on top of the active
    // basemap (see basemap-byod-section.tsx's checkbox list) — shared across A/B,
    // only meaningful in split-or-radio basemap mode (basemapPerView).
    overlayBasemapIds: parseAsArrayOf(parseAsString).withDefault([]),
    // The ONE scrubbed date (epoch ms) for whichever concrete historical
    // source is active on this side (historicalActiveSource(A/B) below) —
    // Wayback/HLS/GE-Historical/Planet/EOX-S2/Bing all share this single
    // field now, instead of a separate date field per source. Wayback is the
    // one source whose own tile lookup isn't directly keyed by a timestamp
    // (its releases are addressed by a release NUMBER); lib/wayback.ts's
    // useResolvedWaybackRelease resolves this date to the nearest actual
    // release at render time, so that indirection never needs to leak into
    // app state. 0 means "not yet picked", resolved to the newest available
    // tick once its catalog loads (see historical-timeline-panel.tsx).
    date: parseAsInteger.withDefault(0),
    dateA: parseAsInteger.withDefault(0),
    dateB: parseAsInteger.withDefault(0),
    dateC: parseAsInteger.withDefault(0),
    dateD: parseAsInteger.withDefault(0),
    dateE: parseAsInteger.withDefault(0),
    dateF: parseAsInteger.withDefault(0),
    dateG: parseAsInteger.withDefault(0),
    dateH: parseAsInteger.withDefault(0),
    // Which concrete underlying source (wayback/hls/ge-historical/planet/
    // eox-s2) actually renders when basemapSource(A/B) === "historical" — the
    // sidebar only ever exposes one combined "Historical Imagery" entry;
    // picking a tick on the timeline for a source that isn't Bing sets both
    // the relevant date field AND this field (see historical-timeline-
    // panel.tsx's setTickForSide). Bing bypasses this: its tick sets
    // basemapSource(A/B) = "bing" directly, never "historical".
    historicalActiveSource: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceA: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceB: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceC: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceD: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceE: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceF: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceG: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    historicalActiveSourceH: parseAsStringLiteral(["wayback", "hls", "ge-historical", "planet", "eox-s2"] as const).withDefault("wayback"),
    // Which historical sources' ticks are aggregated onto the shared timeline
    // (pill toggles in historical-timeline-panel.tsx) — independent of which
    // single source is actually "active"/rendered on the map. "planet" is
    // deliberately left out of the default — it needs an API key, so it only
    // shows up here once a user with a key explicitly toggles its pill on.
    // HLS and EOX Sentinel-2-cloudless also start off by default (HLS's
    // ticks are synthetic monthly placeholders, not real capture dates, per
    // lib/hls.ts; EOX is a once-a-year mosaic, coarser than the other three)
    // — both only show up once explicitly toggled on via their own pill.
    timelineSources: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    // Per-side variants of timelineSources above — only meaningful when both
    // basemapPerView AND splitStyle!=="off" are on (dualMode) AND the timeline's
    // sync toggle is off, letting each active view aggregate a different
    // subset of sources (e.g. Wayback+GE for A, HLS+Bing for B). When sync is
    // on (the default) every side shares timelineSources instead.
    timelineSourcesA: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesB: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesC: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesD: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesE: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesF: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesG: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    timelineSourcesH: parseAsArrayOf(parseAsString).withDefault(["wayback", "ge-historical", "bing"]),
    // Whether the historical timeline's full bar (header + track) is
    // collapsed down to just the small floating clock-icon toggle button.
    historicalTimelineCollapsed: parseAsBoolean.withDefault(false),
    // Whether the timeline's title/source-pills/resolution-chips header row
    // is shown (true) or the panel is in its minimal, track-only mode with
    // just a small floating cog+collapse chip (false). Lifted up (not local
    // state in the panel component) because TerrainViewer needs to know it
    // too — the panel is visibly shorter in minimal mode, so the minimap/
    // scale/attribution clearance above it differs between the two.
    historicalControlsExpanded: parseAsBoolean.withDefault(true),
    // Resolution-class filter alongside the source pills above — "vhr"
    // (Wayback/GE Historical/Bing, sub-meter-ish) vs "medium" (HLS's 10-30m
    // Landsat/Sentinel-2, Planet's ~4.7m monthly mosaic) — see SOURCE_CONFIG's
    // resClass in historical-timeline-panel.tsx. Both on by default.
    resolutionClasses: parseAsArrayOf(parseAsString).withDefault(["vhr", "medium"]),
    // colorRamp: parseAsString.withDefault("mby"),
    colorRamp: parseAsStringLiteral(COLOR_RAMP_IDS).withDefault("mby"),
    customStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    customStopsDiscrete: parseAsBoolean.withDefault(false),
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
    // "raster" (default): lib/matcap-protocol.ts's plain raster-tile
    // pipeline — drapes correctly over 3D terrain exaggeration AND globe,
    // but every rotation/exaggeration change costs a real tile refetch.
    // "live": lib/matcap-live-gl-layer.ts's CustomLayerInterface — instant
    // GPU-uniform updates, zero refetch, drapes onto 3D terrain the same
    // way the live Phong layer does (see phongRenderer below), but not
    // globe; see lighting-effects-options-section.tsx for the UI toggle.
    matcapRenderer: parseAsStringLiteral(["raster", "live"] as const).withDefault("live"),
    // "Light Anchor", ported from Phong's phongLightRelativeToCamera — only
    // meaningful in "live" (2D Fast): off (Absolute) samples the material
    // by the tile-space normal, pinned to compass directions and identical
    // in convention to the raster pipeline; on (Camera, the default per the
    // user's 2026-07-28 request) samples by the view-space normal — the
    // classic matcap lookup, following the camera's real pitch/bearing via
    // computeCameraBasis. The earlier per-fragment reflected-ray versions
    // (hand-derived trig, then inverse-projection unprojection) painted a
    // screen-locked blob of the matcap's center over flat terrain and are
    // gone — see lib/matcap-live-gl-layer.ts's header comment.
    matcapLightRelativeToCamera: parseAsBoolean.withDefault(true),
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
    // Off (default — briefly flipped to Camera on 2026-08-20, reverted the
    // same day on the user's follow-up): illuminationDir is a compass
    // azimuth, fixed to the world, matching maplibre's own hillshade
    // illumination-direction — the light doesn't move when you rotate the
    // map. On: the light is fixed relative to the CAMERA instead —
    // illuminationDir + the map's own bearing is baked into the phong://
    // tile as its effective azimuth (see the PhongSource lightDir prop
    // below), so the light appears to stay "over your shoulder" as you
    // spin the view. state.bearing only settles 500ms after a rotate
    // gesture ends (see commitViewState) rather than updating continuously
    // mid-drag, so this doesn't turn map rotation into a rapid-fire
    // tile-recompute trigger the way it would if bearing were live-tracked.
    // (Matcap's own anchor keeps Camera as ITS default — the material
    // lookup is what a camera-held sphere means — unlike a scene light.)
    phongLightRelativeToCamera: parseAsBoolean.withDefault(false),
    // "raster" (default): lib/phong-protocol.ts's plain raster-tile pipeline —
    // drapes correctly over 3D terrain exaggeration AND globe, but every
    // light/strength/exaggeration change costs a real tile refetch (~150ms
    // debounced). "live": lib/phong-live-gl-layer.ts's CustomLayerInterface —
    // instant GPU-uniform updates, zero refetch, and (since 2026-07-28) also
    // drapes onto 3D terrain via map.terrain.getTerrainData() — see that
    // file's header for the derivation. Still no globe support, so it's only
    // meaningful outside "globe" view mode; see lighting-effects-options-
    // section.tsx for the UI toggle exposing this trade-off directly.
    phongRenderer: parseAsStringLiteral(["raster", "live"] as const).withDefault("live"),
    // "Shadows" sub-mode (lib/shadow-protocol.ts) — a plain binary raster
    // mask: for each pixel, marches toward the sun's actual azimuth
    // (state.illuminationDir/illuminationAlt below — same shared light as
    // Hillshade/Phong, no separate light control here) and darkens it if
    // something between it and the sun rises above the sun's own altitude.
    showShadows: parseAsBoolean.withDefault(false),
    shadowOpacity: parseAsFloat.withDefault(0.6),
    // "Search Radius" — same convention as SVF/Openness: how many same-zoom
    // pixels the single ray marches outward looking for an obstruction.
    shadowRadiusPx: parseAsFloat.withDefault(32),
    // "Datetime-based" light: when on, illuminationDir/illuminationAlt are
    // driven from a physically-plausible sun position (see lib/solar-position.ts)
    // computed from the viewport-center lat/lng + these day-of-year (1–365) and
    // time-of-day (local solar hours, 0–24) values, instead of the free XY-pad
    // pick. The XY pad still just reflects the resulting illuminationDir/Alt.
    // Shared by both Phong (Lighting Effects) and native Hillshade — see
    // light-direction-control.tsx — since both ultimately read the same
    // illuminationDir/illuminationAlt fields.
    lightUseDatetime: parseAsBoolean.withDefault(false),
    lightDayOfYear: parseAsFloat.withDefault(172), // ~summer solstice
    lightTimeOfDay: parseAsFloat.withDefault(15),  // mid-afternoon
    // Which clock convention lightTimeOfDay is expressed in — "local": the
    // real civil wall-clock time at the viewport lat/lng, including that
    // location's actual DST rules (see lib/timezone.ts); "utc": UTC directly,
    // regardless of viewport location. Either way this is only ever a
    // *display/input* convention — light-direction-control.tsx converts it to
    // true solar time (see solar-position.ts) before computing the sun
    // position, and rebases lightTimeOfDay across a mode switch so toggling
    // this doesn't itself move the light.
    lightTimeMode: parseAsStringLiteral(["local", "utc"] as const).withDefault("local"),
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
    aspectCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    aspectCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showTri: parseAsBoolean.withDefault(false),
    triOpacity: parseAsFloat.withDefault(1.0),
    triColorRamp: parseAsString.withDefault("tri-default"),
    triMin: parseAsFloat.withDefault(0),
    triMax: parseAsFloat.withDefault(50),
    triInvertColorRamp: parseAsBoolean.withDefault(false),
    triCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    triCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showCurvature: parseAsBoolean.withDefault(false),
    curvatureOpacity: parseAsFloat.withDefault(1.0),
    curvatureMode: parseAsStringLiteral(CURVATURE_MODES).withDefault("combined"),
    curvatureColorRamp: parseAsString.withDefault("curvature-diverging"),
    curvatureMin: parseAsFloat.withDefault(-20),
    curvatureMax: parseAsFloat.withDefault(20),
    curvatureInvertColorRamp: parseAsBoolean.withDefault(false),
    curvatureSymmetric: parseAsBoolean.withDefault(true),
    curvatureCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    curvatureCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showTpi: parseAsBoolean.withDefault(false),
    tpiOpacity: parseAsFloat.withDefault(1.0),
    tpiColorRamp: parseAsString.withDefault("tpi-diverging"),
    tpiMin: parseAsFloat.withDefault(-20),
    tpiMax: parseAsFloat.withDefault(20),
    tpiInvertColorRamp: parseAsBoolean.withDefault(false),
    tpiSymmetric: parseAsBoolean.withDefault(true),
    tpiCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    tpiCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showLrm: parseAsBoolean.withDefault(true),
    lrmOpacity: parseAsFloat.withDefault(1.0),
    lrmColorRamp: parseAsString.withDefault("lrm-diverging"),
    lrmMin: parseAsFloat.withDefault(-20),
    lrmMax: parseAsFloat.withDefault(20),
    lrmInvertColorRamp: parseAsBoolean.withDefault(false),
    lrmSymmetric: parseAsBoolean.withDefault(true),
    lrmRadius: parseAsFloat.withDefault(16),
    lrmCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    lrmCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showRoughness: parseAsBoolean.withDefault(false),
    roughnessOpacity: parseAsFloat.withDefault(1.0),
    roughnessColorRamp: parseAsString.withDefault("roughness-default"),
    roughnessMin: parseAsFloat.withDefault(0),
    roughnessMax: parseAsFloat.withDefault(50),
    roughnessInvertColorRamp: parseAsBoolean.withDefault(false),
    roughnessCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    roughnessCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showShapeIndex: parseAsBoolean.withDefault(false),
    shapeIndexOpacity: parseAsFloat.withDefault(1.0),
    shapeIndexColorRamp: parseAsString.withDefault("custom"),
    shapeIndexMin: parseAsFloat.withDefault(-1),
    shapeIndexMax: parseAsFloat.withDefault(1),
    shapeIndexInvertColorRamp: parseAsBoolean.withDefault(false),
    shapeIndexSymmetric: parseAsBoolean.withDefault(true),
    shapeIndexCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SHAPE_INDEX_CUSTOM_STOPS),
    shapeIndexCustomStopsDiscrete: parseAsBoolean.withDefault(true),
    showBlobness: parseAsBoolean.withDefault(false),
    blobnessOpacity: parseAsFloat.withDefault(1.0),
    blobnessColorRamp: parseAsString.withDefault("blobness-default"),
    blobnessMin: parseAsFloat.withDefault(0),
    blobnessMax: parseAsFloat.withDefault(50),
    blobnessInvertColorRamp: parseAsBoolean.withDefault(false),
    blobnessCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    blobnessCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showEigenRatio: parseAsBoolean.withDefault(false),
    eigenRatioOpacity: parseAsFloat.withDefault(1.0),
    eigenRatioColorRamp: parseAsString.withDefault("eigen-ratio-default"),
    eigenRatioMin: parseAsFloat.withDefault(0),
    eigenRatioMax: parseAsFloat.withDefault(100),
    eigenRatioInvertColorRamp: parseAsBoolean.withDefault(false),
    eigenRatioCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    eigenRatioCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showOrientation: parseAsBoolean.withDefault(false),
    orientationOpacity: parseAsFloat.withDefault(1.0),
    orientationColorRamp: parseAsString.withDefault("orientation-default"),
    orientationMin: parseAsFloat.withDefault(0),
    orientationMax: parseAsFloat.withDefault(180),
    orientationInvertColorRamp: parseAsBoolean.withDefault(false),
    orientationCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    orientationCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showSvf: parseAsBoolean.withDefault(false),
    svfOpacity: parseAsFloat.withDefault(1.0),
    svfColorRamp: parseAsString.withDefault("svf-default"),
    svfMin: parseAsFloat.withDefault(0),
    svfMax: parseAsFloat.withDefault(100),
    svfInvertColorRamp: parseAsBoolean.withDefault(false),
    svfRadius: parseAsFloat.withDefault(8),
    svfPrecision: parseAsStringLiteral(HORIZON_PRECISIONS).withDefault("precise"),
    svfCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    svfCustomStopsDiscrete: parseAsBoolean.withDefault(false),
    showOpenness: parseAsBoolean.withDefault(false),
    opennessOpacity: parseAsFloat.withDefault(1.0),
    opennessColorRamp: parseAsString.withDefault("openness-default"),
    opennessMin: parseAsFloat.withDefault(-15),
    opennessMax: parseAsFloat.withDefault(15),
    opennessInvertColorRamp: parseAsBoolean.withDefault(false),
    opennessSymmetric: parseAsBoolean.withDefault(true),
    opennessRadius: parseAsFloat.withDefault(8),
    opennessMode: parseAsStringLiteral(OPENNESS_MODES).withDefault("positive"),
    opennessPrecision: parseAsStringLiteral(HORIZON_PRECISIONS).withDefault("precise"),
    opennessCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    opennessCustomStopsDiscrete: parseAsBoolean.withDefault(false),
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
    localDominanceSymmetric: parseAsBoolean.withDefault(false),
    localDominanceMinRadius: parseAsFloat.withDefault(8),
    localDominanceMaxRadius: parseAsFloat.withDefault(32),
    localDominanceCustomStops: parseAsCustomRampStops.withDefault(DEFAULT_SLOPE_CUSTOM_STOPS),
    localDominanceCustomStopsDiscrete: parseAsBoolean.withDefault(false),
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
    // Same Absolute/LRM reference as Plane Slicer, for the Elevation Picker's
    // point/profile sampling itself (lib/elevation-query.ts) — "LRM" here has
    // no 3D-mesh equivalent (map.queryTerrainElevation() only ever reflects
    // the real terrain, not a synthetic relief value), so LRM mode always
    // samples client-side regardless of view mode; see ElevationPickerSection.
    elevationPickerReferenceMode: parseAsStringLiteral(PLANE_SLICER_REFERENCE_MODES).withDefault("absolute"),
    // Experimental — opt-in via Settings (or ?tellsBeta=true directly) so it doesn't
    // clutter Visualization Modes for everyone by default.
    tellsBeta: parseAsBoolean.withDefault(false),
    // Same opt-in-beta gate as tellsBeta above, for Tools: Sun Shadow Calculator.
    // Default true so the URL stays clean when the feature is on (the atom
    // default is also true); `?sunShadowBeta=false` disables it explicitly.
    sunShadowBeta: parseAsBoolean.withDefault(true),
    // Same opt-in-beta gate as tellsBeta above, for the historical-imagery
    // basemaps (Wayback/HLS/GE Historical/Planet) + bottom timeline panel.
    // Default true — same rationale as sunShadowBeta.
    historicalBeta: parseAsBoolean.withDefault(true),
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
    // "Frozen" pins the currently-computed candidates in place (snapshotted
    // into a plain geojson source, see the tellsFrozenSnapshot state and
    // TellsSource's frozen/frozenSnapshot props below) so panning/zooming
    // no longer fetches new tells:// tiles or recomputes detections — "Live"
    // (the default) resumes the normal fetch-as-you-pan vector source.
    tellsFrozen: parseAsBoolean.withDefault(false),
    showContoursAndGraticules: parseAsBoolean.withDefault(false),
    showContours: parseAsBoolean.withDefault(true),
    showContourLabels: parseAsBoolean.withDefault(true),
    showGraticules: parseAsBoolean.withDefault(false),
    showRasterBasemap: parseAsBoolean.withDefault(false),
    showBackground: parseAsBoolean.withDefault(false),
    // Sky/horizon/fog colors for the Background + Fog/Sky mode (background-
    // options-section.tsx) — URL-shareable state like every other viz-mode
    // field, not a localStorage preference (was previously a plain, entirely
    // unpersisted jotai atom — skyConfigAtom — lost on every reload; moved
    // here rather than to atomWithStorage so a shared/bookmarked URL carries
    // the exact same sky look, consistent with color ramps and every other
    // per-mode setting).
    matchThemeColors: parseAsBoolean.withDefault(true),
    skyColor: parseAsColor().withDefault("#80ccff"),
    skyHorizonBlend: parseAsFloat.withDefault(0.5),
    horizonColor: parseAsColor().withDefault("#ccddff"),
    horizonFogBlend: parseAsFloat.withDefault(0.5),
    fogColor: parseAsColor().withDefault("#fcf0dd"),
    fogGroundBlend: parseAsFloat.withDefault(0.2),
    backgroundLayerActive: parseAsBoolean.withDefault(true),
    // Viz-mode master opacity (the "Raster Basemap" checkbox's own slider) — composites
    // (multiplies) with basemapSourceOpacity below for the single/split basemap layer,
    // same pattern as Slope-and-More's master-vs-submode opacity. Overlay layers use
    // this value directly (100% × master), since they have no solo slider of their own.
    rasterBasemapOpacity: parseAsFloat.withDefault(1.0),
    // Basemap-solo opacity (the "Basemap Opacity" slider inside the Basemap Source
    // section) — only affects the single/split basemap layer, not overlays.
    basemapSourceOpacity: parseAsFloat.withDefault(1.0),
    exaggeration: parseAsFloat.withDefault(1),
    lat: parseAsFloat.withDefault(45.9788),
    lng: parseAsFloat.withDefault(7.674),
    zoom: parseAsFloat.withDefault(12.37),
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
    // Absolute ("real altitude") vs LRM ("height above/below the local
    // neighborhood mean") — same reference concept Plane Slicer introduced
    // (PLANE_SLICER_REFERENCE_MODES above), applied to what the contour LINES
    // themselves trace: iso-altitude lines vs iso-relief lines. See
    // ContoursLayer.tsx for how LRM mode swaps the DEM source it contours.
    contourReferenceMode: parseAsStringLiteral(PLANE_SLICER_REFERENCE_MODES).withDefault("absolute"),
    contourMinor: parseAsFloat.withDefault(50),
    contourMajor: parseAsFloat.withDefault(200),
    // Absolute and LRM keep independent interval values, same reasoning as
    // planeSlicerValue/planeSlicerValueLrm — LRM's natural range (roughly
    // ±100m of local relief) is much narrower than real elevation's, so a
    // 50/200m default interval would produce zero (or a handful of very
    // widely-spaced) LRM contour lines. Scaled down ~10x, same 1:4 minor:major
    // ratio.
    contourMinorLrm: parseAsFloat.withDefault(5),
    contourMajorLrm: parseAsFloat.withDefault(20),
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
}

export function TerrainViewer() {
  // Per-view map refs/loaded-flags, keyed by ViewId (A-H) — generalizes what
  // used to be a hardcoded mapARef/mapBRef + mapALoaded/mapBLoaded pair. Eight
  // plain useRef calls (VIEW_IDS.length is a compile-time constant, never
  // conditional, so this doesn't violate the rules of hooks) rather than one
  // ref-per-active-view, since the set of *active* views changes at runtime
  // (gridLayout/splitStyle) and several child components (MatcapLiveGlLayer,
  // BackgroundLayer, TellsInspectPopup, LightControlOverlay, ...) need a
  // real, stable RefObject<MapRef> prop, not a plain mutable lookup. Views
  // beyond the current grid's shape just sit unused/null.
  const mapRefA = useRef<MapRef>(null)
  const mapRefB = useRef<MapRef>(null)
  const mapRefC = useRef<MapRef>(null)
  const mapRefD = useRef<MapRef>(null)
  const mapRefE = useRef<MapRef>(null)
  const mapRefF = useRef<MapRef>(null)
  const mapRefG = useRef<MapRef>(null)
  const mapRefH = useRef<MapRef>(null)
  const mapRefs = useMemo<Record<ViewId, React.RefObject<MapRef>>>(() => ({
    A: mapRefA, B: mapRefB, C: mapRefC, D: mapRefD, E: mapRefE, F: mapRefF, G: mapRefG, H: mapRefH,
  }), [])
  const isSyncing = useRef(false)
  const [mapLibreReady, setMapLibreReady] = useState(false)
  const [mapLoaded, setMapLoaded] = useState<Partial<Record<ViewId, boolean>>>({})
  const setViewLoaded = useCallback((side: ViewId, loaded: boolean) => {
    setMapLoaded((prev) => ({ ...prev, [side]: loaded }))
  }, [])
  const viewStateUpdateTimer = useRef<NodeJS.Timeout | null>(null)
  const isMobile = useIsMobile()

  // Split-screen A/B divider — tracked in real pixels (not a flex ratio) so
  // the divider can sit at a persisted fraction of the space actually
  // available for map content (viewport minus the floating sidebar's
  // footprint when open), and be user-draggable. Seeded synchronously from
  // getBoundingClientRect on mount (see effect below) to avoid a 0-width
  // flash before the first ResizeObserver callback fires.
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const [splitContainerWidth, setSplitContainerWidth] = useState(0)
  // Height is only actually needed for 2-row grids' uneven row-height split
  // (see paneLayouts below) — width alone used to be enough since the old
  // row split was a plain equal percentage. Measured the same way as width.
  const [splitContainerHeight, setSplitContainerHeight] = useState(0)
  const [splitRatio, setSplitRatio] = useAtom(splitRatioAtom)
  const [colorizeMapBorders] = useAtom(colorizeMapBordersAtom)
  const [colorizeMapBordersInset] = useAtom(colorizeMapBordersInsetAtom)
  const [sideColorOverrides] = useAtom(sideColorOverridesAtom)
  useLayoutEffect(() => {
    const el = splitContainerRef.current
    // mapLibreReady gates the entire return (see "if (!mapLibreReady) return
    // null" below) — this div doesn't exist in the DOM at all until then, so
    // this effect (deliberately re-run when mapLibreReady flips, not just on
    // an empty-deps mount) would otherwise measure a null ref once and never
    // retry once the real layout actually mounts.
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSplitContainerWidth(rect.width)
    setSplitContainerHeight(rect.height)
    const observer = new ResizeObserver((entries) => {
      setSplitContainerWidth(entries[0].contentRect.width)
      setSplitContainerHeight(entries[0].contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [mapLibreReady])

  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [hereKey] = useAtom(hereKeyAtom)
  const [planetKey] = useAtom(planetKeyAtom)
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
  const historicalTimelinePanelHeightPx = useAtomValue(historicalTimelinePanelHeightAtom)
  const [activeProjectConfig, setActiveProjectConfig] = useAtom(activeProjectConfigAtom)
  const [, setSectionOpen] = useAtom(sectionOpenAtom)
  const hasAppliedEmbedConfig = useRef(false)
  // Snapshotted during render — BEFORE any effect runs — not read live inside
  // the hasAppliedEmbedConfig effect below: the sibling effect that mirrors
  // state.appMode into appModeAtom (a few lines down) fires first on mount
  // (effects run in declaration order) and unconditionally persists the
  // current value, "terrain" default included. A live localStorage read
  // inside the embed-config effect would therefore always see that just-
  // written entry and never treat any fresh visit as first-ever, silently
  // defeating isHistoricalHostname's first-visit default below.
  const hadStoredAppModeAtMount = useRef<boolean>((() => {
    try { return window.localStorage.getItem("appMode") !== null } catch { return false }
  })())
  // Same pattern for sectionOpen — used below to avoid overriding a returning
  // visitor's deliberate panel choices on the historical-satellite hostname.
  const hadStoredSectionAtMount = useRef<boolean>((() => {
    try { return window.localStorage.getItem("sectionOpen") !== null } catch { return false }
  })())

  const [state, setState] = useQueryStates(QUERY_STATE_PARSERS,
  {
    history: 'replace', // push to remember past interactions, or replace to avoid cluttering history
    limitUrlUpdates: {
      method: 'throttle', // throttle or debounce debounce correctly fires only have paused setState, but flashes
      timeMs: 500
    }
  })
  // Dynamic per-view field lookups (viewFieldName/sourceFieldName return a
  // plain `string`, not a key of the huge literal QUERY_STATE_PARSERS type)
  // need an escape hatch from that type's strict indexing — same pragmatic
  // `any` every section component's own `state: any` prop already uses.
  const stateAny = state as unknown as Record<string, any>

  // Derived split/grid shape — the single source of truth every per-view
  // effect/render below loops over instead of re-deriving its own "is this
  // A or B" check. "overlay" forces "2x1" regardless of state.gridLayout
  // (clip-path/blend only ever compares exactly 2 panes); terrain mode (as
  // opposed to historical) forces "2x1" too — its own General Settings row
  // only ever exposes Split Mode (off/overlay/side), never a grid-layout
  // picker (that only lives in the historical-mode Compare and Blend
  // section), so state.gridLayout could still hold a stale non-2x1 value
  // from a previous historical-mode session. Every other split style in
  // historical mode honors the user's chosen gridLayout.
  const isHistoricalMode = state.appMode === "historical"
  // Keeps the tab favicon's SHAPE (mountain vs clock) in sync with the live
  // app mode — index.html's own inline script only gets one best-effort
  // guess in before this component ever mounts (stored appMode if any, else
  // isHistoricalHostname), so a mode switch mid-session (or a first guess
  // that turns out wrong, e.g. a stored "historical" preference on a domain
  // that isn't historical-satellite.iconem.com) needs this to actually
  // follow it. isProdHostname decides blue vs purple exactly like that
  // inline script — this only ever changes the shape half, never the color.
  useEffect(() => {
    const href = isHistoricalMode
      ? (isProdHostname(window.location.hostname) ? "/favicon-historical.svg" : "/favicon-historical-dev.svg")
      : (isProdHostname(window.location.hostname) ? "/favicon.svg" : "/favicon-dev.svg")
    const link = document.querySelector('link[rel="icon"]')
    if (link) link.setAttribute("href", href)
  }, [isHistoricalMode])
  // Snapshot taken the instant tellsFrozen flips to true — the currently
  // rendered candidates, querySourceFeatures'd off the live "tellsSource"
  // vector tiles into a plain geojson FeatureCollection. TellsSource swaps
  // to rendering THIS (a static geojson source) instead of the live vector
  // source while frozen, so panning/zooming stops triggering new tells://
  // tile fetches — cleared back to null on unfreeze so the next freeze
  // always re-captures fresh rather than reusing a stale set.
  const [tellsFrozenSnapshot, setTellsFrozenSnapshot] = useState<GeoJSON.FeatureCollection | null>(null)
  useEffect(() => {
    if (!state.tellsFrozen) {
      setTellsFrozenSnapshot(null)
      // The live "tellsSource" vector source stays mounted the whole time
      // (see MapSources.tsx's TellsSource), including while frozen — but
      // since no visible layer references it while frozen, MapLibre never
      // fetches its tiles for whatever the viewport panned to in the
      // meantime. Tile loading is move/zoom-event-driven, not triggered by a
      // layer re-attaching, so without this the just-unfrozen view can sit on
      // stale/empty tiles until the next actual pan. Re-setting the same
      // tiles array is MapLibre's supported way to force a full reload.
      const map = mapRefs.A.current?.getMap()
      const liveSource = map?.getSource("tellsSource") as maplibregl.VectorTileSource | undefined
      const tiles = (liveSource as unknown as { _options?: { tiles?: string[] } })?._options?.tiles
      if (liveSource && tiles) liveSource.setTiles(tiles)
      return
    }
    const map = mapRefs.A.current?.getMap()
    if (!map || !map.getSource("tellsSource")) return
    const features = map.querySourceFeatures("tellsSource", { sourceLayer: "tells" })
    // querySourceFeatures returns maplibre's internal MapGeoJSONFeature
    // instances, not plain objects — handing those straight to a new
    // <Source type="geojson"> fails maplibre's worker-side structured-clone
    // step ("can't serialize object of unregistered class nf"). Round-trip
    // through JSON to get plain, serializable Feature objects instead.
    const plainFeatures = JSON.parse(JSON.stringify(features)) as GeoJSON.Feature[]
    setTellsFrozenSnapshot({ type: "FeatureCollection", features: plainFeatures })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tellsFrozen])
  const isSplit = state.splitStyle !== "off"
  const isOverlaySplit = state.splitStyle === "overlay"
  const effectiveGridLayout: GridLayoutId = (isOverlaySplit || !isHistoricalMode) ? "2x1" : state.gridLayout
  const gridConfig = GRID_LAYOUTS[effectiveGridLayout]
  const activeViewIds: ViewId[] = isSplit ? gridConfig.grid.flat() : ["A"]
  const bottomRightViewId: ViewId = isSplit ? bottomRightView(effectiveGridLayout) : "A"
  // Which panes have the floating sidebar overlapping their own right edge,
  // and so need the matching camera-padding correction. The sidebar overlaps
  // the full height of the viewport, so that's the rightmost pane of EVERY
  // row — including when "every row" is just one row, and including the
  // single non-split view, which is its own row's rightmost pane.
  //
  // (This was briefly gated on `gridConfig.cols > 1` / `rows > 1` below, on
  // the theory that padding only matters for aligning vanishing points BETWEEN
  // side-by-side panes. It doesn't: the padding's real job is to keep the
  // camera's focus point centred in the pane's VISIBLE area rather than in its
  // full, partly-covered rect, which applies just as much to a lone pane with
  // a panel sitting on top of it.)
  const rightmostPerRow: ViewId[] = isSplit ? rightmostViewsPerRow(effectiveGridLayout) : ["A"]
  // Same, bottom edge: the historical timeline panel docks along the true
  // bottom of the viewport, covering the last row's panes — which in a
  // single-row grid (or non-split) is every pane.
  const bottomRowViews: ViewId[] = isSplit ? gridConfig.grid[gridConfig.grid.length - 1] : ["A"]

  // Session-only (never persisted) live ramp tweaks — see rampSessionOverridesAtom's
  // own header. Read once here and threaded into every computeColorReliefPaint call
  // below via each mode's own `sessionOverride: rampOverrides[state.xColorRamp]`, so
  // editing one ramp only invalidates the useMemo(s) actually keyed to it.
  const [rampOverrides] = useAtom(rampSessionOverridesAtom)

  // Compute hillshade paint with useMemo to prevent recalculation
  const hillshadePaint = useMemo(
    () => computeHillshadePaint(state),
    [ state.hillshadeMethod, state.illuminationDir, state.illuminationAlt, state.hillshadeOpacity, state.shadowColor, state.highlightColor, state.hillshadeExag, state.accentColor ]
  )

  const colorReliefPaint = useMemo(
    () => computeColorReliefPaint({ ...state, sessionOverride: rampOverrides[state.colorRamp] }),
    [ state.colorRamp, state.customStops, state.customStopsDiscrete, state.customHypsoMinMax, state.minElevation, state.maxElevation, state.colorReliefOpacity, state.invertColorRamp, rampOverrides[state.colorRamp] ]
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
      sessionOverride: rampOverrides[state.slopeColorRamp],
    }),
    [ state.slopeColorRamp, state.slopeCustomStops, state.slopeCustomStopsDiscrete, state.slopeMinDegrees, state.slopeMaxDegrees, state.slopeOpacity, state.terrainAnalysisOpacity, state.slopeInvertColorRamp, rampOverrides[state.slopeColorRamp] ]
  )

  // Aspect/TRI/curvature: same trick as slope above, just with their own state fields.
  const aspectReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.aspectColorRamp,
      customStops: state.aspectCustomStops,
      customStopsDiscrete: state.aspectCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.aspectMinDegrees,
      maxElevation: state.aspectMaxDegrees,
      colorReliefOpacity: state.aspectOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.aspectInvertColorRamp,
      shiftDegrees: state.aspectShiftDegrees,
      sessionOverride: rampOverrides[state.aspectColorRamp],
    }),
    [ state.aspectColorRamp, state.aspectCustomStops, state.aspectCustomStopsDiscrete, state.aspectMinDegrees, state.aspectMaxDegrees, state.aspectOpacity, state.terrainAnalysisOpacity, state.aspectInvertColorRamp, state.aspectShiftDegrees, rampOverrides[state.aspectColorRamp] ]
  )

  const triReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.triColorRamp,
      customStops: state.triCustomStops,
      customStopsDiscrete: state.triCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.triMin,
      maxElevation: state.triMax,
      colorReliefOpacity: state.triOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.triInvertColorRamp,
      sessionOverride: rampOverrides[state.triColorRamp],
    }),
    [ state.triColorRamp, state.triCustomStops, state.triCustomStopsDiscrete, state.triMin, state.triMax, state.triOpacity, state.terrainAnalysisOpacity, state.triInvertColorRamp, rampOverrides[state.triColorRamp] ]
  )

  const curvatureReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.curvatureColorRamp,
      // The curvature:// protocol wire-encodes its value ×CURVATURE_ENCODE_SCALE
      // for finer Terrarium quantization (see curvature-protocol.ts) — the raw
      // ["elevation"] this color-relief layer reads back is scaled the same
      // way, so custom stops (authored in ordinary curvature units, like every
      // other curvature field here) need the same factor applied to line up.
      customStops: state.curvatureCustomStops?.map((s: CustomRampStop) => ({ ...s, value: s.value * CURVATURE_ENCODE_SCALE })),
      customStopsDiscrete: state.curvatureCustomStopsDiscrete,
      customHypsoMinMax: true,
      // The slider/state itself (curvatureMin/Max) stays in ordinary curvature units.
      minElevation: state.curvatureMin * CURVATURE_ENCODE_SCALE,
      maxElevation: state.curvatureMax * CURVATURE_ENCODE_SCALE,
      colorReliefOpacity: state.curvatureOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.curvatureInvertColorRamp,
      sessionOverride: rampOverrides[state.curvatureColorRamp],
    }),
    [ state.curvatureColorRamp, state.curvatureCustomStops, state.curvatureCustomStopsDiscrete, state.curvatureMin, state.curvatureMax, state.curvatureOpacity, state.terrainAnalysisOpacity, state.curvatureInvertColorRamp, rampOverrides[state.curvatureColorRamp] ]
  )

  const tpiReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.tpiColorRamp,
      customStops: state.tpiCustomStops,
      customStopsDiscrete: state.tpiCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.tpiMin,
      maxElevation: state.tpiMax,
      colorReliefOpacity: state.tpiOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.tpiInvertColorRamp,
      sessionOverride: rampOverrides[state.tpiColorRamp],
    }),
    [ state.tpiColorRamp, state.tpiCustomStops, state.tpiCustomStopsDiscrete, state.tpiMin, state.tpiMax, state.tpiOpacity, state.terrainAnalysisOpacity, state.tpiInvertColorRamp, rampOverrides[state.tpiColorRamp] ]
  )

  const lrmReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.lrmColorRamp,
      customStops: state.lrmCustomStops,
      customStopsDiscrete: state.lrmCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.lrmMin,
      maxElevation: state.lrmMax,
      colorReliefOpacity: state.lrmOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.lrmInvertColorRamp,
      sessionOverride: rampOverrides[state.lrmColorRamp],
    }),
    [ state.lrmColorRamp, state.lrmCustomStops, state.lrmCustomStopsDiscrete, state.lrmMin, state.lrmMax, state.lrmOpacity, state.reliefVisualizationOpacity, state.lrmInvertColorRamp, rampOverrides[state.lrmColorRamp] ]
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
      customStops: state.roughnessCustomStops,
      customStopsDiscrete: state.roughnessCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.roughnessMin,
      maxElevation: state.roughnessMax,
      colorReliefOpacity: state.roughnessOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.roughnessInvertColorRamp,
      sessionOverride: rampOverrides[state.roughnessColorRamp],
    }),
    [ state.roughnessColorRamp, state.roughnessCustomStops, state.roughnessCustomStopsDiscrete, state.roughnessMin, state.roughnessMax, state.roughnessOpacity, state.terrainAnalysisOpacity, state.roughnessInvertColorRamp, rampOverrides[state.roughnessColorRamp] ]
  )

  const shapeIndexReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.shapeIndexColorRamp,
      // Shape Index is still wire-encoded through the shared curvature://
      // protocol, which applies CURVATURE_ENCODE_SCALE to every mode's value
      // uniformly (see curvature-protocol.ts) — the raw ["elevation"] this
      // color-relief layer reads back is in that ×1000-scaled space, same as
      // curvatureReliefPaint above, even though the slider/state itself
      // (shapeIndexMin/Max, custom stop values) stays in ordinary [-1, 1]
      // shape-index units.
      customStops: state.shapeIndexCustomStops?.map((s: CustomRampStop) => ({ ...s, value: s.value * CURVATURE_ENCODE_SCALE })),
      customStopsDiscrete: state.shapeIndexCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.shapeIndexMin * CURVATURE_ENCODE_SCALE,
      maxElevation: state.shapeIndexMax * CURVATURE_ENCODE_SCALE,
      colorReliefOpacity: state.shapeIndexOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.shapeIndexInvertColorRamp,
      sessionOverride: rampOverrides[state.shapeIndexColorRamp],
    }),
    [ state.shapeIndexColorRamp, state.shapeIndexCustomStops, state.shapeIndexCustomStopsDiscrete, state.shapeIndexMin, state.shapeIndexMax, state.shapeIndexOpacity, state.terrainAnalysisOpacity, state.shapeIndexInvertColorRamp, rampOverrides[state.shapeIndexColorRamp] ]
  )

  const blobnessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.blobnessColorRamp,
      customStops: state.blobnessCustomStops,
      customStopsDiscrete: state.blobnessCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.blobnessMin,
      maxElevation: state.blobnessMax,
      colorReliefOpacity: state.blobnessOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.blobnessInvertColorRamp,
      sessionOverride: rampOverrides[state.blobnessColorRamp],
    }),
    [ state.blobnessColorRamp, state.blobnessCustomStops, state.blobnessCustomStopsDiscrete, state.blobnessMin, state.blobnessMax, state.blobnessOpacity, state.terrainAnalysisOpacity, state.blobnessInvertColorRamp, rampOverrides[state.blobnessColorRamp] ]
  )

  const eigenRatioReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.eigenRatioColorRamp,
      customStops: state.eigenRatioCustomStops,
      customStopsDiscrete: state.eigenRatioCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.eigenRatioMin,
      maxElevation: state.eigenRatioMax,
      colorReliefOpacity: state.eigenRatioOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.eigenRatioInvertColorRamp,
      sessionOverride: rampOverrides[state.eigenRatioColorRamp],
    }),
    [ state.eigenRatioColorRamp, state.eigenRatioCustomStops, state.eigenRatioCustomStopsDiscrete, state.eigenRatioMin, state.eigenRatioMax, state.eigenRatioOpacity, state.terrainAnalysisOpacity, state.eigenRatioInvertColorRamp, rampOverrides[state.eigenRatioColorRamp] ]
  )

  const orientationReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.orientationColorRamp,
      customStops: state.orientationCustomStops,
      customStopsDiscrete: state.orientationCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.orientationMin,
      maxElevation: state.orientationMax,
      colorReliefOpacity: state.orientationOpacity * state.terrainAnalysisOpacity,
      invertColorRamp: state.orientationInvertColorRamp,
      sessionOverride: rampOverrides[state.orientationColorRamp],
    }),
    [ state.orientationColorRamp, state.orientationCustomStops, state.orientationCustomStopsDiscrete, state.orientationMin, state.orientationMax, state.orientationOpacity, state.terrainAnalysisOpacity, state.orientationInvertColorRamp, rampOverrides[state.orientationColorRamp] ]
  )

  const svfReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.svfColorRamp,
      customStops: state.svfCustomStops,
      customStopsDiscrete: state.svfCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.svfMin,
      maxElevation: state.svfMax,
      colorReliefOpacity: state.svfOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.svfInvertColorRamp,
      sessionOverride: rampOverrides[state.svfColorRamp],
    }),
    [ state.svfColorRamp, state.svfCustomStops, state.svfCustomStopsDiscrete, state.svfMin, state.svfMax, state.svfOpacity, state.reliefVisualizationOpacity, state.svfInvertColorRamp, rampOverrides[state.svfColorRamp] ]
  )

  const opennessReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.opennessColorRamp,
      customStops: state.opennessCustomStops,
      customStopsDiscrete: state.opennessCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.opennessMin,
      maxElevation: state.opennessMax,
      colorReliefOpacity: state.opennessOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.opennessInvertColorRamp,
      sessionOverride: rampOverrides[state.opennessColorRamp],
    }),
    [ state.opennessColorRamp, state.opennessCustomStops, state.opennessCustomStopsDiscrete, state.opennessMin, state.opennessMax, state.opennessOpacity, state.reliefVisualizationOpacity, state.opennessInvertColorRamp, rampOverrides[state.opennessColorRamp] ]
  )

  const localDominanceReliefPaint = useMemo(
    () => computeColorReliefPaint({
      colorRamp: state.localDominanceColorRamp,
      customStops: state.localDominanceCustomStops,
      customStopsDiscrete: state.localDominanceCustomStopsDiscrete,
      customHypsoMinMax: true,
      minElevation: state.localDominanceMin,
      maxElevation: state.localDominanceMax,
      colorReliefOpacity: state.localDominanceOpacity * state.reliefVisualizationOpacity,
      invertColorRamp: state.localDominanceInvertColorRamp,
      sessionOverride: rampOverrides[state.localDominanceColorRamp],
    }),
    [ state.localDominanceColorRamp, state.localDominanceCustomStops, state.localDominanceCustomStopsDiscrete, state.localDominanceMin, state.localDominanceMax, state.localDominanceOpacity, state.reliefVisualizationOpacity, state.localDominanceInvertColorRamp, rampOverrides[state.localDominanceColorRamp] ]
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
      "showMatcap", "showPhong", "showShadows",
      "showLrm", "showSvf", "showOpenness", "showLocalDominance",
      "showSlope", "showAspect", "showTri", "showCurvature", "showTpi", "showRoughness", "showShapeIndex",
      "showBlobness", "showEigenRatio", "showOrientation",
      "showContours", "showGraticules",
    ] as const
    const activeBasemap = state.basemapPerView ? state.basemapSourceA : state.basemapSource
    const prev = analyticsPrev.current
    const snapshot: Record<string, unknown> = {
      viewMode: state.viewMode, phongRenderer: state.phongRenderer, matcapRenderer: state.matcapRenderer,
      sourceA: state.sourceA, basemap: activeBasemap, splitStyle: state.splitStyle, gridLayout: state.gridLayout,
      // A few discrete sub-mode settings worth knowing which values people pick
      // (not every slider — just the categorical choices; color ramps aren't
      // tracked, just the algorithm/mode selections).
      hillshadeMethod: state.hillshadeMethod,
      curvatureMode: state.curvatureMode,
      slopeSourceMode: state.slopeSourceMode,
      opennessMode: state.opennessMode,
      lightUseDatetime: state.lightUseDatetime,
      contourReferenceMode: state.contourReferenceMode, planeSlicerReferenceMode: state.planeSlicerReferenceMode,
      elevationPickerReferenceMode: state.elevationPickerReferenceMode,
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
      if (state.viewMode !== prev.viewMode) track("actions-view-mode", { mode: state.viewMode })
      if (state.phongRenderer !== prev.phongRenderer) track("options-light-phong", { renderer: state.phongRenderer })
      if (state.matcapRenderer !== prev.matcapRenderer) track("options-light-matcap", { renderer: state.matcapRenderer })
      if (state.splitStyle !== prev.splitStyle) track("tools-split-screen", { style: state.splitStyle })
      if (state.sourceA !== prev.sourceA) {
        const custom = customTerrainSources.find((s) => s.id === state.sourceA)
        track("source-terrain", { source: state.sourceA, custom: !!custom })
      }
      if (activeBasemap !== prev.basemap) {
        const custom = customBasemapSources.find((s) => s.id === activeBasemap)
        track("source-basemap", { source: activeBasemap, custom: !!custom })
      }
      if (state.hillshadeMethod !== prev.hillshadeMethod) track("options-hillshade", { method: state.hillshadeMethod })
      if (state.curvatureMode !== prev.curvatureMode) track("options-terrain-analysis", { setting: "curvatureMode", value: state.curvatureMode })
      if (state.slopeSourceMode !== prev.slopeSourceMode) track("options-terrain-analysis", { setting: "slopeSourceMode", value: state.slopeSourceMode })
      // svfPrecision/opennessPrecision used to be tracked here too, but the
      // snapshot below never stored either field — prev.svfPrecision/
      // opennessPrecision were permanently undefined, so the !== check was
      // true on every render this effect ran (virtually every state change),
      // not just on a real Precise/Fast toggle. That false signal dominated
      // the event volume without being useful, so it's dropped rather than
      // fixed — opennessMode above is the setting worth tracking here.
      if (state.opennessMode !== prev.opennessMode) track("options-relief-visualization", { setting: "opennessMode", value: state.opennessMode })
      // Free vs Datetime-derived light direction — shared by Hillshade and
      // Phong (see light-direction-control.tsx), so tracked under its own
      // event rather than folded into options-light-phong.
      if (state.lightUseDatetime !== prev.lightUseDatetime) track("options-light-direction", { mode: state.lightUseDatetime ? "datetime" : "free" })
      // Absolute vs LRM reference — same toggle (see elevation-reference-
      // toggle.tsx) reused by Contours, Plane Slicer, and the Elevation
      // Picker; `feature` distinguishes which one changed.
      if (state.contourReferenceMode !== prev.contourReferenceMode) track("options-elevation-reference", { feature: "contours", mode: state.contourReferenceMode })
      if (state.planeSlicerReferenceMode !== prev.planeSlicerReferenceMode) track("options-elevation-reference", { feature: "plane-slicer", mode: state.planeSlicerReferenceMode })
      if (state.elevationPickerReferenceMode !== prev.elevationPickerReferenceMode) track("options-elevation-reference", { feature: "elevation-picker", mode: state.elevationPickerReferenceMode })
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
      const added = customTerrainSources[customTerrainSources.length - 1]
      // The BYOD url itself is only meaningful to log once, right here at
      // creation — source-terrain (above) fires again every time the user
      // just re-selects an already-added source, which would otherwise
      // re-log the same url repeatedly.
      track("source-add", { kind: "terrain", type: added?.type, url: added?.url })
    }
    prevTerrainCount.current = customTerrainSources.length
  }, [customTerrainSources])
  useEffect(() => {
    if (prevBasemapCount.current !== null && customBasemapSources.length > prevBasemapCount.current) {
      const added = customBasemapSources[customBasemapSources.length - 1]
      track("source-add", { kind: "basemap", type: added?.type, url: added?.url })
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
    // withSlowTileStats composes INSIDE withTileResultCache so it measures the
    // real ray-marching cost, not a cache hit — see tile-timing-stats.ts.
    maplibregl.addProtocol('svf', withTileResultCache(withSlowTileStats('svf', svfProtocol)))
    maplibregl.addProtocol('openness', withTileResultCache(withSlowTileStats('openness', opennessProtocol)))
    maplibregl.addProtocol('local-dominance', withTileResultCache(withSlowTileStats('local-dominance', localDominanceProtocol)))
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
    maplibregl.addProtocol('shadow', withTileResultCache(shadowProtocol))
  }, [])

  // Keep the module-level cache flag in sync with the persisted Settings switch
  // (protocol handlers run outside React, so they can't read the atom directly).
  const [cacheVizTiles] = useAtom(cacheVizTilesAtom)
  useEffect(() => {
    setTileResultCacheEnabled(cacheVizTiles)
  }, [cacheVizTiles])

  // Force the corner AttributionControl (<AttributionControl compact .../>
  // below) to actually START collapsed. `compact` alone doesn't guarantee
  // that: confirmed against maplibre-gl-js's own attribution_control.ts —
  // _updateCompact() force-opens the <details> (sets the `open` attribute
  // and adds "maplibregl-compact-show") the FIRST time real attribution text
  // actually resolves while the map's canvas container is <=640px (true for
  // most of our panes, especially split or with the sidebar open) — a
  // one-time transition baked into the control itself, not something this
  // app's own props can turn off. Several of our sources resolve their real
  // attribution asynchronously well after mount (Esri contributor fetch,
  // Bing capture-date lookup, GE Historical), so that forced-open moment
  // reliably happens AFTER the user's first look at the map, reading as "it
  // just opened itself". A capture-phase click listener distinguishes a
  // genuine user click on the toggle (left alone) from that automatic one
  // (immediately re-collapsed) — a plain MutationObserver can't tell the two
  // apart on its own, since both ultimately just add the same attribute.
  useEffect(() => {
    let userToggledAt = 0
    const onButtonClick = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.(".maplibregl-ctrl-attrib-button")) userToggledAt = Date.now()
    }
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target as HTMLElement
        if (!el.classList?.contains("maplibregl-ctrl-attrib") || !el.hasAttribute("open")) continue
        if (Date.now() - userToggledAt < 200) continue // a real click just happened — respect it
        el.removeAttribute("open")
        el.classList.remove("maplibregl-compact-show")
      }
    })
    document.addEventListener("click", onButtonClick, true)
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true })
    return () => {
      document.removeEventListener("click", onButtonClick, true)
      observer.disconnect()
    }
  }, [])

  // Persist the beta gates' last value so re-opening the app without their
  // `?tellsBeta=`/`?sunShadowBeta=` URL param doesn't silently reset to off
  // (see stateOverrides application below, and the atoms' own comment).
  const [tellsBetaEnabled, setTellsBetaEnabled] = useAtom(tellsBetaEnabledAtom)
  const [sunShadowBetaEnabled, setSunShadowBetaEnabled] = useAtom(sunShadowBetaEnabledAtom)
  const [historicalBetaEnabled, setHistoricalBetaEnabled] = useAtom(historicalBetaEnabledAtom)
  const [appModeEnabled, setAppModeEnabled] = useAtom(appModeAtom)
  useEffect(() => {
    setTellsBetaEnabled(state.tellsBeta)
  }, [state.tellsBeta, setTellsBetaEnabled])
  useEffect(() => {
    setSunShadowBetaEnabled(state.sunShadowBeta)
  }, [state.sunShadowBeta, setSunShadowBetaEnabled])
  useEffect(() => {
    setHistoricalBetaEnabled(state.historicalBeta)
  }, [state.historicalBeta, setHistoricalBetaEnabled])
  useEffect(() => {
    setAppModeEnabled(state.appMode as AppMode)
  }, [state.appMode, setAppModeEnabled])

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

    // Restore the beta gates from their persisted last value, unless the URL
    // itself already carries an explicit override.
    if (!searchParams.has("tellsBeta") && tellsBetaEnabled) stateOverrides.tellsBeta = true
    if (!searchParams.has("sunShadowBeta") && sunShadowBetaEnabled) stateOverrides.sunShadowBeta = true
    if (!searchParams.has("historicalBeta") && historicalBetaEnabled) stateOverrides.historicalBeta = true
    if (!searchParams.has("appMode")) {
      if (appModeEnabled !== "terrain") {
        stateOverrides.appMode = appModeEnabled
      } else {
        // No explicit `?appMode=` and nothing persisted yet for this origin
        // (a brand-new visitor, or one whose browser never stored an
        // appMode preference here) — let the hostname itself pick a default.
        // A domain unrelated to either deploy (a fork, localhost, a preview
        // URL) matches neither branch and just keeps the normal "terrain"
        // default, so this never breaks serving from another domain.
        // On a historical-satellite deploy, always default to historical mode
        // regardless of any stale "terrain" value in localStorage (which could
        // come from the user having visited the main terrain-viewer deploy).
        // A visitor who genuinely wants terrain mode on this hostname can use
        // `?appMode=terrain` — that case is already handled by the
        // `!searchParams.has("appMode")` guard above.
        if (isHistoricalHostname(window.location.hostname)) {
          stateOverrides.appMode = "historical"
        }
      }
    }

    // Historical-satellite default camera/layout/basemap — applied whenever
    // this resolves to historical mode on that hostname with no explicit URL
    // override for a given field, NOT just a visitor's first-ever load.
    // Previously this block lived nested inside the "fresh visitor" branch
    // above (gated on `appModeEnabled !== "terrain"` being false), so ANY
    // returning visitor — meaning anyone with literally any appMode value
    // already in this origin's localStorage, which is everyone after their
    // very first visit, since the mirroring effect a few lines up persists
    // whatever appMode ends up active — silently skipped the entire default
    // forever: not just lat/lng, but zoom/pitch/splitStyle/basemap dates too.
    // Gated on the RESOLVED appMode (computed below, after the restore-from-
    // storage logic above) rather than on "is this a fresh visit", so a
    // visitor who explicitly parked this origin in terrain mode (via
    // `?appMode=terrain`) still doesn't get yanked into a historical camera.
    const effectiveAppMode = (stateOverrides.appMode as AppMode | undefined) ?? state.appMode
    if (effectiveAppMode === "historical" && isHistoricalHostname(window.location.hostname)) {
      const HISTORICAL_HOSTNAME_DEFAULTS: Record<string, unknown> = {
        viewMode: "2d",
        splitStyle: "overlay",
        showRasterBasemap: true,
        basemapSourceA: "historical",
        dateA: 1514678400000,
        basemapSourceB: "historical",
        dateB: 1295049600000,
        historicalActiveSourceA: "ge-historical",
      }
      for (const [key, value] of Object.entries(HISTORICAL_HOSTNAME_DEFAULTS)) {
        if (!searchParams.has(key)) stateOverrides[key] = value
      }
      // The whole-earth default camera CANNOT go through stateOverrides/
      // setState like the fields above: the <Map>'s `initialViewState` has
      // already consumed the plain nuqs defaults (Mont Blanc) by the time
      // this effect runs, and it's uncontrolled after mount — a setState
      // would only rewrite the URL, then get stomped right back by the next
      // debounced commitViewState carrying the (unmoved) actual camera.
      // Same trap and same cure as TerrainControlPanel.tsx's handleGoHome
      // and lib/bookmarks.ts's applyBookmark: command the map directly.
      // Per-key URL overrides still win — a shared link with e.g. lat/lng
      // but no zoom keeps its own values for what it does carry.
      const HISTORICAL_CAMERA_DEFAULTS = { lat: 28.2176, lng: 11.5101, zoom: 1.46, pitch: 0 } as const
      if (Object.keys(HISTORICAL_CAMERA_DEFAULTS).some((key) => !searchParams.has(key))) {
        const jumpToHistoricalHome = () => mapRefs.A.current?.getMap()?.jumpTo({
          center: [
            searchParams.has("lng") ? state.lng : HISTORICAL_CAMERA_DEFAULTS.lng,
            searchParams.has("lat") ? state.lat : HISTORICAL_CAMERA_DEFAULTS.lat,
          ],
          zoom: searchParams.has("zoom") ? state.zoom : HISTORICAL_CAMERA_DEFAULTS.zoom,
          pitch: searchParams.has("pitch") ? state.pitch : HISTORICAL_CAMERA_DEFAULTS.pitch,
        })
        const mapA = mapRefs.A.current?.getMap()
        if (mapA?.isStyleLoaded()) jumpToHistoricalHome()
        else mapA?.once("load", jumpToHistoricalHome)
      }
      // Open Compare-and-Blend + Basemaps panels on first-ever visit (no
      // stored sectionOpen). Returning visitors who closed them keep their
      // preference.
      if (!hadStoredSectionAtMount.current) {
        setSectionOpen(prev => ({ ...prev, comparisonMix: true, rasterBasemap: true }))
      }
    }

    // Historical mode only ever shows the raster basemap (its Options/
    // Visualization Modes/Detectors/Elevation Picker sections are hidden
    // entirely — see TerrainControlPanel.tsx) — but most of those toggles'
    // OWN defaults don't reflect that (showHillshade defaults true; an
    // explicit `?showColorRelief=true&appMode=historical`-style link could
    // set any of the rest), so a direct historical-mode deep link with no
    // explicit override for a given field forces it off. Handled here for a
    // fresh load; the ModePicker's handleSelectMode (TerrainControlPanel.tsx)
    // covers the same nudge for an in-session mode switch (there every one of
    // these is forced off unconditionally, since a visitor could have turned
    // any of them on while still in Terrain mode — no default to rely on).
    if (effectiveAppMode === "historical") {
      const HISTORICAL_MODE_OFF_FIELDS = [
        "showHillshade", "showLightingEffects", "showShadows", "showColorRelief",
        "showTerrainAnalysis", "showReliefVisualization", "showPlaneSlicer",
        "showTellsDetector", "showContoursAndGraticules", "showContours",
        "showGraticules", "showBackground",
      ] as const
      for (const field of HISTORICAL_MODE_OFF_FIELDS) {
        if (!searchParams.has(field)) stateOverrides[field] = false
      }
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
      const flyToBounds = () => mapRefs.A.current?.fitBounds([[west, south], [east, north]], { padding: 50, duration: 0 })
      const map = mapRefs.A.current?.getMap()
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
          if (bbox && mapRefs.A.current) {
            const [west, south, east, north] = bbox
            mapRefs.A.current.fitBounds([[west, south], [east, north]], { padding: 50, duration: 0 })
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

  // A terrain-aware MapLibre camera has a SIXTH parameter beyond
  // center/zoom/bearing/pitch/roll: `transform.elevation`, the altitude of the
  // point the camera is looking at (public readers: Map#getCameraTargetElevation,
  // writer: Map#transform.setElevation). Two views can agree exactly on all the
  // others and still draw the same ground at different screen heights if their
  // camera-target elevations differ — at any nonzero pitch that difference is
  // a straight vertical offset between the panes.
  //
  // Re-anchoring it uses MapLibre's own end-of-gesture routine,
  // transform.recalculateZoomAndCenter(terrain), which holds the CAMERA
  // POSITION fixed and solves for the center/zoom that put the target back on
  // the ground along the same view ray (maplibre-gl 5.24,
  // TransformHelper#recalculateZoomAndCenter). Nothing moves on screen; only
  // the reported center/zoom change, to stay honest about where the camera
  // actually is. The obvious alternative — transform.setElevation(ground) —
  // preserves the requested center instead, but pays for it with a visible
  // lurch every time it fires, since it swings the camera's target up or down
  // by however wrong the elevation was (a valley-to-summit pan is a ~2900m
  // correction). That lurch is the worse of the two, so the small center/zoom
  // drift is the accepted trade.
  //
  // Two things keep that drift from becoming a problem:
  //
  // 1. ELEVATION_SETTLE_EPSILON_M. Elevation is re-anchored only when it is
  //    genuinely stale — i.e. after the user has actually panned across
  //    terrain, which is the one case where MapLibre freezes elevation for the
  //    duration of the gesture and so leaves it behind. It deliberately does
  //    NOT fire for a padding change, a resize, or a split-mode switch: none
  //    of those move the center, so the elevation is already right and there
  //    is nothing to correct. Without this guard those settles re-derived
  //    center/zoom for no reason and walked the focus point off the Matterhorn
  //    on every Off/Overlay/Side switch.
  //
  // 2. ONE reference view owns the result, and it is whichever view the user
  //    last touched (lastInteractedViewRef, set on pointerdown so it is right
  //    even for a click that never became a drag). That view is re-anchored
  //    against its own terrain and every other view is then jumped to match it
  //    exactly. Letting each view re-derive independently is what lets them
  //    drift apart, since the answer depends on that view's own DEM — so the
  //    view being driven is made authoritative and the rest follow it,
  //    whichever one it happens to be (the single view, or any of A..H in
  //    side/overlay/grid).

  // Whether a pointer is currently held down anywhere. Programmatic camera
  // commands are forbidden while it is: MapLibre's jumpTo/easeTo both begin
  // with Map#stop(), which ends up calling HandlerManager#stop() ->
  // handler.reset() on EVERY input handler (maplibre-gl 5.24). Doing that to a
  // map the user is mid-gesture on silently kills the gesture — the button is
  // still down but every handler has forgotten the press, so the map just
  // stops responding until the next mousedown. That was the "cursor looks
  // right but click-and-drag does nothing, seemingly at random" bug: a pointer
  // pressed but not yet MOVED leaves Map#isMoving() false, so an 'idle' could
  // still slip through and issue one out from under the press.
  //
  // Tracked on window in the capture phase rather than per-canvas so a release
  // outside the map (dragged past the edge) still clears it.
  const pointerDownRef = useRef(false)
  // Which view the user last put a pointer on — the reference the settle below
  // re-anchors against, and which every other view is then matched to. Set on
  // pointerdown (see the pane's onPointerDownCapture in the JSX) rather than on
  // the first move, so a press that hasn't turned into a drag yet already
  // counts. Defaults to the primary view for the very first settle after load,
  // when nothing has been touched.
  const lastInteractedViewRef = useRef<ViewId>("A")
  useEffect(() => {
    const down = () => { pointerDownRef.current = true }
    const up = () => { pointerDownRef.current = false }
    window.addEventListener("pointerdown", down, true)
    window.addEventListener("pointerup", up, true)
    window.addEventListener("pointercancel", up, true)
    return () => {
      window.removeEventListener("pointerdown", down, true)
      window.removeEventListener("pointerup", up, true)
      window.removeEventListener("pointercancel", up, true)
    }
  }, [])

  const resettleTerrainElevation = useCallback(() => {
    if (pointerDownRef.current) return

    const preferred = lastInteractedViewRef.current
    const order = activeViewIds.includes(preferred)
      ? [preferred, ...activeViewIds.filter((s) => s !== preferred)]
      : activeViewIds
    const referenceSide = order.find((s) => mapRefs[s].current?.getMap()?.getTerrain())
    if (!referenceSide) return
    const reference = mapRefs[referenceSide].current!.getMap()
    const tr = reference.transform

    // Is the camera height actually stale? Only a pan across terrain leaves it
    // behind (MapLibre freezes elevation for the duration of a gesture); a
    // padding change, a resize or a split-mode switch move the viewport, not
    // the center, so there is nothing to re-anchor and re-deriving center/zoom
    // would just walk the focus point off its coordinates for no reason.
    // The epsilon also guarantees termination: recalculateZoomAndCenter picks a
    // new center, whose ground height differs from the old one's by a hair, so
    // an exact-equality test would let it creep from idle to idle forever —
    // and every one of those iterations would fire the jumpTo loop below.
    const groundElevation = reference.terrain.getElevationForLngLatZoom(tr.center, tr.tileZoom)
    if (!Number.isFinite(groundElevation)) return
    if (Math.abs(groundElevation - tr.elevation) < ELEVATION_SETTLE_EPSILON_M) return

    tr.recalculateZoomAndCenter(reference.terrain)
    reference.triggerRepaint()

    if (!isSplit) return
    // Same re-entrancy guard the sync handler uses — these jumps would
    // otherwise bounce back through handleViewMove and re-sync in the opposite
    // direction, undoing the reference view's correction.
    isSyncing.current = true
    try {
      for (const side of activeViewIds) {
        if (side === referenceSide) continue
        const map = mapRefs[side].current?.getMap()
        if (!map) continue
        // Copied wholesale from the reference, elevation included — NOT
        // re-derived per view. This is the "never drifts from the view you
        // clicked" guarantee: the others are told where the reference ended up,
        // they don't get a vote.
        map.jumpTo({
          center: tr.center,
          zoom: tr.zoom,
          bearing: tr.bearing,
          pitch: tr.pitch,
          ...(map.getTerrain() ? { elevation: tr.elevation } : {}),
        })
      }
    } finally {
      isSyncing.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewIds.join(","), isSplit])

  // The 'idle' variant, plus the gate that only belongs there: don't re-resolve
  // while any view still has a gesture in flight. MapLibre freezes the dragged
  // view's elevation for the duration of a drag (Map#_elevationFreeze) exactly
  // so the camera doesn't bob as the ground rises under it; re-resolving
  // between drag frames would undo that, and would also overwrite the
  // elevation handleViewMove has just mirrored onto the other views.
  const resettleTerrainElevationOnIdle = useCallback(() => {
    for (const side of activeViewIds) {
      if (mapRefs[side].current?.getMap()?.isMoving()) return
    }
    resettleTerrainElevation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewIds.join(","), resettleTerrainElevation])

  // Each view's 'idle' listener is registered once, in its onLoad, so its
  // closure would otherwise pin whichever activeViewIds happened to be current
  // at mount — and go stale the moment split mode changes the view set. Read
  // it through a ref instead so the listener always calls the latest one.
  const resettleTerrainElevationOnIdleRef = useRef(resettleTerrainElevationOnIdle)
  useEffect(() => {
    resettleTerrainElevationOnIdleRef.current = resettleTerrainElevationOnIdle
  }, [resettleTerrainElevationOnIdle])

  // Every active view is fully interactive too (drag/scroll/rotate), so sync
  // has to run both/all ways — otherwise panning or zooming any non-primary
  // view directly desyncs it with nothing to bring it back, since only one
  // view's own moves used to propagate to the other. Generalizes the old
  // onMoveA/onMoveB pair: whichever view moved jumps every OTHER active view
  // to match, instead of a hardcoded "the one other map".
  const handleViewMove = useCallback((side: ViewId, evt: any) => {
    if (isSyncing.current || !isSplit) return
    isSyncing.current = true
    try {
      // evt.viewState carries only the five "classic" camera parameters, so
      // the sixth (camera-target elevation, see resettleTerrainElevation) has
      // to be read off the moved view's own transform and forwarded
      // explicitly. Without it the panes visibly drift apart vertically for
      // the whole duration of a drag, then snap back together the instant it
      // ends, because MapLibre updates the two views' elevations by different
      // rules while a drag is in flight:
      //   - the DRAGGED view is elevation-frozen for the whole gesture
      //     (HandlerManager sets Map#_elevationFreeze on the first drag frame
      //     and only clears it once the gesture finishes), so its camera stays
      //     anchored at the altitude it had when the drag started;
      //   - every OTHER view is driven by jumpTo() below, and jumpTo
      //     unconditionally re-resolves elevation against its own terrain
      //     first thing (`if (this.terrain) tr.setElevation(...)`), i.e. it
      //     tracks the live ground altitude under the moving center.
      // Passing `elevation` explicitly wins: jumpTo applies an explicit
      // `elevation` option AFTER that automatic re-resolve, so every view ends
      // up anchored exactly where the dragged one is.
      const source = mapRefs[side].current?.getMap()
      const sourceElevation = source?.getTerrain() ? source.getCameraTargetElevation() : undefined
      const syncElevation = Number.isFinite(sourceElevation) ? sourceElevation : undefined
      for (const other of activeViewIds) {
        if (other === side) continue
        const otherMap = mapRefs[other].current?.getMap()
        if (!otherMap) continue
        otherMap.jumpTo({
          center: [evt.viewState.longitude, evt.viewState.latitude],
          zoom: evt.viewState.zoom,
          bearing: evt.viewState.bearing,
          pitch: evt.viewState.pitch,
          // Only meaningful when this view has terrain of its own; a flat view
          // belongs at elevation 0, which is what jumpTo already leaves it at.
          ...(syncElevation !== undefined && otherMap.getTerrain() ? { elevation: syncElevation } : {}),
        })
      }
    } finally {
      // jumpTo() fires 'move'/'moveend' synchronously (see padding effect
      // comment above), so any re-entrant call from the other views' own
      // handlers has already run and bailed out (isSyncing was still true)
      // by the time this loop returns — safe to clear the guard immediately
      // instead of on a timer. A timed reset (the old approach) blocked
      // legitimate subsequent drag frames too (they fire every ~16ms, far
      // more often than a 50ms window), leaving the other view a few frames
      // behind and requiring a manual pan on it to resync.
      isSyncing.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSplit, activeViewIds.join(",")])

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

  // Identical regardless of which view moved (unlike handleViewMove, no
  // "jump every other view" side-effect here) — one shared handler for every
  // active view, replacing the old onMoveEndA/onMoveEndB pair.
  const handleViewMoveEnd = useCallback((evt: any) => {
    if (!isSyncing.current) commitViewState(evt)
  }, [commitViewState])

  const getMapBounds = useCallback(() => {
    const primary = mapRefs.A.current
    if (!primary) return { west: -180, south: -90, east: 180, north: 90 }
    const bounds = primary.getMap().getBounds()
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }
  }, [])

  // 2D is a strict nadir, north-up top-down view. maxPitch:0 (Map prop) locks
  // pitch, but bearing can still be changed by right-drag / two-finger rotate
  // even with the dragRotate prop off (react-map-gl doesn't reliably re-apply
  // that handler option after construction — same caveat as pitchWithRotate), so
  // disable the rotation handlers imperatively here and snap bearing+pitch to 0
  // on entry. Re-enabled for 3D/globe. Runs on map load too, so a map first
  // constructed in 2D still gets locked.
  useEffect(() => {
    const is2d = state.viewMode === "2d"
    const apply = (side: ViewId) => {
      const map = mapRefs[side].current?.getMap()
      if (!map) return
      if (is2d) {
        map.dragRotate.disable()
        map.touchZoomRotate.disableRotation()
        ;(map.keyboard as any)?.disableRotation?.()
        map.easeTo({ bearing: 0, pitch: 0, duration: 500 })
      } else {
        map.dragRotate.enable()
        map.touchZoomRotate.enableRotation()
        ;(map.keyboard as any)?.enableRotation?.()
      }
    }
    activeViewIds.forEach(apply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.viewMode, activeViewIds.join(","), mapLoaded])

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

  // matchThemeColors only overrides the *applied* color here — state's own
  // skyColor/horizonColor/fogColor always keep the user's last custom picks, so
  // toggling this off restores them instead of losing them (see
  // background-options-section.tsx's handleMatchThemeToggle).
  const getSkyConfig = () => ({
    'sky-color': state.matchThemeColors ? themeColor : state.skyColor,
    'sky-horizon-blend': state.skyHorizonBlend,
    'horizon-color': state.matchThemeColors ? themeColor : state.horizonColor,
    'horizon-fog-blend': state.horizonFogBlend,
    'fog-color': state.matchThemeColors ? themeColor : state.fogColor,
    'fog-ground-blend': state.fogGroundBlend,
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
  // Per-map pending "apply terrain once its source shows up" listener, so a
  // re-run of the effect below can take the previous one off first. Without
  // this the listener stacked: the effect re-runs on every mapLoaded change
  // (and on each source/exaggeration change), and each run that found no
  // terrainSource yet added ANOTHER 'sourcedata' handler, all of which then
  // fired setTerrain in the same tick once the source finally appeared. Each
  // of those calls builds a fresh Terrain + RenderToTexture and discards the
  // render-to-texture tile cache, so the map visibly re-renders from scratch
  // once per stacked listener — a good part of the "terrain blinks through a
  // few states as it loads" flicker.
  const pendingTerrainApply = useMemo(() => new WeakMap<maplibregl.Map, () => void>(), [])

  const applyTerrain = useCallback((map: maplibregl.Map, viewMode: string) => {
    const pending = pendingTerrainApply.get(map)
    if (pending) {
      map.off('sourcedata', pending)
      pendingTerrainApply.delete(map)
    }

    // Remove terrain in 2D mode
    if (viewMode === '2d') {
      if (map.getTerrain()) map.setTerrain(null)
      return
    }

    const exaggeration = state.exaggeration || 1
    const setTerrainIfNeeded = () => {
      const source = map.getSource('terrainSource')
      if (!source) return false
      // setTerrain() is expensive and destructive (new Terrain, new
      // RenderToTexture, RTT tile cache dropped), so only call it when it
      // would actually change something. Comparing the bound source OBJECT —
      // not just the id — matters because <Source id="terrainSource"> is
      // remounted (removed and re-added under the same id) whenever the
      // terrain provider, hi-res toggle, local file or probed maxzoom change,
      // see MapSources.tsx; a terrain still bound to the old, torn-down source
      // has the right id but the wrong tiles.
      const current = map.getTerrain()
      const boundSource = map.terrain?.tileManager?.getSource()
      if (current?.exaggeration === exaggeration && boundSource === source) return true
      map.setTerrain({ source: 'terrainSource', exaggeration })
      return true
    }

    if (setTerrainIfNeeded()) return
    // Source isn't in the style yet — retry as sources arrive, then stop.
    const apply = () => {
      if (!setTerrainIfNeeded()) return
      map.off('sourcedata', apply)
      pendingTerrainApply.delete(map)
    }
    pendingTerrainApply.set(map, apply)
    map.on('sourcedata', apply)
  }, [state.exaggeration, pendingTerrainApply])
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

  // Sync terrain for every active view — generalizes the old "Map A"/"Map B"
  // pair of near-identical effects into one loop.
  useEffect(() => {
    for (const side of activeViewIds) {
      const map = mapRefs[side].current?.getMap()
      if (!map || !mapLoaded[side]) continue
      applyTerrain(map, state.viewMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.exaggeration, state.sourceA, state.sourceB, state.sourceC, state.sourceD, state.sourceE, state.sourceF, state.sourceG, state.sourceH,
    state.viewMode, highResTerrain, mapLoaded, activeViewIds.join(","), applyTerrain,
  ])

  // Reset a view's loaded flag once it's no longer active (split turned off,
  // or gridLayout shrank) — generalizes "reset mapBLoaded when split screen
  // is toggled off". A view that drops out of activeViewIds unmounts its
  // <Map>, so its stale `true` would otherwise never get cleared.
  useEffect(() => {
    setMapLoaded((prev) => {
      let changed = false
      const next = { ...prev }
      for (const side of VIEW_IDS) {
        if (!activeViewIds.includes(side) && next[side]) { next[side] = false; changed = true }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewIds.join(",")])

  // ----------------------------------------
  // Terrain-transition tile-texture desync workaround (upstream MapLibre GL
  // JS limitation, not something wrong on our end — a community-shared fix,
  // no tracked issue/PR number to cite; see this function's own detailed
  // walkthrough plus the memory note "maplibre-terrain-transition-rtt-desync"
  // for the full original write-up if this ever needs revisiting). With 3D
  // terrain on, each terrain tile's rendered-to-texture
  // (RTT) result is cached and only freed on a style 'data' event (see this
  // package's own Map#setTerrain, which wires exactly that). A maplibre paint-
  // property TRANSITION — e.g. this app's color-relief opacity/min/max easing
  // after a React/nuqs state change — does NOT fire a 'data' event per frame,
  // so the terrain-draped layer keeps painting from whatever was cached at
  // the transition's first frame until something else (a camera move, or the
  // tile pool evicting an entry) happens to free it — which is exactly why
  // interactions seem to "magically" fix a stuck-looking layer. Community
  // workaround (not an official fix): force-free the RTT cache on every frame
  // a transition is in progress, plus one extra frame after it ends (a
  // transition's `hasTransition()` already reads false by the next tick, so
  // the LAST real frame needs its own repaint triggered explicitly or it'd
  // never get one). `.terrain` isn't in the public Map type (undocumented
  // internal), hence the `any` — `getLayersOrder`/`getLayer`/`hasTransition`
  // all are public.
  useEffect(() => {
    const cleanups: (() => void)[] = []
    for (const side of activeViewIds) {
      const map = mapRefs[side].current?.getMap()
      if (!map || !mapLoaded[side]) continue
      let wasTransitioning = false
      const onRender = () => {
        const terrain = (map as any).terrain
        const transitioning = !!terrain && map.getLayersOrder().some((id) => map.getLayer(id)?.hasTransition())
        if (transitioning || wasTransitioning) terrain?.tileManager.freeRtt()
        if (!transitioning && wasTransitioning) map.triggerRepaint()
        wasTransitioning = transitioning
      }
      map.on('render', onRender)
      cleanups.push(() => map.off('render', onRender))
    }
    return () => { cleanups.forEach((fn) => fn()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, activeViewIds.join(",")])
  // ----------------------------------------

  // Effective zoom bounds are resolved from view A only, same primary-only
  // policy as max-bounds/Contours/Geocoder/Nav below — so only A's zoom
  // range is ever tracked (a zoomRangeB used to exist here too but nothing
  // downstream ever read it).
  const [zoomRangeA, setZoomRangeA] = useState<{ minzoom: number; maxzoom: number; isCustom: boolean } | null>(null)
  const [zoomRangeBasemap, setZoomRangeBasemap] = useState<{ minzoom: number; maxzoom: number; isCustom: boolean } | null>(null)

  // Only include a range in the computation if it came from a custom source — checked
  // directly against the id (a builtin source reporting a coincidental maxzoom of 20
  // shouldn't be mistaken for "no custom range" the way a fallback-value heuristic would).
  const isTerrainCustom = customTerrainSources.some(s => s.id === state.sourceA)
  // effectiveMinZoom/effectiveMaxZoom below are driven by the primary map only, so the
  // "active basemap" for zoom purposes is always map A's — basemapSourceA in per-view
  // mode, basemapSource otherwise.
  // Per-view resolution of basemap id + scrubbed date — generalizes the old
  // activeBasemapSourceA/B + activeDateA/B pairs to every letter (A-F). Cheap
  // (plain field lookups, no fetch), so recomputed every render rather than
  // memoized. rawBasemapSource is either a normal basemap id or the single
  // combined "historical" entry — resolved down to whichever concrete source
  // (wayback/hls/ge-historical/planet) is actually active for that side
  // before it reaches RasterBasemapSource, which never needs to know
  // "historical" exists as a sidebar-level concept.
  // Live "ESRI World Imagery" (basemapSource "esri", as opposed to the
  // scrubbable "wayback" historical source) has no stored per-view date of
  // its own — it's always showing whichever Wayback release is currently
  // newest at this location. One location-keyed lookup here, not per-view
  // (same "not per-side" reasoning as Bing's own capture date, which the
  // historical timeline panel already only ever calls once), applied to
  // any/every view whose resolved basemapSource comes out "esri" below.
  const { dateMs: esriLiveDateMs } = useEsriLiveCaptureDate(state.lat, state.lng, state.zoom)
  const perViewResolved = {} as Record<ViewId, { basemapSource: string; date: number }>
  for (const side of VIEW_IDS) {
    const rawBasemapSource = stateAny[viewFieldName(side, "basemapSource", state.basemapPerView)]
    const historicalActiveSourceForSide = stateAny[viewFieldName(side, "historicalActiveSource", state.basemapPerView)]
    perViewResolved[side] = {
      basemapSource: resolveActiveHistoricalSource(rawBasemapSource, historicalActiveSourceForSide),
      date: stateAny[viewFieldName(side, "date", state.basemapPerView)],
    }
  }
  const activeBasemapSourceA = perViewResolved.A.basemapSource
  const activeBasemapSourceB = perViewResolved.B.basemapSource
  // Drives the minimap's bottom offset below — the timeline panel docks to
  // the same bottom-left area the minimap (a MapLibre IControl, only ever
  // mounted on the primary/map-a pane) would otherwise occupy.
  // In TERRAIN mode the timeline additionally requires the Raster Basemap
  // viz mode to actually be on — with it off, no historical imagery is
  // rendered at all, so a timeline scrubbing an invisible layer is noise.
  // (Historical mode always shows the basemap; see the opacity forcing in
  // the per-view render below.) The panel mirrors this same gate itself.
  const historicalTimelineActive = state.historicalBeta && isHistoricalSourceActive(state)
    && (isHistoricalMode || state.showRasterBasemap)
  const historicalTimelineVisible = historicalTimelineActive && !state.historicalTimelineCollapsed
  const isBasemapCustom = customBasemapSources.some(s => s.id === activeBasemapSourceA)

  // Linked terrain/basemap pairs (e.g. a fresco's DTM + its own albedo photo
  // COG, see CustomTerrainSource.linkedBasemapId / CustomBasemapSource.
  // linkedTerrainId) used to be applied via a pair of reactive useEffects
  // here (one watching sourceA, one watching the active basemap, each
  // re-asserting the link). That was fragile in a way ref-guards on "did the
  // effect's OWN trigger change" couldn't fully fix: both effects still
  // shared the same dependency surface (each reads the OTHER's target field
  // to decide whether to write it), so a manual pick of an unrelated
  // basemap could still race against the terrain-side effect re-confirming
  // its own link on the same render pass, silently reverting the user's
  // click. Resolving the link imperatively, once, at the exact moment of
  // each user selection (see resolveLinkedTerrainSelect/
  // resolveLinkedBasemapSelect below, used by terrain-source-section.tsx and
  // basemap-byod-section.tsx/raster-basemap-section.tsx) has no such race:
  // there's only ever one setState call per click, containing exactly the
  // fields that one action should touch.

  // Shift the vanishing point left so it stays centered in the visible
  // (non-obscured) portion of the map when the floating sidebar covers the
  // right edge — but the sidebar only ever overlaps the RIGHTMOST pane IN
  // EACH ROW of the grid (it's a full-height floating overlay pinned to the
  // viewport's right edge, so every row's last column sits under it):
  // - not split: the lone view fills the whole viewport, so the sidebar sits
  //   within its own right edge → it needs the padding (it's trivially "the
  //   rightmost of its row").
  // - split: every view except each row's last one ends well left of the
  //   sidebar → no padding. Each row's last view extends to the true
  //   viewport right edge, which DOES include the sidebar-covered region →
  //   it needs the padding instead.
  // Applying the same padding to every view regardless of column (as this
  // used to, for the 2-map case) shifts a left pane's vanishing point for an
  // obstruction that isn't actually over it, while the rightmost pane's own
  // shift would be sized against a wider box than its own visible portion —
  // so the same lat/lng/zoom would look centered at visibly different points
  // across panes. Per-row-rightmost-only padding fixes that.
  const sidebarPaddingPx = getSidebarFootprintPx(isSidebarOpen, isMobile)
  // Same reasoning, bottom edge: the historical timeline panel docks along
  // the true bottom of the viewport (only ever clearing the LAST row's own
  // panes, see bottomRowViews above) — computed here (rather than reusing
  // measuredPanelClearance below, which feeds the CSS-var minimap/scale
  // offsets instead) since this needs a plain number for `padding`, not a
  // CSS length string, and needs to exist before mapPaddingFor is defined.
  const timelineBottomPaddingPx = historicalTimelineVisible
    ? Math.round(historicalTimelinePanelHeightPx + PANEL_CLEARANCE_GAP_PX)
    : 0

  // Opening or closing the sidebar / timeline changes the space the grid has
  // to divide up, so every pane rect and the gutter between them jump to new
  // positions in a single frame. Arm a short window around that change during
  // which the panes CSS-transition to their new geometry instead, matching the
  // panel's own slide and the map-padding ease below (same duration).
  //
  // Deliberately keyed on the two PANEL FOOTPRINTS and nothing else. Dragging
  // the split pill changes splitRatio, not these, so it stays pinned 1:1 to
  // the pointer with no transition lag — which is the whole reason this isn't
  // just an always-on CSS transition on the pane divs. Window resizes don't
  // touch them either, so those stay immediate too.
  const [panelGeometryEasing, setPanelGeometryEasing] = useState(false)
  const panelFootprintKey = `${sidebarPaddingPx}:${timelineBottomPaddingPx}`
  const lastPanelFootprintKey = useRef(panelFootprintKey)
  useEffect(() => {
    if (lastPanelFootprintKey.current === panelFootprintKey) return
    lastPanelFootprintKey.current = panelFootprintKey
    setPanelGeometryEasing(true)
    const timer = setTimeout(() => setPanelGeometryEasing(false), PADDING_EASE_MS + 50)
    return () => clearTimeout(timer)
  }, [panelFootprintKey])
  // Applied to the pane rects and their border overlays below.
  const panelGeometryTransition = panelGeometryEasing
    ? `top ${PADDING_EASE_MS}ms ease-out, left ${PADDING_EASE_MS}ms ease-out, width ${PADDING_EASE_MS}ms ease-out, height ${PADDING_EASE_MS}ms ease-out, right ${PADDING_EASE_MS}ms ease-out, bottom ${PADDING_EASE_MS}ms ease-out`
    : undefined

  const mapPaddingFor = useCallback(
    (side: ViewId) => ({
      top: 0,
      bottom: bottomRowViews.includes(side) ? timelineBottomPaddingPx : 0,
      left: 0,
      // Overlay: both panes MUST share identical horizontal padding — they're
      // full-bleed stacked over the exact same viewport, so any difference
      // shifts one camera's center relative to the other's, visibly
      // misaligning the underlying imagery under the shared clip-path
      // boundary (confirmed live at partial opacity). rightmostPerRow would
      // give it to overlay's "B" only (its forced 2x1 shape), hence the
      // explicit override — but the shared value is the sidebar-avoidance one,
      // NOT zero. Every overlay pane is full-bleed and so runs under the
      // sidebar exactly like a real last column does (the border inset below
      // already treats it that way), and giving it zero here meant the camera
      // visibly jumped sideways on every Off/Side <-> Overlay switch.
      right: (isOverlaySplit || rightmostPerRow.includes(side)) ? sidebarPaddingPx : 0,
    }),
    [isOverlaySplit, bottomRowViews.join(","), rightmostPerRow.join(","), sidebarPaddingPx, timelineBottomPaddingPx],
  )

  // Eased, to match the side/bottom panels' own open/close transition instead
  // of snapping the camera the instant they start moving.
  //
  // Animating this used to be impossible: with any nonzero duration, every
  // 'move' event the easing fired while animating got picked up by the OTHER
  // views' sync handler, which called their own jumpTo — and MapLibre's
  // jumpTo() unconditionally calls this.stop() first (it has to, to jump
  // instantly), aborting whichever view's padding easeTo was still mid-flight.
  // Confirmed live at the time: with duration 300 the effect fired with the
  // correct target value but getPadding() read back {0,0,0,0} seconds later.
  // The fix is holding the isSyncing guard for the WHOLE animation rather than
  // just the synchronous call, which the timer below does — every view is
  // eased to its own target in the same tick with the same duration, so they
  // stay in lockstep and there is nothing legitimate to cross-sync anyway.
  const paddingEaseRef = useRef(0)
  useEffect(() => {
    const generation = ++paddingEaseRef.current
    isSyncing.current = true
    for (const side of activeViewIds) {
      if (!mapLoaded[side]) continue
      const map = mapRefs[side].current?.getMap()
      if (!map) continue
      map.easeTo({
        padding: mapPaddingFor(side),
        duration: PADDING_EASE_MS,
        // freezeElevation is what makes MapLibre run _finalizeElevation() when
        // the ease ends, and _finalizeElevation is the ONLY thing that clears
        // Map#_elevationFreeze afterwards. Without it, every easeTo leaves that
        // flag stuck true forever (maplibre-gl 5.24: _prepareElevation sets it
        // unconditionally, _finalizeElevation only runs when this option is
        // set), and the only other thing that ever clears it is completing an
        // interactive drag ON THAT MAP. That left the two views in different
        // internal states depending on which one you'd last dragged — the
        // second half of the "pan B and A follows the terrain" asymmetry.
        // It also keeps the camera's height steady across the ease instead of
        // re-deriving it per frame; resettleTerrainElevation below re-anchors
        // it once at the end, without moving the camera.
        freezeElevation: true,
      })
    }
    const timer = setTimeout(() => {
      // A later padding change already superseded this one (the timeline
      // panel's measured height, say, arriving frame by frame as it slides) —
      // that newer run owns the guard and its own settle now.
      if (paddingEaseRef.current !== generation) return
      isSyncing.current = false
      // Assert the final padding outright, rather than trusting the ease above
      // to have landed on it. Switching Off/Overlay -> Side changes each pane's
      // pixel width in the same commit as its padding, so the ease runs through
      // a burst of resize() calls (and, with the pane geometry now animating
      // too, one per frame of it) — and a pane that MOUNTED in this same commit
      // never got the ease at all, since the loop above skips views that aren't
      // loaded yet. Either way the rightmost pane could end up with the
      // sidebar-avoidance padding only partly applied, or not at all.
      //
      // transform.setPadding, deliberately, not another easeTo: it early-returns
      // when the padding already matches (maplibre-gl 5.24,
      // TransformHelper#setPadding), so this is a no-op in the normal case, and
      // unlike easeTo/jumpTo it never calls Map#stop() — so it cannot reset a
      // view's input handlers or eat a gesture (see pointerDownRef).
      for (const side of activeViewIds) {
        const map = mapRefs[side].current?.getMap()
        if (!mapLoaded[side] || !map) continue
        const target = mapPaddingFor(side)
        if (map.transform.isPaddingEqual(target)) continue
        map.transform.setPadding(target)
        map.triggerRepaint()
      }
      // A pane's pixel dimensions usually change in the same commit as its
      // padding (Overlay's full width vs Side's half), and both that resize
      // and this ease leave the camera-target elevation resolved against the
      // old viewport.
      resettleTerrainElevation()
    }, PADDING_EASE_MS + 50)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPaddingFor, mapLoaded, activeViewIds.join(","), resettleTerrainElevation])

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
    for (const side of activeViewIds) {
      // Defensive `?.` (not `!`) — mapLoaded[side] can still read stale
      // `true` for one render right after a remount (e.g. a gridLayout
      // change that drops/re-adds this exact side), while the fresh
      // instance's ref hasn't attached yet. Was a real crash before this
      // guard existed (null.getMap()); the pane-geometry rewrite above
      // avoids the remount for a plain split-style switch, but a
      // gridLayout/view-count change still remounts the views that enter
      // or leave the active set, so this stays defensive either way.
      const map = mapRefs[side].current?.getMap()
      if (mapLoaded[side] && map) applySafeZoomBounds(map, effectiveMinZoom, effectiveMaxZoom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMinZoom, effectiveMaxZoom, mapLoaded, activeViewIds.join(","), applySafeZoomBounds])

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

  // Phong's raster ("3D Slow") tile source is expensive to refetch, so its
  // consumed light direction is decoupled from the raw illuminationDir/
  // illuminationAlt nuqs state via a read-side debounce (see
  // useDebouncedValue's own header for why this has to live on the READ
  // side): the shared state can be written at very different cadences —
  // Hillshade's own XY pad/sliders write it undebounced (native hillshade
  // paint is a cheap GPU uniform, see hillshadePaint above, which still reads
  // state.illuminationDir/Alt directly) — so debouncing only Phong's own
  // pad/sliders isn't enough to stop a Hillshade drag from re-fetching every
  // phong:// tile on every pointer-move frame. "live" (2D Fast) is itself a
  // cheap GPU uniform update, so it gets debounceMs 0 — a same-render
  // passthrough of the raw state, per useDebouncedValue.
  const phongRasterLightDebounceMs = state.phongRenderer === "raster" ? 150 : 0
  const phongLightDir = useDebouncedValue(state.illuminationDir, phongRasterLightDebounceMs)
  const phongLightAlt = useDebouncedValue(state.illuminationAlt, phongRasterLightDebounceMs)
  // Shadows has no "live" renderer variant — always tile-based, so always
  // debounced (same 150ms as Phong's own raster path), regardless of what
  // phongRenderer happens to be set to.
  const shadowLightDir = useDebouncedValue(state.illuminationDir, 150)
  const shadowLightAlt = useDebouncedValue(state.illuminationAlt, 150)

  // Same read-side debounce, for the global "Terrain Exaggeration" slider —
  // also baked directly into the matcap:// / phong:// tile URL (see
  // use-debounced-state.ts's header, which already named this field), but
  // was never actually routed through a debounce: dragging that slider —
  // unrelated to Lighting Effects entirely — was re-fetching every Matcap/
  // Phong raster tile on every pointer-move frame. The Live (2D Fast) GL
  // layers push exaggeration straight to their shader via updateOptions(),
  // not a tile URL, so they keep reading state.exaggeration directly and are
  // unaffected either way.
  const matcapRasterExaggerationDebounceMs = state.matcapRenderer === "raster" ? 150 : 0
  const matcapRasterExaggeration = useDebouncedValue(state.exaggeration, matcapRasterExaggerationDebounceMs)
  const phongRasterExaggerationDebounceMs = state.phongRenderer === "raster" ? 150 : 0
  const phongRasterExaggeration = useDebouncedValue(state.exaggeration, phongRasterExaggerationDebounceMs)

  // matcapRotationDeg/phongDiffuseStrength/phongSpecularStrength are also
  // baked into the matcap://phong:// tile URL, and each already gets a
  // write-side debounce from its own slider (lighting-effects-options-
  // section.tsx's useDebouncedState) — safe today only because each
  // currently has exactly one writer. That's the same fragile assumption
  // that caused the exaggeration bug above (a write-side debounce only
  // protects against ITS OWN control, not a second writer of the same
  // field), so these get the identical read-side treatment for parity/
  // future-proofing rather than waiting for a second writer to appear.
  const matcapRasterRotationDeg = useDebouncedValue(state.matcapRotationDeg, matcapRasterExaggerationDebounceMs)
  const phongRasterDiffuseStrength = useDebouncedValue(state.phongDiffuseStrength, phongRasterExaggerationDebounceMs)
  const phongRasterSpecularStrength = useDebouncedValue(state.phongSpecularStrength, phongRasterExaggerationDebounceMs)

  // A "color-relief" layer's color ramp is a GPU-side lookup texture, not a
  // per-pixel uniform — some maplibre-gl versions don't mark the map dirty
  // on a bare setPaintProperty("color-relief-color", ...) the way they do
  // for plain fill/line paint props, so a ramp edit with no OTHER map
  // interaction (no pan/zoom to incidentally repaint) can silently sit one
  // frame stale until something else nudges the renderer — same class of
  // issue the CustomLayerInterface live layers (matcap/phong-live-gl-layer.ts)
  // already work around with their own triggerRepaint() calls. Session ramp
  // overrides (the pencil editor's live stops/transparent-B&W edits) are
  // exactly this "isolated click, no other map interaction" case, so force
  // a repaint on both maps whenever they change.
  useEffect(() => {
    for (const side of activeViewIds) mapRefs[side].current?.getMap()?.triggerRepaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rampOverrides, activeViewIds.join(",")])

  const renderMap = useCallback(
    (source: TerrainSource | string, side: ViewId) => {
      const isPrimary = side === "A"
      const isBottomRight = side === bottomRightViewId
      // "live" (lib/phong-live-gl-layer.ts) now projects through MapLibre's own
      // per-frame shaderData prelude, so it renders correctly under BOTH
      // mercator and globe — no globe fallback needed anymore. It's still
      // flat-only (no terrain-elevation drape); that trade-off is unchanged.
      const effectivePhongRenderer = state.phongRenderer

      return (
        <Map
          ref={mapRefs[side]}
          mapLib={maplibregl}
          // Disabled here (added explicitly below, after ScaleControl) so we
          // control its stacking order in the bottom-right corner instead of
          // MapLibre's own default (added internally during Map construction,
          // i.e. always before — visually above — anything React adds later).
          attributionControl={false}
          initialViewState={{
            latitude: state.lat,
            longitude: state.lng,
            zoom: state.zoom,
            pitch: state.viewMode === "2d" ? 0 : state.pitch,
            bearing: state.viewMode === "2d" ? 0 : state.bearing,
            // Seeded here as well as applied by the padding effect above, so
            // this view is built with its vanishing point ALREADY shifted clear
            // of the sidebar/timeline rather than rendering a frame or two
            // centred on the full canvas and then sliding across to its real
            // framing. That slide was visible on first load (and again on each
            // newly-mounted pane when split mode turns on) as the focus point
            // drifting sideways just after the map appeared. Only the initial
            // value — every later change still goes through the eased effect.
            padding: mapPaddingFor(side),
          }}
          onMove={(evt) => handleViewMove(side, evt)}
          onMoveEnd={handleViewMoveEnd}
          onLoad={() => {
            setViewLoaded(side, true)
            const mapInstance = mapRefs[side].current?.getMap()
            if (!mapInstance) return

            // A new viewport needs a fresh "how many tiles are pending" count
            // for the slow ray-marched modes (SVF/Openness/Local Dominance) —
            // see tile-timing-stats.ts. Reset at the START of a move/zoom
            // (not continuously during it) so the counts actually accumulate
            // while the map is settled instead of being wiped every frame.
            mapInstance.on('movestart', () => resetSlowTileProgress())
            mapInstance.on('zoomstart', () => resetSlowTileProgress())

            // Once terrain is on, several routine operations leave the
            // camera-target elevation stale — DEM tiles arriving AFTER
            // setTerrain() already resolved elevation against nothing,
            // resize() when a pane's pixel dimensions change between
            // Overlay/Side/grid shapes, the padding easeTo below — and
            // MapLibre will not re-resolve it on its own here, because
            // `centerClampedToGround` is deliberately off (see just below)
            // and the render loop's own re-resolve is gated on it
            // (maplibre-gl 5.24, Map#_render). Left alone, a high-elevation
            // focal point (the default viewport's Matterhorn summit, ~4478m)
            // renders visibly off true screen-centre.
            //
            // 'idle' fires after every one of those settles, whatever caused
            // it, so it's the one uniform place to re-resolve — but the work
            // done there has to be cheap, since it can fire many times a
            // second while DEM tiles stream in. resettleTerrainElevation is
            // one DEM lookup plus a float assignment that MapLibre itself
            // no-ops when unchanged; it is NOT a setTerrain() call, which
            // would rebuild the Terrain + RenderToTexture pair and throw away
            // the render-to-texture tile cache on every single idle (the
            // "terrain blinks through several states while loading" flicker).
            mapInstance.on('idle', () => {
              if (!mapInstance.getTerrain()) return
              // Live ground-clamping (centerClampedToGround, default true)
              // re-resolves the camera's height from the DEM on EVERY rendered
              // frame (maplibre-gl 5.24, Map#_render), which is the
              // "follow-terrain" bob/climb while panning. Turn it off once
              // terrain has settled — same knob this file's keyframe-recording
              // animation already disables for its own one map instance (see
              // setCenterClampedToGround(false) in CameraUtilities.tsx), just
              // applied to every split view too. From here on elevation is
              // resolved explicitly instead, by resettleTerrainElevation.
              //
              // Gated on the map's OWN live state, not on a per-view-id "have
              // we done this yet" flag. A view id outlives the map instance
              // behind it: turning split mode off unmounts view B and turning
              // it back on builds a brand new <Map>, and an id-keyed flag then
              // reads "already done" for a map that has never had it done —
              // leaving that one pane permanently ground-clamped. That is
              // exactly the "pan one view and the OTHER one follows the
              // terrain" asymmetry: whichever pane still has clamping on only
              // misbehaves when it ISN'T the pane being dragged, because being
              // dragged is itself what suppresses the per-frame reclamp
              // (MapLibre freezes elevation for the duration of a gesture).
              if (mapInstance.getCenterClampedToGround()) {
                mapInstance.setCenterClampedToGround(false)
              }
              resettleTerrainElevationOnIdleRef.current()
            })

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
          sky={state.showBackground && !isHistoricalMode ? getSkyConfig() : getNoSkyConfig()}
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
          // Default (true) cancels a tile's in-flight request the moment you
          // zoom past its level — fine for a normal, fast raster tile (a
          // fresh request at that zoom next time is cheap), but for the
          // ray-marched SVF/Openness/Local Dominance modes it means an
          // expensive compute gets torn down before finishing almost every
          // time, so there's rarely any real data anywhere nearby in the
          // pyramid for MapLibre's own (already-generous, up to 10 levels)
          // overzoom-placeholder mechanism to reuse.
          //
          // Tried setting this to false, but it didn't fix the placeholder-
          // tile gap: this flag only stops MapLibre from ABORTING a tile it's
          // already tracking (source_cache.ts's _updateRetainedTiles). It does
          // nothing about tiles that haven't started yet, and those are the
          // real bottleneck — maplibre-gl routes every tile/image fetch
          // (basemap, hillshade, terrain elevation, AND every custom-protocol
          // analysis tile) through one global FIFO queue whose concurrency cap
          // drops from 16 to 8 (MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME) while
          // the map is moving/zooming — a multi-second ray-marched tile either
          // occupies one of those 8 slots for its whole duration once
          // dispatched, or sits queued behind faster requests and never gets
          // a turn to start. Re-enabling this (leaving it commented out,
          // i.e. back to the true default) avoids the "wasted compute for
          // tiles you've zoomed past" tradeoff it introduces for no real
          // benefit as-is. Worth revisiting if that queue throttle is instead
          // addressed directly, e.g. `maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME`.
          // cancelPendingTileRequestsWhileZooming={false}
          maxBounds={resolvedMaxBounds ?? undefined}

        >
          {/* Sources */}
          <TerrainSources
            source={source}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            customTerrainSources={customTerrainSources}
            titilerEndpoint={titilerEndpoint}
            onZoomRangeChange={isPrimary ? setZoomRangeA : undefined}
            lat={state.lat}
            lng={state.lng}
          />
          <RasterBasemapSource
            basemapSource={perViewResolved[side].basemapSource}
            mapboxKey={mapboxKey}
            hereKey={hereKey}
            date={perViewResolved[side].date}
            latitude={state.lat}
            longitude={state.lng}
            zoom={state.zoom}
            planetKey={planetKey}
            historicalBeta={state.historicalBeta}
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
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            sourceMode={state.slopeSourceMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <AspectSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <TriSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <CurvatureSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            mode={state.curvatureMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <TpiSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
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
            enabled={!isHistoricalMode && (state.showReliefVisualization || (state.showPlaneSlicer && state.planeSlicerReferenceMode === "lrm"))}
            radius={state.lrmRadius}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
            lat={state.lat}
            lng={state.lng}
          />
          <RoughnessSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <ShapeIndexSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <BlobnessSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <EigenRatioSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <OrientationSource
            enabled={state.showTerrainAnalysis && !isHistoricalMode}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <SvfSource
            enabled={state.showReliefVisualization && !isHistoricalMode}
            radius={state.svfRadius}
            precision={state.svfPrecision}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <OpennessSource
            enabled={state.showReliefVisualization && !isHistoricalMode}
            radius={state.opennessRadius}
            mode={state.opennessMode}
            precision={state.opennessPrecision}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <LocalDominanceSource
            enabled={state.showReliefVisualization && !isHistoricalMode}
            minRadius={state.localDominanceMinRadius}
            maxRadius={state.localDominanceMaxRadius}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <MatcapSource
            enabled={state.showLightingEffects && state.showMatcap && state.matcapRenderer === "raster" && !isHistoricalMode}
            matcapUrl={matcapUrlFor(state.matcapTextureId)}
            rotationDeg={matcapRasterRotationDeg}
            // Reapplied live to the cached (unexaggerated) normal map inside
            // matcapProtocol regardless of view mode — even flat 2D shading
            // should get correspondingly stronger contrast at higher
            // exaggeration, same reasoning as MatcapGlLayer's own historical
            // drapeEnabled/exaggeration split.
            exaggeration={matcapRasterExaggeration}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <MatcapLiveGlLayer
            mapRef={mapRefs[side]}
            enabled={state.showLightingEffects && state.showMatcap && state.matcapRenderer === "live" && !isHistoricalMode}
            matcapUrl={matcapUrlFor(state.matcapTextureId)}
            rotationDeg={state.matcapRotationDeg}
            exaggeration={state.exaggeration}
            opacity={state.matcapOpacity * state.lightingEffectsOpacity}
            lightRelativeToCamera={state.matcapLightRelativeToCamera}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <PhongSource
            enabled={state.showLightingEffects && state.showPhong && effectivePhongRenderer === "raster" && !isHistoricalMode}
            diffuseStrength={phongRasterDiffuseStrength}
            specularStrength={phongRasterSpecularStrength}
            // 3D Slow (raster) is always ABSOLUTE — a per-frame camera headlamp
            // isn't possible here (it would bake the settled bearing into every
            // tile URL and re-fetch on each rotate, not a real headlamp), so the
            // Light Anchor toggle is disabled + forced to Absolute in this mode
            // (see lighting-effects-options-section.tsx). Only the live 2D Fast
            // layer honours phongLightRelativeToCamera.
            lightDir={phongLightDir}
            lightAlt={phongLightAlt}
            exaggeration={phongRasterExaggeration}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <PhongLiveGlLayer
            mapRef={mapRefs[side]}
            enabled={state.showLightingEffects && state.showPhong && effectivePhongRenderer === "live" && !isHistoricalMode}
            diffuseStrength={state.phongDiffuseStrength}
            specularStrength={state.phongSpecularStrength}
            // Raw compass azimuth + a relative flag: the live layer adds the
            // CURRENT map bearing itself every frame (headlamp that tracks
            // through the whole rotate gesture), instead of us baking in the
            // settled bearing here the way the raster layer must.
            lightDir={phongLightDir}
            lightAlt={phongLightAlt}
            lightRelativeToCamera={state.phongLightRelativeToCamera}
            exaggeration={state.exaggeration}
            opacity={state.phongOpacity * state.lightingEffectsOpacity}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          <ShadowSource
            enabled={state.showLightingEffects && state.showShadows && !isHistoricalMode}
            lightDir={shadowLightDir}
            lightAlt={shadowLightAlt}
            radiusPx={state.shadowRadiusPx}
            terrainSource={source}
            customTerrainSources={customTerrainSources}
            mapboxKey={mapboxKey}
            maptilerKey={maptilerKey}
            titilerEndpoint={titilerEndpoint}
          />
          {isPrimary && (
            <TellsSource
              enabled={state.tellsBeta && tellsEverActivated}
              terrainSource={source}
              customTerrainSources={customTerrainSources}
              mapboxKey={mapboxKey}
              maptilerKey={maptilerKey}
              titilerEndpoint={titilerEndpoint}
              tellsOptions={tellsOptions}
              frozen={state.tellsFrozen}
              frozenSnapshot={tellsFrozenSnapshot}
            />
          )}
          {isPrimary && (
            <TellsSource
              enabled={state.tellsBeta && tellsEverActivated}
              terrainSource={source}
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

          {/* Rendered once per map instance (not primary-only) — each map's
              own react-map-gl <Layer> tree needs its own background fill;
              the mapRef prop itself is currently dead code inside
              BackgroundLayer (getBeforeId defined but unused). */}
          {state.backgroundLayerActive && !isHistoricalMode && (
            <BackgroundLayer theme={theme as any} mapRef={mapRefs[side] as any} />
          )}
          {/* Historical mode forces the basemap viz-layer opacity to 100% —
              the imagery IS the content there, and a leftover sub-100%
              terrain-mode slider value would just dim every pane against
              the blank background. Compare/blend cross-fading has its own
              overlayOpacity; the per-source basemapSourceOpacity is a
              source-calibration knob and stays honored. */}
          <RasterLayer
            showRasterBasemap={state.showRasterBasemap}
            rasterBasemapOpacity={(isHistoricalMode ? 1 : state.rasterBasemapOpacity) * state.basemapSourceOpacity}
          />
          {state.basemapPerView && state.showRasterBasemap && (
            <OverlayBasemapLayers overlayIds={state.overlayBasemapIds} opacity={isHistoricalMode ? 1 : state.rasterBasemapOpacity} customBasemapSources={customBasemapSources} />
          )}
          <ColorReliefLayer
            showColorRelief={state.showColorRelief && !isHistoricalMode}
            colorReliefPaint={colorReliefPaint}
          />
          <SlopeReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showSlope={state.showSlope} slopeReliefPaint={slopeReliefPaint} />
          <AspectReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showAspect={state.showAspect} aspectReliefPaint={aspectReliefPaint} />
          <TriReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showTri={state.showTri} triReliefPaint={triReliefPaint} />
          <CurvatureReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showCurvature={state.showCurvature} curvatureReliefPaint={curvatureReliefPaint} />
          <TpiReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showTpi={state.showTpi} tpiReliefPaint={tpiReliefPaint} />
          <LrmReliefLayer enabled={state.showReliefVisualization && !isHistoricalMode} showLrm={state.showLrm} lrmReliefPaint={lrmReliefPaint} />
          <RoughnessReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showRoughness={state.showRoughness} roughnessReliefPaint={roughnessReliefPaint} />
          <ShapeIndexReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showShapeIndex={state.showShapeIndex} shapeIndexReliefPaint={shapeIndexReliefPaint} />
          <BlobnessReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showBlobness={state.showBlobness} blobnessReliefPaint={blobnessReliefPaint} />
          <EigenRatioReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showEigenRatio={state.showEigenRatio} eigenRatioReliefPaint={eigenRatioReliefPaint} />
          <OrientationReliefLayer enabled={state.showTerrainAnalysis && !isHistoricalMode} showOrientation={state.showOrientation} orientationReliefPaint={orientationReliefPaint} />
          <SvfReliefLayer enabled={state.showReliefVisualization && !isHistoricalMode} showSvf={state.showSvf} svfReliefPaint={svfReliefPaint} />
          <OpennessReliefLayer enabled={state.showReliefVisualization && !isHistoricalMode} showOpenness={state.showOpenness} opennessReliefPaint={opennessReliefPaint} />
          <LocalDominanceReliefLayer enabled={state.showReliefVisualization && !isHistoricalMode} showLocalDominance={state.showLocalDominance} localDominanceReliefPaint={localDominanceReliefPaint} />
          <PlaneSlicerLayer enabled={state.showPlaneSlicer && !isHistoricalMode} referenceMode={state.planeSlicerReferenceMode} planeSlicerPaint={planeSlicerPaint} />
          {isPrimary && (
            <TellsMarkersLayer
              enabled={state.tellsBeta}
              visible={state.showTellsDetector && state.tellsMarkersVisible && !isHistoricalMode}
              style={state.tellsStyle}
              outlineColor={state.tellsOutlineColor}
              sizeByMeasuredScale={state.tellMeasureScale && state.tellsScaleMarkers}
              scaleMultiplier={state.tellsScaleMultiplier}
              latDeg={state.lat}
              colorByPaints={tellsColorByPaints}
              frozen={state.tellsFrozen}
            />
          )}
          {isPrimary && <TellsUnfilteredLoaderLayer enabled={state.tellsBeta && tellsEverActivated} />}
          {isPrimary && (
            <TellsInspectPopup
              mapRef={mapRefs.A as any}
              active={mapLoaded.A && state.tellsBeta}
            />
          )}
          <MatcapRasterLayer
            enabled={state.showLightingEffects && state.showMatcap && state.matcapRenderer === "raster" && !isHistoricalMode}
            opacity={state.lightingEffectsOpacity * state.matcapOpacity}
          />
          <PhongRasterLayer
            enabled={state.showLightingEffects && state.showPhong && state.phongRenderer === "raster" && !isHistoricalMode}
            opacity={state.lightingEffectsOpacity * state.phongOpacity}
          />
          <ShadowRasterLayer
            enabled={state.showLightingEffects && state.showShadows && !isHistoricalMode}
            opacity={state.lightingEffectsOpacity * state.shadowOpacity}
          />
          <HillshadeLayer
            showHillshade={state.showHillshade && !isHistoricalMode}
            hillshadePaint={hillshadePaint}
          />

          {/* Contours — self-contained, primary map only */}
          {isPrimary && (
            <ContoursLayer
              showContours={state.showContoursAndGraticules && state.showContours && !isHistoricalMode}
              showContourLabels={state.showContourLabels}
              sourceId={source}
              referenceMode={state.contourReferenceMode}
              lrmRadius={state.lrmRadius}
              contourMinor={state.contourReferenceMode === "lrm" ? state.contourMinorLrm : state.contourMinor}
              contourMajor={state.contourReferenceMode === "lrm" ? state.contourMajorLrm : state.contourMajor}
              contourWeight={state.contourWeight}
              contourColor={state.contourColor || undefined}
              mapboxKey={mapboxKey}
              maptilerKey={maptilerKey}
              customTerrainSources={customTerrainSources}
              titilerEndpoint={titilerEndpoint}
              mapLoaded={!!mapLoaded.A}
              theme={theme}
            />
          )}

          {/* Graticules — primary map only */}
          {isPrimary && state.showGraticules && !isHistoricalMode && (
            <GraticuleLayer
              showGraticules={state.showContoursAndGraticules && state.showGraticules && !isHistoricalMode}
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
                <NavigationControlThemed position="top-left" />
              )}
              {!activeProjectConfig?.hideMapControls?.includes("geolocate") && (
                <GeolocateControlThemed position="top-left" />
              )}

            </>
          )}
          {/* Scale bar + attribution mounted on whichever view currently
              occupies the bottom-right corner (bottomRightViewId), matching
              today's "map B when split, map A otherwise" for the 2-map
              case. Exactly one view ever satisfies this per render, by
              construction, so this always mounts exactly one ScaleControl
              across the whole grid. */}
          {!activeProjectConfig?.hideMapControls?.includes("scale") && isBottomRight && (
            <ScaleControl position="bottom-right" unit="metric" maxWidth={250} />
          )}
          {/* Mounted after ScaleControl so it's the later-added of the two —
              stacking order matters for MapLibre's own corner container. */}
          {isBottomRight && (
            <AttributionControl compact position="bottom-right" />
          )}
        </Map>
      )
    },
    [
      isHistoricalMode,
      state.lat, state.lng, state.zoom, state.pitch, state.bearing, state.viewMode, state.exaggeration,
      state.basemapSource, state.basemapPerView, state.basemapSourceA, state.basemapSourceB, state.overlayBasemapIds,
      state.showRasterBasemap, state.rasterBasemapOpacity, state.basemapSourceOpacity,
      state.showHillshade, state.hillshadeMethod, state.shadowColor, state.highlightColor, state.hillshadeExag, state.accentColor,
      state.showLightingEffects, state.lightingEffectsOpacity,
      // Same "toggle it on but nothing shows until I pan or edit a slider"
      // desync as the tellsBeta comment below — these plain raster Sources/
      // Layers only ever refreshed on a map move because none of their own
      // state was actually in this dependency list.
      state.showMatcap, state.matcapOpacity, state.matcapTextureId, state.matcapRotationDeg, state.matcapRenderer, state.matcapLightRelativeToCamera,
      state.showPhong, state.phongOpacity, state.phongDiffuseStrength, state.phongSpecularStrength, state.phongLightRelativeToCamera, state.phongRenderer,
      phongLightDir, phongLightAlt,
      state.showShadows, state.shadowOpacity, state.shadowRadiusPx, shadowLightDir, shadowLightAlt,
      state.showColorRelief, state.showTerrainAnalysis, state.showReliefVisualization, state.showSlope, state.slopeSourceMode, state.showContours, state.showContoursAndGraticules, state.showContourLabels,
      state.showAspect, state.showTri, state.showCurvature, state.curvatureMode, state.showTpi, state.showLrm, state.lrmRadius, state.showRoughness,
      state.showShapeIndex, state.showBlobness, state.showEigenRatio, state.showOrientation,
      state.showSvf, state.svfRadius, state.svfPrecision, state.showOpenness, state.opennessRadius, state.opennessMode, state.opennessPrecision,
      state.showLocalDominance, state.localDominanceMinRadius, state.localDominanceMaxRadius,
      state.showPlaneSlicer, state.planeSlicerReferenceMode, planeSlicerPaint,
      // tellsBeta/tellsEverActivated gate the tells layer+source mounts: leaving
      // them out of these deps was the "toggle it on but nothing shows until I
      // pan or edit a slider" desync — the memoized JSX simply never re-rendered.
      state.tellsStyle, state.showTellsDetector, state.tellsMarkersVisible, tellsOptions, state.tellsBeta, tellsEverActivated,
      state.tellsFrozen, tellsFrozenSnapshot,
      tellsColorByPaints, state.tellsOutlineColor, state.tellsScaleMarkers, state.tellsScaleMultiplier, state.tellMeasureScale,
      state.showBackground, state.showGraticules, state.graticuleWidth, state.minimapMinimized,
      state.graticuleDensity, state.showGraticuleLabels, state.sourceB, state.sourceC, state.sourceD, state.sourceE, state.sourceF, state.sourceG, state.sourceH, isSplit,
      state.sourceA, state.contourMinor, state.contourMajor, state.contourMinorLrm, state.contourMajorLrm, state.contourReferenceMode, state.contourWeight,
      state.contourColor, state.graticuleColor,
      perViewResolved, planetKey, state.historicalBeta,
      hillshadePaint, colorReliefPaint, slopeReliefPaint, aspectReliefPaint, triReliefPaint, curvatureReliefPaint,
      tpiReliefPaint, lrmReliefPaint, roughnessReliefPaint, shapeIndexReliefPaint, blobnessReliefPaint, eigenRatioReliefPaint, orientationReliefPaint,
      svfReliefPaint, opennessReliefPaint, localDominanceReliefPaint,
      mapboxKey, maptilerKey, customTerrainSources, customBasemapSources, titilerEndpoint,
      mapLoaded, mapRefs, handleViewMove, handleViewMoveEnd, mapPaddingFor, bottomRightViewId,
      state.skyColor, state.skyHorizonBlend, state.horizonColor, state.horizonFogBlend,
      state.fogColor, state.fogGroundBlend, state.matchThemeColors, state.backgroundLayerActive,
      activeProjectConfig,
      themeColor,
      setZoomRangeBasemap, resolvedMaxBounds
    ],
  )

  // Bottom-left corner (minimap, always map A) needs headroom for: the full
  // timeline panel, just the small collapsed-timeline toggle button sitting
  // below it, or neither (the unified 16px control margin) when historical
  // imagery isn't even active. Derived from the panel's own MEASURED height
  // (historicalTimelinePanelHeightAtom, written by a ResizeObserver in
  // historical-timeline-panel.tsx) plus a 16px gap, rather than a guessed
  // static rem value — expanded (title bar + pills) and minimal (no header
  // row) modes render at genuinely different heights, so any single
  // hardcoded constant was always wrong for one of the two, leaving either a
  // gap or an overlap. (An earlier attempt at this dynamic approach was
  // wrongly rolled back after appearing not to reach the rendered corner
  // element — that was a background-tab rAF-throttling test artifact, not a
  // real mechanism failure; the CSS-var + Tailwind wiring below does work.)
  // Two DISTINCT additions, not one: the panel itself is anchored
  // `sm:bottom-4` (MAP_CTRL_EDGE_MARGIN_PX, 16px) off the viewport's own
  // bottom edge, and a clearance consumer sitting above it additionally
  // wants its own PANEL_CLEARANCE_GAP_PX (16px) of breathing room above
  // THAT. Adding only one of the two (as this used to) puts the clearance
  // value exactly at the panel's own top edge — i.e. flush against it, zero
  // visible gap — confirmed live: the minimap sat glued to the timeline
  // panel whenever it was expanded, while the collapsed-timeline case
  // (below) correctly accounts for both its own 56px footprint AND a
  // separate 16px gap on top of that.
  const measuredPanelClearance = historicalTimelinePanelHeightPx > 0
    ? `${Math.round(historicalTimelinePanelHeightPx + MAP_CTRL_EDGE_MARGIN_PX + PANEL_CLEARANCE_GAP_PX)}px`
    : "13rem" // panel hasn't reported a real height yet (first paint) — reasonable fallback
  const minimapBottomOffset = !historicalTimelineActive
    ? `${MAP_CTRL_EDGE_MARGIN_PX}px`
    : state.historicalTimelineCollapsed
      // HistoricalTimelineToggle sits at bottom-4 (16px) with h-10 (40px) —
      // its own top edge is already 56px up from the viewport bottom, so the
      // minimap needs 56px + the same 16px gap every other clearance here
      // uses, not just 56px (which put the minimap flush against the toggle
      // button with zero gap between them).
      ? "4.5rem"
      : measuredPanelClearance
  // Bottom-right corner (attribution+scale) needs the same historical-panel
  // clearance reasoning as the minimap above, since it also docks off the
  // bottom edge.
  const scaleBottomOffset = historicalTimelineVisible ? measuredPanelClearance : `${MAP_CTRL_EDGE_MARGIN_PX}px`
  const sidebarFootprintPx = getSidebarFootprintPx(isSidebarOpen, isMobile)
  const scaleRightOffset = sidebarFootprintPx > 0 ? `${sidebarFootprintPx}px` : `${MAP_CTRL_EDGE_MARGIN_PX}px`

  const availableSplitWidth = Math.max(0, splitContainerWidth - (isSidebarOpen && !isMobile ? sidebarFootprintPx : 0))
  // Pixel x-position of the overlay drag pill/gutter, in the same coordinate
  // space as pane.left/width (0 = container's own left edge) — used both for
  // the clip-path percentage below (overlay imagery blend) and for sizing
  // each side's own border rect directly (see the border render below).
  const overlayGutterPx = availableSplitWidth * clamp(splitRatio, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX)
  // "overlay" clip-path's own coordinate space is a % of the FULL container
  // (not availableSplitWidth) — same derivation as the 2x1 side-by-side
  // boundary below, just expressed as a percentage instead of a pixel width.
  const overlayBoundaryPct = splitContainerWidth > 0 ? (overlayGutterPx / splitContainerWidth) * 100 : 0
  const grid: ViewId[][] = isSplit ? gridConfig.grid : [["A"]]
  const rows = grid.length
  const borderColorFor = (side: ViewId) => sideColorOverrides[side] ?? SIDE_COLORS[side]

  // Every pane is ALWAYS absolutely positioned relative to splitContainerRef
  // — never a flex child, never nested inside a per-row wrapper — so
  // switching between split styles/grid layouts only ever changes an
  // existing pane's inline geometry (top/left/width/height/clip-path), never
  // its position in the JSX tree. React can then reuse the very same <Map>
  // instance (and its whole WebGL context/tile cache) across a mode switch
  // instead of unmounting and remounting every pane — which is what a
  // structurally-different-per-branch tree (a dedicated overlay branch vs. a
  // grid-of-rows branch) used to force. That remount was also the root cause
  // of a real crash: right after such a remount, this component's own
  // mapLoaded[side] could still read stale `true` from the just-unmounted
  // instance for one render, while the brand new instance's ref hadn't
  // attached yet — a bare `!` non-null assertion on that ref (elsewhere in
  // this file) then threw on `null.getMap()`.
  //
  // "overlay" panes both get the full container (0/0/100%/100%) — see the
  // per-pane clip-path/blend/opacity applied to B below — regardless of
  // gridConfig, which for "overlay" is always the forced "2x1" shape from
  // effectiveGridLayout above.
  interface PaneLayout { side: ViewId; rowIdx: number; colIdx: number; isLastCol: boolean; top: number; height: number; left: number; width: number }
  const paneLayouts: PaneLayout[] = []
  // Same "fixed rows + one that absorbs the remainder" pattern as columns
  // (below) — the LAST row (the one the historical timeline panel actually
  // docks along) gets whatever height is left over after every other row
  // takes an equal share of the height genuinely available (excluding the
  // timeline's own footprint), so its own VISIBLE (non-covered) portion ends
  // up the same height as every other row, instead of the timeline eating
  // visibly into a naively-equal 50/50 split.
  const availableSplitHeight = Math.max(0, splitContainerHeight - timelineBottomPaddingPx)
  const rowHeightPx = rows > 0 ? Math.round(availableSplitHeight / rows) : 0
  let rowCursorPx = 0
  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    const row = grid[rowIdx]
    const cols = row.length
    const isLastRow = rowIdx === rows - 1
    const rowTop = rowCursorPx
    const rowHeight = isLastRow ? Math.max(0, splitContainerHeight - rowCursorPx) : rowHeightPx
    rowCursorPx += rowHeightPx
    let cursorPx = 0
    for (let colIdx = 0; colIdx < cols; colIdx++) {
      const isLastCol = colIdx === cols - 1
      let left: number, width: number
      if (isOverlaySplit) {
        left = 0
        width = splitContainerWidth
      } else {
        const colWidthPx = effectiveGridLayout === "2x1"
          ? Math.round(availableSplitWidth * clamp(splitRatio, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX))
          : Math.round(availableSplitWidth / cols)
        left = cursorPx
        width = isLastCol ? Math.max(0, splitContainerWidth - cursorPx) : colWidthPx
        cursorPx += colWidthPx
      }
      paneLayouts.push({ side: row[colIdx], rowIdx, colIdx, isLastCol, top: rowTop, height: rowHeight, left, width })
    }
  }
  // Boundary between column 0 and 1 as a % of the full container — same
  // coordinate space overlayBoundaryPct uses, needed for the 2x1 side-by-side
  // SplitPill now that it's absolutely positioned too (see below) rather
  // than just landing in a flex gap between two siblings.
  const sideBySideBoundaryPct = splitContainerWidth > 0 && paneLayouts.length > 0
    ? (paneLayouts[0].width / splitContainerWidth) * 100
    : 0

  // "Show Capture Date" pill (Compare and Blend) — rendered as a SIBLING of
  // the pane divs (not nested inside one), positioned via that pane's own
  // geometry, specifically so it's never subject to an overlay pane's own
  // clip-path/opacity/blend (a UI label, unlike the border below, has no
  // reason to fade out or get clipped along with the underlying imagery).
  // "auto" resolves here, not in the nuqs default — split/blend views get the
  // full source + date pill out of the box, the single-map view stays clean.
  const effectiveCaptureDatePill = state.showCaptureDatePill === "auto"
    ? (isSplit ? "source-date" : "off")
    : state.showCaptureDatePill
  const datePillFor = (pane: PaneLayout): React.ReactNode => {
    if (effectiveCaptureDatePill === "off") return null
    const resolved = perViewResolved[pane.side]
    if (!resolved || !resolved.basemapSource) return null
    // A non-historical basemap (Mapbox/HERE/Google Sat/OSM/plain Bing) has no
    // real per-tile capture date to show — rather than hiding the pill
    // entirely (which used to make it look like the feature just stopped
    // working the moment you switched off Historical Imagery), show it with
    // just the source name (no fabricated "Unknown" date to pad it out),
    // same as switching sources on a historical tick before any pill has
    // actually been chosen. Plain "esri" is the one exception: it's always
    // showing whichever Wayback release is currently newest, so
    // esriLiveDateMs (resolved once, above) stands in for a real per-view
    // date the same way TIMELINE_SOURCE_IDS ones already have.
    const isHistoricalDate = !!resolved.date && TIMELINE_SOURCE_IDS.has(resolved.basemapSource)
    const isEsriLive = resolved.basemapSource === "esri" && !!esriLiveDateMs
    const hasKnownDate = isHistoricalDate || isEsriLive
    const dateLabel = isHistoricalDate ? new Date(resolved.date).toISOString().slice(0, 10)
      : isEsriLive ? new Date(esriLiveDateMs).toISOString().slice(0, 10)
      : null
    const sourceShortLabel = SOURCE_CONFIG[resolved.basemapSource]?.shortLabel
      ?? BASEMAP_SHORT_LABELS[resolved.basemapSource]
      // A custom/BYOD basemap has no entry in either table — show its
      // human-facing name, not its raw id slug.
      ?? customBasemapSources.find((s) => s.id === resolved.basemapSource)?.name
      ?? resolved.basemapSource
    const label = !hasKnownDate ? sourceShortLabel
      : effectiveCaptureDatePill === "source-date" ? `${sourceShortLabel} · ${dateLabel}`
      : dateLabel
    const bottomClearance = historicalTimelineVisible ? measuredPanelClearance : "0.5rem"
    // The rightmost column's own pane DOM box intentionally extends under the
    // floating sidebar (see paneLayouts/mapPaddingFor above) so its VISIBLE
    // portion matches every other pane's — centering on the full (partly
    // hidden) pane width would drift the pill rightward under the sidebar as
    // it opens, so center on the actually-visible width instead.
    const visiblePaneWidth = (!isOverlaySplit && pane.isLastCol && isSidebarOpen && !isMobile)
      ? Math.max(0, pane.width - sidebarFootprintPx)
      : pane.width
    let positionStyle: React.CSSProperties
    if (isOverlaySplit) {
      // Center each pane's pill in ITS OWN visible half, same boundary
      // (overlayGutterPx) and same sidebar-aware right edge
      // (availableSplitWidth) the colored borders already split on — A's and
      // B's panes share the exact same full-bleed rect, so `pane.left` is
      // identical for both, which used to mean their pills always landed
      // stacked at the shared left edge (worked around with a 28px vertical
      // offset, but read as an arbitrary stack rather than "which half of
      // the screen is A vs B" the way the border split already does).
      // Deliberately plain arithmetic on the same pixel values the borders
      // use, NOT tied to the clip-path polygon itself — the clip-path lives
      // on the pane's imagery; this pill is a sibling that was never
      // subject to it and doesn't need to reason about it either.
      const centerPx = pane.side === "A" ? overlayGutterPx / 2 : (overlayGutterPx + availableSplitWidth) / 2
      positionStyle = { left: `${centerPx}px`, bottom: bottomClearance, transform: "translateX(-50%)" }
    } else if (rows === 1) {
      positionStyle = { left: `${pane.left + visiblePaneWidth / 2}px`, bottom: bottomClearance, transform: "translateX(-50%)" }
    } else if (pane.rowIdx === rows - 1) {
      // Last row: anchored to ITS OWN true bottom (clearing the timeline),
      // not the seam with the row above — now that the border/timeline
      // clamping this pill's positioning shares (paneLayouts/mapPaddingFor
      // above) is correct, the last row's own visible area has real room at
      // its bottom for this, and it reads better as a normal per-row
      // caption than crowding both rows' pills onto the same middle seam.
      positionStyle = { left: `${pane.left + visiblePaneWidth / 2}px`, bottom: bottomClearance, transform: "translateX(-50%)" }
    } else {
      // Non-last row: anchored to THIS row's own bottom edge (the seam with
      // the row below), not the shared container's — "bottom: 0.5rem" used
      // to mean 0.5rem above the whole grid's bottom edge (i.e. under the
      // timeline/last row), landing this row's pill deep inside the bottom
      // row instead of near its own seam.
      positionStyle = { left: `${pane.left + visiblePaneWidth / 2}px`, top: `${pane.top + pane.height - 8}px`, transform: "translate(-50%, -100%)" }
    }
    return (
      <div
        key={`date-${pane.side}`}
        className="absolute z-10 rounded-full bg-background/90 backdrop-blur-sm border border-border px-2 py-0.5 text-[11px] font-medium tabular-nums shadow-sm pointer-events-none"
        style={positionStyle}
      >
        {label}
      </div>
    )
  }

  if (!mapLibreReady) return null

  return (
    // `fixed` + viewport insets instead of `relative`/`w-full` with a raw
    // `100vh` height — 100vh measures the FULL window height regardless of
    // any scrollbar reservation, so in normal document flow (this div's own
    // content contributing to body's scrollable height) it's always >= the
    // true available client height the moment any scrollbar exists at all,
    // which then never lets that scrollbar go away — a self-sustaining
    // feedback loop (confirmed live: both scroll axes short by exactly the
    // scrollbar's own width, only in single-view/split-off layouts where
    // nothing else happened to be forcing a similar overflow already).
    // `fixed` removes this div from document flow entirely, so it can never
    // contribute to body's own scroll size no matter how its height is
    // computed.
    <div
      className={cn("fixed left-0 right-0 top-0 overflow-hidden", !isMobile && "bottom-0")}
      style={{
        height: isMobile ? 'calc(var(--vh, 1vh) * 100)' : undefined
      }}
    >
      <div ref={splitContainerRef} className="absolute inset-0">
        {paneLayouts.map((pane) => {
          const isBlendedOverlayPane = isOverlaySplit && pane.side === "B"
          return (
            <div
              key={pane.side}
              className={cn(
                "absolute",
                // No bottom-left targeting here anymore — the minimap is a
                // plain floating div now (see the fixed-position render
                // below), not a per-pane maplibre control corner.
                pane.side === bottomRightViewId && "[&_.maplibregl-ctrl-bottom-right]:!bottom-[var(--scale-offset)] [&_.maplibregl-ctrl-bottom-right]:!right-[var(--scale-right-offset)] [&_.maplibregl-ctrl-bottom-right]:transition-[bottom,right] [&_.maplibregl-ctrl-bottom-right]:duration-200",
              )}
              style={{
                top: pane.top,
                height: pane.height,
                left: pane.left,
                width: pane.width,
                // Only set while a side/bottom panel is actually opening or
                // closing — see panelGeometryTransition. Never during a split-
                // pill drag or a window resize, which must track 1:1.
                transition: panelGeometryTransition,
                clipPath: isBlendedOverlayPane ? `polygon(${overlayBoundaryPct}% 0%, ${overlayBoundaryPct}% 100%, 100% 100%, 100% 0%)` : undefined,
                mixBlendMode: isBlendedOverlayPane ? ((state.splitBlendModeEnabled ? state.splitBlendMode : "normal") as any) : undefined,
                opacity: isBlendedOverlayPane ? state.overlayOpacity : undefined,
                ["--scale-offset" as any]: scaleBottomOffset,
                ["--scale-right-offset" as any]: scaleRightOffset,
              }}
              // Records which view the terrain settle should treat as
              // authoritative (see lastInteractedViewRef). Capture phase, and on
              // the PANE rather than the canvas, so it registers before any
              // handler inside can stop propagation, and so a press on a pane's
              // controls counts as "this is the view I'm working in" too. In
              // overlay the top pane's clip-path also clips hit-testing, so a
              // press left of the wipe boundary correctly attributes to A and
              // one right of it to B.
              onPointerDownCapture={() => { lastInteractedViewRef.current = pane.side }}
            >
              {renderMap(stateAny[sourceFieldName(pane.side)], pane.side)}
            </div>
          )
        })}
        {/* Colored borders render as their own sibling layer, NOT nested
            inside the pane div above — that pane div is exactly the element
            mix-blend-mode gets applied to for the overlay's blended pane, and
            mix-blend-mode on a parent blends its entire rendered subtree
            (children included) as one group against whatever's behind it.
            Nesting the border there made it pick up the blend mode too
            (e.g. a colorful "difference" border), which was never the intent
            — blend modes are for comparing imagery, not for the frame
            around it. Rendered as a flat map here instead, at the same
            level as the date pills below, so borders always draw in their
            own true color regardless of the pane's blend mode. */}
        {/* isHistoricalMode-gated, not just a straight read of the persisted
            atom — colored borders are a historical-imagery-comparison
            feature (matching per-side pill colors on the timeline), same
            "terrain mode doesn't get this" policy as effectiveGridLayout
            above. Gating the RENDER rather than resetting the atom itself
            keeps the user's actual preference intact for next time they
            switch back to historical mode. */}
        {colorizeMapBorders && isHistoricalMode && isSplit && paneLayouts.map((pane) => {
          // Inset (not flush with the pane edge, unless
          // colorizeMapBordersInsetAtom is off — see insetPx below) so it
          // reads as a frame rather than colliding with maplibre's own
          // corner controls. Two adjustments beyond a plain inset:
          // - Overlay: each pane's border rect is sized to end/start
          //   exactly at the drag pill's own x position (overlayGutterPx)
          //   instead of the pane's real edge — a plain inset would trace
          //   A's FULL shared rect (both overlay panes span the whole
          //   container) while B's is already visually cropped by its own
          //   clip-path, reading as inconsistent. This sizes each side's
          //   border independently instead of clipping a single
          //   shared-rect border down to size.
          // - Side-by-side/grid: the last column/row's own pane DOM box
          //   intentionally extends past the visible area (under the
          //   floating sidebar / historical timeline panel — see the
          //   paneLayouts and mapPaddingFor comments above) so its VISIBLE
          //   portion matches every other pane's. A plain inset would then
          //   draw the border partway under the sidebar/timeline instead of
          //   right at the edge actually visible — pull the right/bottom
          //   edge in by exactly that hidden extension instead.
          // - Overlay ALSO needs that same sidebar/timeline pull-in on top
          //   of its own gutter clamp above — both of its panes are
          //   full-bleed to the container's real edges (paneLayouts gives
          //   overlay panes the full splitContainerWidth/Height regardless
          //   of column/row), so B's right edge and both panes' bottom
          //   edges extend under the sidebar/timeline exactly like
          //   side-by-side's last column/row does. Every pane in overlay is
          //   effectively "the last column of the last row" at once, so the
          //   clamp applies unconditionally rather than checking
          //   isLastCol/bottomRowViews (which only mean something for a
          //   real multi-column/row grid).
          // Every pane always draws its own FULL-width border on all 4
          // sides, inset or not — a shared seam between two adjacent panes
          // (any inner grid line, or overlay's own gutter) therefore reads
          // as visibly thicker than an outer edge, which only ever has ONE
          // pane's border: intentional, per request — the doubled seam
          // reads as "this is a real boundary between two views," not a
          // rendering glitch. insetPx/fullWidth are kept even numbers
          // specifically so this and the seam math both land on whole
          // pixels, no half-pixel blur either mode.
          const insetPx = colorizeMapBordersInset ? 3 : 0
          const fullWidth = colorizeMapBordersInset ? 2 : 4
          return (
            <div
              key={`border-${pane.side}`}
              className="absolute pointer-events-none"
              style={{ top: pane.top, left: pane.left, width: pane.width, height: pane.height, transition: panelGeometryTransition }}
            >
              <div
                className={cn("pointer-events-none absolute", colorizeMapBordersInset ? "rounded-sm" : "rounded-none")}
                style={{
                  borderColor: borderColorFor(pane.side),
                  borderStyle: "solid",
                  borderWidth: fullWidth,
                  // The right/bottom edges are pulled in by the sidebar and
                  // timeline footprints directly, so they need the same
                  // transition as the pane rect or the border would arrive at
                  // its new edge before the pane it outlines does.
                  transition: panelGeometryTransition,
                  top: insetPx,
                  left: isOverlaySplit && pane.side === "B" ? overlayGutterPx + insetPx : insetPx,
                  right: isOverlaySplit && pane.side === "A"
                    ? (splitContainerWidth - overlayGutterPx) + insetPx
                    : insetPx + (((isOverlaySplit || pane.isLastCol) && isSidebarOpen && !isMobile) ? sidebarFootprintPx : 0),
                  bottom: insetPx + ((isOverlaySplit || bottomRowViews.includes(pane.side)) ? timelineBottomPaddingPx : 0),
                }}
              />
            </div>
          )
        })}
        {paneLayouts.map(datePillFor)}
        {/* Static (non-interactive) seams between fixed columns/rows — every
            grid layout except 2x1 (which gets the draggable SplitPill
            instead, just below) and overlay (no seam at all, panes fully
            overlap). */}
        {!isOverlaySplit && effectiveGridLayout !== "2x1" && paneLayouts.filter((p) => !p.isLastCol).map((p) => (
          <div key={`vdiv-${p.side}`} className="absolute w-px bg-border" style={{ top: p.top, height: p.height, left: p.left + p.width, transition: panelGeometryTransition }} />
        ))}
        {/* Positioned from the next row's own (possibly taller, see
            availableSplitHeight above) top — NOT an even 1/rows percentage —
            so the seam lines up with the real row boundary. */}
        {!isOverlaySplit && rows > 1 && Array.from({ length: rows - 1 }, (_, i) => {
          const nextRowTop = paneLayouts.find((p) => p.rowIdx === i + 1)?.top ?? 0
          return <div key={`hdiv-${i}`} className="absolute left-0 right-0 h-px bg-border" style={{ top: nextRowTop, transition: panelGeometryTransition }} />
        })}
        {effectiveGridLayout === "2x1" && (
          isOverlaySplit ? (
            <SplitPill
              ratio={splitRatio}
              onRatioChange={setSplitRatio}
              availableWidthPx={availableSplitWidth}
              min={SPLIT_RATIO_MIN}
              max={SPLIT_RATIO_MAX}
              leftPercent={overlayBoundaryPct}
              leftTransition={panelGeometryTransition}
              opacity={state.overlayOpacity}
              onOpacityChange={(v) => setState({ overlayOpacity: v })}
            />
          ) : (
            <SplitPill
              ratio={splitRatio}
              onRatioChange={setSplitRatio}
              availableWidthPx={availableSplitWidth}
              min={SPLIT_RATIO_MIN}
              max={SPLIT_RATIO_MAX}
              leftPercent={sideBySideBoundaryPct}
              leftTransition={panelGeometryTransition}
            />
          )
        )}
      </div>
      <LightControlOverlay state={state} setState={setState} mapRef={mapRefs.A as any} />
      {/* One instance per non-A active view — overlay only ever has B, but
          grid/side-by-side can have up to G (B..H), each independently
          matched onto A. */}
      {isSplit && activeViewIds.filter((side) => side !== "A").map((side) => (
        <HistogramMatchFilter
          key={side}
          id={side}
          enabled={state.matchColorsToA}
          colorSpace={state.matchColorsColorSpace}
          referenceMapRef={mapRefs.A}
          targetMapRef={mapRefs[side]}
          referenceLoaded={!!mapLoaded.A}
          targetLoaded={!!mapLoaded[side]}
        />
      ))}
      {/* A plain floating div (not a per-map maplibre IControl) — positioned
          relative to the whole viewport via the SAME minimapBottomOffset
          already used for the old in-map-corner version, so it correctly
          clears the historical timeline panel's own height regardless of
          grid shape, instead of always sitting at view A's own bottom-left
          (the row 0/row 1 seam in a 2-row grid, nowhere near the timeline). */}
      {!activeProjectConfig?.hideMapControls?.includes("minimap") && (
        <div className="fixed z-10" style={{ bottom: minimapBottomOffset, left: `${MAP_CTRL_EDGE_MARGIN_PX}px` }}>
          <MinimapInternal
            parentMap={mapRefs.A.current?.getMap()}
            position="bottom-left"
            mode="dynamic"
            initBounds={[[-150, -30], [150, 50]]}
            zoomLevelOffset={-6}
            interactive={true}
            interactions={{
              dragPan: true,
              scrollZoom: true,
              boxZoom: true,
            }}
            width={260}
            height={180}
            showFrustum={false}
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
        </div>
      )}
      <HistoricalTimelinePanel state={state} setState={setState} mapRef={mapRefs.A as any} />
      {historicalTimelineActive && state.historicalTimelineCollapsed && (
        <HistoricalTimelineToggle onExpand={() => setState({ historicalTimelineCollapsed: false })} widthPx={state.minimapMinimized ? 40 : undefined} />
      )}
      <TerrainControlPanel
        state={state}
        setState={setState}
        getMapBounds={getMapBounds}
        mapRef={mapRefs.A as any}
      />
    </div>
  )
}