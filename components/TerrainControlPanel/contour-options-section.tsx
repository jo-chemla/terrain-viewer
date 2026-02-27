import type React from "react"
import { Section, SliderControl, CheckboxWithSlider } from "./controls-components"
import { Input } from "@/components/ui/input"

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
}> = ({ state, setState, isOpen, onOpenChange }) => {

  if (!state.showContoursAndGraticules) return null

  // ── Contour derived values ─────────────────────────────────────────────
  const currentMinor = Number(state.contourMinor) || 50
  const currentMajor = Number(state.contourMajor) || 200

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
    <Section title="Contours & GeoGrid" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-4">

        <>
          {/* ── Contour Lines ──────────────────────────────────────────── */}
          <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
            Contour Lines (only for TMS terrain, not BYOD COG)
          </h4>
          <CheckboxWithSlider
            id="showContours"
            label="Show Contour Lines"
            checked={state.showContours}
            onCheckedChange={(checked) => setState({ showContours: checked })}
            hideSlider
          />
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
              <SliderControl
                label={`Minor: ${snappedMinor}m`}
                value={minorIndex}
                onChange={(i) => {
                  const newMinor = MINOR_INTERVALS[i]
                  setState({ contourMinor: newMinor, contourMajor: newMinor * currentMajorMultiplier })
                }}
                min={0} max={MINOR_INTERVALS.length - 1} step={1} hideValue
              />
              <SliderControl
                label={`Major: ${snappedMajor}m (${currentMajorMultiplier}×)`}
                value={majorMultiplierIndex}
                onChange={(i) => setState({ contourMajor: snappedMinor * MAJOR_MULTIPLIERS[i] })}
                min={0} max={MAJOR_MULTIPLIERS.length - 1} step={1} hideValue
              />
            </>
          )}
        </>

        {/* ── Graticules ─────────────────────────────────────────────── */}
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground">
          Graticules
        </h4>
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
            <div className="flex gap-3">
              {/* <Input
                type="color"
                value={state.graticuleColor}
                onChange={(e) => setState({ graticuleColor: e.target.value })}
                className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
              /> */}
              <div className="grow">
                <SliderControl
                  label={`Width: ${graticuleWidth}px`}
                  value={graticuleWidth}
                  onChange={(v) => setState({ graticuleWidth: v })}
                  min={0.1} max={3} step={0.1} hideValue
                />
              </div>
            </div>
          </>
        )}

      </div>
    </Section>
  )
}