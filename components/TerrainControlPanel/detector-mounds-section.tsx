import type React from "react"
import { useCallback } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, CycleButtonGroup } from "./controls-components"
import { TellsFields } from "./tells-options-section"

const TELLS_STYLE_OPTIONS = [
  { value: "hidden", label: "Hidden" },
  { value: "purple", label: "Purple Fill" },
  { value: "outline", label: "Red Outline" },
  { value: "byBlobness", label: "Color by Blobness" },
  { value: "byPlan", label: "Color by Plan Curvature" },
  { value: "byDetHessian", label: "Color by Det-Hessian" },
  { value: "byLrm", label: "Color by LRM Relief" },
]
const TELLS_STYLE_KEYS = TELLS_STYLE_OPTIONS.map(({ value }) => value)

// Standalone panel for the experimental archaeological mound detector — split out
// of SlopeAndMoreOptionsSection (which it used to live inside of as a sub-mode)
// since it isn't a terrain-derivative visualization like the others in that
// section, but its own detector with a distinct settings surface (size, veto
// thresholds, resolution, export). Gated behind state.tellsBeta (a nuqs param,
// so a project/embed URL can turn it on directly) — renders nothing at all
// unless that beta flag is on.
export const DetectorMoundsSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  // Actual tile grid size of the active terrain source (256/512, from its
  // maplibre source config) — used by TellsFields to display an accurate
  // meters-equivalent for the smoothing radius, instead of assuming 256.
  terrainTileSize: number
  // Threaded through to TellsFields' GeoJSON export button, which reads
  // already-loaded vector tiles straight from the live map instance.
  mapRef?: React.RefObject<MapRef>
}> = ({ state, setState, isOpen, onOpenChange, terrainTileSize, mapRef }) => {
  const cycleTellsStyle = useCallback((direction: number) => {
    const currentIndex = TELLS_STYLE_KEYS.indexOf(state.tellsStyle)
    const newIndex = (currentIndex + direction + TELLS_STYLE_KEYS.length) % TELLS_STYLE_KEYS.length
    setState({ tellsStyle: TELLS_STYLE_KEYS[newIndex] })
  }, [state.tellsStyle, setState])
  if (!state.tellsBeta) return null

  return (
    <Section title="Detector: Mound Candidates" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Label className="text-sm cursor-default">Tells (Mound Candidates)</Label>
          </TooltipTrigger>
          <TooltipContent>
            <p>Experimental archaeological mound detector: local maxima of a Difference-of-Gaussians relief signal, filtered by blobness/curvature to reject ridges and saddles. Cycle Hidden / Purple Fill / Red Outline / Color-by-Blobness / Color-by-Plan / Color-by-Det-Hessian / Color-by-LRM — hiding never discards already-computed detections, so reactivating is instant.</p>
          </TooltipContent>
        </Tooltip>
        <CycleButtonGroup
          value={state.tellsStyle}
          options={TELLS_STYLE_OPTIONS}
          onChange={(v) => setState({ tellsStyle: v })}
          onCycle={cycleTellsStyle}
        />
        <TellsFields state={state} setState={setState} tileSize={terrainTileSize} mapRef={mapRef} />
      </div>
    </Section>
  )
}
