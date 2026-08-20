import type React from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Info, RotateCcw } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, SliderControl, CheckboxWithSlider, GroupHeading } from "./controls-components"
import { ElevationReferenceToggle } from "./elevation-reference-toggle"
import { ColorAlphaSwatch } from "./color-picker"
import { useTheme } from "@/lib/controls-utils"

const WEIGHT_TOGGLE_ITEM_CLASS = "cursor-pointer px-2 text-xs text-muted-foreground font-normal data-pressed:bg-white data-pressed:font-bold data-pressed:text-foreground"

// ── Contour snap tables ────────────────────────────────────────────────────
const MINOR_INTERVALS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
const MAJOR_MULTIPLIERS = [2, 4, 5, 10, 20, 25, 50, 100]

// ── Graticule density — 0 means "auto" (library default adaptive) ──────────
const DENSITY_VALUES = [0, 0.5, 1, 2, 5, 10, 15, 30, 45]
const densityLabel = (v: number) => v === 0 ? "Auto" : `${v}°`

function nearestIndex(arr: number[], target: number) {
  return arr.reduce((best, v, i) =>
    Math.abs(v - target) < Math.abs(arr[best] - target) ? i : best, 0)
}

export const ContourOptionsSection: React.FC<{
  state: any
  setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mapRef?: React.RefObject<MapRef>
}> = ({ state, setState, isOpen, onOpenChange, mapRef }) => {
  // Both colors are theme-adaptive by default (empty state value). The picker
  // shows that effective default and, once changed, stores an explicit hex that
  // overrides the theme. autoHex mirrors the layers' own auto fallback (contour
  // lines → translucent black/white by theme, grid → themeAntiColor): light →
  // black, dark → white.
  const { theme } = useTheme()
  const autoHex = theme === "dark" ? "#ffffff" : "#000000"

  if (!state.showContoursAndGraticules) return null

  // Plain render function (not a nested component rendered as <ColorRow/>) so it
  // doesn't remount on every parent render — that would close the native color
  // dialog mid-pick.
  const colorRow = (label: string, stateKey: string) => (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-1">
        {state[stateKey] && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 cursor-pointer"
                  aria-label="Reset to theme default"
                  onClick={() => setState({ [stateKey]: "" })}
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              }
            />
            <TooltipContent><p>Reset to theme default</p></TooltipContent>
          </Tooltip>
        )}
        <ColorAlphaSwatch
          title={label}
          color={state[stateKey] || autoHex}
          onChange={(hex) => setState({ [stateKey]: hex })}
          className="rounded"
        />
      </div>
    </div>
  )

  // ── Contour derived values ─────────────────────────────────────────────
  // Absolute and LRM keep independent minor/major intervals (same reasoning
  // as Plane Slicer's planeSlicerValue/planeSlicerValueLrm split) — LRM's
  // natural range is much narrower than real elevation's, so switching modes
  // reads/writes a different pair of fields rather than dragging one
  // interval across both scales.
  const isLrm = state.contourReferenceMode === "lrm"
  const minorField = isLrm ? "contourMinorLrm" : "contourMinor"
  const majorField = isLrm ? "contourMajorLrm" : "contourMajor"
  const currentMinor = Number(state[minorField]) || (isLrm ? 5 : 50)
  const currentMajor = Number(state[majorField]) || (isLrm ? 20 : 200)

  const minorIndex = MINOR_INTERVALS.reduce((best, v, i) =>
    Math.abs(v - currentMinor) < Math.abs(MINOR_INTERVALS[best] - currentMinor) ? i : best, 0)

  const snappedMinor = MINOR_INTERVALS[minorIndex]
  const currentMultiplier = snappedMinor > 0 ? currentMajor / snappedMinor : 5
  const majorMultiplierIndex = MAJOR_MULTIPLIERS.reduce((best, v, i) =>
    Math.abs(v - currentMultiplier) < Math.abs(MAJOR_MULTIPLIERS[best] - currentMultiplier) ? i : best, 0)
  const currentMajorMultiplier = MAJOR_MULTIPLIERS[majorMultiplierIndex]
  const snappedMajor = snappedMinor * currentMajorMultiplier

  // ── Graticule derived values ───────────────────────────────────────────
  const densityIndex = nearestIndex(DENSITY_VALUES, Number(state.graticuleDensity) || 0)
  const graticuleWidth = Number(state.graticuleWidth) || 1

  return (
    <Section id="tour-contour-section" title="Contours & GeoGrid" isOpen={isOpen} onOpenChange={onOpenChange} pulseKey="showContoursAndGraticules">
      <div className="space-y-4">

        <div className="space-y-2">
          {/* ── Contour Lines ──────────────────────────────────────────── */}
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="inline-flex items-center gap-1 cursor-help">
                  <GroupHeading>Contours</GroupHeading>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </div>
              }
            />
            <TooltipContent><p>Only for TMS terrain, not BYOD COG</p></TooltipContent>
          </Tooltip>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="showContours"
                checked={state.showContours}
                onCheckedChange={(checked) => setState({ showContours: checked })}
                className="cursor-pointer"
              />
              <Label htmlFor="showContours" className="text-sm cursor-pointer">Show Contour Lines</Label>
            </div>
            <ToggleGroup
              value={[String(Number(state.contourWeight) || 1)]}
              onValueChange={([value]) => value && setState({ contourWeight: Number(value) })}
              disabled={!state.showContours}
              className="border rounded-md"
            >
              <ToggleGroupItem value="1" className={WEIGHT_TOGGLE_ITEM_CLASS}>1×</ToggleGroupItem>
              <ToggleGroupItem value="2" className={WEIGHT_TOGGLE_ITEM_CLASS}>2×</ToggleGroupItem>
              <ToggleGroupItem value="4" className={WEIGHT_TOGGLE_ITEM_CLASS}>4×</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {state.showContours && (
            <>
              <CheckboxWithSlider
                id="showContourLabels"
                label="Show Contour Labels"
                checked={state.showContourLabels}
                // disabled
                onCheckedChange={(checked) => setState({ showContourLabels: checked })}
                hideSlider
              />
              {/* Switches which DEM the contour lines themselves trace —
                  iso-altitude (Absolute) vs iso-relief (LRM), see
                  ContoursLayer.tsx. Not supported for a "Bring Your Own
                  Data" local COG source (no LRM path wired for that source
                  type yet) — picking LRM there silently keeps tracing
                  absolute elevation. */}
              <ElevationReferenceToggle
                value={state.contourReferenceMode}
                onChange={(v) => setState({ contourReferenceMode: v })}
              />
              <SliderControl
                label={`Minor: ${snappedMinor}m`}
                value={minorIndex}
                onChange={(i) => {
                  const newMinor = MINOR_INTERVALS[i]
                  setState({ [minorField]: newMinor, [majorField]: newMinor * currentMajorMultiplier })
                }}
                min={0} max={MINOR_INTERVALS.length - 1} step={1} hideValue
              />
              <SliderControl
                label={`Major: ${snappedMajor}m (${currentMajorMultiplier}×)`}
                value={majorMultiplierIndex}
                onChange={(i) => setState({ [majorField]: snappedMinor * MAJOR_MULTIPLIERS[i] })}
                min={0} max={MAJOR_MULTIPLIERS.length - 1} step={1} hideValue
              />
              {colorRow("Line Color", "contourColor")}
            </>
          )}
        </div>

        <div className="space-y-2">
          {/* ── Graticules ─────────────────────────────────────────────── */}
          <GroupHeading>Geogrid / Graticule</GroupHeading>
          <CheckboxWithSlider
            id="showGraticules"
            label="Show GeoGrid / Graticules"
            checked={state.showGraticules}
            onCheckedChange={(checked) => setState({ showGraticules: checked })}
            hideSlider
          />
          {state.showGraticules && (
            <>
              <CheckboxWithSlider
                id="showGraticuleLabels"
                label="Show Geogrid Labels (north-up only)"
                checked={state.showGraticuleLabels}
                // disabled
                onCheckedChange={(checked) => setState({ showGraticuleLabels: checked })}
                hideSlider
              />
              <SliderControl
                label={`Density: ${densityLabel(DENSITY_VALUES[densityIndex])}`}
                value={densityIndex}
                onChange={(i) => setState({ graticuleDensity: DENSITY_VALUES[i] })}
                min={0} max={DENSITY_VALUES.length - 1} step={1} hideValue
              />
              <SliderControl
                label={`Width: ${graticuleWidth}px`}
                value={graticuleWidth}
                onChange={(v) => setState({ graticuleWidth: v })}
                min={0.1} max={3} step={0.1} hideValue
              />
              {colorRow("Grid Color", "graticuleColor")}
            </>
          )}
        </div>

      </div>
    </Section>
  )
}