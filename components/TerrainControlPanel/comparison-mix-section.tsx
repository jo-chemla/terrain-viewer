import type React from "react"
import { useAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section, SegmentedToggle, SliderControl } from "./controls-components"
import { ColorAlphaSwatch } from "./color-picker"
import { activeProjectConfigAtom } from "@/lib/settings-atoms"
import { colorizeMapBordersAtom, sideColorOverridesAtom } from "@/lib/layout-constants"
import { GRID_LAYOUTS, GRID_LAYOUT_IDS, GRID_LAYOUT_LABELS, BLEND_MODE_OPTIONS, SIDE_COLORS, type GridLayoutId, type ViewId } from "@/lib/grid-layouts"

// Sidebar home for every split/grid/blend control — split out of General
// Settings (which used to hold just the old on/off "Split Screen" row) once
// that grew into: split style (off/overlay/side-by-side), grid layout
// (2x1..3x2), blend mode + opacity (overlay only), and per-side border
// colorization. "Comparison and Mix" while a better name doesn't turn up.
//
// Historical-mode only — Terrain mode still gets a plain Split Mode toggle
// (off/overlay/side, no grid picker, forced to gridLayout "2x1" — see
// TerrainViewer.tsx's effectiveGridLayout) inside General Settings instead,
// since a full N-map grid is really a historical-imagery-comparison feature,
// not a terrain-visualization one.
export const ComparisonMixSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  historicalMode?: boolean
}> = ({ state, setState, isOpen, onOpenChange, historicalMode = false }) => {
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  // Same opaque hiddenSections identifier the old inline row in
  // general-settings.tsx used — kept as-is (not renamed to e.g.
  // "comparisonMix") so existing project configs (see lib/projects.json)
  // that already hide it keep working unchanged.
  const hideSplitScreen = activeProjectConfig?.hiddenSections?.includes("splitScreen") ?? false
  const [colorizeMapBorders, setColorizeMapBorders] = useAtom(colorizeMapBordersAtom)
  const [sideColorOverrides, setSideColorOverrides] = useAtom(sideColorOverridesAtom)

  if (hideSplitScreen || !historicalMode) return null

  const isSplit = state.splitStyle !== "off"
  const isOverlay = state.splitStyle === "overlay"
  // Overlay always compares exactly 2 views — the Grid Layout picker (below)
  // is meaningless for it and hidden entirely rather than shown-disabled.
  const effectiveGridLayout: GridLayoutId = isOverlay ? "2x1" : (state.gridLayout ?? "2x1")

  return (
    <Section title="Comparison and Mix" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={true}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Split Mode</Label>
        <SegmentedToggle
          className="w-[180px]"
          value={state.splitStyle}
          onChange={(value) => setState({ splitStyle: value })}
          options={[
            { value: "off", label: "Off" },
            { value: "overlay", label: "Overlay" },
            { value: "side-by-side", label: "Side" },
          ]}
        />
      </div>

      {isSplit && !isOverlay && (
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">Grid Layout</Label>
          <SegmentedToggle
            className="w-[220px]"
            value={state.gridLayout}
            onChange={(value) => setState({ gridLayout: value })}
            options={GRID_LAYOUT_IDS.map((id) => ({ value: id, label: GRID_LAYOUT_LABELS[id] }))}
          />
        </div>
      )}

      {isOverlay && (
        <>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Blend Mode</Label>
            <Select
              value={state.splitBlendMode}
              onValueChange={(value) => value && setState({ splitBlendMode: value })}
              items={BLEND_MODE_OPTIONS}
            >
              <SelectTrigger className="w-[140px] cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLEND_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SliderControl
            sliderId="overlay-opacity"
            label="Opacity"
            value={state.overlayOpacity * 100}
            onChange={(v) => setState({ overlayOpacity: v / 100 })}
            min={0} max={100} step={1}
            suffix="%"
          />
        </>
      )}

      {isSplit && (
        <>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Show Capture Date</Label>
            <SegmentedToggle
              className="w-[140px]"
              value={state.showCaptureDatePill ? "on" : "off"}
              onChange={(value) => setState({ showCaptureDatePill: value === "on" })}
              options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Colorize Map Borders</Label>
            <SegmentedToggle
              className="w-[140px]"
              value={colorizeMapBorders ? "on" : "off"}
              onChange={(value) => setColorizeMapBorders(value === "on")}
              options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
            />
          </div>
          {colorizeMapBorders && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Label className="text-sm text-muted-foreground">Side Colors</Label>
              {/* Square, no-rounded-corner swatches laid out in the exact same
                  rows/cols shape as the map grid itself — same convention as
                  SourceGridToggle (controls-components.tsx), so this reads as
                  "a tiny copy of the map layout" rather than an arbitrary list. */}
              <div className="flex flex-col border shrink-0 overflow-hidden divide-y divide-border">
                {GRID_LAYOUTS[effectiveGridLayout].grid.map((row, rowIdx) => (
                  <div key={rowIdx} className="flex divide-x divide-border">
                    {row.map((side: ViewId) => (
                      <ColorAlphaSwatch
                        key={side}
                        title={`View ${side} border color`}
                        size="h-6 w-6"
                        className="rounded-none border-0"
                        color={sideColorOverrides[side] ?? SIDE_COLORS[side]}
                        onChange={(hex) => setSideColorOverrides((prev) => ({ ...prev, [side]: hex }))}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  )
}
