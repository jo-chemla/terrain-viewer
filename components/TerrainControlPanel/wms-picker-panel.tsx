import type React from "react"
import { useState, useCallback } from "react"
import { Plus, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { fetchWmsService, buildWmsTileUrl, type WmsServiceInfo, type FlatWmsLayer } from "@/lib/wms-client"

export interface WmsPickerSaveParams {
  name: string
  url: string
  description?: string
  bounds?: [west: number, south: number, east: number, north: number]
}

/**
 * Inline panel that fetches a WMS service's GetCapabilities document (via
 * @loaders.gl/wms) and lists its layers, so users pick a layer instead of
 * hand-building a GetMap URL — embedded inside CustomBasemapModal /
 * CustomTerrainSourceModal as one of the "Add Source" type options, following the
 * same pattern as NextGisQmsSearchPanel.
 */
export const WmsPickerPanel: React.FC<{
  /** GetMap format to request — 'image/png' for basemap raster, 'image/geotiff' for
   *  raw-elevation terrain sources decoded by float32demProtocol. */
  format?: string
  tileSize?: number
  onSave: (params: WmsPickerSaveParams) => void
}> = ({ format = "image/png", tileSize = 256, onSave }) => {
  const [baseUrl, setBaseUrl] = useState("")
  const [service, setService] = useState<WmsServiceInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [layerFilter, setLayerFilter] = useState("")

  const handleFetchLayers = useCallback(async () => {
    if (!baseUrl.trim()) return
    setIsLoading(true)
    setError("")
    setService(null)
    try {
      const info = await fetchWmsService(baseUrl.trim())
      if (!info.layers.length) throw new Error("No renderable layers found in this service's capabilities")
      setService(info)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch WMS capabilities")
    } finally {
      setIsLoading(false)
    }
  }, [baseUrl])

  const handlePick = useCallback((layer: FlatWmsLayer) => {
    if (!service) return
    const url = buildWmsTileUrl({ source: service.source, layerName: layer.name, tileSize, format })
    const bbox = layer.geographicBoundingBox
    const bounds: WmsPickerSaveParams["bounds"] = bbox
      ? [bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]]
      : undefined
    onSave({ name: layer.title, url, description: service.capabilities.title, bounds })
  }, [service, tileSize, format, onSave])

  const filterQuery = layerFilter.trim().toLowerCase()
  const filteredLayers = service
    ? service.layers.filter((layer) => !filterQuery
        || layer.title.toLowerCase().includes(filterQuery)
        || layer.name.toLowerCase().includes(filterQuery))
    : []

  return (
    <div className="space-y-3 w-full min-w-0 overflow-hidden">
      <p className="text-xs text-muted-foreground">
        Enter a WMS service's base URL to list its layers and build the tile URL automatically.
      </p>

      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder="https://example.com/geoserver/wms"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleFetchLayers() }}
          className="cursor-text"
        />
        <Button
          onClick={handleFetchLayers}
          disabled={isLoading || !baseUrl.trim()}
          className="cursor-pointer shrink-0"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "List Layers"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {service && (
        <div className="space-y-2 w-full min-w-0">
          <Input
            placeholder={`Filter ${service.layers.length} layers…`}
            value={layerFilter}
            onChange={(e) => setLayerFilter(e.target.value)}
            className="cursor-text"
          />
          <div className="max-h-72 w-full overflow-y-auto overflow-x-hidden space-y-1">
            {filteredLayers.map((layer) => (
              <div
                key={layer.name}
                className="grid grid-cols-[1fr_auto] items-center gap-2 p-2 rounded-md hover:bg-muted/60 w-full"
              >
                <div className="min-w-0 overflow-hidden">
                  <p className="text-sm font-medium truncate" title={layer.title}>{layer.title}</p>
                  <p className="text-xs text-muted-foreground truncate" title={layer.name}>{layer.name}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => handlePick(layer)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {filteredLayers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No layers match "{layerFilter}"</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
