import type React from "react"
import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, GroupHeading } from "./controls-components"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  fetchSourceProvenance,
  type ProvenanceResult,
  type ProvenanceSourceKind,
} from "@/lib/source-provenance"
import { STATIC_BASEMAP_ATTRIBUTIONS, useEsriDynamicAttribution } from "@/lib/basemap-attribution"
import { useGeHistoricalDynamicAttribution } from "@/lib/ge-historical"
import { useBingDynamicAttribution } from "@/lib/bing"
import { useWaybackDynamicAttribution } from "@/lib/wayback"
import { resolveActiveHistoricalSource } from "@/lib/historical-sources"
import { SOURCE_CONFIG } from "./historical-timeline-panel"
import { BUILTIN_BASEMAP_OPTIONS } from "./raster-basemap-section"
import { GRID_LAYOUTS, viewFieldName, type GridLayoutId, type ViewId } from "@/lib/grid-layouts"
import { useAtomValue, useAtom, useSetAtom } from "jotai"
import { coverageInViewAtom, coverageGroupOfLeaf, overlapLabel, overlapStats, byOverlap, type OverlapStats } from "@/lib/coverage-in-view"
import { coverageUseRequestAtom } from "@/lib/use-coverage-use-request"
import { ExternalLink, ChevronDown, Maximize2, Info, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { coverageOverlaysAtom, coverageGroups, type EliLike } from "@/lib/coverage-overlays"
import { HistoricalCatalogTree, catalogTreeKeys } from "./historical-catalog-tree"
import { SourceMetadataDialog, useSourceInfoDialog } from "./source-metadata"
import { coverageVisibleAtom, coverageOutlineOnlyAtom, timelineFootprintsAtom, timelineFollowViewportAtom, timelineWindowFilterAtom, coverageFoldsAtom, tickPicksKeepAtom, activeExtentsAtom, activeExtentIdsAtom } from "@/lib/settings-atoms"
import { sourceFieldName } from "@/lib/grid-layouts"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { customBasemapSourcesAtom, customTerrainSourcesAtom, type CustomTerrainSource, type CustomBasemapSource } from "@/lib/settings-atoms"
import { catalogItemsAtom, catalogPickRequestAtom, catalogTick, HISTORICAL_TREE_ROOTS, searchCatalogs, COVERAGE_ONLY_ENTRIES, TIMELINE_CATALOGS, type CatalogItem, type CatalogSearchResult } from "@/lib/timeline-catalogs"
import { Input } from "@/components/ui/input"
import { Search, X, Loader2 } from "lucide-react"
import { compareWithMapterhorn, formatRes } from "@/lib/mapterhorn-compare"
import { sourceGsd, gsdText } from "@/lib/gsd"
import { terrainKindOf } from "./sample-sources-modal"
import customSources from "@/lib/custom-sources.json"

const SAMPLE_TERRAIN_BY_ID: Record<string, CustomTerrainSource> = Object.fromEntries(
  (customSources.SAMPLE_TERRAIN_SOURCES as CustomTerrainSource[]).map((s) => [s.id, s]),
)
const TERRAIN_SERVING: Record<string, string> = {
  "wms-raw": "WMS / WCS / ImageServer, raw Float32 decoded in the browser",
  terrainrgb: "XYZ tiles, Terrain-RGB", terrarium: "XYZ tiles, Terrarium", cog: "Cloud Optimized GeoTIFF",
  "cog-local": "Local COG file", vrt: "VRT via titiler", tilejson: "TileJSON", stac: "STAC", mosaicjson: "MosaicJSON",
}
const hostOf = (u: string) => u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "").replace(/^https?:\/\//, "").split(/[/?]/)[0]
const PROVIDER_SHORT: Record<string, string> = { qms: "QMS", eli: "ELI", allmaps: "Allmaps" }

/** What we know about a custom terrain source — for the shipped national
 *  datasets that is a lot more than an id: grid, DTM/DSM, how it compares to
 *  Mapterhorn, licence page, extent. A stored copy that predates a field
 *  falls back to the shipped sample definition of the same id. */
const CustomTerrainInfo: React.FC<{ source: CustomTerrainSource }> = ({ source }) => {
  const shipped = SAMPLE_TERRAIN_BY_ID[source.id]
  const merged = { ...shipped, ...source, resolutionM: source.resolutionM ?? shipped?.resolutionM, infoUrl: source.infoUrl ?? shipped?.infoUrl, bounds: source.bounds ?? shipped?.bounds, description: source.description || shipped?.description }
  const kind = terrainKindOf(merged.name)
  const cmp = compareWithMapterhorn(merged)
  const VERDICT: Record<string, string> = { new: "not in Mapterhorn", finer: "finer than Mapterhorn", bareearth: "bare-earth model where Mapterhorn has the GLO-30 surface", same: "same grid as Mapterhorn", coarser: "coarser than Mapterhorn" }
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 text-xs"><span className="text-muted-foreground shrink-0">{k}</span><span className="text-right min-w-0 break-words">{v}</span></div>
  )
  const gsd = sourceGsd(merged)
  return (
    <div className="px-2 py-1.5 rounded bg-muted/50 space-y-1">
      <div className="text-xs font-medium break-words">{merged.name}</div>
      {kind && <Row k="Model" v={`${kind.label} — ${kind.title.split(":")[1]?.trim() ?? kind.title}`} />}
      {merged.resolutionM !== undefined ? (
        <Row k="Resolution" v={cmp ? `${formatRes(cmp.ours)}${cmp.verdict === "same" ? "" : ` vs ${formatRes(cmp.theirs)}`} · ${VERDICT[cmp.verdict]}` : formatRes(merged.resolutionM)} />
      ) : gsd ? <Row k="Resolution" v={`${gsdText(gsd)}, from the max zoom`} /> : null}
      <Row k="Served as" v={TERRAIN_SERVING[merged.type] ?? merged.type} />
      {(merged.minzoom !== undefined || merged.maxzoom !== undefined) && <Row k="Zoom" v={`${merged.minzoom ?? 0} – ${merged.maxzoom ?? "native"}`} />}
      {merged.bounds && <Row k="Extent" v={merged.bounds.map((b) => b.toFixed(1)).join(", ")} />}
      <Row k="Endpoint" v={<a href={merged.url.startsWith("http") ? merged.url : `https://${merged.url.replace(/^[a-z]+:\/\/\/vsicurl\//i, "")}`} target="_blank" rel="noopener noreferrer" className="underline">{hostOf(merged.url)}</a>} />
      {merged.infoUrl && (
        <Row k="Dataset page" v={<a href={merged.infoUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">{hostOf(merged.infoUrl)} <ExternalLink className="h-3 w-3" /></a>} />
      )}
      {merged.description && <p className="text-[11px] text-muted-foreground leading-snug pt-0.5">{merged.description}</p>}
    </div>
  )
}

/** True for every basemap id whose real attribution is resolved dynamically
 *  (as opposed to a fixed string) — shared between the sidebar list below and
 *  the imperative live-push effect, so both agree on exactly which ids need
 *  it. */
function isDynamicBasemap(id: string): boolean {
  return id === "wayback" || id === "esri" || id === "ge-historical" || id === "bing"
}

function basemapLabel(id: string): string {
  return SOURCE_CONFIG[id]?.label ?? BUILTIN_BASEMAP_OPTIONS.find((o) => o.value === id)?.label ?? id
}

function sourceKindOf(sourceA: string): ProvenanceSourceKind | null {
  if (sourceA === "aws") return "aws"
  if (sourceA === "mapterhorn") return "mapterhorn"
  return null
}

/** Gate for whether Source Info applies at all to the current Terrain Source —
 *  used by TerrainControlPanel to hide the whole section rather than rendering
 *  a disabled, "not available" state for every other source. Built-in AWS /
 *  Mapterhorn have a per-tile provenance lookup; every custom source has at
 *  least its own metadata card. */
export function isProvenanceSource(sourceA: string): boolean {
  return sourceKindOf(sourceA) !== null || (sourceA !== "aws" && sourceA !== "mapterhorn" && sourceA !== "mapbox" && sourceA !== "maptiler" && sourceA !== "esri" && !!sourceA)
}

const MOVE_DEBOUNCE_MS = 400

// The basemap actually on screen, on whichever side(s) — dynamic (real per-
// location/zoom, per-date for GE Historical, per-tile-date-range for Bing)
// for Esri/Wayback/GE Historical/Bing, static for every other basemap.
// Independent of terrain-vs-historical app mode: a raster basemap can be
// active in EITHER (it's just the only thing historical mode shows), so
// this renders whenever state.showRasterBasemap is on, alongside the
// terrain-provenance block above rather than instead of it.
const BasemapAttributionList: React.FC<{ state: any; mapRef: React.RefObject<MapRef> }> = ({ state, mapRef }) => {
  const customBasemaps = useAtomValue(customBasemapSourcesAtom)
  const customBasemapById = (id: string): CustomBasemapSource | undefined => customBasemaps.find((b) => b.id === id)
  const info = useSourceInfoDialog()
  // Every active view (A-F), not just A/B — generalizes the old fixed pair
  // the same way TerrainViewer.tsx's own perViewResolved does. "overlay"
  // always compares exactly 2 views regardless of state.gridLayout's own
  // value, same policy as everywhere else this distinction matters.
  const effectiveGridLayout: GridLayoutId = state.splitStyle === "overlay" ? "2x1" : (state.gridLayout ?? "2x1")
  const activeViews: ViewId[] = state.splitStyle !== "off" ? GRID_LAYOUTS[effectiveGridLayout].grid.flat() : ["A"]

  const activeSourceFor = (side: ViewId) => resolveActiveHistoricalSource(
    state[viewFieldName(side, "basemapSource", state.basemapPerView)],
    state[viewFieldName(side, "historicalActiveSource", state.basemapPerView)],
  )
  const dateFor = (side: ViewId) => state[viewFieldName(side, "date", state.basemapPerView)]

  // Fixed eight calls (rules of hooks forbid a variable count) — cheap/
  // debounced regardless of which sides are actually active, same "call
  // unconditionally" convention the original A/B version already used.
  const esriAttribution = useEsriDynamicAttribution(state.lat, state.lng, state.zoom)
  const bingAttribution = useBingDynamicAttribution(state.lat, state.lng, state.zoom)
  const geAttributionA = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("A"))
  const geAttributionB = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("B"))
  const geAttributionC = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("C"))
  const geAttributionD = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("D"))
  const geAttributionE = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("E"))
  const geAttributionF = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("F"))
  const geAttributionG = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("G"))
  const geAttributionH = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("H"))
  const geAttributionBySide: Record<ViewId, string> = {
    A: geAttributionA, B: geAttributionB, C: geAttributionC, D: geAttributionD, E: geAttributionE, F: geAttributionF, G: geAttributionG, H: geAttributionH,
  }
  // Wayback's own real per-RELEASE attribution — distinct from esriAttribution
  // above (which is a location-only "who covers this region today" lookup,
  // still correct for the plain LIVE "esri" basemap, but wrong for a
  // Wayback tick pinned to a past date: it used to resolve to the exact
  // same "today" value regardless of which historical date was picked).
  const waybackAttributionA = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("A"))
  const waybackAttributionB = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("B"))
  const waybackAttributionC = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("C"))
  const waybackAttributionD = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("D"))
  const waybackAttributionE = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("E"))
  const waybackAttributionF = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("F"))
  const waybackAttributionG = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("G"))
  const waybackAttributionH = useWaybackDynamicAttribution(state.lat, state.lng, state.zoom, dateFor("H"))
  const waybackAttributionBySide: Record<ViewId, { srcDesc: string; niceDesc: string }> = {
    A: waybackAttributionA, B: waybackAttributionB, C: waybackAttributionC, D: waybackAttributionD,
    E: waybackAttributionE, F: waybackAttributionF, G: waybackAttributionG, H: waybackAttributionH,
  }

  const textFor = (id: string, geAttribution: string, waybackAttribution: { srcDesc: string; niceDesc: string }) =>
    // Short "Provider (Source)" label only (e.g. "Maxar (WV03_VNIR)") — the
    // fuller NICE_DESC-style sentence read as too much noise in this list.
    id === "wayback" ? waybackAttribution.srcDesc
    : id === "esri" ? esriAttribution
    : id === "ge-historical" ? geAttribution
    : id === "bing" ? bingAttribution
    : STATIC_BASEMAP_ATTRIBUTIONS[id] ?? customBasemapById(id)?.attribution ?? "—"

  const activeA = activeSourceFor("A")
  const textA = textFor(activeA, geAttributionA, waybackAttributionA)

  // Pushes view A's resolved dynamic text directly onto the LIVE maplibre
  // source object (bypassing react-map-gl's <Source> entirely — see the
  // long comment on MapSources.tsx's wayback branch for why that
  // component's own `attribution` prop can never carry a value that changes
  // post-mount), then fires a synthetic 'sourcedata' event so the corner
  // AttributionControl actually redraws with it. Confirmed against
  // maplibre-gl-js's own source (attribution_control.ts): its _updateData
  // listener only recomputes when e.sourceDataType is 'metadata' or
  // 'visibility' (or a style-level event) — firing exactly that shape is
  // Map's normal PUBLIC fire() (Evented.fire, not a private method), so this
  // needs no undocumented API at all. Every other active view (B-F) isn't
  // covered — this component only ever receives view A's own ref, and
  // TerrainViewer.tsx only ever mounts ONE AttributionControl in the whole
  // grid anyway (on whichever view sits bottom-right); the sidebar list
  // below is unaffected either way since it reads these hooks' values
  // directly rather than through this imperative push.
  useEffect(() => {
    if (!isDynamicBasemap(activeA)) return
    const map = mapRef.current?.getMap()
    const source = map?.getSource("raster-basemap-source") as { attribution?: string } | undefined
    if (!map || !source || source.attribution === textA) return
    source.attribution = textA
    // Shaped like a real MapSourceDataEvent (dataType/sourceId/isSourceLoaded
    // included, not just the one field _updateData checks) so any OTHER
    // 'sourcedata' listener that destructures more of it — this app's own
    // applyTerrain effect (TerrainViewer.tsx) already tolerates a bare event
    // fine since it ignores the argument entirely, but a future listener
    // might not — sees a shape it can actually work with instead of a
    // half-real event.
    map.fire("sourcedata", { dataType: "source", sourceId: "raster-basemap-source", sourceDataType: "metadata", isSourceLoaded: true })
  }, [mapRef, activeA, textA])

  if (!state.showRasterBasemap) return <p className="text-xs text-muted-foreground">Raster basemap off: no basemap attribution to show.</p>

  // The dynamic hooks' own return values are self-contained strings meant to
  // stand alone (e.g. the map corner, with no adjacent label) — "Esri - Vantor",
  // "Google Earth - CNES / Airbus". This table already names the source in
  // its own left-hand column, so repeating it in the value column too just
  // reads as noise; strip it here only, not from textFor's return value
  // itself (still used as-is for the corner-attribution push above).
  const stripSourcePrefix = (text: string) => text.replace(/^(Esri|Google Earth) - /, "")

  const row = (id: string, geAttribution: string, waybackAttribution: { srcDesc: string; niceDesc: string }, prefix: string) => {
    const custom = customBasemapById(id)
    // A provider prefix on the left: the index it came from (QMS, ELI,
    // Allmaps) or a library name's "FRA - IGN …" country code.
    const fullName = custom?.name ?? basemapLabel(id)
    const codeMatch = !custom?.provider ? fullName.match(/^([A-Z]{2,4}) - (.+)$/) : null
    const providerShort = custom?.provider ? PROVIDER_SHORT[custom.provider] ?? custom.provider : codeMatch ? codeMatch[1] : null
    const name = codeMatch ? codeMatch[2] : fullName
    const gsd = custom ? sourceGsd(custom, state.lat) : null
    return (
      <div key={prefix || "single"} className="px-2 py-1.5 rounded bg-muted/50 text-xs space-y-0.5">
        <div className="flex items-start gap-2">
          <span className="min-w-0 truncate" title={fullName}>{prefix}{providerShort && <span className="text-muted-foreground">{providerShort} · </span>}{name}</span>
          <span className="text-muted-foreground text-right flex-1 min-w-0 truncate">{stripSourcePrefix(textFor(id, geAttribution, waybackAttribution))}</span>
          {custom && (
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="ghost" className="h-5 w-5 shrink-0 cursor-pointer -my-0.5" onClick={() => info.open(custom.id)}><Info className="h-3.5 w-3.5" /></Button>} />
              <TooltipContent><p>Every field this source carries</p></TooltipContent>
            </Tooltip>
          )}
        </div>
        {custom && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{custom.type}{custom.role === "overlay" ? " overlay" : ""}</span>
            {gsd && <span>{gsdText(gsd)}</span>}
            {(custom.licenseName || custom.licenseUrl) && (
              custom.licenseUrl
                ? <a href={custom.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{custom.licenseName || "licence"}</a>
                : <span>{custom.licenseName}</span>
            )}
            {custom.infoUrl && <a href={custom.infoUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">page <ExternalLink className="h-3 w-3" /></a>}
          </div>
        )}
      </div>
    )
  }

  // Dedup consecutive views that resolved to the exact same basemap id AND
  // the exact same resolved attribution TEXT (e.g. a 3x1 grid where B and C
  // both happen to be on plain ESRI World Imagery) — no reason to repeat an
  // identical attribution row per letter; the surviving row's prefix lists
  // every letter it covers instead of just one. Comparing the resolved text
  // itself means two views only ever collapse into one row when they'd
  // genuinely show the same line anyway (GE Historical's attribution varies
  // by capture date).
  const grouped: { ids: ViewId[]; source: string; ge: string; wayback: { srcDesc: string; niceDesc: string }; text: string }[] = []
  for (const side of activeViews) {
    const source = activeSourceFor(side)
    const ge = geAttributionBySide[side]
    const wayback = waybackAttributionBySide[side]
    const text = textFor(source, ge, wayback)
    const last = grouped[grouped.length - 1]
    if (last && last.source === source && last.text === text) last.ids.push(side)
    else grouped.push({ ids: [side], source, ge, wayback, text })
  }
  const infoSource = info.infoId ? customBasemapById(info.infoId) ?? null : null

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Esri/Wayback, Google Earth and Bing resolve live for the current view; every other source is fixed. The info button opens every field a source carries.
      </p>
      {grouped.map((g) => row(g.source, g.ge, g.wayback, activeViews.length > 1 ? `${g.ids.join("/")}: ` : ""))}
      <SourceMetadataDialog source={infoSource} onClose={info.close} onFit={(s) => { const b = s.bounds; if (b) mapRef.current?.getMap()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 600 }) }} />
    </div>
  )
}

/** The coverage tree, always open: Terrain (Mapterhorn, 3D and LiDAR, the
 *  library, your sources), Basemaps · Static (the community indexes: the
 *  Editor Layer Index, QMS, ArcGIS Online; the library, your basemaps) and
 *  Basemaps · Historical, the timeline's catalogs tree (historical-catalog-
 *  tree.tsx, the same one the timeline's Catalogs select shows). A group
 *  checkbox takes the whole group; a master switch hides every footprint at
 *  once, the selection kept. Every group starts folded; what the user opens
 *  is kept across sessions (coverageFoldsAtom). */
const CoverageOverlayPicker: React.FC<{ mapRef: React.RefObject<MapRef>; state: any; setState?: (u: any) => void }> = ({ mapRef, state, setState }) => {
  const [selected, setSelected] = useAtom(coverageOverlaysAtom)
  const [visible, setVisible] = useAtom(coverageVisibleAtom)
  const [outlineOnly, setOutlineOnly] = useAtom(coverageOutlineOnlyAtom)
  const [footprints, setFootprints] = useAtom(timelineFootprintsAtom)
  const [follow, setFollow] = useAtom(timelineFollowViewportAtom)
  const [windowFilter, setWindowFilter] = useAtom(timelineWindowFilterAtom)
  const [folds, setFolds] = useAtom(coverageFoldsAtom)
  const [picksKeep, setPicksKeep] = useAtom(tickPicksKeepAtom)
  const [activeExtents, setActiveExtents] = useAtom(activeExtentsAtom)
  const setActiveExtentIds = useSetAtom(activeExtentIdsAtom)
  const terrains = useAtomValue(customTerrainSourcesAtom)
  const basemaps = useAtomValue(customBasemapSourcesAtom)
  const [eliInView, setEliInView] = useState<EliLike[]>([])
  // The active views' sources' declared extents: their coverage leaves,
  // selected while the switch is on (and dashed on the map), released after.
  const effectiveGridLayout: GridLayoutId = state.splitStyle === "overlay" ? "2x1" : (state.gridLayout ?? "2x1")
  const activeViews: ViewId[] = state.splitStyle !== "off" ? GRID_LAYOUTS[effectiveGridLayout].grid.flat() : ["A"]
  const activeIds = useMemo(() => {
    if (!activeExtents) return [] as string[]
    const ids = new Set<string>()
    for (const side of activeViews) {
      const t = terrains.find((x) => x.id === state[sourceFieldName(side)])
      if (t?.bounds) ids.add(`terrain:${t.id}`)
      const bid = resolveActiveHistoricalSource(state[viewFieldName(side, "basemapSource", state.basemapPerView)], state[viewFieldName(side, "historicalActiveSource", state.basemapPerView)])
      const b = basemaps.find((x) => x.id === bid)
      if (b?.bounds) ids.add(`basemap:${b.id}`)
      for (const oid of (state[side === "A" ? "overlayBasemapIds" : `overlayBasemapIds${side}`] as string[] | undefined) ?? []) {
        const o = basemaps.find((x) => x.id === oid)
        if (o?.bounds) ids.add(`basemap:${o.id}`)
      }
    }
    return [...ids].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExtents, activeViews.join(","), terrains, basemaps, state])
  const activeKey = activeIds.join(",")
  const prevActiveRef = useRef<string[]>([])
  useEffect(() => {
    const prev = prevActiveRef.current
    prevActiveRef.current = activeIds
    setActiveExtentIds(activeIds)
    const gone = prev.filter((id) => !activeIds.includes(id))
    setSelected((cur) => {
      const next = cur.filter((id) => !gone.includes(id))
      for (const id of activeIds) if (!next.includes(id)) next.push(id)
      return next.length === cur.length && next.every((id, i) => id === cur[i]) ? cur : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])
  const isOpenKey = (key: string, fallback = false) => folds[key] ?? fallback
  // ELI leaves follow the view (the package is lazy: 14 MB of index chunks
  // only load once the group is opened).
  const eliWanted = isOpenKey("cov:eli")
  useEffect(() => {
    if (!eliWanted) return
    const map = mapRef.current?.getMap()
    if (!map) return
    let cancelled = false
    import("@osm-editor-kit/maplibre-editor-layer-index").then((eli) => {
      if (cancelled) return
      const rows = eli.layersInViewport(map.getBounds(), { includeWorldwide: false })
      setEliInView(rows.slice().sort((a, b) => (a.best ? 0 : 1) - (b.best ? 0 : 1) || a.name.localeCompare(b.name)).map((r: any) => ({ ...r, infoUrl: r.attributionUrl || r.url || undefined })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [eliWanted, mapRef, state.lat, state.lng, state.zoom])
  const groups = useMemo(() => coverageGroups({ terrains, basemaps, eliInView }), [terrains, basemaps, eliInView])
  const set = new Set(selected)
  const setMany = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of ids) on ? next.add(id) : next.delete(id)
    return [...next]
  })
  const timelineCatalogs: string[] = state.timelineCatalogs ?? []
  const leavesOf = (g: (typeof groups)[number]): (typeof g.leaves) => [...g.leaves, ...groups.filter((c) => c.parent === g.key).flatMap(leavesOf)]
  const renderGroup = (g: (typeof groups)[number], depth: number) => {
    const leaves = leavesOf(g)
    const on = leaves.filter((l) => set.has(l.id)).length
    const all = on === leaves.length
    const isOpen = isOpenKey(`cov:${g.key}`)
    const mixed = g.leaves.some((l) => l.color !== g.color)
    const children = groups.filter((c) => c.parent === g.key)
    return (
      <div key={g.key} className={depth ? "pl-[21px]" : undefined}>
        <div className="flex items-center gap-1.5 py-0.5">
          <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground p-0.5 shrink-0" aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={() => setFolds((prev) => ({ ...prev, [`cov:${g.key}`]: !isOpen }))}>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
          </button>
          <Checkbox id={`cov-g-${g.key}`} checked={all && leaves.length > 0} indeterminate={!all && on > 0} disabled={leaves.length === 0} onCheckedChange={(v) => setMany(leaves.map((l) => l.id), v === true)} className="cursor-pointer" />
          {!mixed && !children.length && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: g.color }} />}
          <Label htmlFor={`cov-g-${g.key}`} className="text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer truncate flex-1" title={g.note}>{g.label}</Label>
          {leaves.length > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{on}/{leaves.length}</span>}
        </div>
        {isOpen && (
          <>
            {g.leaves.length > 0 && (
              <div className="pl-[42px] space-y-0.5">
                {g.leaves.map((l) => (
                  <div key={l.id} className="flex items-center gap-1.5">
                    <Checkbox id={`cov-${l.id}`} checked={set.has(l.id)} onCheckedChange={(v) => setMany([l.id], v === true)} className="cursor-pointer" />
                    {(mixed || children.length > 0) && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: l.color }} />}
                    <Label htmlFor={`cov-${l.id}`} className="text-xs cursor-pointer truncate shrink-0 max-w-full" title={l.label}>{l.label}</Label>
                    {l.detail && <span className="text-[10px] text-muted-foreground truncate min-w-0" title={l.detail}>{l.detail}</span>}
                    {l.bounds && (
                      <button type="button" className="cursor-pointer ml-auto shrink-0 text-muted-foreground hover:text-foreground" title="Zoom to its extent"
                        onClick={() => { const b = l.bounds!; mapRef.current?.getMap()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 600 }) }}>
                        <Maximize2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {g.leaves.length === 0 && children.length === 0 && <p className="pl-[42px] text-xs text-muted-foreground italic">None</p>}
            {children.map((c) => renderGroup(c, depth + 1))}
          </>
        )}
      </div>
    )
  }
  const terrainGroups = groups.filter((g) => g.section === "Terrain" && !g.parent)
  const staticGroups = groups.filter((g) => g.section === "Basemaps" && !g.parent && g.key !== "allmaps" && g.key !== "qms")
  // The historical root takes every catalog of the tree: the dated ones are
  // state.timelineCatalogs, the footprint-only ones (Allmaps, QMS) coverage
  // overlays; a catalog a browser cannot query (disabled) is left out.
  const historicalTicks = TIMELINE_CATALOGS.filter((c) => !c.disabled).map((c) => c.id)
  const historicalCov = COVERAGE_ONLY_ENTRIES.map((c) => c.id)
  const sectionState = (key: string): { on: number; total: number; toggle: (on: boolean) => void } => {
    if (key === "Historical") {
      const on = historicalTicks.filter((id) => timelineCatalogs.includes(id)).length + historicalCov.filter((id) => set.has(id)).length
      return { on, total: historicalTicks.length + historicalCov.length, toggle: (v) => { setState?.({ timelineCatalogs: v ? [...new Set([...timelineCatalogs, ...historicalTicks])] : timelineCatalogs.filter((id) => !historicalTicks.includes(id)) }); setMany(historicalCov, v) } }
    }
    const leaves = (key === "Terrain" ? terrainGroups : staticGroups).flatMap(leavesOf)
    return { on: leaves.filter((l) => set.has(l.id)).length, total: leaves.length, toggle: (v) => setMany(leaves.map((l) => l.id), v) }
  }
  // A section header: its fold, and a box that takes every leaf under it
  // (indeterminate while only some are on), so a whole section can be
  // switched without opening it.
  const sectionHeader = (key: string, label: string) => {
    const { on, total, toggle } = sectionState(key)
    return (
      <div className="flex w-full items-center gap-1 py-0.5">
        <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground p-0.5 shrink-0" aria-label={isOpenKey(`sec:${key}`, true) ? "Collapse" : "Expand"} onClick={() => setFolds((prev) => ({ ...prev, [`sec:${key}`]: !(prev[`sec:${key}`] ?? true) }))}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpenKey(`sec:${key}`, true) ? "" : "-rotate-90"}`} />
        </button>
        <Checkbox id={`cov-sec-${key}`} checked={total > 0 && on === total} indeterminate={on > 0 && on < total} disabled={total === 0} onCheckedChange={(v) => toggle(v === true)} className="cursor-pointer" />
        <Label htmlFor={`cov-sec-${key}`} className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 cursor-pointer flex-1">{label}</Label>
        {total > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{on}/{total}</span>}
      </div>
    )
  }
  // Expand or fold the three sections at once: the groups of Terrain and
  // Basemaps · Static, the roots and continents of the historical tree
  // (the countries stay folded: 70 archives would be a wall).
  const allKeys = [...groups.filter((g) => !g.parent).map((g) => `cov:${g.key}`), ...catalogTreeKeys(HISTORICAL_TREE_ROOTS, 1)]
  const allOpen = allKeys.every((k) => folds[k] === true)
  const foldAll = (fold: boolean) => setFolds((prev) => ({ ...prev, ...Object.fromEntries(allKeys.map((k) => [k, !fold])) }))
  // Two folds of their own: the controls (the master switch and the flags),
  // then the catalogs (the three trees); Search results below is the third.
  const partHeader = (key: string, label: string, right?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <button type="button" className="flex items-center gap-1 cursor-pointer text-xs font-medium" onClick={() => setFolds((prev) => ({ ...prev, [`sec:${key}`]: !(prev[`sec:${key}`] ?? true) }))}>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpenKey(`sec:${key}`, true) ? "" : "-rotate-90"}`} />
        {label}
      </button>
      {right}
    </div>
  )
  return (
    <div id="tour-coverage-overlays" className="space-y-1.5 scroll-mt-[100px]">
      {partHeader("controls", "Controls", (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground tabular-nums">{selected.length ? `${selected.length} shown` : "none"}</span>
          {selected.length > 0 && <button type="button" className="text-[11px] underline text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setSelected([])}>clear</button>}
          <Tooltip>
            <TooltipTrigger render={<Switch id="coverage-visible" checked={visible} onCheckedChange={setVisible} className="cursor-pointer" />} />
            <TooltipContent><p>Show or hide every coverage footprint at once, the selection kept</p></TooltipContent>
          </Tooltip>
        </div>
      ))}
      {isOpenKey("sec:controls", true) && <>
      {/* The switches that apply to every footprint and every catalog, above the tree. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={outlineOnly} onCheckedChange={setOutlineOnly} className="cursor-pointer scale-75 origin-left" />Outlines only</label>} />
          <TooltipContent><p>No fill, borders twice as bold</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={footprints} onCheckedChange={setFootprints} className="cursor-pointer scale-75 origin-left" />Items' footprints</label>} />
          <TooltipContent><p>Every item the historical catalogs found for the view, drawn as an outline in its catalog's colour</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={follow} onCheckedChange={setFollow} className="cursor-pointer scale-75 origin-left" />Follow the view</label>} />
          <TooltipContent><p>Off: the catalogs are not asked again as the map moves, so the historical items stay as they are; on again asks them for the current view</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={windowFilter} onCheckedChange={setWindowFilter} className="cursor-pointer scale-75 origin-left" />Within the timeline window</label>} />
          <TooltipContent><p>Only items dated within the timeline's current window (STAC searches pass it to the server); the catalogs are asked again when this changes</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={activeExtents} onCheckedChange={setActiveExtents} className="cursor-pointer scale-75 origin-left" />Active sources' extents</label>} />
          <TooltipContent><p>The declared extents of the sources on the views (terrain, basemap, overlays), dashed; a source row shows z≥N while the view is below the zoom it serves</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={picksKeep} onCheckedChange={setPicksKeep} className="cursor-pointer scale-75 origin-left" />Picks join my sources</label>} />
          <TooltipContent><p>On: a timeline pick is added to your basemaps as well as set on the view. Off: it only becomes the view's basemap, listed nowhere else</p></TooltipContent>
        </Tooltip>
      </div>
      </>}
      {partHeader("catalogs", "Catalogs", (
        <Tooltip>
          <TooltipTrigger render={
            <button type="button" className="cursor-pointer shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1" onClick={() => foldAll(allOpen)}>
              {allOpen ? <ChevronsDownUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}{allOpen ? "Fold all" : "Expand all"}
            </button>
          } />
          <TooltipContent><p>{allOpen ? "Fold the three sections' groups" : "Open the groups of Terrain and Basemaps · Static, and the historical tree down to the continents"}</p></TooltipContent>
        </Tooltip>
      ))}
      {isOpenKey("sec:catalogs", true) && <div className="pl-1 space-y-0.5">
      {sectionHeader("Terrain", "Terrain")}
      {isOpenKey("sec:Terrain", true) && <div className="pl-1">{terrainGroups.map((g) => renderGroup(g, 0))}</div>}
      {sectionHeader("Static", "Basemaps · Static")}
      {isOpenKey("sec:Static", true) && <div className="pl-1">{staticGroups.map((g) => renderGroup(g, 0))}</div>}
      {sectionHeader("Historical", "Basemaps · Historical")}
      {isOpenKey("sec:Historical", true) && (
        <div className="pl-1">
          <HistoricalCatalogTree compact roots={HISTORICAL_TREE_ROOTS} selected={timelineCatalogs} onChange={(ids) => setState?.({ timelineCatalogs: ids })} center={state.lng != null && state.lat != null ? [state.lng, state.lat] : undefined} />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Hover the map to list the sources covering a point; click a footprint for the dataset's page and to put it on the map.</p>
      </div>}
    </div>
  )
}

/** Everything the shown overlays and the checked catalogs hold for the
 *  view, live, as one tree: a block per group, best-matching footprint first
 *  (intersection over union with the view), the whole view or only what
 *  lies under its centre. The same rows the map's click modal gives,
 *  without clicking; one scroll for the whole list. */
/** A text search over the checked catalogs, wherever their items are (Map
 *  Warper, Wikimaps, David Rumsey through Allmaps, ArcGIS Online, QMS, the
 *  USGS quads, IGN and the national catalogs' layer names): "Cassini" finds
 *  the Cassini sheets outside the view. The field only; the hits are listed
 *  by CoverageInViewList in place of the view's rows. */
type TextSearchResult = CatalogSearchResult & { query: string }
const CatalogTextSearch: React.FC<{ state: any; result: TextSearchResult | null; onResult: (r: TextSearchResult | null) => void }> = ({ state, result, onResult }) => {
  const coverage = useAtomValue(coverageOverlaysAtom)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const ctrlRef = useRef<AbortController | null>(null)
  const ids: string[] = [...(state.timelineCatalogs ?? []), ...COVERAGE_ONLY_ENTRIES.map((e) => e.id).filter((id) => coverage.includes(id))]
  const run = () => {
    const q = text.trim()
    if (q.length < 2) return
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setBusy(true)
    searchCatalogs(ids, q, ctrl.signal)
      .then((r) => { if (!ctrl.signal.aborted) onResult({ ...r, query: q }) })
      .finally(() => { if (ctrlRef.current === ctrl) setBusy(false) })
  }
  const clear = () => { ctrlRef.current?.abort(); setBusy(false); onResult(null); setText("") }
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); run() }}>
      <div className="relative flex-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={ids.length ? `Search the ${ids.length} checked catalogs by name, anywhere` : "Check catalogs in the tree to search them"} disabled={!ids.length} className="h-7 pl-6 text-xs" />
      </div>
      <Tooltip>
        <TooltipTrigger render={<span className="cursor-help shrink-0 text-muted-foreground"><Info className="h-3.5 w-3.5" /></span>} />
        <TooltipContent className="max-w-80"><p>Searches the catalogs checked in the tree by name, outside the view too: Map Warper and Wikimaps titles, David Rumsey's catalog (the maps georeferenced in Allmaps), ArcGIS Online, NextGIS QMS, the USGS quads, IGN and the national catalogs' layers. Enter to search; the hits replace the view's rows below until cleared.</p></TooltipContent>
      </Tooltip>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" /> : result ? (
        <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground shrink-0" title="Clear the search: back to what is in view" onClick={clear}><X className="h-3.5 w-3.5" /></button>
      ) : null}
    </form>
  )
}

const CoverageInViewList: React.FC<{ mapRef: React.RefObject<MapRef>; state: any }> = ({ mapRef, state }) => {
  const inView = useAtomValue(coverageInViewAtom)
  const catalogItems = useAtomValue(catalogItemsAtom)
  const requestUse = useSetAtom(coverageUseRequestAtom)
  const requestPick = useSetAtom(catalogPickRequestAtom)
  const [centreOnly, setCentreOnly] = useState(false)
  const [folds, setFolds] = useAtom(coverageFoldsAtom)
  // A text search's hits, shown instead of the view's rows until cleared.
  const [search, setSearch] = useState<TextSearchResult | null>(null)
  const fit = (b: [number, number, number, number]) => mapRef.current?.getMap()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 600 })
  // The catalog items' overlap with the view, from their extents.
  const catalogRows = useMemo(() => {
    const m = mapRef.current?.getMap()
    if (!m || !catalogItems.length) return []
    const b = m.getBounds(), c = m.getCenter()
    const view: [number, number, number, number] = [Math.max(-180, b.getWest()), Math.max(-85, b.getSouth()), Math.min(180, b.getEast()), Math.min(85, b.getNorth())]
    const rows: { item: CatalogItem; stats: OverlapStats; gsdM: number }[] = []
    for (const item of catalogItems) {
      const [w, s, e, n] = item.bounds
      const stats = overlapStats({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, view, [c.lng, c.lat])
      if (!stats || stats.cover <= 0) continue
      rows.push({ item, stats, gsdM: item.meta?.gsd ?? Infinity })
    }
    return rows.sort(byOverlap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogItems, state.lat, state.lng, state.zoom, mapRef])
  type Row = { key: string; label: string; detail: string; url?: string; thumb?: string; stats?: OverlapStats; bounds?: [number, number, number, number]; use?: () => void; useLabel?: string; needsKey?: boolean }
  const groups: { key: string; label: string; color: string; rows: Row[] }[] = []
  const push = (g: { key: string; label: string; color: string }, r: Row) => {
    let entry = groups.find((x) => x.key === g.key)
    if (!entry) { entry = { ...g, rows: [] }; groups.push(entry) }
    entry.rows.push(r)
  }
  for (const h of search?.hits ?? []) {
    // A hit goes on the view as an overlay (a dated tick's basemap or an
    // undated map), a QMS service as the basemap.
    const cfg = SOURCE_CONFIG[h.catalog]
    const label = h.catalog === "qmsAll" ? "NextGIS QMS" : h.catalog === "cat-allmaps" ? "David Rumsey, georeferenced in Allmaps" : cfg?.label ?? h.catalog
    const overlay = h.ref ? `catalog-overlay:${h.ref}` : h.use?.startsWith("catalog-basemap:") ? h.use.replace("catalog-basemap:", "catalog-overlay:") : h.use
    push({ key: `search:${h.catalog}`, label, color: cfg?.color ?? (h.catalog === "qmsAll" ? "#0891b2" : h.catalog === "cat-allmaps" ? "#d946ef" : "#888") }, {
      key: `${h.ref ?? h.use ?? h.label}`, label: h.label, detail: h.detail, url: h.url, bounds: h.bounds, thumb: h.ref ? catalogTick(h.ref)?.meta?.thumb : undefined,
      use: overlay ? () => { requestUse({ overlay, nonce: Date.now() }); if (h.bounds) fit(h.bounds) } : undefined,
      useLabel: overlay?.startsWith("catalog-overlay:") ? "Add as an overlay on the basemap" : "Use as the view's basemap",
    })
  }
  for (const it of (search ? [] : centreOnly ? (inView?.items ?? []).filter((i) => i.stats.atCentre) : inView?.items ?? [])) {
    push(coverageGroupOfLeaf(it.leaf), { key: `${it.leaf}|${it.label}|${it.detail}`, label: it.label, detail: it.detail, url: it.url, stats: it.stats, needsKey: it.needsKey,
      use: it.overlay && it.useAs ? () => requestUse({ overlay: it.overlay!, nonce: Date.now() }) : undefined, useLabel: it.useAs ? `Use as ${it.useAs}` : undefined })
  }
  for (const { item, stats } of (search ? [] : catalogRows)) {
    if (centreOnly && !stats.atCentre) continue
    const cfg = SOURCE_CONFIG[item.source]
    push({ key: `cat:${item.source}`, label: cfg?.label ?? item.source, color: cfg?.color ?? "#888" }, {
      key: item.ref, label: item.label, detail: [item.meta?.date, item.meta?.gsd ? `${item.meta.gsd < 1 ? `${Math.round(item.meta.gsd * 100)} cm` : `${+item.meta.gsd.toFixed(1)} m`}/px` : null].filter(Boolean).join(" · "),
      url: item.meta?.url, thumb: item.meta?.thumb, stats, use: () => requestPick({ ref: item.ref, nonce: Date.now() }), useLabel: "Put on the view",
    })
  }
  // The overlay tree's order: terrain groups, then basemaps, then the catalogs.
  const ORDER = ["mapterhorn", "sources3d", "opentopo", "library", "yourTerrain", "eli", "qms", "allmaps", "yourBasemaps", "basemapLibrary"]
  groups.sort((a, b) => (ORDER.indexOf(a.key) === -1 ? 99 : ORDER.indexOf(a.key)) - (ORDER.indexOf(b.key) === -1 ? 99 : ORDER.indexOf(b.key)))
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  const open = folds["sec:results"] ?? true
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-1 cursor-pointer text-xs font-medium" onClick={() => setFolds((prev) => ({ ...prev, "sec:results": !open }))}>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
          Search results · {total} {search ? `for “${search.query}”` : centreOnly ? "in the view's centre" : "in view"}
        </button>
        {!search && (
          <div className="flex items-center gap-1.5">
            <Label htmlFor="coverage-centre-only" className="text-[11px] text-muted-foreground">Centre only</Label>
            <Switch id="coverage-centre-only" checked={centreOnly} onCheckedChange={setCentreOnly} className="cursor-pointer" />
          </div>
        )}
      </div>
      {open && <CatalogTextSearch state={state} result={search} onResult={setSearch} />}
      {open && search && (
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <p>Searched {search.searched.join(", ") || "no catalog"}{search.unsupported.length > 0 ? `; no text search in ${search.unsupported.join(", ")}` : ""}.</p>
          {search.notes.map((n, i) => <p key={i}>{n}</p>)}
          {Object.entries(search.errors).map(([k, v]) => <p key={k} className="text-destructive">{k}: {v}</p>)}
        </div>
      )}
      {open && groups.length === 0 && <p className="text-xs text-muted-foreground">{search ? "No item of that name in the checked catalogs." : `Nothing from the shown overlays or the checked catalogs ${centreOnly ? "under the centre" : "in view"}.`}</p>}
      {open && groups.length > 0 && (
        <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
          {groups.map((g) => {
            const isOpen = folds[`res:${g.key}`] ?? true
            return (
              <div key={g.key} className="space-y-0.5">
                <button type="button" className="flex w-full items-center gap-1.5 text-xs font-medium cursor-pointer" onClick={() => setFolds((prev) => ({ ...prev, [`res:${g.key}`]: !isOpen }))}>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                  <span className="flex-1 text-left truncate">{g.label}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{g.rows.length}</span>
                </button>
                {isOpen && (
                  <ul className="pl-5 space-y-1">
                    {g.rows.slice(0, 100).map((it) => (
                      <li key={it.key} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          {it.thumb ? (
                            <Tooltip>
                              <TooltipTrigger render={<div className="text-xs truncate" title={it.label}>{it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="underline">{it.label}</a> : it.label}</div>} />
                              <TooltipContent className="p-1"><img src={it.thumb} alt="" className="max-h-48 max-w-64 rounded object-contain" loading="lazy" /></TooltipContent>
                            </Tooltip>
                          ) : (
                            <div className="text-xs truncate" title={it.label}>{it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="underline">{it.label}</a> : it.label}</div>
                          )}
                          <div className="text-[10px] text-muted-foreground truncate" title={it.detail}>{[it.stats ? overlapLabel(it.stats) : null, it.detail].filter(Boolean).join(" · ")}</div>
                        </div>
                        {it.bounds && (
                          <button type="button" className="cursor-pointer shrink-0 text-muted-foreground hover:text-foreground" title="Frame its extent" onClick={() => fit(it.bounds!)}><Maximize2 className="h-3 w-3" /></button>
                        )}
                        {it.use && (
                          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] cursor-pointer shrink-0" disabled={it.needsKey}
                            title={it.needsKey ? "Needs an API key: add it from the Editor Layer Index search" : it.useLabel} onClick={it.use}>
                            Use
                          </Button>
                        )}
                      </li>
                    ))}
                    {g.rows.length > 100 && <li className="text-[10px] text-muted-foreground">+{g.rows.length - 100} more</li>}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const SourceInfoSection: React.FC<{
  state: any
  setState?: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  historicalMode?: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
}> = ({ state, setState, mapRef, historicalMode = false, isOpen, onOpenChange, withSeparator = true }) => {
  const [isActive, setIsActive] = useState(false)
  const [result, setResult] = useState<ProvenanceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A quiet hint (not a failure): shown in muted text.
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sourceKind = sourceKindOf(state.sourceA)
  const [folds, setFolds] = useAtom(coverageFoldsAtom)
  const part = (key: string, fallback = true) => folds[`sec:${key}`] ?? fallback
  const setPart = (key: string, open: boolean) => setFolds((prev) => ({ ...prev, [`sec:${key}`]: open }))
  const customTerrainSources = useAtomValue(customTerrainSourcesAtom)
  const customTerrain = customTerrainSources.find((t) => t.id === state.sourceA)

  // Drive the "show data provenance at map center" probe from the section's own
  // expand/collapse: expanding turns it on, collapsing turns it off (per
  // request). The manual switch still lets you override it while expanded — the
  // sync only fires on an actual open/close transition.
  useEffect(() => {
    setIsActive(isOpen)
    if (!isOpen) {
      setResult(null)
      setError(null)
    }
  }, [isOpen])

  const refresh = useCallback((kind: ProvenanceSourceKind) => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const { lng, lat } = map.getCenter()
    const zoom = Math.round(map.getZoom())
    const requestId = ++requestIdRef.current
    // One coverage tile at the view centre: below zoom 5 it spans a
    // continent and lists dozens of datasets that say nothing about what is
    // on screen.
    if (zoom < 5) {
      setResult(null); setLoading(false); setError(null)
      setNotice("Zoom in past level 5: at this scale the lookup tile covers a whole region and lists every dataset in it.")
      return
    }
    setNotice(null)
    setLoading(true)
    setError(null)
    fetchSourceProvenance(kind, lng, lat, zoom)
      .then((res) => {
        if (requestIdRef.current !== requestId) return
        setResult(res)
        setLoading(false)
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return
        setError(err instanceof Error ? err.message : "Lookup failed")
        setLoading(false)
      })
  }, [mapRef])

  useEffect(() => {
    if (!isActive || !sourceKind) return
    refresh(sourceKind)

    const map = mapRef.current?.getMap()
    if (!map) return
    const onMoveEnd = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => refresh(sourceKind), MOVE_DEBOUNCE_MS)
    }
    map.on("moveend", onMoveEnd)
    return () => {
      map.off("moveend", onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isActive, sourceKind, mapRef, refresh])

  const handleToggle = useCallback((checked: boolean) => {
    setIsActive(checked)
    if (!checked) {
      setResult(null)
      setError(null)
    }
  }, [])

  const subHeader = (key: string, label: string) => (
    <CollapsibleTrigger className="flex items-center gap-1 w-full py-0.5 cursor-pointer">
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${part(key) ? "" : "-rotate-90"}`} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">{label}</span>
    </CollapsibleTrigger>
  )

  return (
    <Section title="Sources Coverage" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator}>
      {/* Two parts: the coverage footprints (terrain and basemaps) with the
          search results, then the provenance of what is on screen, the
          basemap first, then the terrain (meaningless in historical mode,
          where no elevation source is shown). The section is not gated on a
          queryable source: the picker is useful whatever the terrain. */}
      <Collapsible open={part("coverage")} onOpenChange={(o) => setPart("coverage", o)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer">
          <GroupHeading>Coverage overlays</GroupHeading>
          <ChevronDown className={`h-4 w-4 transition-transform ${part("coverage") ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2">
          <CoverageOverlayPicker mapRef={mapRef} state={state} setState={setState} />
          <CoverageInViewList mapRef={mapRef} state={state} />
        </CollapsibleContent>
      </Collapsible>
      <Collapsible open={part("info")} onOpenChange={(o) => setPart("info", o)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer">
          <GroupHeading>Source info</GroupHeading>
          <ChevronDown className={`h-4 w-4 transition-transform ${part("info") ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1.5 pl-1">
          <Collapsible open={part("basemap")} onOpenChange={(o) => setPart("basemap", o)}>
            {subHeader("basemap", "Basemap")}
            <CollapsibleContent className="space-y-2">
              <BasemapAttributionList state={state} mapRef={mapRef} />
            </CollapsibleContent>
          </Collapsible>
          {!historicalMode && (
            <Collapsible open={part("terrain")} onOpenChange={(o) => setPart("terrain", o)}>
              {subHeader("terrain", "Terrain")}
              <CollapsibleContent className="space-y-2">
                {customTerrain && <CustomTerrainInfo source={customTerrain} />}
                {!sourceKind && (
                  <p className="text-xs text-muted-foreground">This terrain source publishes no per-location lookup; its page and licence are above, when it has them.</p>
                )}
                {sourceKind && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="source-info-toggle" className="text-sm font-medium">
                        Show data provenance at map center
                      </Label>
                      <Switch
                        id="source-info-toggle"
                        checked={isActive}
                        onCheckedChange={handleToggle}
                        className="cursor-pointer"
                      />
                    </div>
                    {isActive && (
                      <div className="space-y-2">
                        {loading && <p className="text-xs text-muted-foreground">Looking up…</p>}
                        {error && <p className="text-xs text-destructive">{error}</p>}
                        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

                        {result?.kind === "aws" && (
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              Tile z{result.tile.z}/{result.tile.x}/{result.tile.y} — dataset(s) mosaicked into this tile:
                            </p>
                            {result.sources.length === 0 && (
                              <p className="text-xs text-muted-foreground">No imagery-sources metadata on this tile.</p>
                            )}
                            {result.sources.map(({ name, resolutionM }) => (
                              <div key={name} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-xs">
                                <span>{name}</span>
                                {resolutionM !== null && <span className="font-mono">{resolutionM}m</span>}
                              </div>
                            ))}
                          </div>
                        )}

                        {result?.kind === "mapterhorn" && (
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              Tile z{result.tile.z}/{result.tile.x}/{result.tile.y} — dataset(s) covering this area:
                            </p>
                            {result.sources.length === 0 && (
                              <p className="text-xs text-muted-foreground">No coverage data at this tile.</p>
                            )}
                            {result.sources.map(({ code, attribution }) => (
                              <div key={code} className="px-2 py-1.5 rounded bg-muted/50 text-xs space-y-0.5">
                                <div className="font-medium">{attribution?.name ?? code}</div>
                                {attribution && (
                                  <>
                                    <div className="text-muted-foreground">{attribution.producer}</div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-muted-foreground">{attribution.license}</span>
                                      <span className="font-mono">{attribution.resolution}m</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Section>
  )
}
