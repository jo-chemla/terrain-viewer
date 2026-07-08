import type React from "react"
import { useState, useCallback, useRef } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Plus, Edit, TestTube } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TooltipButton } from "./controls-components"
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

  const handleDeleteCustomBasemap = useCallback((id: string) => {
    setCustomBasemapSources(customBasemapSources.filter((s) => s.id !== id))
    if (state.basemapSource === id) setState({ basemapSource: "osm" })
    if (state.basemapSourceA === id) setState({ basemapSourceA: "esri" })
    if (state.basemapSourceB === id) setState({ basemapSourceB: "google" })
  }, [customBasemapSources, setCustomBasemapSources, state, setState])

  const handleFitToBounds = useCallback(async (source: CustomBasemapSource) => {
    if (source.type === 'tilejson') {
      try {
        const response = await fetch(source.url)
        const data = await response.json()
        const bbox = data.bounds
        if (bbox && mapRef.current) {
          const [west, south, east, north] = bbox
          mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
        }
      } catch (error) {
        console.error("Failed to fetch TileJSON bounds:", error)
      }
      return
    }
    if (!['cog'].includes(source.type)) return
    try {
      if (useCogProtocolVsTitiler) {
        getCogMetadata(source.url).then(metadata => {
          const bbox = metadata.bbox
          const [west, south, east, north] = bbox
          if (bbox && mapRef.current) {
            mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
          }
        })
      } else {
        const infoUrl = `${titilerEndpoint}/cog/info.geojson?url=${encodeURIComponent(source.url)}`
        const response = await fetch(infoUrl)
        const data = await response.json()
        const bbox = data.bbox ?? data.properties.bounds
        const [west, south, east, north] = bbox
        if (bbox && mapRef.current) {
          mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
        }
      }
    } catch (error) {
      console.error("Failed to fetch COG bounds:", error)
    }
  }, [titilerEndpoint, mapRef, useCogProtocolVsTitiler])

  const handleEditBasemap = useCallback((sourceId: string) => {
    const source = customBasemapSources.find(s => s.id === sourceId)
    if (source) {
      setEditingBasemap(source)
      setIsAddBasemapModalOpen(true)
    }
  }, [customBasemapSources])

  const handleLoadSample = useCallback(() => {
    setCustomBasemapSources(SAMPLE_BASEMAP_SOURCES as CustomBasemapSource[])
  }, [setCustomBasemapSources])

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
          {customBasemapSources.length > 0 && (
            state.basemapPerView ? (
              state.splitScreen ? (
                <div className="space-y-2">
                  {customBasemapSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <ToggleGroup
                        type="single"
                        value={state.basemapSourceA === source.id ? "a" : state.basemapSourceB === source.id ? "b" : ""}
                        onValueChange={(value) => {
                          if (value === "a") setState({ basemapSourceA: source.id })
                          else if (value === "b") setState({ basemapSourceB: source.id })
                        }}
                        className="border rounded-md shrink-0 cursor-pointer"
                      >
                        <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold">A</ToggleGroupItem>
                        <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold">B</ToggleGroupItem>
                      </ToggleGroup>
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
                  {customBasemapSources.map((source) => (
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
                {customBasemapSources.map((source) => (
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
        </CollapsibleContent>

      </Collapsible>
      <CustomBasemapModal isOpen={isAddBasemapModalOpen} onOpenChange={setIsAddBasemapModalOpen} editingSource={editingBasemap} onSave={handleSaveCustomBasemap} />
      <BasemapBatchEditModal
        isOpen={isBatchEditModalOpen}
        onOpenChange={setIsBatchEditModalOpen}
        sources={customBasemapSources}
        onSave={(sources) => { setCustomBasemapSources(sources); setIsBatchEditModalOpen(false) }}
      />
    </>
  )
}