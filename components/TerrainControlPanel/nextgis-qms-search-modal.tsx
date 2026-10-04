import type React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
import { Search, Plus, Loader2, ExternalLink } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type CustomBasemapSource } from "@/lib/settings-atoms"

import { QMS_API, QMS_SUPPORTED_TYPES as SUPPORTED_TYPES, qmsDetailToBasemap, type QmsSearchResult, type QmsDetail } from "@/lib/qms"

/**
 * Inline search panel for the NextGIS Quick Map Services catalog — embedded inside
 * CustomBasemapModal as one of the "Add Basemap" type options (alongside TMS/COG/WMS)
 * rather than a separate standalone dialog.
 */
export const NextGisQmsSearchPanel: React.FC<{
  onSave: (source: Omit<CustomBasemapSource, "id">) => void
}> = ({ onSave }) => {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<QmsSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addingId, setAddingId] = useState<number | string | null>(null)
  const [error, setError] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      setError("")
      try {
        const res = await fetch(`${QMS_API}?search=${encodeURIComponent(query)}&limit=20`)
        if (!res.ok) throw new Error(`QMS search failed (${res.status})`)
        const data = await res.json()
        setResults((data.results ?? []).filter((r: QmsSearchResult) => SUPPORTED_TYPES.has(r.type)))
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed")
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const handleAdd = useCallback(async (result: QmsSearchResult) => {
    setAddingId(result.id)
    setError("")
    try {
      const res = await fetch(`${QMS_API}${result.id}/`)
      if (!res.ok) throw new Error(`Failed to fetch service details (${res.status})`)
      const detail: QmsDetail = await res.json()
      onSave(qmsDetailToBasemap(detail))
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
        <a href="https://qms.nextgis.com/" target="_blank" rel="noopener noreferrer" className="underline">
          NextGIS Quick Map Services
        </a>{" "}
        catalog and add a basemap directly.
      </p>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Search e.g. satellite, OpenStreetMap, cadastre..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 cursor-text"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="max-h-72 overflow-y-auto overflow-x-hidden space-y-1">
        {isSearching && (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching…
          </div>
        )}
        {!isSearching && query.trim() && results.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-4 text-center">No matching TMS/WMS services found</p>
        )}
        {results.map((r) => (
          <div key={r.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 max-w-full">
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-sm font-medium truncate" title={r.name}>{r.name}</p>
              <p className="text-xs text-muted-foreground truncate" title={r.desc}>
                {r.type.toUpperCase()} {r.desc && `— ${r.desc}`}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={`https://qms.nextgis.com/geoservices/${r.id}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="View on qms.nextgis.com"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                }
              />
              <TooltipContent><p>View on qms.nextgis.com</p></TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 cursor-pointer"
              disabled={addingId === r.id}
              onClick={() => handleAdd(r)}
            >
              {addingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
