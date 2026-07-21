import { atomWithStorage } from "jotai/utils"
import { atom } from "jotai"
import type { ProjectConfig } from "./project-config"

export const mapboxKeyAtom = atomWithStorage("mapboxKey", "pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw")
export const googleKeyAtom = atomWithStorage("googleKey", "AIzaSyAo6DIOnhYdywBidl4clsPZPkQkXfq6QhI")
export const mapzenKeyAtom = atomWithStorage("mapzenKey", "mapzen-xxxxxxx")
export const maptilerKeyAtom = atomWithStorage("maptilerKey", "FbPGGTCFE8IRiPECxIrp")
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

type SkyConfig = {
  skyColor: string
  skyHorizonBlend: number
  horizonColor: string
  horizonFogBlend: number
  fogColor: string
  fogGroundBlend: number
  matchThemeColors: boolean
  backgroundLayerActive: boolean
}

export const skyConfigAtom = atom<SkyConfig>({
  skyColor: '#80ccff',
  skyHorizonBlend: 0.5,
  horizonColor: '#ccddff',
  horizonFogBlend: 0.5,
  fogColor: '#fcf0dd',
  fogGroundBlend: 0.2,
  matchThemeColors: true,
  backgroundLayerActive: true,
})

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
}

// getOnInit: true reads localStorage synchronously on first render instead of the
// jotai default (hardcoded `[]` on first paint, real value applied post-mount via
// onMount). Without it, TerrainViewer's isTerrainCustom/isBasemapCustom checks — and
// therefore effectiveMinZoom/effectiveMaxZoom — are wrong for one render whenever the
// initially-selected source is a custom one, only self-correcting once something else
// (e.g. a manual source switch) forces a fresh recompute.
export const customTerrainSourcesAtom = atomWithStorage<CustomTerrainSource[]>("customTerrainSources", [], undefined, { getOnInit: true })
export const isByodOpenAtom = atomWithStorage("isByodOpen", true)
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
}

export const customBasemapSourcesAtom = atomWithStorage<CustomBasemapSource[]>("customBasemapSources", [], undefined, { getOnInit: true })
export const isBasemapByodOpenAtom = atomWithStorage("isBasemapByodOpen", true)
export const isHillshadeXYPadOpenAtom = atomWithStorage("isHillshadeXYPadOpen", true)
// Pins Visualization Modes open through "Fold all sections" (TerrainControlPanel.tsx)
// — that's the master on/off switchboard for every viz layer, so folding it away
// along with everything else hides the controls someone's most likely to want
// still-visible right after a bulk fold. Defaults on; still individually
// collapsible via its own chevron regardless of the pin.
export const vizModePinnedAtom = atomWithStorage("vizModePinned", true)

export const transparentUiAtom = atomWithStorage("isTransparentUi", true)
export const activeSliderAtom = atom<string | null>(null)


export type RenderQuality = "quick" | "normal" | "hq"

export interface ExportResolution {
  label: string
  width: number
  height: number
}
export const EXPORT_RESOLUTIONS: ExportResolution[] = [
  { label: "Quick 360p 16:9",  width: 640,  height: 360  },
  { label: "720p 16:9",        width: 1280, height: 720  },
  { label: "1080p FHD 16:9",   width: 1920, height: 1080 },
  { label: "4K UHD 16:9",      width: 3840, height: 2160 },
  { label: "Native",           width: 0,    height: 0    },
  { label: "1080×1080 1:1",    width: 1080, height: 1080 },
  { label: "2048×2048 1:1",    width: 2048, height: 2048 },
]
type ExportResolutionLabel = (typeof EXPORT_RESOLUTIONS)[number]['label']

export const resolutionKeyAtom = atomWithStorage<ExportResolutionLabel> ('anim-resolution-key', '1080p FHD 16:9')

export const renderQualityAtom = atomWithStorage<RenderQuality>('anim-render-quality', 'normal')
export const fpsAtom = atomWithStorage('anim-fps', 60)
export const targetSizeMBAtom = atomWithStorage('anim-target-size-mb', '')
