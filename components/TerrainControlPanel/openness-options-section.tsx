import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { colorRampsClassic, extractStops } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"
import { groundResolutionM } from "@/lib/normal-derived-protocol"
import type { OpennessMode } from "@/lib/openness-protocol"

function formatMeters(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

const DEFAULTS = {
  opennessMode: "positive" as OpennessMode,
  opennessColorRamp: "openness-default",
  opennessMin: undefined,
  opennessMax: undefined,
  opennessInvertColorRamp: false,
  opennessSymmetric: true,
  opennessRadius: 8,
}

// Fields-only (no Section wrapper/gate) — embedded inside ReliefVisualizationOptionsSection,
// which owns the "Openness" checkbox that conditionally renders this block underneath
// it. Structurally the LRM options block (radius + diverging symmetric range) plus a
// Curvature-style mode selector, since Openness combines both: a configurable search
// radius like LRM, and a positive/negative formula variant like Curvature's modes.
export const OpennessFields: React.FC<{
  state: any; setState: (updates: any) => void
  tileSize?: number
}> = ({ state, setState, tileSize = 256 }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.opennessColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["openness-diverging"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.opennessColorRamp])

  const symmetric = state.opennessSymmetric ?? true
  const magnitude = Math.max(
    Math.abs(state.opennessMin ?? rampBounds.min),
    Math.abs(state.opennessMax ?? rampBounds.max),
  )

  const radiusPx = state.opennessRadius ?? DEFAULTS.opennessRadius
  const radiusMeters = radiusPx * groundResolutionM(state.lat ?? 0, state.zoom ?? 0, tileSize)

  return (
    <div className="space-y-4 pl-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Mode</Label>
          <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState(DEFAULTS)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <ToggleGroup
          type="single"
          value={state.opennessMode ?? DEFAULTS.opennessMode}
          onValueChange={(value) => value && setState({ opennessMode: value as OpennessMode })}
          className="border rounded-md w-full"
        >
          <ToggleGroupItem value="positive" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">
            Positive
          </ToggleGroupItem>
          <ToggleGroupItem value="negative" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">
            Negative
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {state.opennessMode === "negative" ? "Highlights enclosed valleys/pits." : "Highlights exposed ridges/summits."}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Color Ramp</Label>
        <Select
          value={state.opennessColorRamp}
          onValueChange={(value) => setState({
            opennessColorRamp: value,
            opennessMin: undefined,
            opennessMax: undefined,
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
              onCommit={(v) => setState({ opennessRadius: Math.min(32, Math.max(2, Math.round(v ?? DEFAULTS.opennessRadius))) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="openness:radius"
          min={2}
          max={32}
          step={1}
          value={[radiusPx]}
          onValueChange={([v]) => setState({ opennessRadius: v })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Openness Range (°)</Label>
          {symmetric ? (
            <DraftBoundInput
              value={magnitude}
              onCommit={(v) => setState({ opennessMin: -Math.abs(v ?? 0), opennessMax: Math.abs(v ?? 0) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          ) : (
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.opennessMin ?? rampBounds.min}
                onCommit={(v) => setState({ opennessMin: clampMinCommit(v, state.opennessMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.opennessMax ?? rampBounds.max}
                onCommit={(v) => setState({ opennessMax: clampMaxCommit(v, state.opennessMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          )}
        </div>
        {symmetric ? (
          <MobileSlider
            sliderId="openness:range"
            min={0}
            max={100}
            step={0.5}
            value={[magnitude]}
            onValueChange={([v]) => setState({ opennessMin: -v, opennessMax: v })}
            className="w-full cursor-pointer"
          />
        ) : (
          <MobileSlider
            sliderId="openness:range"
            min={-100}
            max={100}
            step={0.5}
            value={[state.opennessMin ?? rampBounds.min, state.opennessMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ opennessMin: Math.min(min, max), opennessMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="openness-symmetric"
          checked={symmetric}
          onCheckedChange={(checked) => setState({ opennessSymmetric: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="openness-symmetric" className="text-sm font-medium cursor-pointer">
          Symmetric Range
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="openness-invert-color-ramp"
          checked={state.opennessInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ opennessInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="openness-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
