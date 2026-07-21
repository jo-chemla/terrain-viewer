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
  localDominanceColorRamp: "local-dominance-default",
  localDominanceMin: undefined,
  localDominanceMax: undefined,
  localDominanceInvertColorRamp: false,
  localDominanceMinRadius: 10,
  localDominanceMaxRadius: 20,
}

// Fields-only (no Section wrapper/gate) — embedded inside ReliefVisualizationOptionsSection,
// which owns the "Local Dominance" checkbox that conditionally renders this block
// underneath it. Same shape as SvfFields, but with a [min,max] radius annulus
// (Local Dominance averages downward view angles over a ring of distances, so it
// takes two radii rather than SVF/Openness's single search radius) — see
// lib/local-dominance-protocol.ts.
export const LocalDominanceFields: React.FC<{
  state: any; setState: (updates: any) => void
  tileSize?: number
}> = ({ state, setState, tileSize = 256 }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.localDominanceColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["local-dominance-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.localDominanceColorRamp])

  const minRadius = state.localDominanceMinRadius ?? DEFAULTS.localDominanceMinRadius
  const maxRadius = state.localDominanceMaxRadius ?? DEFAULTS.localDominanceMaxRadius
  const resM = groundResolutionM(state.lat ?? 0, state.zoom ?? 0, tileSize)

  // Min/max radii commit together so the inner edge can never cross the outer
  // one (a maxRadius ≤ minRadius annulus would sample nothing). Clamped to a
  // 2..48 px window — enough spread for a meaningful "dominance over the region"
  // read without an unreasonably large per-pixel ray-march.
  const setRadii = (lo: number, hi: number) =>
    setState({ localDominanceMinRadius: Math.min(lo, hi), localDominanceMaxRadius: Math.max(lo, hi) })

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
          value={state.localDominanceColorRamp}
          onValueChange={(value) => setState({
            localDominanceColorRamp: value,
            localDominanceMin: undefined,
            localDominanceMax: undefined,
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
          <Label className="text-sm font-medium">Radius Annulus (px)</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">≈ {formatMeters(minRadius * resM)}–{formatMeters(maxRadius * resM)}</span>
            <DraftBoundInput
              value={minRadius}
              onCommit={(v) => setRadii(Math.min(48, Math.max(2, Math.round(v ?? DEFAULTS.localDominanceMinRadius))), maxRadius)}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <DraftBoundInput
              value={maxRadius}
              onCommit={(v) => setRadii(minRadius, Math.min(48, Math.max(2, Math.round(v ?? DEFAULTS.localDominanceMaxRadius))))}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="local-dominance:radius"
          min={2}
          max={48}
          step={1}
          value={[minRadius, maxRadius]}
          onValueChange={([lo, hi]) => setRadii(lo, hi)}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Local Dominance Range (°)</Label>
          <div className="flex items-center gap-2">
            <DraftBoundInput
              value={state.localDominanceMin ?? rampBounds.min}
              onCommit={(v) => setState({ localDominanceMin: clampMinCommit(v, state.localDominanceMax ?? rampBounds.max) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <DraftBoundInput
              value={state.localDominanceMax ?? rampBounds.max}
              onCommit={(v) => setState({ localDominanceMax: clampMaxCommit(v, state.localDominanceMin ?? rampBounds.min) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="local-dominance:range"
          min={-30}
          max={30}
          step={0.5}
          value={[state.localDominanceMin ?? rampBounds.min, state.localDominanceMax ?? rampBounds.max]}
          onValueChange={([min, max]) => setState({ localDominanceMin: Math.min(min, max), localDominanceMax: Math.max(min, max) })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="local-dominance-invert-color-ramp"
          checked={state.localDominanceInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ localDominanceInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="local-dominance-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
