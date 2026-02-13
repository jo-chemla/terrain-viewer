import type React from "react"
import { useState, useCallback, useRef } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Plus, Edit } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
    }
  }, [customBasemapSources, setCustomBasemapSources])

  const handleDeleteCustomBasemap = useCallback((id: string) => {
    setCustomBasemapSources(customBasemapSources.filter((s) => s.id !== id))
    if (state.basemapSource === id) setState({ basemapSource: "osm" })
  }, [customBasemapSources, setCustomBasemapSources, state, setState])

  const handleFitToBounds = useCallback(async (source: CustomBasemapSource) => {
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

  return (
    <>
      <Collapsible open={isBasemapByodOpen} onOpenChange={setIsBasemapByodOpen} className="mt-2">
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-m font-medium cursor-pointer pl-2.5">
          Bring Your Own Data
          <ChevronDown className={`h-4 w-4 transition-transform ${isBasemapByodOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-2 pt-1">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-3 cursor-pointer bg-transparent" onClick={() => { setEditingBasemap(null); setIsAddBasemapModalOpen(true) }}>
              <Plus className="h-4 w-4 mr-2" />Add Basemap
            </Button>
            <Button variant="outline" size="sm" className="flex-1 cursor-pointer bg-transparent" onClick={() => setIsBatchEditModalOpen(true)}>
              <Edit className="h-3 w-3 mr-2" />Batch Edit
            </Button>
          </div>
          {customBasemapSources.length > 0 && (
            <RadioGroup value={state.basemapSource} onValueChange={(value) => setState({ basemapSource: value })}>
              {customBasemapSources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-2 min-w-0"
                >
                  <RadioGroupItem value={source.id} id={`basemap-${source.id}`} className="cursor-pointer shrink-0" />
                  <Label htmlFor={`basemap-${source.id}`} className="cursor-pointer flex-1 min-w-0">
                    <CustomSourceDetails source={source} handleFitToBounds={handleFitToBounds} handleEditSource={handleEditBasemap} handleDeleteCustomSource={handleDeleteCustomBasemap} />
                  </Label>
                </div>
              ))}
            </RadioGroup>
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
