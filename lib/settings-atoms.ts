import { atomWithStorage } from "jotai/utils"
import { atom } from "jotai"
import type { ProjectConfig } from "./project-config"

// Builds a PrimitiveAtom<boolean>-shaped view (same [value, SetStateAction]
// signature real atomWithStorage atoms have, so existing useAtom callers and
// PrimitiveAtom<boolean>-typed props don't need to change) onto one field of a
// coalesced atomWithStorage record, so N booleans can share a single
// localStorage key instead of one entry each. Each field's setter still reads
// the *current* record at call time, so calling several of these setters back
// to back (e.g. a "fold all sections" loop) never clobbers a sibling field.
function booleanField<T extends object, K extends keyof T>(storageAtom: ReturnType<typeof atomWithStorage<T>>, key: K) {
  return atom(
    (get) => get(storageAtom)[key] as boolean,
    (get, set, update: boolean | ((prev: boolean) => boolean)) => {
      const prev = get(storageAtom)
      const next = typeof update === "function" ? (update as (prev: boolean) => boolean)(prev[key] as unknown as boolean) : update
      set(storageAtom, { ...prev, [key]: next })
    },
  )
}

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

// Hostnames whose whole purpose is "a dedicated historical imagery viewer" —
// a first-ever visit there (no `?appMode=` in the URL, no locally-stored
// appMode preference yet for that origin) should land straight in Historical
// mode rather than the app's normal Terrain default. Matches the bare domain
// and any subdomain of it (e.g. a legacy "old.historical-satellite.iconem.com"),
// so the terrain-viewer.iconem.com deploy (and any other/unknown domain —
// a fork, localhost, a preview URL) is unaffected and just keeps today's
// Terrain default.
const HISTORICAL_HOSTNAME_RE = /(^|\.)historical-satellite\.iconem\.com$/
export function isHistoricalHostname(hostname: string): boolean {
  return HISTORICAL_HOSTNAME_RE.test(hostname)
}

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

// One open/closed FIELD per top-level Settings dialog section (settings-dialog.tsx's
// CollapsibleSection), all coalesced into a single "settingsSectionsOpen"
// localStorage key (same Record<key, boolean> shape as TerrainControlPanel's
// sectionOpenAtom) instead of one atomWithStorage entry per section — remembers
// what the user last folded, same as isByodOpenAtom/isHillshadeXYPadOpenAtom
// above do for sidebar sections. Most default open (true); "Appearance", "Save
// Project Preset", "Map bounds constraints" and "API Keys" default folded
// (false) — Appearance because it's rarely revisited once picked, the rest
// because they're setup/export actions you configure once, not something you
// look at every time the dialog opens. getOnInit: true so a returning
// visitor's folded sections (and isSettingsWhatsNewOpenAtom specifically,
// which also gates lastSeenChangelogAtAtom's "mark as seen" effect below) read
// their real stored value on first render instead of flashing this object's
// defaults for one frame.
interface SettingsSectionsOpenState {
  whatsNew: boolean
  appearance: boolean
  keyboardShortcuts: boolean
  visualizationModes: boolean
  streaming: boolean
  storagePersistence: boolean
  beta: boolean
  apiKeys: boolean
  mapBounds: boolean
  saveProject: boolean
  resources: boolean
  geomorphometry: boolean
}
const settingsSectionsOpenAtom = atomWithStorage<SettingsSectionsOpenState>("settingsSectionsOpen", {
  whatsNew: true,
  appearance: false,
  keyboardShortcuts: true,
  visualizationModes: true,
  streaming: true,
  storagePersistence: true,
  beta: true,
  apiKeys: false,
  mapBounds: false,
  saveProject: false,
  resources: false,
  geomorphometry: false,
}, undefined, { getOnInit: true })
export const isSettingsAppearanceOpenAtom = booleanField(settingsSectionsOpenAtom, "appearance")
export const isSettingsKeyboardShortcutsOpenAtom = booleanField(settingsSectionsOpenAtom, "keyboardShortcuts")
export const isSettingsVisualizationModesOpenAtom = booleanField(settingsSectionsOpenAtom, "visualizationModes")
export const isSettingsStreamingOpenAtom = booleanField(settingsSectionsOpenAtom, "streaming")
export const isSettingsStoragePersistenceOpenAtom = booleanField(settingsSectionsOpenAtom, "storagePersistence")
export const isSettingsBetaOpenAtom = booleanField(settingsSectionsOpenAtom, "beta")
export const isSettingsApiKeysOpenAtom = booleanField(settingsSectionsOpenAtom, "apiKeys")
export const isSettingsMapBoundsOpenAtom = booleanField(settingsSectionsOpenAtom, "mapBounds")
export const isSettingsSaveProjectOpenAtom = booleanField(settingsSectionsOpenAtom, "saveProject")
export const isSettingsResourcesOpenAtom = booleanField(settingsSectionsOpenAtom, "resources")
export const isSettingsGeomorphometryOpenAtom = booleanField(settingsSectionsOpenAtom, "geomorphometry")
export const isSettingsWhatsNewOpenAtom = booleanField(settingsSectionsOpenAtom, "whatsNew")

// ISO date ("YYYY-MM-DD") of the newest changelog entry's `<!-- released -->`
// marker the user has already seen — see lib/changelog.ts. A plain date, not
// the entry's (frequently-retitled) heading text, so a rename never breaks
// "have I seen this" tracking. Defaults to 2026-08-01 (rather than "never seen
// anything") so visitors with no stored value yet — including first-ever
// visitors — still see the "N new" pill for the batch of features shipped
// since then, instead of it being silently marked caught-up; bump this default
// forward whenever there's a new batch worth surfacing to everyone.
// getOnInit: true is required here, not optional: settings-dialog.tsx freezes
// this value into a `useState` snapshot on its very first render (so the
// unseen-list stays stable for the dialog's lifetime even after it marks
// things seen). Without getOnInit, that first render sees the hardcoded
// default instead of the real localStorage value — permanently freezing the
// snapshot at the default AND tripping settings-dialog.tsx's mark-as-seen
// effect, which then immediately overwrites the real stored value with
// today's latest release date. That bug was exactly reproducible by manually
// editing localStorage's lastSeenChangelogAt and reloading: the edited value
// got silently stomped back to "latest" instead of being honored.
export const lastSeenChangelogAtAtom = atomWithStorage("lastSeenChangelogAt", "2026-08-01", undefined, { getOnInit: true })

// "changes" (just what's new since last visit) vs "full" (every entry) —
// always defaults to "changes", regardless of whether there's currently
// anything unseen.
export const changelogViewAtom = atomWithStorage<"changes" | "full">("changelogView", "changes")

// Per-entry collapsed/expanded state for the What's New / full-changelog
// list, keyed by each entry's `releasedAt` (stable across retitles, unlike
// heading text) — same Record<key, boolean> shape as the main sidebar's
// sectionOpenAtom. A missing key defaults to expanded (see
// ChangelogEntryList in settings-dialog.tsx), so newly-added changelog
// entries show up open without needing an explicit default here.
export const changelogEntriesOpenAtom = atomWithStorage<Record<string, boolean>>("changelogEntriesOpen", {})

// Mirrors of TerrainViewer's tellsBeta/sunShadowBeta/historicalBeta nuqs fields
// (the actual gates the app reads) — those live in the URL so a
// `?tellsBeta=true` link still works, but with no localStorage backing they
// silently reset to off on every reload without the param. These atoms are
// the "last value the user picked in Settings" and get applied as a
// stateOverride on first load whenever the URL doesn't already specify the
// param (see TerrainViewer's embed-config effect), then kept in sync any time
// the nuqs field changes. Coalesced into a single "betaEnabled" localStorage
// key (same pattern as settingsSectionsOpenAtom above) instead of one entry
// per beta flag. getOnInit: true, same reasoning as customTerrainSourcesAtom
// above — these are read synchronously in TerrainViewer's first-load
// stateOverrides effect, which would otherwise see the pre-hydration default
// instead of the real stored value.
const betaEnabledAtom = atomWithStorage("betaEnabled", { tells: false, sunShadow: false, historical: false }, undefined, { getOnInit: true })
export const tellsBetaEnabledAtom = booleanField(betaEnabledAtom, "tells")
export const sunShadowBetaEnabledAtom = booleanField(betaEnabledAtom, "sunShadow")
export const historicalBetaEnabledAtom = booleanField(betaEnabledAtom, "historical")

// Bookmarks gallery modal: on (default) flattens every group's cards into one
// continuous grid (each card's label prefixed with its project name) so
// nothing but the real bookmark count determines how much of the last row is
// empty. Off groups children under their parent project's own grid instead,
// one grid per group — a project with e.g. 4 children (or a single-view
// project) leaves a visibly empty row/near-empty row before the next group's
// heading.
export const galleryFlattenGroupsAtom = atomWithStorage("galleryFlattenGroups", true)

// Bookmarks gallery modal: whether the read-only Featured/preset strip (see
// lib/preset-bookmarks.ts) shows as its own section at the top of the
// gallery, alongside the visitor's own saved bookmarks. On by default —
// off lets someone hide the curated examples entirely once their own list
// has grown past needing them.
export const galleryShowFeaturedAtom = atomWithStorage("galleryShowFeatured", true)
