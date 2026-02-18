import type React from "react"
import { useState, useCallback, useRef } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Plus, Edit, TestTube, RotateCcw } from "lucide-react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  isByodOpenAtom, customTerrainSourcesAtom,
  titilerEndpointAtom, themeAtom, useCogProtocolVsTitilerAtom,
  type CustomTerrainSource
} from "@/lib/settings-atoms"
import { terrainSources } from "@/lib/terrain-sources"
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import type { MapRef } from "react-map-gl/maplibre"
import saveAs from "file-saver"
import { Section } from "./controls-components"
import { type Bounds, templateLink } from "@/lib/controls-utils"
import { SourceDetails } from "./source-details"
import { CustomTerrainSourceModal } from "./custom-terrain-source-modal"
import { CustomSourceDetails } from "./custom-source-details"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TooltipButton } from "./controls-components"

import customSources from "@/lib/custom-sources.json"
const SAMPLE_TERRAIN_SOURCES = customSources['SAMPLE_TERRAIN_SOURCES']

export const TerrainSourceSection: React.FC<{
  state: any; setState: (updates: any) => void; getTilesUrl: (key: string) => string; getMapBounds: () => Bounds; mapRef: React.RefObject<MapRef>;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, getTilesUrl, getMapBounds, mapRef, isOpen, onOpenChange }) => {
  const [isByodOpen, setIsByodOpen] = useAtom(isByodOpenAtom)
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<CustomTerrainSource | null>(null)
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)
  const [batchEditJson, setBatchEditJson] = useState("")
  const [batchEditError, setBatchEditError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)

  const linkCallback = useCallback((link: string) => () => window.open(templateLink(link, state.lat, state.lng), "_blank"), [state.lat, state.lng])

  const handleSaveCustomSource = useCallback((source: Omit<CustomTerrainSource, "id"> & { id?: string }) => {
    if (source.id) {
      setCustomTerrainSources(customTerrainSources.map((s) => s.id === source.id ? { ...s, ...source } as CustomTerrainSource : s))
    } else {
      const newSource: CustomTerrainSource = { ...source, id: `custom-${Date.now()}` } as CustomTerrainSource
      setCustomTerrainSources([...customTerrainSources, newSource])
    }
  }, [customTerrainSources, setCustomTerrainSources])

  const handleDeleteCustomSource = useCallback((id: string) => {
    setCustomTerrainSources(customTerrainSources.filter((s) => s.id !== id))
    if (state.sourceA === id) setState({ sourceA: "aws" })
    if (state.sourceB === id) setState({ sourceB: "mapterhorn" })
  }, [customTerrainSources, setCustomTerrainSources, state, setState])

  const handleFitToBounds = useCallback(async (source: CustomTerrainSource) => {
    if (!['cog', 'vrt'].includes(source.type)) return
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
        let infoUrl = `${titilerEndpoint}/cog/info.geojson?url=${encodeURIComponent(source.url)}`
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

  const handleLoadSample = useCallback(() => {
    setCustomTerrainSources(SAMPLE_TERRAIN_SOURCES as CustomTerrainSource[])
  }, [setCustomTerrainSources])

  return (
    <>
      <Section title="Terrain Source" isOpen={isOpen} onOpenChange={onOpenChange}>
        {state.splitScreen ? (
          <>
            {Object.entries(terrainSources).map(([key, config]) => (
              <div key={key} className="flex items-center gap-2">
                <ToggleGroup
                  type="single"
                  disabled={config.encoding === "3dtiles"}
                  value={state.sourceA === key ? "a" : state.sourceB === key ? "b" : ""}
                  onValueChange={(value) => {
                    if (value === "a") setState({ sourceA: key })
                    else if (value === "b") setState({ sourceB: key })
                  }}
                  className="border rounded-md shrink-0 cursor-pointer"
                >
                  <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold" disabled={config.encoding === "3dtiles"}>A</ToggleGroupItem>
                  <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold" disabled={config.encoding === "3dtiles"}>B</ToggleGroupItem>
                </ToggleGroup>
                <SourceDetails sourceKey={key} config={config} getTilesUrl={getTilesUrl} linkCallback={linkCallback} getMapBounds={getMapBounds} />
              </div>
            ))}
          </>
        ) : (
          <RadioGroup value={state.sourceA} onValueChange={(value) => setState({ sourceA: value })}>
            {Object.entries(terrainSources).map(([key, config]) => (
              <div key={key} className="flex items-center gap-2">
                <RadioGroupItem value={key} id={`source-${key}`} className="cursor-pointer" disabled={config.encoding === "3dtiles"} />
                <SourceDetails sourceKey={key} config={config} getTilesUrl={getTilesUrl} linkCallback={linkCallback} getMapBounds={getMapBounds} />
              </div>
            ))}
          </RadioGroup>
        )}

        <Collapsible open={isByodOpen} onOpenChange={setIsByodOpen} className="mt-4">
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-m font-medium cursor-pointer pl-2.5">
            Bring Your Own Data
            <ChevronDown className={`h-4 w-4 transition-transform ${isByodOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-2 pt-1">
            <TooltipProvider>

              <div className="flex gap-2">
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
                  onClick={() => setIsBatchEditModalOpen(true)}
                />
                <TooltipButton
                  icon={TestTube}
                  label="Sample"
                  tooltip="Load sample terrain sources"
                  onClick={handleLoadSample}
                />
              </div>
            </TooltipProvider>
            {customTerrainSources.length > 0 && (
              <div className="space-y-2">
                <RadioGroup value={state.sourceA} onValueChange={(value) => setState({ sourceA: value })}>
                  {customTerrainSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <RadioGroupItem value={source.id} id={`source-${source.id}`} className="cursor-pointer shrink-0" />
                      <CustomSourceDetails {...{ source, handleFitToBounds, handleEditSource: (id: string) => { setEditingSource(source); setIsAddSourceModalOpen(true) }, handleDeleteCustomSource }} />
                    </div>
                  ))}
                </RadioGroup>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </Section>
      <CustomTerrainSourceModal isOpen={isAddSourceModalOpen} onOpenChange={setIsAddSourceModalOpen} editingSource={editingSource} onSave={handleSaveCustomSource} />
      <Dialog open={isBatchEditModalOpen} onOpenChange={setIsBatchEditModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Batch Edit Terrain Sources</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto px-1">
            <textarea
              className="w-full min-h-[400px] p-3 border rounded-md font-mono text-xs bg-background text-foreground resize-none"
              value={batchEditJson}
              onChange={(e) => setBatchEditJson(e.target.value)}
            />
            {batchEditError && <p className="text-sm text-red-500">{batchEditError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBatchEditModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveBatchEdit}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}