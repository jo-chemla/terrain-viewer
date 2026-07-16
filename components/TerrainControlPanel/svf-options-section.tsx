import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { colorRampsClassic, extractStops } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"
import { groundResolutionM } from "@/lib/normal-derived-protocol"

function formatMeters(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

const DEFAULTS = {
  svfColorRamp: "svf-default",
  svfMin: undefined,
  svfMax: undefined,
  svfInvertColorRamp: false,
  svfRadius: 8,
}

// Fields-only (no Section wrapper/gate) — embedded inside ReliefVisualizationOptionsSection,
// which owns the "Sky View Factor" checkbox that conditionally renders this block
// underneath it.
export const SvfFields: React.FC<{
  state: any; setState: (updates: any) => void
  // Actual tile grid size (256/512) of the active terrain source's maplibre
  // source config — used to display an accurate meters-equivalent for the
  // search radius, same reasoning as LrmFields.
  tileSize?: number
}> = ({ state, setState, tileSize = 256 }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.svfColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["svf-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.svfColorRamp])

  // Bare same-zoom pixel count (unlike LRM's radius, which maps to a coarser
  // pyramid level) — see lib/svf-protocol.ts for why: SVF needs the true local
  // elevation profile, not a smoothed ancestor tile.
  const radiusPx = state.svfRadius ?? DEFAULTS.svfRadius
  const radiusMeters = radiusPx * groundResolutionM(state.lat ?? 0, state.zoom ?? 0, tileSize)

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
          value={state.svfColorRamp}
          onValueChange={(value) => setState({
            svfColorRamp: value,
            svfMin: undefined,
            svfMax: undefined,
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
          <Label className="text-sm font-medium">Search Radius (px)</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">≈ {formatMeters(radiusMeters)}</span>
            <DraftBoundInput
              value={radiusPx}
              onCommit={(v) => setState({ svfRadius: Math.min(32, Math.max(2, Math.round(v ?? DEFAULTS.svfRadius))) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="svf:radius"
          min={2}
          max={32}
          step={1}
          value={[radiusPx]}
          onValueChange={([v]) => setState({ svfRadius: v })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Sky View Factor Range</Label>
          <div className="flex items-center gap-2">
            <DraftBoundInput
              value={state.svfMin ?? rampBounds.min}
              onCommit={(v) => setState({ svfMin: clampMinCommit(v, state.svfMax ?? rampBounds.max) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <DraftBoundInput
              value={state.svfMax ?? rampBounds.max}
              onCommit={(v) => setState({ svfMax: clampMaxCommit(v, state.svfMin ?? rampBounds.min) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="svf:range"
          min={0}
          max={100}
          step={1}
          value={[state.svfMin ?? rampBounds.min, state.svfMax ?? rampBounds.max]}
          onValueChange={([min, max]) => setState({ svfMin: Math.min(min, max), svfMax: Math.max(min, max) })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="svf-invert-color-ramp"
          checked={state.svfInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ svfInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="svf-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
