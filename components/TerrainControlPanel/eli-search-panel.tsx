import type React from "react"
import { useState, useMemo, useCallback } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Search, Plus, Loader2, ExternalLink, Star } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getLayers, layersInViewport, getLayerHydrated, getRasterSourceSpec, type EliLocatorLayer } from "@osm-editor-kit/maplibre-editor-layer-index"
import { type CustomBasemapSource } from "@/lib/settings-atoms"

// The OSM Editor Layer Index (osmlab/editor-layer-index) is the imagery
// catalogue behind iD, JOSM and Rapid: ~1,500 aerial, map and historic
// sources, most of them national or regional agency services with their
// licence recorded. @osm-editor-kit/maplibre-editor-layer-index ships it
// pre-converted to maplibre raster sources (TMS {zoom}->{z}, {-y}->scheme
// tms, WMS {bbox}->{bbox-epsg-3857}) with a slim always-loaded locator and
// lazily fetched per-continent tile URLs, so this panel is mostly a filter
// over that list plus the same onSave shape the NextGIS QMS panel produces.
const CATEGORY_LABEL: Record<string, string> = {
  photo: "Aerial", map: "Map", historicmap: "Historic map", osmbasedmap: "OSM-based", historicphoto: "Historic aerial",
  qa: "QA", elevation: "Elevation", other: "Other",
}

export const EliSearchPanel: React.FC<{
  onSave: (source: Omit<CustomBasemapSource, "id">) => void
  mapRef?: React.RefObject<MapRef | null>
}> = ({ onSave, mapRef }) => {
  const [query, setQuery] = useState("")
  const [viewportOnly, setViewportOnly] = useState(true)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState("")

  // Permalink into the ELI browser: same view, the layer's category panel
  // open, the layer selected.
  const browserLink = useCallback((r: EliLocatorLayer) => {
    const map = mapRef?.current?.getMap()
    const c = map?.getCenter()
    const q = new URLSearchParams()
    if (c) { q.set("lat", c.lat.toFixed(4)); q.set("lng", c.lng.toFixed(4)); q.set("zoom", (map!.getZoom()).toFixed(2)) }
    q.set("open", r.category ?? "photo")
    q.set("selected", r.id)
    return `https://osm-editor-kit.github.io/maplibre-editor-layer-index/react-map-gl?${q}`
  }, [mapRef])
  // The index records no ground resolution, only a max zoom: the ground
  // size of one pixel at that zoom, at the current latitude, is the closest
  // thing to a GSD it can offer.
  const gsdAt = useCallback((r: EliLocatorLayer) => {
    if (r.maxzoom === undefined) return null
    const lat = mapRef?.current?.getMap()?.getCenter().lat ?? 0
    const m = 40075016.686 * Math.cos((lat * Math.PI) / 180) / ((r.tileSize || 256) * 2 ** r.maxzoom)
    return `z${r.maxzoom} ≈ ${m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(m < 10 ? 1 : 0)} m`}/px`
  }, [mapRef])

  const results = useMemo(() => {
    const map = mapRef?.current?.getMap()
    let rows: EliLocatorLayer[]
    if (viewportOnly && map) {
      // Pure bbox overlap; worldwide layers always pass. A layer with a huge
      // bbox but small real coverage can over-match (the package documents
      // US TIGER as the classic case) - the name filter below usually clears it.
      rows = layersInViewport(map.getBounds(), { includeWorldwide: true })
    } else {
      rows = getLayers()
    }
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q) || l.countryCodes.some((c) => c.toLowerCase() === q))
    // "best" (the editor's recommended imagery for the area) first, then
    // aerial photos, then everything else alphabetically.
    const rank = (l: EliLocatorLayer) => (l.best ? 0 : 1) * 10 + (l.category === "photo" ? 0 : 1)
    return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 80)
  }, [query, viewportOnly, mapRef])

  const handleAdd = useCallback(async (row: EliLocatorLayer) => {
    setAddingId(row.id)
    setError("")
    try {
      const layer = await getLayerHydrated(row.id)
      if (!layer) throw new Error("This layer's tile URLs could not be loaded")
      const spec = getRasterSourceSpec(layer)
      if (!spec.tiles.length) throw new Error("This layer has no tile URL")
      onSave({
        name: layer.name,
        url: spec.tiles[0],
        type: "tms",
        scheme: spec.scheme ?? "xyz",
        minzoom: spec.minzoom,
        maxzoom: spec.maxzoom,
        role: layer.overlay ? "overlay" : "basemap",
        description: `OSM Editor Layer Index id ${layer.id}${layer.startDate || layer.endDate ? ` (${layer.startDate ?? "?"} – ${layer.endDate ?? "?"})` : ""}`,
        attribution: layer.attributionText || undefined,
        licenseUrl: layer.licenseUrl || undefined,
        infoUrl: layer.attributionUrl || "https://osm-editor-kit.github.io/maplibre-editor-layer-index/",
        provider: "eli",
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add basemap")
    } finally {
      setAddingId(null)
    }
  }, [onSave])

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-muted-foreground">
        Search the{" "}
        <a href="https://github.com/osmlab/editor-layer-index" target="_blank" rel="noopener noreferrer" className="underline">
          OSM Editor Layer Index
        </a>
        , the imagery catalogue behind iD and JOSM: agency aerials, historic maps and more, each with its licence.
        Browse it on a map in the{" "}
        <a href="https://osm-editor-kit.github.io/maplibre-editor-layer-index/" target="_blank" rel="noopener noreferrer" className="underline">
          ELI browser
        </a>
        .
      </p>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Filter by name, id or country code (e.g. FR)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 cursor-text"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox id="eli-viewport-only" checked={viewportOnly} onCheckedChange={(v) => setViewportOnly(v === true)} className="cursor-pointer" />
          <Label htmlFor="eli-viewport-only" className="text-xs cursor-pointer">Only layers whose footprint touches the current view</Label>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 inline-flex items-center gap-1"><Star className="h-3 w-3 text-amber-500" /> = the index's pick for its area</span>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="max-h-72 overflow-y-auto overflow-x-hidden space-y-1">
        {results.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">No matching layers{viewportOnly ? " here — untick the view filter to search everywhere" : ""}</p>
        )}
        {results.map((r) => {
          const needsKey = r.requiresKeys.length > 0
          return (
            <div key={r.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 max-w-full">
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="text-sm truncate flex items-center gap-1">
                  {r.best && <Star className="h-3 w-3 shrink-0 text-amber-500" aria-label="Recommended for this area" />}
                  <span className="truncate">{r.name}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[CATEGORY_LABEL[r.category ?? "other"], r.type.toUpperCase(), gsdAt(r), r.overlay ? "overlay" : null, r.countryCodes.slice(0, 3).join(", ") || "worldwide", needsKey ? "needs an API key" : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <a href={browserLink(r)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  }
                />
                <TooltipContent><p>Open this layer in the Editor Layer Index browser, at this view</p></TooltipContent>
              </Tooltip>
              <Button size="sm" variant="outline" className="cursor-pointer shrink-0" disabled={addingId === r.id || needsKey} onClick={() => handleAdd(r)}>
                {addingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
