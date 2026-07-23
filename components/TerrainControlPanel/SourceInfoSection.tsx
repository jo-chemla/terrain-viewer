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

export const SourceInfoSection: React.FC<{
  state: any
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, mapRef, isOpen, onOpenChange }) => {
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
    </Section>
  )
}
