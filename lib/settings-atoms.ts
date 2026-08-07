import { atomWithStorage } from "jotai/utils"
import { atom } from "jotai"
import type { ProjectConfig } from "./project-config"

// Timestamp (ms) of the last time each viz-mode was switched on, keyed by its
// show-flag name. Written by TerrainControlPanel's edge detector, read by the
// Section header to show a 3s "just turned on" breathing dot. Lives in an atom
// (not Section-local state) because each Options section unmounts while its
// mode is off and remounts already-on when toggled — so the false→true edge is
// invisible from inside the freshly-mounted Section itself.
export const vizActivationAtom = atom<Record<string, number>>({})

// These were hardcoded literals committed here — all moved to local, gitignored
// VITE_*_API_KEY / VITE_MAPBOX_ACCESS_TOKEN vars (see .env) instead, same pattern
// as hereKeyAtom below. There is no GH Actions injection for any of them: nothing
// in .github/ references mapbox/maptiler/google, so these had only ever lived here.
export const mapboxKeyAtom = atomWithStorage("mapboxKey", import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? "")
export const googleKeyAtom = atomWithStorage("googleKey", import.meta.env.VITE_GOOGLE_API_KEY ?? "")
const mapzenKeyAtom = atomWithStorage("mapzenKey", "mapzen-xxxxxxx")
export const maptilerKeyAtom = atomWithStorage("maptilerKey", import.meta.env.VITE_MAPTILER_API_KEY ?? "")
// Unlike mapbox/maptiler/google above, no public demo key is committed here — HERE
// requires a paid account, so its default comes from a local, gitignored VITE_HERE_API_KEY
// (see .env) instead of a hardcoded literal. Falls back to "" for anyone without that env
// var; HERE Maps satellite only appears in BUILTIN_BASEMAP_OPTIONS (raster-basemap-
// section.tsx) once a real key is set, whether from .env or pasted into Settings.
export const hereKeyAtom = atomWithStorage("hereKey", import.meta.env.VITE_HERE_API_KEY ?? "")
// Same gating pattern as hereKeyAtom — Planet's monthly mosaics require a paid
// account, so "planet" only appears as a Basemap option (raster-basemap-
// section.tsx) once a real key is set, from a local VITE_PLANET_API_KEY or
// pasted into Settings.
export const planetKeyAtom = atomWithStorage("planetKey", import.meta.env.VITE_PLANET_API_KEY ?? "")
export const titilerEndpointAtom = atomWithStorage("titilerEndpoint", "https://titiler.xyz")
export const maxResolutionAtom = atomWithStorage("maxResolution", 4096)

export const useCogProtocolVsTitilerAtom = atomWithStorage("useCogProtocolVsTitiler", true)
// DTM export mode: client-side (browser range-reads/tile-mosaic, no titiler, no
// server-side size limit) vs the original titiler-based export — see lib/client-export.ts.
// On by default (was opt-in until field use showed it's the better path).
export const useClientExportAtom = atomWithStorage("useClientExport", true)
// Not persisted (plain atom): the currently active `?project=` preset, if any — set
// once by TerrainViewer on mount from lib/projects.json, read by GeneralSettings (to
// filter the View Mode toggle via disableViewModes) and TerrainControlPanel (to hide
// source-picker sections via hideSourcePanels). null outside of a project embed.
export const activeProjectConfigAtom = atom<ProjectConfig | null>(null)
export const colorRampTypeAtom = atomWithStorage('colorRampType', 'classic')
export const licenseFilterAtom = atomWithStorage('licenseFilter', 'open-distribute' )
export const highResTerrainAtom = atomWithStorage("highResTerrain", true)
// Gates lib/tile-result-cache.ts — the LRU of finished viz-mode tile bytes that
// makes re-toggling a mode instant instead of recomputing every visible tile.
// On by default; off reclaims the memory (up to ~96MB) and reverts to recompute.
export const cacheVizTilesAtom = atomWithStorage("cacheVizTiles", true)
// Basic/Advanced toggle, one per section (Terrain Analysis / Relief
// Visualization — terrain-analysis-section.tsx / relief-visualization-section.tsx):
// in "basic" mode each sub-mode collapses to just its checkbox/title/opacity
// slider (its *Fields options block — color ramp, range sliders, etc. — stays
// hidden), matching the everything-off look. Defaults to advanced (true) so
// nothing already-visible disappears for existing users the first time this
// ships. Independent per section (not a single shared atom), so folding one
// doesn't affect the other.
export const terrainAnalysisAdvancedAtom = atomWithStorage("terrainAnalysisAdvanced", true)
export const reliefVisualizationAdvancedAtom = atomWithStorage("reliefVisualizationAdvanced", true)

// Sky/horizon/fog colors used to live here as a plain (unpersisted) atom —
// moved to URL/nuqs state instead (components/TerrainViewer.tsx's
// QUERY_STATE_PARSERS: skyColor/skyHorizonBlend/horizonColor/etc.) so they're
// shareable via URL/bookmark the same way every other viz-mode setting is,
// rather than a silent per-browser localStorage preference.

export interface CustomTerrainSource {
  id: string
  name: string
  /** For type "cog-local", this is a `local://<id>` placeholder (see
   *  lib/local-file-store.ts) rather than a real URL — the actual File only
   *  lives in-memory for the current session. */
  url: string
  type: "cog" | "cog-local" | "terrainrgb" | "terrarium" | "vrt" | 'stac' | 'mosaicjson' | 'wms-raw' | 'tilejson'
  description?: string
  /** Overrides the auto-detected (or fallback 0-20) zoom range — useful for WMS
   *  sources where COG metadata detection doesn't apply. */
  maxzoom?: number
  /** Fallback raster-dem encoding used only when a 'tilejson' source's manifest omits
   *  its own "encoding" field (most, e.g. Mapterhorn's, declare it — see
   *  useTilejsonMetadata in MapSources.tsx, which is preferred over this when present). */
  encoding?: 'terrarium' | 'mapbox'
  /** [west, south, east, north] — populated for WMS-picked layers straight from their
   *  GetCapabilities geographicBoundingBox (no extra fetch needed), so the existing
   *  per-source "fit to bounds" action works instantly instead of needing type-specific
   *  metadata detection (see handleFitToBounds in terrain-source-section.tsx). */
  bounds?: [west: number, south: number, east: number, north: number]
  /** Paired custom basemap source id — e.g. a fresco/mural's elevation COG
   *  paired with its own albedo/photo COG (see the non-geo relief-viz
   *  workflow in Non-Geo-Relief-Visualization.md). Selecting this terrain
   *  source as active auto-selects that basemap too. The link only needs to
   *  be set from ONE side (here or CustomBasemapSource.linkedTerrainId) —
   *  TerrainViewer.tsx's auto-select effects check both directions. */
  linkedBasemapId?: string
}

// getOnInit: true reads localStorage synchronously on first render instead of the
// jotai default (hardcoded `[]` on first paint, real value applied post-mount via
// onMount). Without it, TerrainViewer's isTerrainCustom/isBasemapCustom checks — and
// therefore effectiveMinZoom/effectiveMaxZoom — are wrong for one render whenever the
// initially-selected source is a custom one, only self-correcting once something else
// (e.g. a manual source switch) forces a fresh recompute.
export const customTerrainSourcesAtom = atomWithStorage<CustomTerrainSource[]>("customTerrainSources", [], undefined, { getOnInit: true })
export const isByodOpenAtom = atomWithStorage("isByodOpen", true)

export interface CustomTheme {
  /** Bare color-preset name, same role as a built-in ThemeConfig's `name` — combined
   *  with the app's own light/dark toggle by theme-provider.tsx, e.g. "my-theme-dark". */
  name: string
  /** Raw CSS text: both `[data-theme="<name>-light"]` and `[data-theme="<name>-dark"]`
   *  blocks, as produced by theme-editor's buildCss() — saved from whichever single
   *  mode was live when the user hit Save, so both variants currently render identically
   *  (a known simplification, not a full separately-tuned light/dark pair). */
  css: string
}
export const customThemesAtom = atomWithStorage<CustomTheme[]>("customThemes", [], undefined, { getOnInit: true })
export interface CustomBasemapSource {
  id: string
  name: string
  /** For type "cog-local", this is a `local://<id>` placeholder (see
   *  lib/local-file-store.ts) rather than a real URL — the actual File only
   *  lives in-memory for the current session. */
  url: string
  type: "cog" | "cog-local" | "tms" | "wms" | "wmts" | "tilejson"
  description?: string
  /** 'tms' for bottom-left-origin tile grids (rare) — see maplibre raster source `scheme`. Defaults to 'xyz'. */
  scheme?: "xyz" | "tms"
  /** Overrides the default 0-22 fallback zoom range, e.g. from a NextGIS QMS z_min/z_max. */
  minzoom?: number
  maxzoom?: number
  /** [west, south, east, north] — see the same field on CustomTerrainSource. */
  bounds?: [west: number, south: number, east: number, north: number]
  /** 'overlay' sources render stacked on top of the active basemap instead of
   *  replacing it, and are multi-selectable (see the "Overlays" checkbox list in
   *  raster-basemap-section.tsx) — only meaningful outside the simplified single-select
   *  basemap mode. Defaults to 'basemap' for sources created before this field existed. */
  role?: "basemap" | "overlay"
  /** 0-100 — lets an overlay (or a basemap) render partially see-through
   *  instead of fully opaque. Defaults to 100 for sources created before this
   *  field existed. */
  opacity?: number
  /** Mirror of CustomTerrainSource.linkedBasemapId — the terrain source this
   *  basemap auto-selects (and is auto-selected by) when either becomes
   *  active. Only needs to be set from one side of the pair. */
  linkedTerrainId?: string
}

export const customBasemapSourcesAtom = atomWithStorage<CustomBasemapSource[]>("customBasemapSources", [], undefined, { getOnInit: true })
export const isBasemapByodOpenAtom = atomWithStorage("isBasemapByodOpen", true)
export const isHillshadeXYPadOpenAtom = atomWithStorage("isHillshadeXYPadOpen", true)
// User-dragged height (px) of the Bookmarks list's scroll area (bookmarks-section.tsx's
// drag handle below it) — null means "use the default max-h-64 clamp".
export const bookmarksListHeightAtom = atomWithStorage<number | null>("bookmarksListHeight", null)
// Ids of "project" (root) bookmarks whose children are currently folded away —
// bookmarks-section.tsx's file-tree-style collapse. Absent from the array =
// expanded (matches the pre-existing always-expanded behavior for anyone
// upgrading with bookmarks already saved).
export const collapsedBookmarkGroupsAtom = atomWithStorage<string[]>("collapsedBookmarkGroups", [])
// Pins Visualization Modes open through "Fold all sections" (TerrainControlPanel.tsx)
// — that's the master on/off switchboard for every viz layer, so folding it away
// along with everything else hides the controls someone's most likely to want
// still-visible right after a bulk fold. Defaults on; still individually
// collapsible via its own chevron regardless of the pin.
export const vizModePinnedAtom = atomWithStorage("vizModePinned", true)

// Which of the two sidebar "modes" the ModePicker (opened by clicking the
// sidebar title) last chose — "terrain" is the full app as it's always been;
// "historical" swaps in a deliberately stripped-down sidebar for browsing
// historical imagery only (see TerrainControlPanel.tsx's historicalMode
// gating). The live value is nuqs state (state.appMode, shareable/bookmarkable
// via URL like viewMode) — this atom only mirrors its last value (same
// "persist across a fresh session with no URL param" role as
// historicalBetaEnabledAtom in TerrainViewer.tsx) so opening the app again
// without `?appMode=` doesn't silently reset to Terrain.
export type AppMode = "terrain" | "historical"
export const appModeAtom = atomWithStorage<AppMode>("appMode", "terrain")

export const transparentUiAtom = atomWithStorage("isTransparentUi", true)
export const activeSliderAtom = atom<string | null>(null)


type RenderQuality = "quick" | "normal" | "hq"

interface ExportResolution {
  label: string
  width: number
  height: number
}
const EXPORT_RESOLUTIONS: ExportResolution[] = [
  { label: "Quick 360p 16:9",  width: 640,  height: 360  },
  { label: "720p 16:9",        width: 1280, height: 720  },
  { label: "1080p FHD 16:9",   width: 1920, height: 1080 },
  { label: "4K UHD 16:9",      width: 3840, height: 2160 },
  { label: "Native",           width: 0,    height: 0    },
  { label: "1080×1080 1:1",    width: 1080, height: 1080 },
  { label: "2048×2048 1:1",    width: 2048, height: 2048 },
]
type ExportResolutionLabel = (typeof EXPORT_RESOLUTIONS)[number]['label']

const resolutionKeyAtom = atomWithStorage<ExportResolutionLabel> ('anim-resolution-key', '1080p FHD 16:9')

const renderQualityAtom = atomWithStorage<RenderQuality>('anim-render-quality', 'normal')
const fpsAtom = atomWithStorage('anim-fps', 60)
const targetSizeMBAtom = atomWithStorage('anim-target-size-mb', '')

// One open/closed atom per top-level Settings dialog section (settings-dialog.tsx's
// CollapsibleSection) — remembers what the user last folded, same as
// isByodOpenAtom/isHillshadeXYPadOpenAtom above do for sidebar sections. Most
// default open (true); "Appearance", "Save Project Preset", "Map bounds
// constraints" and "API Keys" default folded (false) — Appearance because it's
// rarely revisited once picked, the rest because they're setup/export actions
// you configure once, not something you look at every time the dialog opens.
export const isSettingsAppearanceOpenAtom = atomWithStorage("isSettingsAppearanceOpen", false)
export const isSettingsKeyboardShortcutsOpenAtom = atomWithStorage("isSettingsKeyboardShortcutsOpen", true)
export const isSettingsVisualizationModesOpenAtom = atomWithStorage("isSettingsVisualizationModesOpen", true)
export const isSettingsStreamingOpenAtom = atomWithStorage("isSettingsStreamingOpen", true)
export const isSettingsStoragePersistenceOpenAtom = atomWithStorage("isSettingsStoragePersistenceOpen", true)
export const isSettingsBetaOpenAtom = atomWithStorage("isSettingsBetaOpen", true)
export const isSettingsApiKeysOpenAtom = atomWithStorage("isSettingsApiKeysOpen", false)
export const isSettingsMapBoundsOpenAtom = atomWithStorage("isSettingsMapBoundsOpen", false)
export const isSettingsSaveProjectOpenAtom = atomWithStorage("isSettingsSaveProjectOpen", false)
export const isSettingsResourcesOpenAtom = atomWithStorage("isSettingsResourcesOpen", false)
export const isSettingsGeomorphometryOpenAtom = atomWithStorage("isSettingsGeomorphometryOpen", false)

// Mirrors of TerrainViewer's tellsBeta/sunShadowBeta nuqs fields (the actual
// gates the app reads) — those live in the URL so a `?tellsBeta=true` link
// still works, but with no localStorage backing they silently reset to off on
// every reload without the param. These atoms are the "last value the user
// picked in Settings" and get applied as a stateOverride on first load
// whenever the URL doesn't already specify the param (see TerrainViewer's
// embed-config effect), then kept in sync any time the nuqs field changes.
// getOnInit: true, same reasoning as customTerrainSourcesAtom above — these are
// read synchronously in TerrainViewer's first-load stateOverrides effect, which
// would otherwise see the pre-hydration default instead of the real stored value.
export const tellsBetaEnabledAtom = atomWithStorage("tellsBetaEnabled", false, undefined, { getOnInit: true })
export const sunShadowBetaEnabledAtom = atomWithStorage("sunShadowBetaEnabled", false, undefined, { getOnInit: true })
export const historicalBetaEnabledAtom = atomWithStorage("historicalBetaEnabled", false, undefined, { getOnInit: true })

// Bookmarks gallery modal: on (default) flattens every group's cards into one
// continuous grid (each card's label prefixed with its project name) so
// nothing but the real bookmark count determines how much of the last row is
// empty. Off groups children under their parent project's own grid instead,
// one grid per group — a project with e.g. 4 children (or a single-view
// project) leaves a visibly empty row/near-empty row before the next group's
// heading.
export const galleryFlattenGroupsAtom = atomWithStorage("galleryFlattenGroups", true)
