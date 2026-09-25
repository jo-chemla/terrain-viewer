import type React from "react"
import { useCallback } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Section, CycleButtonGroup, SegmentedToggle } from "./controls-components"
import { TellsFields } from "./tells-options-section"
import { ColorAlphaSwatch } from "./color-picker"

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
            Show candidates
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Experimental archaeological mound detector: local maxima of a Difference-
          of-Gaussians relief signal, filtered by blobness/curvature to reject
          ridges and saddles. Minima of the same signal are pits.
        </p>
        <div className="flex items-center gap-2">
        <Label className="text-sm shrink-0 w-20">Type</Label>
        <SegmentedToggle
          className="flex-1"
          value={(state.tellsPolarity ?? "mounds") as "mounds" | "pits" | "both"}
          onChange={(v) => setState({ tellsPolarity: v })}
          options={[
            { value: "mounds", label: "Mounds", tooltip: "Local maxima of the relief: tells, tumuli, platform mounds" },
            { value: "pits", label: "Pits", tooltip: "Local minima: quarries, sinkholes, craters, cisterns, robbed-out tombs" },
            { value: "both", label: "Both", tooltip: "Mounds in the outline colour, pits in the pit colour" },
          ]}
        />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm shrink-0 w-20">Detections</Label>
          <SegmentedToggle
            className="flex-1"
            value={state.tellsFrozen === true ? "frozen" : "live"}
            onChange={(v) => setState({ tellsFrozen: v === "frozen" })}
            options={[
              { value: "live", label: "Live", tooltip: "Detections refresh as you pan and zoom" },
              { value: "frozen", label: "Frozen", tooltip: "Detections pinned: panning and zooming won't refresh them" },
            ]}
          />
        </div>
        <CycleButtonGroup
          value={state.tellsStyle}
          options={TELLS_STYLE_OPTIONS}
          onChange={(v) => setState({ tellsStyle: v })}
          onCycle={cycleTellsStyle}
          middle={state.tellsStyle === "outline" ? (
            <div className="flex items-center gap-1">
              {state.tellsPolarity !== "pits" && (
                <ColorAlphaSwatch
                  title="Mound outline color — red by default; white or black read better over some ramps."
                  color={state.tellsOutlineColor}
                  onChange={(hex) => setState({ tellsOutlineColor: hex })}
                  size="h-7 w-7"
                  className="rounded"
                />
              )}
              {state.tellsPolarity !== "mounds" && (
                <ColorAlphaSwatch
                  title="Pit outline color — blue by default."
                  color={state.tellsPitColor ?? "#3b82f6"}
                  onChange={(hex) => setState({ tellsPitColor: hex })}
                  size="h-7 w-7"
                  className="rounded"
                />
              )}
            </div>
          ) : undefined}
        />
        <TellsFields state={state} setState={setState} tileSize={terrainTileSize} mapRef={mapRef} />
      </div>
    </Section>
  )
}
