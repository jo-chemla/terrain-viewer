import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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

const CURVATURE_MODE_OPTIONS: { value: CurvatureMode; label: string; tooltip: string }[] = [
  {
    value: "combined",
    label: "Combined",
    tooltip: "General curvature — a combined measure of surface bending (the discrete Laplacian, ∇²z) that doesn't separate flow direction from contour direction.",
  },
  {
    value: "profile",
    label: "Profile",
    tooltip: "Rate of slope change along the steepest-descent direction, affects flow acceleration.",
  },
  {
    value: "plan",
    label: "Plan",
    tooltip: "Rate of aspect change across contours, affects flow convergence/divergence. Equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|).",
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

  return (
    <div className="space-y-4 pl-6">
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
        <Label className="text-sm font-medium">Curvature Type</Label>
        <div className="flex border rounded-md overflow-hidden">
          {CURVATURE_MODE_OPTIONS.map((opt, i) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={(state.curvatureMode ?? "combined") === opt.value ? "default" : "ghost"}
                  size="sm"
                  className={`flex-1 rounded-none cursor-pointer h-8 text-xs ${i > 0 ? "border-l" : ""}`}
                  onClick={() => setState({ curvatureMode: opt.value })}
                >
                  {opt.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{opt.tooltip}</p></TooltipContent>
            </Tooltip>
          ))}
        </div>
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
            max={100}
            step={1}
            value={[magnitude]}
            onValueChange={([v]) => setState({ curvatureMin: -v, curvatureMax: v })}
            className="w-full cursor-pointer"
          />
        ) : (
          <MobileSlider
            sliderId="curvature:range"
            min={-100}
            max={100}
            step={1}
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
