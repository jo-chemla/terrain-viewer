import { atomWithStorage } from "jotai/utils"
import type { TerrainSourceEntry, RasterSourceEntry } from "./source-schema"
import { atom } from "jotai"
import { GLIHT_DEFAULT_BASE } from "./gliht-kmz"
import type { ViewId } from "./grid-layouts"
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
// section.tsx) once a real key is set, from a local VITE_PLANET_API_KEY (dev
// server only: vite.config.ts leaves it out of builds) or pasted into Settings.
export const planetKeyAtom = atomWithStorage("planetKey", import.meta.env.VITE_PLANET_API_KEY ?? "")
/** Planet's STAC (api.planet.com/x/data) takes an OpenID access token, not
 *  the API key: `planet auth print-access-token` (a JWT, valid about 2 h 20). */
export const planetAccessTokenAtom = atomWithStorage("planetAccessToken", "")
// Cesium ion access token. Every ion asset is 401 without one, so the
// quantized-mesh terrain entries stay hidden until this is set - the same
// gating as hereKeyAtom and planetKeyAtom above. The token is exchanged for a
// short-lived per-asset tile token by lib/quantized-mesh-protocol.ts; neither
// ever goes into a URL or a shared link.
export const cesiumIonKeyAtom = atomWithStorage("cesiumIonKey", import.meta.env.VITE_CESIUM_ION_TOKEN ?? "")
// Copernicus Data Space Sentinel Hub configuration ("instance") id. The OGC
// services at sh.dataspace.copernicus.eu/ogc/{wms,wmts}/<id> authenticate by
// this id alone, so it is a credential: entered by the visitor, kept in this
// browser only, never written into a saved or shared URL: those carry the
// {shInstance} placeholder (lib/key-placeholders.ts). A local
// VITE_SENTINEL_HUB_INSTANCE_ID seeds it on the dev server only: like the
// Planet key, vite.config.ts empties it in every build.
export const sentinelHubInstanceIdAtom = atomWithStorage("sentinelHubInstanceId", import.meta.env.VITE_SENTINEL_HUB_INSTANCE_ID ?? "")
// Extra quantized-mesh levels to fetch per tile. A mesh is adaptively
// tessellated, so matching the output tile's angular width leaves far fewer
// vertices than pixels (measured: 436 for 65536 px, which is the visible
// faceting). +1 is the first value that resolves real terrain, at 4 requests
// per tile; each further step is 4x the requests. See lib/quantized-mesh-protocol.ts.
export const cesiumDetailOffsetAtom = atomWithStorage("cesiumDetailOffset", 1)

// STAC catalogs the visitor has switched OFF in the Library's Catalogs
// section: stored as the exclusions rather than the inclusions so a preset
// added in a later release is on by default instead of silently missing.
export const disabledStacPresetsAtom = atomWithStorage<string[]>("disabledStacPresets", [])

// Catalog endpoints the visitor pasted into the STAC search. Kept so they
// survive a reload and can be listed in the Library beside the shipped ones -
// a URL typed once and lost on refresh is barely a feature.
export interface SavedStacCatalog { id: string; name: string; url: string; kind: "api" | "static"; target: "basemap" | "terrain" | "both" }
export const savedStacCatalogsAtom = atomWithStorage<SavedStacCatalog[]>("savedStacCatalogs", [])

// STAC catalogs the visitor attached to the historical timeline's Catalogs
// tree ("My catalogs" group, lib/timeline-catalogs.ts): a STAC API (one
// /search per view move) or a static catalog.json (crawled, extent-filtered),
// optionally narrowed to one collection (an API collection id, or a child
// catalog URL of a static tree). The id is self-describing (stacCatalogId:
// endpoint, kind and collection encoded in it), so a link that names it
// resolves in a browser that never saved the entry; this list is what the
// picker shows and what the label, short name and colour come from.
export interface CustomTimelineCatalog {
  id: string
  label: string
  /** Pill and caption text. */
  short: string
  endpoint: string
  kind: "api" | "static"
  collection?: string
  /** Asset keys to prefer (visual, cog, image... when absent). */
  assetKeys?: string[]
  color: string
  note?: string
}
export const customTimelineCatalogsAtom = atomWithStorage<CustomTimelineCatalog[]>("customTimelineCatalogs", [], undefined, { getOnInit: true })

// Which walkthroughs have been finished, by branch key. The level-2 tours
// (tools / byod / ndsm) are offered once EITHER level-1 branch is done -
// terrain and historical are alternatives, not a sequence, so requiring both
// would push a terrain-only visitor through the historical tour to unlock the
// drawing tools. hasSeenTourAtom stays the separate "has the intro ever
// auto-started" flag; this is about completion, not first contact.
export const tourProgressAtom = atomWithStorage<Record<string, boolean>>("tourProgress", {})

// One-shot request to open a side-panel section and scroll to it. Written by
// anything that wants to send the visitor somewhere (the map's viz-mode GoTo
// button today), consumed and cleared by TerrainControlPanel - the same
// open-then-scroll the ?scrollTo= parameter already did, reachable at runtime.
// Session-only: it is an action, not a preference.
export const revealSectionAtom = atom<string | null>(null)

// The two point-picking tools keep their picks here rather than in their own
// component state, so something outside them can seed a worked example - the
// level-2 walkthrough places real points and lets the tool compute the answer,
// instead of describing what would happen if you clicked. Session-only.
export interface PickedLngLat { lng: number; lat: number; elevation: number | null; error?: string; /** The view (A..H) the point was clicked on; absent means A. */ view?: string }
export const elevationPickerPointsAtom = atom<PickedLngLat[]>([])
export const sunShadowPicksAtom = atom<{ base: PickedLngLat | null; tip: PickedLngLat | null }>({ base: null, tip: null })
// Whether each tool is armed for picking. Lifted for the same reason as the
// picks themselves: a walkthrough step has to be able to switch the tool on.
export const elevationPickerActiveAtom = atom(false)
// The timeline's Catalogs picker switches: item footprints drawn on the
// map, and only items dated within the timeline's window.
export const timelineFootprintsAtom = atomWithStorage("timelineFootprints", false)
export const timelineWindowFilterAtom = atomWithStorage("timelineWindowFilter", false)
// Off: the catalogs are not asked again as the map moves (the ticks stay).
export const timelineFollowViewportAtom = atomWithStorage("timelineFollowViewport", true)
// Every coverage overlay hidden at once, the selection kept.
export const coverageVisibleAtom = atomWithStorage("coverageVisible", true)
// Coverage footprints as outlines only, twice as bold, no fill.
export const coverageOutlineOnlyAtom = atomWithStorage("coverageOutlineOnly", false)
/** Which groups of the Sources Coverage tree are open (the timeline's
 *  Catalogs picker shows the same tree with the same state); a group not in
 *  here is folded, only the three level-1 sections start open. */
export const coverageFoldsAtom = atomWithStorage<Record<string, boolean>>("coverageTreeOpen", {}, undefined, { getOnInit: true })
/** A timeline pick also joins the user's sources (off: the item stays a
 *  transient basemap of the view, listed nowhere else). */
export const tickPicksKeepAtom = atomWithStorage("tickPicksKeep", true)
/** Draw the active views' terrain and basemap sources' declared extents as
 *  dashed outlines (their coverage leaves, selected for you). */
export const activeExtentsAtom = atomWithStorage("coverageActiveExtents", false)
/** The overlay ids those extents are (set by the picker, read by the map). */
export const activeExtentIdsAtom = atom<string[]>([])
/** Old maps, warped (Allmaps) or tiled (a catalog's scans): drop the paper's
 *  colour (Allmaps' "remove background"), a distance threshold and an edge hardness. Auto:
 *  each map's own paper colour and threshold from its image's luminance
 *  histogram (lib/allmaps-paper.ts), `autoGain` scaling the threshold
 *  (0.5 = as detected, 0 = half, 1 = one and a half). */
export interface AllmapsRemoveColor { enabled: boolean; auto?: boolean; autoGain?: number; color: string; threshold: number; hardness: number }
export const allmapsRemoveColorAtom = atomWithStorage<AllmapsRemoveColor>("allmapsRemoveColor", { enabled: false, auto: true, autoGain: 0.5, color: "#ffffff", threshold: 0.3, hardness: 0.7 }, undefined, { getOnInit: true })

// The source lists' edit mode: off, rows show info, fit and opacity only;
// on, the batch-edit JSON button and each row's edit and delete.
export const sourcesEditModeAtom = atom(false)
/** The elevation profile docked under the map (components/ProfileDock.tsx)
 *  instead of inside the Elevation Picker section; remembered. */
export const profileDockedAtom = atomWithStorage("profileDocked", false)
/** What the picker section has to draw: the sampled line and the mast
 *  height, published for the dock; null when there is no profile. */
type ProfileSample = { lng: number; lat: number; distanceM: number; elevation: number | null }
export const profileChartAtom = atom<{ points: ProfileSample[]; poleHeightM: number; showLineOfSight?: boolean; /** The main line's view and colour, and the other views' profiles, in a split. */ label?: string; color?: string; series?: { label: string; color: string; points: ProfileSample[] }[] } | null>(null)
/** The sample under the pointer, in either chart; the section's marker follows. */
export const profileHoverIndexAtom = atom<number | null>(null)
export const sunShadowActiveAtom = atom(false)
export const sunShadowModeAtom = atom<"forward" | "reverse">("forward")

// Georeference tool (lib/georef.ts, components/TerrainControlPanel/
// GeorefSection.tsx): the loaded image and its control points. The image is
// session-only when it came from disk (an object URL), so the whole state
// stays out of storage; a URL-loaded image and its points travel in the URL
// (georefImage, georefGcps in TerrainViewer's query state).
export interface GeorefImage { url: string; width: number; height: number; name: string; fromDisk: boolean }
export const georefImageAtom = atom<GeorefImage | null>(null)
/** The view selected through its pill in a split layout (null: none). While
 *  one is selected, every per-view mode toggle collapses to that view's
 *  single button (lib/viz-views.ts, SourceGridToggle onlySide). */
export const activeViewAtom = atom<ViewId | null>(null)
export const georefActiveAtom = atom(false)
/** The saved overlay being re-georeferenced, so Save updates it instead of adding another. */
export const georefEditingIdAtom = atom<string | null>(null)
/** Object height for the reverse solve, in metres. Lifted so the walkthrough
 *  can present a complete worked example rather than a half-filled form. */
export const sunShadowHeightAtom = atom(10)
/** Requests the 360-degree orbit. AnimationSection owns animPlaying360 in its
 *  OWN useQueryStates map, which TerrainViewer's setState does not write - so
 *  the walkthrough asks through here instead of silently doing nothing. */
export const orbitRequestAtom = atom(false)
/** Bumped to ask the hypsometric section to re-derive min/max elevation from
 *  the tiles currently on screen — the same thing its "Set from viewport"
 *  button does. A nonce rather than a boolean so two requests in a row are two
 *  events, and because the section has to poll (a fresh viewport has no
 *  decoded DEM tiles yet) rather than answer immediately. */
export const hypsoAutoRangeRequestAtom = atom(0)
export const titilerEndpointAtom = atomWithStorage("titilerEndpoint", "https://titiler.xyz")
/** A Terrain Viewer tile service (tile-server/, e.g. http://localhost:3400),
 *  empty for none. When it answers, the Share dialog offers the view as a
 *  QGIS project (its /qgis.qgz with the view's parameters). */
export const tileServerUrlAtom = atomWithStorage("tileServerUrl", "")
/** Where the gliht:// protocol reads NASA G-LiHT's KMZs (lib/gliht-protocol.ts
 *  reads this key from storage itself, GLIHT_BASE_URL_KEY): by default the
 *  local tile service's proxy, http://localhost:3400/proxy/gliht; empty for
 *  glihtdata.gsfc.nasa.gov (no CORS: needs a CORS-unblocking extension); any
 *  base URL such as another tile service's `<server>/proxy/gliht`, or a CORS
 *  proxy template with `{url}`. */
export const glihtBaseUrlAtom = atomWithStorage("glihtBaseUrl", GLIHT_DEFAULT_BASE)

/** Primary viewport centre, mirrored from the URL camera state by TerrainViewer.
 *  Read by useClientDemUpstream (MapSources.tsx) so EVERY client-computed viz
 *  source — slope, matcap, phong, shadows, tells — probes real tile coverage at
 *  this location, the way the primary terrain source already did. Without it
 *  Mapterhorn's declared maxzoom 18 stood over places it only serves to z12
 *  (Syria, and anywhere else with GLO-30 only), so past z12.5 MapLibre asked
 *  the slope protocol for z13 tiles that 404, and the overlay went blank.
 *  Session-only, never persisted. */
export const viewportCenterAtom = atom<{ lat: number; lng: number; zoom: number } | null>(null)

/** "Open Add Basemap on this URL": from Add Terrain's Auto when the URL is a
 *  georeferenced map (Allmaps, IIIF), which only a basemap can take. */
export const addBasemapRequestAtom = atom<{ url: string; nonce: number } | null>(null)
/** Type the "Add Basemap" modal opens on: Auto (detect from the pasted URL),
 *  or a search or file type picked last. Persisted; edit mode ignores it. */
export const customBasemapLastTypeAtom = atomWithStorage<string>("customBasemapLastType", "auto")
/** OpenFreeMap Liberty (the "OSM" basemap): extruded 3D buildings from z14. */
export const osmBuildings3dAtom = atomWithStorage<boolean>("osmBuildings3d", false)
/** How the OSM 3D buildings are drawn (the cog beside their checkbox): a fill
 *  colour (Liberty's warm grey, white, black or one of your own), an opacity,
 *  and the footprint outlines, a line layer drawn under each building's base.
 *  MapLibre's fill-extrusion has no edges of its own, so the walls and roofs
 *  stay plain; a pale fill at a low opacity with outlines reads as a wireframe
 *  of footprints. */
export type OsmBuildingsStyle = { color: "grey" | "white" | "black" | "custom"; custom: string; opacity: number; outlines: boolean }
export const OSM_BUILDINGS_STYLE_DEFAULT: OsmBuildingsStyle = { color: "grey", custom: "#d8d2c9", opacity: 0.8, outlines: false }
export const osmBuildingsStyleAtom = atomWithStorage<OsmBuildingsStyle>("osmBuildingsStyle", OSM_BUILDINGS_STYLE_DEFAULT)
/** Last "Add Dataset" type in the terrain modal (Auto on first run). */
export const customTerrainLastTypeAtom = atomWithStorage<string>("customTerrainLastType", "auto")

/** One-shot request to zoom the historical timeline to a date window —
 *  written by Export Multi as its start/end dates change, so the timeline
 *  shows exactly the captures about to be downloaded. `nonce` makes the
 *  same window re-apply if the user has zoomed away in between. */
export const timelineWindowRequestAtom = atom<{ min: number; max: number; nonce: number } | null>(null)

/** The timeline's currently visible date window, mirrored by the panel on
 *  every change - read by Export Multi when it opens, so its start/end dates
 *  begin as whatever the user is already looking at. */
export const timelineViewWindowAtom = atom<{ min: number; max: number } | null>(null)

/** Fold state of the Terrain Analysis sub-groups, persisted. */
export const terrainAnalysisGroupsOpenAtom = atomWithStorage<Record<string, boolean>>("terrainAnalysisGroupsOpen", {})
export const maxResolutionAtom = atomWithStorage("maxResolution", 4096)
/** GeoTIFF export resolution: "screen" exports at the zoom the map is
 *  drawing (tiles already cached, seconds), "max" up to maxResolutionAtom
 *  pixels (a deeper zoom, fetched afresh). Shared by the GeoTIFF button
 *  and the Export layers dialog. */
export const exportResolutionModeAtom = atomWithStorage<"screen" | "max">("exportResolutionMode", "screen")
/** Layer export: a mode's raw values, its colour-mapped rendering, or both. */
export const exportValueFormatAtom = atomWithStorage<"raw" | "color" | "both">("exportValueFormat", "raw")
/** Layer export: file format for RGBA outputs (float32 is always GeoTIFF). */
export const exportImageFormatAtom = atomWithStorage<"tiff" | "png" | "jpeg">("exportImageFormat", "tiff")
/** Layer export: one .zip for the whole run instead of a download per file. */
export const exportZipAtom = atomWithStorage("exportZip", false)
/** What the Snapshot button does: save the image to disk, or copy it to the
 *  clipboard. Picked from the button's arrow and remembered. */
export const snapshotActionAtom = atomWithStorage<"download" | "clipboard">("snapshotAction", "download")
/** CRS the DEM, layer and snapshot exports are georeferenced in: an EPSG
 *  code as text ("3857", "4326", "2154"...) or "utm" for the zone of the
 *  export's own centre. The pixels stay on the Web Mercator grid; only the
 *  affine changes (lib/output-crs.ts). The historical batch export has its
 *  own field in its dialog. */
export const exportCrsAtom = atomWithStorage<string>("exportCrs", "3857")

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
export const licenseFilterAtom = atomWithStorage('licenseFilter', 'open-distribute' )
export const highResTerrainAtom = atomWithStorage("highResTerrain", true)
// Gates lib/tile-result-cache.ts — the LRU of finished viz-mode tile bytes that
// makes re-toggling a mode instant instead of recomputing every visible tile.
// On by default; off reclaims the memory (up to ~96MB) and reverts to recompute.
export const cacheVizTilesAtom = atomWithStorage("cacheVizTiles", true)
// Live Phong/Matcap draped by MapLibre through renderToTerrainTile (an
// experimental MapLibre API, 6.13). Off falls back to the old hand-built drape
// (lib/*-live-gl-layer-legacy.ts). Settings → Streaming. On by default.
export const nativeTerrainDrapeAtom = atomWithStorage("nativeTerrainDrape", true)
// Set when the live GPU shadow layer (lib/shadow-live-gl-layer.ts) could not
// draw on this device (shader or float texture failure): Hard Shadows then
// fall back to the shadow:// tiles for the rest of the session. Not stored.
export const shadowLiveUnsupportedAtom = atom<string | null>(null)
/** What the building shadows of one view have loaded
 *  (components/LayersAndSources/BuildingShadowLayer.tsx): the tiles in and
 *  still asked for, the buildings they hold and how many state a height, or
 *  only a number of floors (the rest cast the shadow of the default height). */
export interface BuildingShadowStats { sourceId: string; tiles: number; pending: number; buildings: number; stated: number; floors: number; error?: string }
// One record per view drawing building shadows, for the panel's line on
// heights (Lighting Effects, Buildings). Not stored.
export const buildingShadowStatsAtom = atom<Record<string, BuildingShadowStats>>({})
// Google Earth Historical tiles built from one Keyhole level finer into 512 px
// images (Settings → Streaming): no vertical stretch away from the equator and
// a 2x image for HiDPI screens, for four times the Keyhole fetches. Read by
// MapSources.tsx into the gehist:// tile URL (lib/ge-historical.ts).
export const geHiDpiTilesAtom = atomWithStorage("geHiDpiTiles", true)
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
export const lightingEffectsAdvancedAtom = atomWithStorage("lightingEffectsAdvanced", true)

// Guided product tour (components/TerrainControlPanel/product-tour.tsx).
// hasSeenTourAtom gates the one-time auto-start; isTourOpenAtom is the
// tour's own open/closed state, shared (not prop-drilled) so both the
// sidebar header button and Settings dialog's "Take the Tour" entry can
// start the same mounted <ProductTour> instance — not persisted, a reload
// mid-tour should just land back on the closed app, not resume it.
export const hasSeenTourAtom = atomWithStorage("hasSeenTour", false)
export const isTourOpenAtom = atom(false)

// Sky/horizon/fog colors used to live here as a plain (unpersisted) atom —
// moved to URL/nuqs state instead (components/TerrainViewer.tsx's
// QUERY_STATE_PARSERS: skyColor/skyHorizonBlend/horizonColor/etc.) so they're
// shareable via URL/bookmark the same way every other viz-mode setting is,
// rather than a silent per-browser localStorage preference.

// The source types are the shared schema's (lib/source-schema.ts): a saved
// source, a library entry and a built-in are one record.
export type { LibraryStacLink, LibraryBrowseEntry } from "./source-schema"
export type CustomTerrainSource = TerrainSourceEntry

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
export type CustomBasemapSource = RasterSourceEntry

export const customBasemapSourcesAtom = atomWithStorage<CustomBasemapSource[]>("customBasemapSources", [], undefined, { getOnInit: true })
export const isBasemapByodOpenAtom = atomWithStorage("isBasemapByodOpen", true)
// The Basemap and Overlays groups of the basemap BYOD list, folded or not.
export const byodBasemapsOpenAtom = atomWithStorage("byodBasemapsOpen", true)
export const byodOverlaysOpenAtom = atomWithStorage("byodOverlaysOpen", true)
export const byodVectorOverlaysOpenAtom = atomWithStorage("byodVectorOverlaysOpen", true)
/** What every vector overlay shares: footprints or 3D, and what colors them
 *  (lib/vector-sources.ts's VectorSharedStyle). */
export const vectorOverlaySharedAtom = atomWithStorage<import("./vector-sources").VectorSharedStyle>("vectorOverlayShared", { mode: "flat", colorBy: "auto" })
/** The Library's vector sources listed in the sidebar (the Vector library
 *  dialog ticks them); one switched on by a link shows too. */
export const vectorLibraryIdsAtom = atomWithStorage<string[]>("vectorLibraryIds", ["overture-buildings", "vida-open-buildings", "osm-buildings-openfreemap", "osm-liberty-lines-labels", "hwai-heritage-osm", "hwai-heritage-wikidata"], undefined, { getOnInit: true })
/** The user's own vector sources (Bring Your Own Data > Vector overlays > Add):
 *  PMTiles archives, TileJSONs, MVT templates or MapLibre styles, as
 *  VectorSourceEntry records with section "custom". */
export const customVectorSourcesAtom = atomWithStorage<import("./source-schema").VectorSourceEntry[]>("customVectorSources", [], undefined, { getOnInit: true })
/** How each vector overlay is drawn, by source id (lib/vector-sources.ts's
 *  VectorOverlayStyle: flat or 3D, color by, color, opacity, outlines). Only
 *  what the user changed; the rest comes from vectorStyleOf. */
export const vectorOverlayStylesAtom = atomWithStorage<Record<string, Partial<import("./vector-sources").VectorOverlayStyle>>>("vectorOverlayStyles", {})
export const isHillshadeXYPadOpenAtom = atomWithStorage("isHillshadeXYPadOpen", true)
// User-dragged height (px) of the Bookmarks list's scroll area (bookmarks-section.tsx's
// drag handle below it) — null means "use the default max-h-64 clamp".
export const bookmarksListHeightAtom = atomWithStorage<number | null>("bookmarksListHeight", null)
// Ids of "project" (root) bookmarks whose children are currently folded away —
// bookmarks-section.tsx's file-tree-style collapse. Absent from the array =
// expanded (matches the pre-existing always-expanded behavior for anyone
// upgrading with bookmarks already saved).
export const collapsedBookmarkGroupsAtom = atomWithStorage<string[]>("collapsedBookmarkGroups", [])
// Sidebar bookmarks list presentation — "list" (default: the original tree of
// project rows with children indented beneath) or "grid" (flattened thumbnail
// tiles, a compact in-panel cousin of the gallery modal's cards). Same
// list/gallery icon-toggle idea as RiverREM_UI's runsView selector, which this
// whole Bookmarks UI is modeled on.
export const bookmarksViewModeAtom = atomWithStorage<"list" | "grid">("bookmarksViewMode", "list")
/** Whether the Bookmarks section's Featured and Your Bookmarks folds are
 *  open. Both open on a first visit; a fold the user closes stays closed. */
export const bookmarksFoldsOpenAtom = atomWithStorage<{ featured: boolean; own: boolean }>("bookmarksFoldsOpen", { featured: true, own: true })
// Gallery MODAL presentation — "grid" (default: the original thumbnail cards)
// or "list" (compact rows: small thumbnail left, project + view name right).
// Deliberately its own atom rather than sharing bookmarksViewModeAtom above:
// the sidebar and the fullscreen modal are different reading contexts (a
// narrow always-on panel vs. a wide overlay), so one's preferred density
// shouldn't drag the other's along with it.
export const bookmarksGalleryViewModeAtom = atomWithStorage<"grid" | "list">("bookmarksGalleryViewMode", "grid")
// Pins Visualization Modes open through "Fold all sections" (TerrainControlPanel.tsx)
// — that's the master on/off switchboard for every viz layer, so folding it away
// along with everything else hides the controls someone's most likely to want
// still-visible right after a bulk fold. Defaults on; still individually
// collapsible via its own chevron regardless of the pin.
export const vizModePinnedAtom = atomWithStorage("vizModePinned", true)

// The Data layers picker's open state. An atom rather than local state because
// the trigger and the dialog live in different components: the button sits in
// the Visualization Modes section header, next to the pin it belongs beside,
// while the dialog stays mounted at the panel root. Not persisted - a modal
// that reopens itself on reload is a bug, not a setting.
export const dataLayersModalOpenAtom = atom(false)

// Which of the two sidebar "modes" the ModePicker (opened by clicking the
// sidebar title) last chose — "terrain" is the full app as it's always been;
// "historical" swaps in a deliberately stripped-down sidebar for browsing
// historical imagery only (see TerrainControlPanel.tsx's historicalMode
// gating). The live value is nuqs state (state.appMode, shareable/bookmarkable
// via URL like viewMode) — this atom only mirrors its last value (same
// "persist across a fresh session with no URL param" role as
// tellsBetaEnabledAtom in TerrainViewer.tsx) so opening the app again
// without `?appMode=` doesn't silently reset to Terrain.
export type AppMode = "terrain" | "historical" | "rem"
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

// The same idea for the River REM mode: a host whose name starts with
// "river-rem." (river-rem.iconem.com, wherever it is pointed) opens in that
// mode when the link names none. Only the app's default: the link preview
// of such a host is whatever page it serves (see scripts/mode-pages.mjs).
export function isRemHostname(hostname: string): boolean {
  return /^river-rem./.test(hostname)
}

// Real deploys of this app (as opposed to local dev, a fork, or a preview
// URL) — used by the favicon swap (index.html's inline script AND the
// appMode-reactive effect in TerrainViewer.tsx) to pick the blue/purple
// color half of the icon, independently of isHistoricalHostname's own
// mountain-vs-clock SHAPE decision above.
export function isProdHostname(hostname: string): boolean {
  return hostname === "terrain-viewer.iconem.com" || hostname === "jo-chemla.github.io" || isHistoricalHostname(hostname) || hostname === "river-rem.iconem.com"
}

export const transparentUiAtom = atomWithStorage("isTransparentUi", true)
// Download and Snapshot's own "Export settings" fold (see download-section.tsx).
export const isExportSettingsOpenAtom = atomWithStorage("isExportSettingsOpen", false)
// Snapshot / Copy / Share: keep the historical timeline in the picture, or
// (default) crop the strip it covers off the bottom - see captureMapScreenshot.
// getOnInit: read through getDefaultStore() there, possibly before any
// component has mounted the atom.
export const snapshotIncludeTimelineAtom = atomWithStorage("snapshotIncludeTimeline", false, undefined, { getOnInit: true })
// The two "Library" modals (SampleSourcesModal) - session state, shared so
// the ?openLibrary= parameter and the product tour can open them from
// outside the sections that own the buttons.
export const terrainLibraryOpenAtom = atom(false)
/** The terrain "Add dataset" dialog (BYOD), lifted out of the Terrain
 *  section so `?openDialog=addTerrain` can open it on arrival. */
export const addTerrainSourceOpenAtom = atom(false)
export const basemapLibraryOpenAtom = atom(false)
/** The Vector tab of the same Library dialog (vector-library-panel.tsx);
 *  `?openLibrary=vector` and the Vector overlays list open it. */
export const vectorLibraryOpenAtom = atom(false)
/** The filter typed into either Library dialog. One for both, so the
 *  Terrain / Basemap tabs switch libraries with the same search. */
export const libraryQueryAtom = atom("")
/** The box both libraries portal their content into (LibraryDialogHost in
 *  sample-sources-modal.tsx), null while the dialog is closed. */
export const libraryDialogHostAtom = atom<HTMLElement | null>(null)
/** Which libraries' lists are mounted (their section rendered), so a tab
 *  switch keeps the current list on screen until the other one is there. */
export const libraryMountedAtom = atom<{ terrain: boolean; basemap: boolean }>({ terrain: false, basemap: false })

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
  desktopTileService: boolean
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
  desktopTileService: true,
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
// Desktop app only (Settings > Desktop: local tile service).
export const isSettingsDesktopTileServiceOpenAtom = booleanField(settingsSectionsOpenAtom, "desktopTileService")
/** Its Quick start list, a sub-section folded on its own; open by default.
 *  A key of its own rather than a field of settingsSectionsOpen: a record
 *  stored before the field existed would read it as folded. */
export const isSettingsDesktopQuickstartOpenAtom = atomWithStorage("settingsDesktopQuickstartOpen", true, undefined, { getOnInit: true })

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

// The beta gates. Since 2026-10-07 these are the only home of the flags:
// TerrainViewer merges them into `state` (state.tellsBeta…) and routes a
// setState({ tellsBeta }) here, no URL field (a link does not switch them,
// the Home button does not clear them). Earlier mirrors of nuqs fields
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
const betaEnabledAtom = atomWithStorage("betaEnabled", { tells: false, georef: false }, undefined, { getOnInit: true })
export const tellsBetaEnabledAtom = booleanField(betaEnabledAtom, "tells")
// The historical imagery sources left beta on 2026-10-08 (always on; a stored
// `historical` key from before is ignored).
/** STAC catalog search in the Add Dataset / Add Basemap modals (no URL param: local only). */
export const georefBetaEnabledAtom = booleanField(betaEnabledAtom, "georef")

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

/** Each derived mode's color-relief expression by layer id, published by
 *  TerrainViewer whether or not the mode is on, so the export can colour a
 *  mode whose layer is not on the map. */
export const modeColorRampsAtom = atom<Record<string, unknown>>({})
