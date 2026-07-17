import type React from "react"
import { useState, useCallback, useRef } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Plus, Edit, TestTube } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TooltipButton, SourceAbToggle } from "./controls-components"
import {
  isBasemapByodOpenAtom, customBasemapSourcesAtom,
  useCogProtocolVsTitilerAtom, titilerEndpointAtom,
  type CustomBasemapSource
} from "@/lib/settings-atoms"
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import type { MapRef } from "react-map-gl/maplibre"
import { CustomBasemapModal } from "./custom-basemap-modal"
import { BasemapBatchEditModal } from "./basemap-batch-edit-modal"
import { CustomSourceDetails } from "./custom-source-details"
import { shouldZoomToBounds } from "@/lib/controls-utils"

import customSources from "@/lib/custom-sources.json"
const SAMPLE_BASEMAP_SOURCES = customSources['SAMPLE_BASEMAPS_SOURCES']

export const BasemapByodSection: React.FC<{ state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef> }> = ({ state, setState, mapRef }) => {
  const [isBasemapByodOpen, setIsBasemapByodOpen] = useAtom(isBasemapByodOpenAtom)
  const [customBasemapSources, setCustomBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [isAddBasemapModalOpen, setIsAddBasemapModalOpen] = useState(false)
  const [editingBasemap, setEditingBasemap] = useState<CustomBasemapSource | null>(null)
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)
  const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)

  const handleSaveCustomBasemap = useCallback((source: Omit<CustomBasemapSource, "id"> & { id?: string }) => {
    if (source.id) {
      setCustomBasemapSources(customBasemapSources.map((s) => s.id === source.id ? { ...s, ...source } as CustomBasemapSource : s))
    } else {
      const newSource: CustomBasemapSource = { ...source, id: `custom-basemap-${Date.now()}` } as CustomBasemapSource
      setCustomBasemapSources([...customBasemapSources, newSource])
      // Newly added sources are the ones the user almost always wants to look at
      // immediately — auto-select it as the active basemap.
      setState({ basemapSource: newSource.id })
    }
  }, [customBasemapSources, setCustomBasemapSources, setState])

  // Applies the Edit Basemap modal's opacity slider straight to the atom as
  // it drags — the modal itself only calls this while an existing source is
  // being edited (see its own comment), and reverts to the pre-edit value if
  // the dialog closes without Save.
  const handleLiveOpacityChange = useCallback((opacity: number) => {
    if (!editingBasemap) return
    setCustomBasemapSources(customBasemapSources.map((s) => s.id === editingBasemap.id ? { ...s, opacity } : s))
  }, [editingBasemap, customBasemapSources, setCustomBasemapSources])

  const handleDeleteCustomBasemap = useCallback((id: string) => {
    setCustomBasemapSources(customBasemapSources.filter((s) => s.id !== id))
    if (state.basemapSource === id) setState({ basemapSource: "osm" })
    if (state.basemapSourceA === id) setState({ basemapSourceA: "esri" })
    if (state.basemapSourceB === id) setState({ basemapSourceB: "google" })
  }, [customBasemapSources, setCustomBasemapSources, state, setState])

  // `force` skips the smart-zoom heuristic and always moves the camera — used by
  // the dedicated "Fit to bounds" button. Without it (the default, used when a
  // source's label is clicked to activate it), the camera only moves when the
  // target bounds are fully inside the current viewport, or fully disjoint from
  // it — see shouldZoomToBounds — so activating a world-covering basemap (bounds
  // fully contain the viewport) or one that only partially overlaps it doesn't
  // yank the user's context away from wherever they're already looking.
  const attemptFitBounds = useCallback((bbox: [number, number, number, number], force = false) => {
    if (!mapRef.current) return
    const [west, south, east, north] = bbox
    if (!force) {
      const viewport = mapRef.current.getMap().getBounds()
      const target = { west, south, east, north }
      const viewportBounds = { west: viewport.getWest(), south: viewport.getSouth(), east: viewport.getEast(), north: viewport.getNorth() }
      if (!shouldZoomToBounds(viewportBounds, target)) return
    }
    mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
  }, [mapRef])

  const handleFitToBounds = useCallback(async (source: CustomBasemapSource, force = false) => {
    // Populated directly from WMS GetCapabilities (see wms-picker-panel.tsx) — no
    // fetch needed, unlike the type-specific detection below.
    if (source.bounds) {
      attemptFitBounds(source.bounds, force)
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
    if (!['cog'].includes(source.type)) return
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

  const handleEditBasemap = useCallback((sourceId: string) => {
    const source = customBasemapSources.find(s => s.id === sourceId)
    if (source) {
      setEditingBasemap(source)
      setIsAddBasemapModalOpen(true)
    }
  }, [customBasemapSources])

  // Merge by id rather than replacing the whole list — refresh any sample entries
  // the user already has (matching id), add ones they don't, and leave every other
  // user-added source (not part of the sample set) untouched.
  const handleLoadSample = useCallback(() => {
    const samples = SAMPLE_BASEMAP_SOURCES as CustomBasemapSource[]
    const sampleIds = new Set(samples.map((s) => s.id))
    const preserved = customBasemapSources.filter((s) => !sampleIds.has(s.id))
    setCustomBasemapSources([...preserved, ...samples])
  }, [customBasemapSources, setCustomBasemapSources])

  // 'overlay' sources stack on top of the active basemap (see OverlayBasemapSources/
  // Layers in MapSources.tsx/MapLayers.tsx) instead of being one themselves — keep
  // them out of the basemap radio/toggle lists below, and multi-select them in their
  // own checkbox list further down.
  const basemapRoleSources = customBasemapSources.filter((s) => (s.role ?? "basemap") === "basemap")
  const overlaySources = customBasemapSources.filter((s) => s.role === "overlay")

  const handleToggleOverlay = useCallback((id: string, checked: boolean) => {
    const current: string[] = state.overlayBasemapIds || []
    setState({ overlayBasemapIds: checked ? [...current, id] : current.filter((x) => x !== id) })
  }, [state.overlayBasemapIds, setState])

  return (
    <>
      <Collapsible open={isBasemapByodOpen} onOpenChange={setIsBasemapByodOpen} className="mt-2">
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-m font-medium cursor-pointer pl-2.5">
          Bring Your Own Data
          <ChevronDown className={`h-4 w-4 transition-transform ${isBasemapByodOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-2 pt-1">
          <TooltipProvider>
            <div className="grid grid-cols-3 gap-2">
              <TooltipButton
                icon={Plus}
                label="Basemap"
                tooltip="Add a new custom basemap source"
                onClick={() => { setEditingBasemap(null); setIsAddBasemapModalOpen(true) }}
              />
              <TooltipButton
                icon={Edit}
                label="Batch"
                tooltip="Batch edit all sources as JSON"
                onClick={() => setIsBatchEditModalOpen(true)}
              />
              <TooltipButton
                icon={TestTube}
                label="Sample"
                tooltip="Load sample basemap sources"
                onClick={handleLoadSample}
              />
            </div>
          </TooltipProvider>
          {basemapRoleSources.length > 0 && (
            state.basemapPerView ? (
              state.splitScreen ? (
                <div className="space-y-2">
                  {basemapRoleSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <SourceAbToggle
                        aActive={state.basemapSourceA === source.id}
                        bActive={state.basemapSourceB === source.id}
                        onSelectA={() => setState({ basemapSourceA: source.id })}
                        onSelectB={() => setState({ basemapSourceB: source.id })}
                      />
                      <CustomSourceDetails
                        source={source}
                        handleFitToBounds={handleFitToBounds}
                        handleEditSource={handleEditBasemap}
                        handleDeleteCustomSource={handleDeleteCustomBasemap}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <RadioGroup value={state.basemapSourceA} onValueChange={(value) => setState({ basemapSourceA: value })} className="gap-2">
                  {basemapRoleSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <RadioGroupItem
                        value={source.id}
                        id={`basemap-${source.id}`}
                        className="cursor-pointer shrink-0"
                      />
                      <CustomSourceDetails
                        source={source}
                        handleFitToBounds={handleFitToBounds}
                        handleEditSource={handleEditBasemap}
                        handleDeleteCustomSource={handleDeleteCustomBasemap}
                        onSelect={(id) => setState({ basemapSourceA: id })}
                      />
                    </div>
                  ))}
                </RadioGroup>
              )
            ) : (
              <RadioGroup value={state.basemapSource} onValueChange={(value) => setState({ basemapSource: value })} className="gap-2">
                {basemapRoleSources.map((source) => (
                  <div key={source.id} className="flex items-center gap-2 min-w-0">
                    <RadioGroupItem
                      value={source.id}
                      id={`basemap-${source.id}`}
                      className="cursor-pointer shrink-0"
                    />
                    <CustomSourceDetails
                      source={source}
                      handleFitToBounds={handleFitToBounds}
                      handleEditSource={handleEditBasemap}
                      handleDeleteCustomSource={handleDeleteCustomBasemap}
                      onSelect={(id) => setState({ basemapSource: id })}
                    />
                  </div>
                ))}
              </RadioGroup>
            )
          )}
          {state.basemapPerView && overlaySources.length > 0 && (
            <div className="space-y-2 pt-2 mt-2 border-t">
              <Label className="text-sm font-medium">Overlays</Label>
              {overlaySources.map((source) => (
                <div key={source.id} className="flex items-center gap-2 min-w-0">
                  <Checkbox
                    checked={(state.overlayBasemapIds || []).includes(source.id)}
                    onCheckedChange={(checked) => handleToggleOverlay(source.id, checked === true)}
                    className="cursor-pointer shrink-0"
                  />
                  <CustomSourceDetails
                    source={source}
                    handleFitToBounds={handleFitToBounds}
                    handleEditSource={handleEditBasemap}
                    handleDeleteCustomSource={handleDeleteCustomBasemap}
                    onSelect={(id) => handleToggleOverlay(id, !(state.overlayBasemapIds || []).includes(id))}
                  />
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>

      </Collapsible>
      <CustomBasemapModal isOpen={isAddBasemapModalOpen} onOpenChange={setIsAddBasemapModalOpen} editingSource={editingBasemap} onSave={handleSaveCustomBasemap} onLiveOpacityChange={handleLiveOpacityChange} />
      <BasemapBatchEditModal
        isOpen={isBatchEditModalOpen}
        onOpenChange={setIsBatchEditModalOpen}
        sources={customBasemapSources}
        onSave={(sources) => { setCustomBasemapSources(sources); setIsBatchEditModalOpen(false) }}
      />
    </>
  )
}