import type React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Section } from "./controls-components"
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
import { resolveActiveHistoricalSource } from "@/lib/historical-sources"
import { SOURCE_CONFIG } from "./historical-timeline-panel"
import { BUILTIN_BASEMAP_OPTIONS } from "./raster-basemap-section"

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
 *  a disabled, "not available" state for every other source. */
export function isProvenanceSource(sourceA: string): boolean {
  return sourceKindOf(sourceA) !== null
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
  const rawA = state.basemapPerView ? state.basemapSourceA : state.basemapSource
  const rawB = state.basemapPerView ? state.basemapSourceB : state.basemapSource
  const activeA = resolveActiveHistoricalSource(rawA, state.basemapPerView ? state.historicalActiveSourceA : state.historicalActiveSource)
  const activeB = resolveActiveHistoricalSource(rawB, state.basemapPerView ? state.historicalActiveSourceB : state.historicalActiveSource)
  const dateA = state.basemapPerView ? state.dateA : state.date
  const dateB = state.basemapPerView ? state.dateB : state.date
  const showB = !!state.splitScreen && !!state.basemapPerView && activeB !== activeA

  // All three hooks are called unconditionally (cheap/debounced) regardless
  // of which side(s) actually need them — hooks can't be conditional.
  const esriAttribution = useEsriDynamicAttribution(state.lat, state.lng, state.zoom)
  const geAttributionA = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateA)
  const geAttributionB = useGeHistoricalDynamicAttribution(state.lat, state.lng, state.zoom, dateB)
  const bingAttribution = useBingDynamicAttribution(state.lat, state.lng, state.zoom)

  const textFor = (id: string, geAttribution: string) =>
    id === "wayback" || id === "esri" ? esriAttribution
    : id === "ge-historical" ? geAttribution
    : id === "bing" ? bingAttribution
    : STATIC_BASEMAP_ATTRIBUTIONS[id] ?? "—"

  const textA = textFor(activeA, geAttributionA)

  // Pushes map A's resolved dynamic text directly onto the LIVE maplibre
  // source object (bypassing react-map-gl's <Source> entirely — see the
  // long comment on MapSources.tsx's wayback branch for why that
  // component's own `attribution` prop can never carry a value that changes
  // post-mount), then fires a synthetic 'sourcedata' event so the corner
  // AttributionControl actually redraws with it. Confirmed against
  // maplibre-gl-js's own source (attribution_control.ts): its _updateData
  // listener only recomputes when e.sourceDataType is 'metadata' or
  // 'visibility' (or a style-level event) — firing exactly that shape is
  // Map's normal PUBLIC fire() (Evented.fire, not a private method), so this
  // needs no undocumented API at all. Map B (split screen) isn't covered —
  // this component only ever receives the primary map's ref.
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

  const row = (id: string, geAttribution: string, prefix: string) => (
    <div key={prefix || "single"} className="flex items-start justify-between gap-3 px-2 py-1.5 rounded bg-muted/50 text-xs">
      <span className="shrink-0">{prefix}{basemapLabel(id)}</span>
      <span className="text-muted-foreground text-right">{stripSourcePrefix(textFor(id, geAttribution))}</span>
    </div>
  )

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Basemap attribution — Esri/Wayback, Google Earth, and Bing resolve live for the current view; every other source is fixed.
      </p>
      {row(activeA, geAttributionA, showB ? "A: " : "")}
      {showB && row(activeB, geAttributionB, "B: ")}
    </div>
  )
}

export const SourceInfoSection: React.FC<{
  state: any
  mapRef: React.RefObject<MapRef>
  historicalMode?: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, mapRef, historicalMode = false, isOpen, onOpenChange }) => {
  const [isActive, setIsActive] = useState(false)
  const [result, setResult] = useState<ProvenanceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sourceKind = sourceKindOf(state.sourceA)

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
    <Section title="Source Info" isOpen={isOpen} onOpenChange={onOpenChange}>
      {/* Terrain provenance is meaningless in historical mode (no elevation
          source is shown there) — but a raster basemap can be active in
          EITHER app mode, so BasemapAttributionList below always renders
          alongside this, not instead of it. */}
      {!historicalMode && (
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
      <BasemapAttributionList state={state} mapRef={mapRef} />
    </Section>
  )
}
