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
import { radiusToLevels } from "@/lib/lrm-protocol"

function formatMeters(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

const DEFAULTS = {
  lrmColorRamp: "lrm-diverging",
  lrmMin: undefined,
  lrmMax: undefined,
  lrmInvertColorRamp: false,
  lrmSymmetric: true,
  lrmRadius: 16,
}

// Fields-only (no Section wrapper/gate) — embedded inside SlopeAndMoreOptionsSection,
// which owns the "Local Relief Model" checkbox that conditionally renders this block
// underneath it.
export const LrmFields: React.FC<{
  state: any; setState: (updates: any) => void
  // Actual tile grid size (256/512) of the active terrain source's maplibre
  // source config — the LRM protocol fetches tiles at this size, so it's the
  // correct divisor for turning a pixel radius into a real-world distance.
  tileSize?: number
}> = ({ state, setState, tileSize = 256 }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.lrmColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["lrm-diverging"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.lrmColorRamp])

  // LRM is diverging around 0 (raised vs. sunken relative to the regional trend) —
  // a symmetric -V..+V range is the natural default, same as Curvature/TPI.
  const symmetric = state.lrmSymmetric ?? true
  const magnitude = Math.max(
    Math.abs(state.lrmMin ?? rampBounds.min),
    Math.abs(state.lrmMax ?? rampBounds.max),
  )

  // Approximate ground size of the smoothing neighborhood at the viewport center —
  // informational only, computed with the same Web Mercator formula the protocol
  // itself uses to turn a pixel radius into a real-world distance, using the
  // active source's actual tile grid size (256 or 512) rather than assuming one.
  const radiusPx = state.lrmRadius ?? DEFAULTS.lrmRadius
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
          value={state.lrmColorRamp}
          onValueChange={(value) => setState({
            lrmColorRamp: value,
            lrmMin: undefined,
            lrmMax: undefined,
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
          <Label className="text-sm font-medium">Smoothing Radius (px)</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">≈ {formatMeters(radiusMeters)}</span>
            <DraftBoundInput
              value={radiusPx}
              onCommit={(v) => setState({ lrmRadius: Math.pow(2, radiusToLevels(v ?? DEFAULTS.lrmRadius)) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="lrm:radius"
          min={1}
          max={6}
          step={1}
          value={[radiusToLevels(radiusPx)]}
          onValueChange={([exp]) => setState({ lrmRadius: Math.pow(2, exp) })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">LRM Range (m)</Label>
          {symmetric ? (
            <DraftBoundInput
              value={magnitude}
              onCommit={(v) => setState({ lrmMin: -Math.abs(v ?? 0), lrmMax: Math.abs(v ?? 0) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          ) : (
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.lrmMin ?? rampBounds.min}
                onCommit={(v) => setState({ lrmMin: clampMinCommit(v, state.lrmMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.lrmMax ?? rampBounds.max}
                onCommit={(v) => setState({ lrmMax: clampMaxCommit(v, state.lrmMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          )}
        </div>
        {symmetric ? (
          <MobileSlider
            sliderId="lrm:range"
            min={0}
            max={100}
            step={1}
            value={[magnitude]}
            onValueChange={([v]) => setState({ lrmMin: -v, lrmMax: v })}
            className="w-full cursor-pointer"
          />
        ) : (
          <MobileSlider
            sliderId="lrm:range"
            min={-100}
            max={100}
            step={1}
            value={[state.lrmMin ?? rampBounds.min, state.lrmMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ lrmMin: Math.min(min, max), lrmMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="lrm-symmetric"
          checked={symmetric}
          onCheckedChange={(checked) => setState({ lrmSymmetric: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="lrm-symmetric" className="text-sm font-medium cursor-pointer">
          Symmetric Range
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="lrm-invert-color-ramp"
          checked={state.lrmInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ lrmInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="lrm-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
