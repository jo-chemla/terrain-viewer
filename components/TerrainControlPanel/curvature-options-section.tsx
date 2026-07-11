import type React from "react"
import { useCallback, useMemo } from "react"
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { colorRampsClassic, extractStops } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"
import type { CurvatureMode } from "@/lib/curvature-protocol"

const DEFAULTS = {
  curvatureMode: "combined" as CurvatureMode,
  curvatureColorRamp: "curvature-diverging",
  curvatureMin: undefined,
  curvatureMax: undefined,
  curvatureInvertColorRamp: false,
  curvatureSymmetric: true,
}

// defaultMagnitude: each mode's formula has a different typical value scale (Profile's
// extra (1+gradSq)^1.5 denominator term suppresses it well below Combined/Plan; Plan's
// gradSq^1.5 denominator instead spikes near-flat pixels; Det Hessian's r*t product term
// is smaller still) — measured empirically against real DEM tiles at a fixed zoom so
// switching modes lands on a sensible range instead of reusing whichever mode set it last.
// sliderMax/sliderStep: the drag range and granularity of the Curvature Range slider
// itself, not just its starting value — without this, Profile/Det Hessian (typically
// single-digit magnitudes) would share Plan/Combined's 0-100 track and collapse to a
// sliver at the low end, making fine adjustment near their actual working range impossible.
const CURVATURE_MODE_OPTIONS: { value: CurvatureMode; label: string; tooltip: string; defaultMagnitude: number; sliderMax: number; sliderStep: number }[] = [
  {
    value: "profile",
    label: "Profile",
    tooltip: "Rate of slope change along the steepest-descent direction, affects flow acceleration.",
    defaultMagnitude: 5,
    sliderMax: 20,
    sliderStep: 0.1,
  },
  {
    value: "plan",
    label: "Plan (Divergence)",
    tooltip: "Rate of aspect change across contours, affects flow convergence/divergence. Equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|).",
    defaultMagnitude: 20,
    sliderMax: 100,
    sliderStep: 0.5,
  },
  {
    value: "det-hessian",
    label: "Det Hessian",
    tooltip: "Determinant of the Hessian (fxx·fyy − fxy²) — a blob/saddle detector: positive at bowl/dome-shaped extrema, negative at saddle points, near zero on a straight ridge or uniform slope.",
    defaultMagnitude: 5,
    sliderMax: 20,
    sliderStep: 0.1,
  },
  {
    value: "combined",
    label: "Combined",
    tooltip: "General curvature — a combined measure of surface bending (the discrete Laplacian, ∇²z) that doesn't separate flow direction from contour direction.",
    defaultMagnitude: 20,
    sliderMax: 100,
    sliderStep: 0.5,
  },
]

// Fields-only (no Section wrapper/gate) — embedded inside SlopeAndMoreOptionsSection,
// which owns the "Curvature" checkbox that conditionally renders this block underneath it.
export const CurvatureFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.curvatureColorRamp] ?? colorRampsClassic["curvature-diverging"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.curvatureColorRamp])

  // Curvature is diverging around 0 (convex ridges vs. concave valleys) — a symmetric
  // -V..+V range is the natural default, so a single "magnitude" control replaces the
  // usual independent min/max pair unless the user unchecks it below.
  const symmetric = state.curvatureSymmetric ?? true
  const magnitude = Math.max(
    Math.abs(state.curvatureMin ?? rampBounds.min),
    Math.abs(state.curvatureMax ?? rampBounds.max),
  )

  const activeModeOption = CURVATURE_MODE_OPTIONS.find((opt) => opt.value === (state.curvatureMode ?? "combined"))
  const sliderMax = activeModeOption?.sliderMax ?? 100
  const sliderStep = activeModeOption?.sliderStep ?? 1

  // Switching curvature mode also resets the range to that mode's calibrated
  // defaultMagnitude, so the color ramp automatically re-scales to a sensible
  // window instead of staying pinned to whichever mode's range was set last.
  const applyMode = useCallback((value: string) => {
    const opt = CURVATURE_MODE_OPTIONS.find((o) => o.value === value)
    setState({
      curvatureMode: value,
      curvatureMin: opt ? -opt.defaultMagnitude : undefined,
      curvatureMax: opt ? opt.defaultMagnitude : undefined,
    })
  }, [setState])

  const cycleCurvatureMode = useCallback((direction: number) => {
    const currentIndex = CURVATURE_MODE_OPTIONS.findIndex((opt) => opt.value === (state.curvatureMode ?? "combined"))
    const newIndex = (currentIndex + direction + CURVATURE_MODE_OPTIONS.length) % CURVATURE_MODE_OPTIONS.length
    applyMode(CURVATURE_MODE_OPTIONS[newIndex].value)
  }, [state.curvatureMode, applyMode])

  return (
    <div className="space-y-4 pl-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Curvature Type</Label>
        <div className="flex gap-2">
          <Select
            value={state.curvatureMode ?? "combined"}
            onValueChange={applyMode}
          >
            <SelectTrigger className="flex-1 min-w-0 w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURVATURE_MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex border rounded-md shrink-0">
            <Button variant="ghost" size="icon" onClick={() => cycleCurvatureMode(-1)} className="rounded-r-none border-r cursor-pointer">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => cycleCurvatureMode(1)} className="rounded-l-none cursor-pointer">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {CURVATURE_MODE_OPTIONS.find((opt) => opt.value === (state.curvatureMode ?? "combined"))?.tooltip}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Color Ramp</Label>
          <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState(DEFAULTS)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <Select
          value={state.curvatureColorRamp}
          onValueChange={(value) => setState({
            curvatureColorRamp: value,
            curvatureMin: undefined,
            curvatureMax: undefined,
          })}
        >
          <SelectTrigger className="w-full cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(colorRampsClassic).map(([key, ramp]: [string, any]) => (
              <SelectItem key={key} value={key}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-12 h-4 rounded-sm"
                    style={{ background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})` }}
                  />
                  <span>{ramp.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Curvature Range</Label>
          {symmetric ? (
            <DraftBoundInput
              value={magnitude}
              onCommit={(v) => setState({ curvatureMin: -Math.abs(v ?? 0), curvatureMax: Math.abs(v ?? 0) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          ) : (
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.curvatureMin ?? rampBounds.min}
                onCommit={(v) => setState({ curvatureMin: clampMinCommit(v, state.curvatureMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.curvatureMax ?? rampBounds.max}
                onCommit={(v) => setState({ curvatureMax: clampMaxCommit(v, state.curvatureMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          )}
        </div>
        {symmetric ? (
          <MobileSlider
            sliderId="curvature:range"
            min={0}
            max={sliderMax}
            step={sliderStep}
            value={[magnitude]}
            onValueChange={([v]) => setState({ curvatureMin: -v, curvatureMax: v })}
            className="w-full cursor-pointer"
          />
        ) : (
          <MobileSlider
            sliderId="curvature:range"
            min={-sliderMax}
            max={sliderMax}
            step={sliderStep}
            value={[state.curvatureMin ?? rampBounds.min, state.curvatureMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ curvatureMin: Math.min(min, max), curvatureMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="curvature-symmetric"
          checked={symmetric}
          onCheckedChange={(checked) => setState({ curvatureSymmetric: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="curvature-symmetric" className="text-sm font-medium cursor-pointer">
          Symmetric Range
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="curvature-invert-color-ramp"
          checked={state.curvatureInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ curvatureInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="curvature-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
