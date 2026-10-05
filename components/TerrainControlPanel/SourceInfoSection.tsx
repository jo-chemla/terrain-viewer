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
import { coverageInViewAtom, coverageGroupOfLeaf, overlapLabel } from "@/lib/coverage-in-view"
import { coverageUseRequestAtom } from "@/lib/use-coverage-use-request"
import { ExternalLink, ChevronDown, X, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { coverageOverlaysAtom, coverageGroups, type EliLike } from "@/lib/coverage-overlays"
import { customBasemapSourcesAtom, customTerrainSourcesAtom, type CustomTerrainSource, type CustomBasemapSource } from "@/lib/settings-atoms"
import { compareWithMapterhorn, formatRes } from "@/lib/mapterhorn-compare"
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
  return (
    <div className="px-2 py-1.5 rounded bg-muted/50 space-y-1">
      <div className="text-xs font-medium break-words">{merged.name}</div>
      {kind && <Row k="Model" v={`${kind.label} — ${kind.title.split(":")[1]?.trim() ?? kind.title}`} />}
      {merged.resolutionM !== undefined && (
        <Row k="Resolution" v={cmp ? `${formatRes(cmp.ours)}${cmp.verdict === "same" ? "" : ` vs ${formatRes(cmp.theirs)}`} · ${VERDICT[cmp.verdict]}` : formatRes(merged.resolutionM)} />
      )}
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

  if (!state.showRasterBasemap) return null

  // The dynamic hooks' own return values are self-contained strings meant to
  // stand alone (e.g. the map corner, with no adjacent label) — "Esri - Vantor",
  // "Google Earth - CNES / Airbus". This table already names the source in
  // its own left-hand column, so repeating it in the value column too just
  // reads as noise; strip it here only, not from textFor's return value
  // itself (still used as-is for the corner-attribution push above).
  const stripSourcePrefix = (text: string) => text.replace(/^(Esri|Google Earth) - /, "")

  const row = (id: string, geAttribution: string, waybackAttribution: { srcDesc: string; niceDesc: string }, prefix: string) => {
    const custom = customBasemapById(id)
    return (
      <div key={prefix || "single"} className="px-2 py-1.5 rounded bg-muted/50 text-xs space-y-0.5">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0">{prefix}{custom?.name ?? basemapLabel(id)}</span>
          <span className="text-muted-foreground text-right">{stripSourcePrefix(textFor(id, geAttribution, waybackAttribution))}</span>
        </div>
        {custom && (custom.provider || custom.licenseName || custom.licenseUrl || custom.infoUrl) && (
          // Catalog provenance for sources added through NextGIS QMS or the
          // OSM Editor Layer Index: where it came from, and under what licence.
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {custom.provider && <span>via {custom.provider === "qms" ? "NextGIS QMS" : "OSM Editor Layer Index"}</span>}
            {(custom.licenseName || custom.licenseUrl) && (
              custom.licenseUrl
                ? <a href={custom.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{custom.licenseName || "licence"}</a>
                : <span>{custom.licenseName}</span>
            )}
            {custom.infoUrl && <a href={custom.infoUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">record <ExternalLink className="h-3 w-3" /></a>}
            {!custom.provider && <span>{TERRAIN_SERVING[custom.type] ?? custom.type}</span>}
          </div>
        )}
      </div>
    )
  }

  // Dedup consecutive views that resolved to the exact same basemap id AND
  // the exact same resolved attribution TEXT (e.g. a 3x1 grid where B and C
  // both happen to be on plain ESRI World Imagery) — no reason to repeat an
  // identical attribution row per letter; the surviving row's prefix lists
  // every letter it covers instead of just one. Matching on id alone used to
  // merge e.g. two GE Historical views into ONE row keyed off only the
  // FIRST one's ge/text value — silently dropping the other's, even though
  // GE Historical's real attribution (Airbus vs. Maxar, etc.) varies by
  // capture DATE, i.e. by which specific tile/layer that view is actually
  // showing, not just by which source it's on. Comparing the resolved text
  // itself means two views only ever collapse into one row when they'd
  // genuinely show the same line anyway.
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

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Basemap attribution — Esri/Wayback, Google Earth, and Bing resolve live for the current view; every other source is fixed.
      </p>
      {grouped.map((g) => row(g.source, g.ge, g.wayback, activeViews.length > 1 ? `${g.ids.join("/")}: ` : ""))}
    </div>
  )
}

/** Tree of coverage footprints to draw on the map (see
 *  lib/coverage-overlays.ts): Mapterhorn's coverage tiles, the whole terrain
 *  and basemap libraries, the Editor Layer Index layers covering the view,
 *  and loaded custom sources. A group checkbox takes the whole group;
 *  expanding it (collapsed by default) refines to a handful of leaves.
 *  Selected leaves show as pills, one pill per fully selected group. */
const CoverageOverlayPicker: React.FC<{ mapRef: React.RefObject<MapRef> }> = ({ mapRef }) => {
  const [selected, setSelected] = useAtom(coverageOverlaysAtom)
  const terrains = useAtomValue(customTerrainSourcesAtom)
  const basemaps = useAtomValue(customBasemapSourcesAtom)
  const [eliInView, setEliInView] = useState<EliLike[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState(false)
  // ELI leaves follow the view at the moment the picker opens (the package is
  // lazy: 14 MB of index chunks only load once someone asks for it).
  useEffect(() => {
    if (!open) return
    const map = mapRef.current?.getMap()
    if (!map) return
    let cancelled = false
    import("@osm-editor-kit/maplibre-editor-layer-index").then((eli) => {
      if (cancelled) return
      const rows = eli.layersInViewport(map.getBounds(), { includeWorldwide: false })
      setEliInView(rows.slice().sort((a, b) => (a.best ? 0 : 1) - (b.best ? 0 : 1) || a.name.localeCompare(b.name)).map((r: any) => ({ ...r, infoUrl: r.attributionUrl || r.url || undefined })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [open, mapRef])
  const groups = useMemo(() => coverageGroups({ terrains, basemaps, eliInView }), [terrains, basemaps, eliInView])
  const set = new Set(selected)
  const setMany = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of ids) on ? next.add(id) : next.delete(id)
    return [...next]
  })
  const pills: { key: string; label: string; color: string; ids: string[] }[] = []
  for (const g of groups) {
    const on = g.leaves.filter((l) => set.has(l.id))
    if (!on.length) continue
    if (on.length === g.leaves.length && g.leaves.length > 1) pills.push({ key: g.key, label: `${g.label} (${on.length})`, color: g.color, ids: on.map((l) => l.id) })
    else for (const l of on) pills.push({ key: l.id, label: l.label, color: l.color, ids: [l.id] })
  }
  // Leaves selected earlier that no longer have a leaf (ELI view changed) stay
  // selected and drawn; they only lose their pill label.
  return (
    <div id="tour-coverage-overlays" className="space-y-1.5 scroll-mt-[100px]">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Coverage overlays</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={
            <Button variant="outline" size="sm" className="cursor-pointer font-normal h-7">
              {selected.length ? `${selected.length} shown` : "None"} <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          } />
          <PopoverContent align="end" className="w-80 p-2 max-h-96 overflow-y-auto space-y-1">
            {(() => {
              // Groups nest one level (`parent`): the OpenTopography group
              // sits inside 3D and LiDAR coverage. A parent's checkbox and
              // count take in its children's leaves.
              const leavesOf = (g: (typeof groups)[number]): (typeof g.leaves) => [...g.leaves, ...groups.filter((c) => c.parent === g.key).flatMap(leavesOf)]
              const top = groups.filter((g) => !g.parent)
              const renderGroup = (g: (typeof groups)[number], gi: number, depth: number) => {
                const leaves = leavesOf(g)
                const on = leaves.filter((l) => set.has(l.id)).length
                const all = on === leaves.length
                const isOpen = expanded[g.key] ?? false
                const newSection = depth === 0 && (gi === 0 || top[gi - 1].section !== g.section)
                const mixed = g.leaves.some((l) => l.color !== g.color)
                const children = groups.filter((c) => c.parent === g.key)
                return (
                  <div key={g.key} className={depth ? "pl-[21px]" : undefined}>
                    {newSection && (
                      <div className={`text-[10px] uppercase tracking-wide text-muted-foreground px-0.5 ${gi === 0 ? "pb-0.5" : "pt-2 pb-0.5 border-t mt-1"}`}>{g.section}</div>
                    )}
                    <div className="flex items-center gap-1.5 py-0.5">
                      <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground p-0.5 shrink-0" aria-label={isOpen ? "Collapse" : "Expand"}
                        onClick={() => setExpanded((prev) => ({ ...prev, [g.key]: !isOpen }))}>
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      </button>
                      <Checkbox id={`cov-g-${g.key}`} checked={all && leaves.length > 0} indeterminate={!all && on > 0} disabled={leaves.length === 0} onCheckedChange={(v) => setMany(leaves.map((l) => l.id), v === true)} className="cursor-pointer" />
                      {/* One swatch for the group when its leaves share a
                          colour; otherwise each leaf carries its own below
                          (3D and LiDAR: one colour per provider). */}
                      {!mixed && !children.length && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: g.color }} />}
                      <Label htmlFor={`cov-g-${g.key}`} className="text-xs font-medium cursor-pointer truncate flex-1" title={g.note}>{g.label}</Label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{on}/{leaves.length}</span>
                    </div>
                    {isOpen && (
                      <>
                        <div className="pl-[42px] space-y-0.5 max-h-48 overflow-y-auto">
                          {leaves.length === 0 && <p className="text-xs text-muted-foreground italic">None</p>}
                          {g.leaves.map((l) => (
                            <div key={l.id} className="flex items-center gap-1.5">
                              <Checkbox id={`cov-${l.id}`} checked={set.has(l.id)} onCheckedChange={(v) => setMany([l.id], v === true)} className="cursor-pointer" />
                              {(mixed || children.length > 0) && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: l.color }} />}
                              {/* The label wins the width fight: `detail` used to be
                                  shrink-0, so a long one (the Esri leaf's) pushed the
                                  layer's own NAME down to zero width and the row read
                                  as subtitle-only. */}
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
                        {children.map((c) => renderGroup(c, 0, depth + 1))}
                      </>
                    )}
                  </div>
                )
              }
              return top.map((g, gi) => renderGroup(g, gi, 0))
            })()}
          </PopoverContent>
        </Popover>
      </div>
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pills.slice(0, 16).map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] max-w-full" style={{ borderColor: p.color }}>
              <span className="truncate max-w-[180px]" title={p.label}>{p.label}</span>
              <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setMany(p.ids, false)} aria-label={`Hide ${p.label}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
          {pills.length > 16 && <span className="text-[11px] text-muted-foreground self-center">+{pills.length - 16} more</span>}
          <button type="button" className="text-[11px] underline text-muted-foreground hover:text-foreground cursor-pointer self-center" onClick={() => setSelected([])}>clear</button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Hover the map to list the sources covering a point; click a footprint for the dataset's page and to put it on the map.</p>
    </div>
  )
}

/** Everything the drawn coverage overlays hold for the view, live: one block
 *  per overlay group, best-matching footprint first (intersection over union
 *  with the view), the whole view or only what lies under its centre. The
 *  same rows the map's click modal gives, without clicking. */
const CoverageInViewList: React.FC = () => {
  const inView = useAtomValue(coverageInViewAtom)
  const requestUse = useSetAtom(coverageUseRequestAtom)
  const [centreOnly, setCentreOnly] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  if (!inView) return null
  const items = centreOnly ? inView.items.filter((i) => i.stats.atCentre) : inView.items
  const groups: { key: string; label: string; color: string; items: typeof items }[] = []
  for (const it of items) {
    const g = coverageGroupOfLeaf(it.leaf)
    let entry = groups.find((x) => x.key === g.key)
    if (!entry) { entry = { ...g, items: [] }; groups.push(entry) }
    entry.items.push(it)
  }
  // The overlay tree's order: terrain groups, then basemaps.
  const ORDER = ["mapterhorn", "library", "yourTerrain", "sources3d", "opentopo", "eli", "qms", "allmaps", "yourBasemaps", "basemapLibrary"]
  groups.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="coverage-centre-only" className="text-xs font-medium">
          {items.length} in {centreOnly ? "the view's centre" : "view"}
        </Label>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="coverage-centre-only" className="text-[11px] text-muted-foreground">Centre only</Label>
          <Switch id="coverage-centre-only" checked={centreOnly} onCheckedChange={setCentreOnly} className="cursor-pointer" />
        </div>
      </div>
      {groups.length === 0 && <p className="text-xs text-muted-foreground">Nothing from the shown overlays {centreOnly ? "under the centre" : "in view"}.</p>}
      {groups.map((g) => {
        const isOpen = openGroups[g.key] ?? true
        return (
          <div key={g.key} className="space-y-0.5">
            <button type="button" className="flex w-full items-center gap-1.5 text-xs font-medium cursor-pointer" onClick={() => setOpenGroups((prev) => ({ ...prev, [g.key]: !isOpen }))}>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: g.color }} />
              <span className="flex-1 text-left truncate">{g.label}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{g.items.length}</span>
            </button>
            {isOpen && (
              <ul className="pl-5 space-y-1 max-h-56 overflow-y-auto">
                {g.items.slice(0, 100).map((it, i) => (
                  <li key={`${it.label}-${i}`} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate" title={it.label}>{it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="underline">{it.label}</a> : it.label}</div>
                      <div className="text-[10px] text-muted-foreground truncate" title={it.detail}>{overlapLabel(it.stats)} · {it.detail}</div>
                    </div>
                    {it.overlay && it.useAs && (
                      <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] cursor-pointer shrink-0" disabled={it.needsKey}
                        title={it.needsKey ? "Needs an API key: add it from the Editor Layer Index search" : `Use as ${it.useAs}`}
                        onClick={() => requestUse({ overlay: it.overlay!, nonce: Date.now() })}>
                        Use
                      </Button>
                    )}
                  </li>
                ))}
                {g.items.length > 100 && <li className="text-[10px] text-muted-foreground">+{g.items.length - 100} more</li>}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

export const SourceInfoSection: React.FC<{
  state: any
  mapRef: React.RefObject<MapRef>
  historicalMode?: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
}> = ({ state, mapRef, historicalMode = false, isOpen, onOpenChange, withSeparator = true }) => {
  const [isActive, setIsActive] = useState(false)
  const [result, setResult] = useState<ProvenanceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A quiet hint (not a failure): shown in muted text.
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sourceKind = sourceKindOf(state.sourceA)
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

  return (
    <Section title="Sources Coverage" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator}>
      {/* Two parts: the coverage footprints (terrain and basemaps), then the
          provenance of what is on screen. Terrain provenance is meaningless
          in historical mode (no elevation source is shown there) — but a
          raster basemap can be active in EITHER app mode, so
          BasemapAttributionList below always renders alongside this, not
          instead of it. The section is not gated on a queryable source: the
          picker is useful whatever the terrain. */}
      <GroupHeading>Coverage overlays</GroupHeading>
      <CoverageOverlayPicker mapRef={mapRef} />
      <CoverageInViewList />
      <GroupHeading>Source info</GroupHeading>
      {!historicalMode && customTerrain && <CustomTerrainInfo source={customTerrain} />}
      {!historicalMode && !sourceKind && (
        <p className="text-xs text-muted-foreground">This terrain source publishes no per-location lookup; its page and licence are above, when it has them.</p>
      )}
      {!historicalMode && sourceKind && (
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

      {isActive && sourceKind && (
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
      {state.showRasterBasemap
        ? <BasemapAttributionList state={state} mapRef={mapRef} />
        : <p className="text-xs text-muted-foreground">Raster basemap off: no basemap attribution to show.</p>}
    </Section>
  )
}
