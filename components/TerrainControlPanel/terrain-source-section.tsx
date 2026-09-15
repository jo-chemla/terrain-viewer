import type React from "react"
import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Plus, Edit, TestTube, RotateCcw, Lightbulb } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  isByodOpenAtom, customTerrainSourcesAtom, customBasemapSourcesAtom,
  titilerEndpointAtom, useCogProtocolVsTitilerAtom, mapboxKeyAtom, maptilerKeyAtom,
  type CustomTerrainSource
} from "@/lib/settings-atoms"
import { terrainSources } from "@/lib/terrain-sources"
import { resolveLocalFileUrl, localFileId } from "@/lib/local-file-store"
import { deletePersistedCogFile } from "@/lib/opfs-file-store"
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import type { MapRef } from "react-map-gl/maplibre"
import saveAs from "file-saver"
import { Section, SourceGridToggle, GroupHeading } from "./controls-components"
import { type Bounds, templateLink, shouldZoomToTerrainBounds } from "@/lib/controls-utils"
import { resolveLinkedBasemapId } from "@/lib/linked-sources"
import { staticBoundsFor } from "@/lib/max-bounds"
import { applyBoundedView, fitPaddingFor } from "@/lib/underzoom"
import { viewFieldName, sourceFieldName, VIEW_IDS, type ViewId } from "@/lib/grid-layouts"
import { SourceDetails } from "./source-details"
import { CustomTerrainSourceModal } from "./custom-terrain-source-modal"
import { CustomSourceDetails } from "./custom-source-details"
import { SampleSourcesModal } from "./sample-sources-modal"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TooltipButton } from "./controls-components"
import { JsonEditor } from "@/components/ui/json-editor"

import customSources from "@/lib/custom-sources.json"
const SAMPLE_TERRAIN_SOURCES = customSources['SAMPLE_TERRAIN_SOURCES']

export const TerrainSourceSection: React.FC<{
  state: any; setState: (updates: any) => void; getTilesUrl: (key: string) => string; getMapBounds: () => Bounds; mapRef: React.RefObject<MapRef>;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, getTilesUrl, getMapBounds, mapRef, isOpen, onOpenChange }) => {
  const [isByodOpen, setIsByodOpen] = useAtom(isByodOpenAtom)
  const [isWorldwideOpen, setIsWorldwideOpen] = useState(true)
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<CustomTerrainSource | null>(null)
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)
  const [isSampleModalOpen, setIsSampleModalOpen] = useState(false)
  const [batchEditJson, setBatchEditJson] = useState("")
  const [batchEditError, setBatchEditError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)

  // Mapbox/MapTiler terrain need a real access token/key (see getTilesUrl's
  // {API_KEY} substitution in controls-utils.tsx) — without one their tiles
  // just 401, so they're hidden from the picker until a key is set, same
  // convention as KEY_GATED_BASEMAPS in raster-basemap-section.tsx.
  const visibleTerrainSources = useMemo(
    () => Object.entries(terrainSources).filter(([key]) => (
      (key !== "mapbox" || !!mapboxKey) && (key !== "maptiler" || !!maptilerKey)
    )),
    [mapboxKey, maptilerKey],
  )

  const linkCallback = useCallback((link: string) => () => window.open(templateLink(link, state.lat, state.lng), "_blank"), [state.lat, state.lng])

  // Resolves a terrain source's paired basemap NAME for CustomSourceDetails'
  // link badge (see CustomTerrainSource.linkedBasemapId) — falls back to a
  // reverse scan since the pairing may have been set from the basemap's own
  // modal instead, same "either side works" logic as TerrainViewer.tsx's
  // auto-select effects.
  const linkedBasemapName = useCallback((source: CustomTerrainSource) => {
    const id = source.linkedBasemapId ?? customBasemapSources.find((b) => b.linkedTerrainId === source.id)?.id
    return id ? customBasemapSources.find((b) => b.id === id)?.name : undefined
  }, [customBasemapSources])

  // Every terrain-source pick (worldwide default, custom, split A/B or single)
  // routes through these so a linked basemap (see lib/linked-sources.ts) is
  // resolved once, imperatively, at the moment of the click — one setState
  // call with both fields, instead of a reactive effect racing the user's
  // next action (see TerrainViewer.tsx's removed link-effects for why that
  // was fragile).
  const selectTerrainA = useCallback((id: string) => {
    const linkedBasemapId = resolveLinkedBasemapId(id, customTerrainSources, customBasemapSources)
    setState(linkedBasemapId
      ? (state.basemapPerView ? { sourceA: id, basemapSourceA: linkedBasemapId } : { sourceA: id, basemapSource: linkedBasemapId })
      : { sourceA: id })
  }, [customTerrainSources, customBasemapSources, state.basemapPerView, setState])

  // Every non-A view (B-F) always uses its own suffixed source/basemap
  // fields — it can only be active at all once splitStyle !== "off", same
  // reasoning viewFieldName centralizes for every other per-view field.
  const selectTerrainSide = useCallback((side: ViewId, id: string) => {
    if (side === "A") { selectTerrainA(id); return }
    const linkedBasemapId = state.basemapPerView ? resolveLinkedBasemapId(id, customTerrainSources, customBasemapSources) : undefined
    setState(linkedBasemapId
      ? { [sourceFieldName(side)]: id, [viewFieldName(side, "basemapSource", true)]: linkedBasemapId }
      : { [sourceFieldName(side)]: id })
  }, [customTerrainSources, customBasemapSources, state.basemapPerView, setState, selectTerrainA])

  // This section is only ever rendered in Terrain mode (see
  // TerrainControlPanel's !historicalMode gate), where the map's own grid is
  // always forced back to 2x1 regardless of state.gridLayout (which isn't
  // reset on a mode switch — see TerrainViewer's effectiveGridLayout) — so
  // unlike RasterBasemapSection, which renders in both modes, this picker
  // has no case where showing anything but 2x1 would ever match the map.
  const effectiveGridLayout = "2x1"

  const handleSaveCustomSource = useCallback((source: Omit<CustomTerrainSource, "id"> & { id?: string }) => {
    if (source.id) {
      setCustomTerrainSources(customTerrainSources.map((s) => s.id === source.id ? { ...s, ...source } as CustomTerrainSource : s))
    } else {
      const newSource: CustomTerrainSource = { ...source, id: `custom-${Date.now()}` } as CustomTerrainSource
      setCustomTerrainSources([...customTerrainSources, newSource])
      // Newly added sources are the ones the user almost always wants to look at
      // immediately — auto-select it as the primary (sourceA) terrain source.
      // Resolved directly from newSource rather than via selectTerrainA: a
      // brand-new id can't yet be the target of a REVERSE link from an
      // existing basemap (nothing could have referenced it before it
      // existed), and customTerrainSources here is one render stale (doesn't
      // include newSource yet), so only the forward link is relevant.
      if (newSource.linkedBasemapId) {
        setState(state.basemapPerView
          ? { sourceA: newSource.id, basemapSourceA: newSource.linkedBasemapId }
          : { sourceA: newSource.id, basemapSource: newSource.linkedBasemapId })
      } else {
        setState({ sourceA: newSource.id })
      }
    }
  }, [customTerrainSources, setCustomTerrainSources, state.basemapPerView, setState])

  const handleDeleteCustomSource = useCallback((id: string) => {
    const deleted = customTerrainSources.find((s) => s.id === id)
    setCustomTerrainSources(customTerrainSources.filter((s) => s.id !== id))
    // Every view (not just A/B) needs its own fallback once it's pointing at
    // the source being deleted — otherwise a 2x2/3x2 grid could keep a dead
    // sourceC/D/E/F id around after this.
    const fallback: Record<ViewId, string> = { A: "aws", B: "mapterhorn", C: "aws", D: "mapterhorn", E: "aws", F: "mapterhorn", G: "aws", H: "mapterhorn" }
    const updates: Record<string, string> = {}
    for (const side of VIEW_IDS) {
      if (state[sourceFieldName(side)] === id) updates[sourceFieldName(side)] = fallback[side]
    }
    if (Object.keys(updates).length > 0) setState(updates)
    // Reclaim its OPFS-persisted bytes too (see opfs-file-store.ts) — otherwise
    // a deleted-then-forgotten local COG would keep counting against quota.
    if (deleted?.type === "cog-local") {
      deletePersistedCogFile(localFileId(deleted.url))
    }
  }, [customTerrainSources, setCustomTerrainSources, state, setState])

  // `force` skips the smart-zoom heuristic and always moves the camera — used by
  // the dedicated "Fit to bounds" button. Without it (the default, used when a
  // source's label is clicked to activate it), the camera only moves when the
  // the viewport is not ALREADY fully inside the source's own bounds — see
  // shouldZoomToTerrainBounds. So picking a country you are not looking at flies
  // there, picking a worldwide source never moves you (it has no bounds, so this
  // is never called), and coming back to a country you are already zoomed inside
  // leaves your view alone rather than pulling back out to the whole country.
  const attemptFitBounds = useCallback((bbox: [number, number, number, number], force = false) => {
    if (!mapRef.current) return
    const [west, south, east, north] = bbox
    if (!force) {
      const viewport = mapRef.current.getMap().getBounds()
      const target = { west, south, east, north }
      const viewportBounds = { west: viewport.getWest(), south: viewport.getSouth(), east: viewport.getEast(), north: viewport.getNorth() }
      if (!shouldZoomToTerrainBounds(viewportBounds, target)) return
    }
    const map = mapRef.current.getMap()
    // Apply the target's constraint BEFORE flying. Selecting a source runs this
    // fit synchronously from the click, whereas the maxBounds effect in
    // TerrainViewer only re-resolves a tick later. Two things went wrong without
    // it: the camera was still fenced inside the PREVIOUS country so maplibre
    // clamped the flight back (Netherlands -> Mexico simply stayed over the
    // Netherlands), and the relaxed underzoom constrain was not in force yet, so
    // stock maplibre refused to let the country shrink inside the viewport and
    // the fit came out filling the frame instead of showing the whole country.
    // Only touched when a constraint is already active, so maxBoundsMode "none"
    // keeps its unbounded behaviour.
    if (map.getMaxBounds()) applyBoundedView(map, [west, south, east, north])
    map.fitBounds([[west, south], [east, north]], { padding: fitPaddingFor(map), speed: 6 })
  }, [mapRef])

  const handleFitToBounds = useCallback(async (source: CustomTerrainSource, force = false) => {
    // Populated directly from WMS GetCapabilities (see wms-picker-panel.tsx) — no
    // fetch needed, unlike the type-specific detection below.
    // staticBoundsFor, not source.bounds — a localStorage copy saved before the
    // sample gained bounds would otherwise silently fall through to the
    // type-specific detection below and fit to nothing.
    const staticBounds = staticBoundsFor(source)
    if (staticBounds) {
      attemptFitBounds(staticBounds, force)
      return
    }
    if (source.type === 'tilejson') {
      try {
        const response = await fetch(source.url)
        const data = await response.json()
        if (data.bounds) attemptFitBounds(data.bounds, force)
      } catch (error) {
        console.error("Failed to fetch TileJSON bounds:", error)
      }
      return
    }
    if (source.type === 'cog-local') {
      // Always the geomatico protocol, and always this session's blob: URL —
      // titiler can't be pointed at the user's disk, and getCogMetadata needs a
      // real fetchable URL, not the persisted `local://<id>` placeholder.
      const resolvedUrl = resolveLocalFileUrl(localFileId(source.url))
      if (!resolvedUrl) return // not (re-)picked yet this session
      try {
        const metadata = await getCogMetadata(resolvedUrl)
        if (metadata.bbox) attemptFitBounds(metadata.bbox, force)
      } catch (error) {
        console.error("Failed to fetch local COG bounds:", error)
      }
      return
    }
    if (!['cog', 'vrt'].includes(source.type)) return
    try {
      if (useCogProtocolVsTitiler) {
        getCogMetadata(source.url).then(metadata => {
          if (metadata.bbox) attemptFitBounds(metadata.bbox, force)
        })
      } else {
        const infoUrl = `${titilerEndpoint}/cog/info.geojson?url=${encodeURIComponent(source.url)}`
        const response = await fetch(infoUrl)
        const data = await response.json()
        const bbox = data.bbox ?? data.properties.bounds
        if (bbox) attemptFitBounds(bbox, force)
      }
    } catch (error) {
      console.error("Failed to fetch COG bounds:", error)
    }
  }, [titilerEndpoint, useCogProtocolVsTitiler, attemptFitBounds])

  const handleOpenBatchEdit = useCallback(() => {
    setBatchEditJson(JSON.stringify(customTerrainSources, null, 2))
    setBatchEditError("")
    setIsBatchEditModalOpen(true)
  }, [customTerrainSources])

  const handleSaveBatchEdit = useCallback(() => {
    try {
      const parsed = JSON.parse(batchEditJson)
      if (!Array.isArray(parsed)) {
        setBatchEditError("Input must be a valid JSON array")
        return
      }
      setCustomTerrainSources(parsed)
      setIsBatchEditModalOpen(false)
    } catch (error) {
      setBatchEditError("Invalid JSON: " + (error as Error).message)
    }
  }, [batchEditJson, setCustomTerrainSources])

  // The sample library is picked from a modal (see SampleSourcesModal) rather
  // than bulk-loaded: with ~50 national datasets, one click dumping all of
  // them into the list was more noise than help.
  const handleLoadSample = useCallback(() => setIsSampleModalOpen(true), [])

  return (
    <>
      <Section id="tour-terrain-section" title="Terrain" isOpen={isOpen} onOpenChange={onOpenChange}>
        <Collapsible open={isWorldwideOpen} onOpenChange={setIsWorldwideOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer">
            <GroupHeading>Worldwide Defaults</GroupHeading>
            <ChevronDown className={`h-4 w-4 transition-transform ${isWorldwideOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-1 pl-2.5">
            {state.splitStyle !== "off" ? (
              <div className="space-y-1.5">
                {visibleTerrainSources.map(([key, config]) => (
                  <div key={key} className="flex items-center gap-2 min-w-0">
                    <SourceGridToggle
                      disabled={config.encoding === "3dtiles"}
                      gridLayout={effectiveGridLayout}
                      isActive={(side) => state[sourceFieldName(side)] === key}
                      onSelect={(side) => selectTerrainSide(side, key)}
                    />
                    <SourceDetails sourceKey={key} config={config} getTilesUrl={getTilesUrl} linkCallback={linkCallback} getMapBounds={getMapBounds} state={state} />
                  </div>
                ))}
              </div>
            ) : (
              <RadioGroup value={state.sourceA} onValueChange={selectTerrainA} className="gap-2">
                {visibleTerrainSources.map(([key, config]) => (
                  <div key={key} className="flex items-center gap-2 min-w-0">
                    <RadioGroupItem value={key} id={`source-${key}`} className="cursor-pointer shrink-0" disabled={config.encoding === "3dtiles"} />
                    <SourceDetails sourceKey={key} config={config} getTilesUrl={getTilesUrl} linkCallback={linkCallback} getMapBounds={getMapBounds} state={state} />
                  </div>
                ))}
              </RadioGroup>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={isByodOpen} onOpenChange={setIsByodOpen} className="mt-4">
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer">
            <GroupHeading>Bring Your Own Data</GroupHeading>
            <ChevronDown className={`h-4 w-4 transition-transform ${isByodOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-2 pt-1 pl-2.5">
            <TooltipProvider>
              <div id="tour-byod-terrain-row" className="grid grid-cols-3 gap-2">
                <TooltipButton
                  icon={Plus}
                  label="Add Dataset"
                  tooltip="Add a new custom terrain source"
                  onClick={() => { setEditingSource(null); setIsAddSourceModalOpen(true) }}
                />
                <TooltipButton
                  icon={Edit}
                  label="Batch"
                  tooltip="Batch edit all sources as JSON"
                  onClick={handleOpenBatchEdit}
                />
                <TooltipButton
                  icon={TestTube}
                  label="Sample"
                  tooltip="Pick from the sample terrain sources"
                  onClick={handleLoadSample}
                />
              </div>
            </TooltipProvider>

            {customTerrainSources.length > 0 && (
              state.splitStyle !== "off" ? (
                <div className="space-y-1.5">
                  {customTerrainSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <SourceGridToggle
                        gridLayout={effectiveGridLayout}
                        isActive={(side) => state[sourceFieldName(side)] === source.id}
                        onSelect={(side) => selectTerrainSide(side, source.id)}
                      />
                      <CustomSourceDetails {...{ source, handleFitToBounds, handleEditSource: (id: string) => { setEditingSource(source); setIsAddSourceModalOpen(true) }, handleDeleteCustomSource, linkedSourceName: linkedBasemapName(source) }} />
                    </div>
                  ))}
                </div>
              ) : (
                <RadioGroup value={state.sourceA} onValueChange={selectTerrainA} className="gap-2">
                  {customTerrainSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <RadioGroupItem value={source.id} id={`source-${source.id}`} className="cursor-pointer shrink-0" />
                      <CustomSourceDetails {...{ source, handleFitToBounds, handleEditSource: (id: string) => { setEditingSource(source); setIsAddSourceModalOpen(true) }, handleDeleteCustomSource, onSelect: selectTerrainA, linkedSourceName: linkedBasemapName(source) }} />
                    </div>
                  ))}
                </RadioGroup>
              )
            )}
          </CollapsibleContent>
        </Collapsible>

        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-muted-foreground cursor-pointer"
          onClick={() => window.open("https://github.com/mapterhorn/mapterhorn/issues/27", "_blank")}
        >
          <Lightbulb className="h-4 w-4 mr-1" /> Suggest a new terrain source
        </Button>
      </Section>
      <CustomTerrainSourceModal isOpen={isAddSourceModalOpen} onOpenChange={setIsAddSourceModalOpen} editingSource={editingSource} onSave={handleSaveCustomSource} mapRef={mapRef} />
      <SampleSourcesModal
        open={isSampleModalOpen}
        onOpenChange={setIsSampleModalOpen}
        title="Sample terrain sources"
        samples={SAMPLE_TERRAIN_SOURCES as CustomTerrainSource[]}
        current={customTerrainSources}
        setCurrent={setCustomTerrainSources}
        compareToMapterhorn
      />
      <Dialog open={isBatchEditModalOpen} onOpenChange={setIsBatchEditModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Batch Edit Terrain Sources</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto px-1">
            <JsonEditor value={batchEditJson} onChange={setBatchEditJson} />
            {batchEditError && <p className="text-sm text-red-500">{batchEditError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBatchEditModalOpen(false)} className="cursor-pointer">Cancel</Button>
              <Button onClick={handleSaveBatchEdit} className="cursor-pointer">Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}