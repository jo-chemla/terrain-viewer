import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit, SegmentedToggle } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { colorRampsClassic, extractStops, DEFAULT_SLOPE_CUSTOM_STOPS } from "@/lib/color-ramps"
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
  opennessCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  opennessCustomStopsDiscrete: false,
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
  const isCustom = state.opennessColorRamp === "custom"
  const isDiscrete = state.opennessCustomStopsDiscrete ?? false
  const customStops = state.opennessCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

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
        <SegmentedToggle
          className="w-full"
          value={(state.opennessMode ?? DEFAULTS.opennessMode) as OpennessMode}
          onChange={(value) => setState({ opennessMode: value })}
          options={[
            { value: "positive" as OpennessMode, label: "Positive" },
            { value: "negative" as OpennessMode, label: "Negative" },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {state.opennessMode === "negative" ? "Highlights enclosed valleys/pits." : "Highlights exposed ridges/summits."}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Color Ramp</Label>
        <ColorRampSelectWithCustom
          ramps={colorRampsClassic}
          value={state.opennessColorRamp}
          onValueChange={(value) => setState({
            opennessColorRamp: value,
            opennessMin: undefined,
            opennessMax: undefined,
          })}
          anchorKey="openness-default"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
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

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ opennessCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ opennessCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Openness Range (°)</Label>
            {symmetric ? (
              <DraftBoundInput
                value={magnitude}
                onCommit={(v) => setState({ opennessMin: -Math.abs(v ?? 0), opennessMax: Math.abs(v ?? 0) })}
                className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
                step={0.5}
              />
            ) : (
              <div className="flex items-center gap-2">
                <DraftBoundInput
                  value={state.opennessMin ?? rampBounds.min}
                  onCommit={(v) => setState({ opennessMin: clampMinCommit(v, state.opennessMax ?? rampBounds.max) })}
                  className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                  step={0.5}
                />
                <DraftBoundInput
                  value={state.opennessMax ?? rampBounds.max}
                  onCommit={(v) => setState({ opennessMax: clampMaxCommit(v, state.opennessMin ?? rampBounds.min) })}
                  className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                  step={0.5}
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
      )}

      <div className="flex gap-2">
        {!isCustom && (
        <div className="flex flex-1 items-center gap-2">
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
        )}

        <div className="flex flex-1 items-center gap-2">
          <Checkbox
            id="openness-invert-color-ramp"
            checked={state.opennessInvertColorRamp || false}
            onCheckedChange={(checked) => setState({ opennessInvertColorRamp: checked === true })}
            className="cursor-pointer"
          />
          <Label htmlFor="openness-invert-color-ramp" className="text-sm font-medium cursor-pointer">
            Invert Ramp
          </Label>
        </div>
      </div>
    </div>
  )
}
