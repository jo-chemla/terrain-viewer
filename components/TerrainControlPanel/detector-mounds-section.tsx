import type React from "react"
import { useCallback } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, CycleButtonGroup } from "./controls-components"
import { TellsFields } from "./tells-options-section"

// "hidden" is deliberately NOT an option here — visibility is the topmost
// checkbox below (and the Tells toggle in Visualization Modes), not a style.
const TELLS_STYLE_OPTIONS = [
  { value: "outline", label: "Outline" },
  { value: "byLrm", label: "Color by LRM Relief" },
  { value: "byPlan", label: "Color by Plan Curvature" },
  { value: "byBlobness", label: "Color by Blobness" },
  { value: "byDetHessian", label: "Color by Det-Hessian" },
]
const TELLS_STYLE_KEYS = TELLS_STYLE_OPTIONS.map(({ value }) => value)

// Standalone panel for the experimental archaeological mound detector — split out
// of what's now TerrainAnalysisOptionsSection (which it used to live inside of as
// a sub-mode) since it isn't a terrain-derivative visualization like the others in
// that section, but its own detector with a distinct settings surface (size, veto
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
    <Section title="Mound Candidates" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={false}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {/* Pure paint-visibility toggle (tellsMarkersVisible) — deliberately
              independent of showTellsDetector (Visualization Modes' master
              switch, which gates this whole section): unchecking this only
              hides the already-computed markers, it never also collapses
              the section or unchecks the Viz Modes checkbox. */}
          <Checkbox
            id="tells-show-markers"
            checked={state.tellsMarkersVisible}
            onCheckedChange={(checked) => setState({ tellsMarkersVisible: checked === true })}
          />
          <Label htmlFor="tells-show-markers" className="text-sm cursor-pointer">
            Show mound candidates
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Experimental archaeological mound detector: local maxima of a Difference-
          of-Gaussians relief signal, filtered by blobness/curvature to reject
          ridges and saddles.
        </p>
        <CycleButtonGroup
          value={state.tellsStyle}
          options={TELLS_STYLE_OPTIONS}
          onChange={(v) => setState({ tellsStyle: v })}
          onCycle={cycleTellsStyle}
          middle={state.tellsStyle === "outline" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <input
                  type="color"
                  aria-label="Outline color"
                  value={state.tellsOutlineColor}
                  onChange={(e) => setState({ tellsOutlineColor: e.target.value })}
                  className="h-8 w-9 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
                />
              </TooltipTrigger>
              <TooltipContent><p>Outline color — red by default; white or black read better over some ramps.</p></TooltipContent>
            </Tooltip>
          ) : undefined}
        />
        <TellsFields state={state} setState={setState} tileSize={terrainTileSize} mapRef={mapRef} />
      </div>
    </Section>
  )
}
