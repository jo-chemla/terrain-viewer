import type React from "react"
import { useMemo, useState } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Frame } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, SegmentedToggle, SliderControl, GroupHeading } from "./controls-components"
import { ColorAlphaSwatch } from "./color-picker"
import { OpenInLinksButton } from "./open-in-links"
import { activeProjectConfigAtom } from "@/lib/settings-atoms"
import { colorizeMapBordersAtom, colorizeMapBordersInsetAtom, sideColorOverridesAtom } from "@/lib/layout-constants"
import { GRID_LAYOUTS, GRID_LAYOUT_IDS, GRID_LAYOUT_LABELS, BLEND_MODE_OPTIONS, SIDE_COLORS, type GridLayoutId, type ViewId } from "@/lib/grid-layouts"
import { useWaybackItemsWithLocalChanges } from "@/lib/wayback"

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
  mapRef: React.RefObject<MapRef>
}> = ({ state, setState, isOpen, onOpenChange, historicalMode = false, mapRef }) => {
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  // Same opaque hiddenSections identifier the old inline row in
  // general-settings.tsx used — kept as-is (not renamed to e.g.
  // "comparisonMix") so existing project configs (see lib/projects.json)
  // that already hide it keep working unchanged.
  const hideSplitScreen = activeProjectConfig?.hiddenSections?.includes("splitScreen") ?? false
  const [colorizeMapBorders, setColorizeMapBorders] = useAtom(colorizeMapBordersAtom)
  const [colorizeMapBordersInset, setColorizeMapBordersInset] = useAtom(colorizeMapBordersInsetAtom)
  const [sideColorOverrides, setSideColorOverrides] = useAtom(sideColorOverridesAtom)
  // Default collapsed — capture-date pills, border colorization and its side
  // colors are secondary/cosmetic compared to Split Mode/Grid Layout/Blend
  // Mode above, which most users need every time they turn split mode on.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Newest release at this location — used by the "Open in..." ESRI Wayback
  // link (open-in-links.tsx) instead of a hardcoded release id. Shares
  // historical-timeline-panel.tsx's own module-level per-location cache (see
  // lib/wayback.ts's getCachedLocalChanges), so mounting this hook here too
  // (the "Open In" button moved out of that panel to keep it tighter) costs
  // no extra network round-trip.
  const { items: rawWaybackItems } = useWaybackItemsWithLocalChanges(state.lat, state.lng, state.zoom)
  const latestWaybackRelease = useMemo(
    () => rawWaybackItems.reduce<number | null>((max, item) => (max === null || item.releaseNum > max ? item.releaseNum : max), null),
    [rawWaybackItems],
  )

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

      {/* Moved out of the historical timeline panel's own footer (it used to
          sit centered between the A/B date captions there) to keep that
          panel tighter — this is the natural sidebar home for it regardless
          of split state, since it's about jumping the CURRENT view into
          another viewer, not specifically about comparison/mix. No adjacent
          Label — the button's own text already says "Open in {destination}",
          so a row label would just repeat "open in" — and full width (not
          paired against a label in a justify-between row) since it's the
          only control on this line. */}
      <OpenInLinksButton state={state} mapRef={mapRef} waybackLatestRelease={latestWaybackRelease} className="w-full" />

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
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div className="flex items-center justify-between gap-2 pt-1">
            <CollapsibleTrigger className="flex-1 min-w-0 text-left cursor-pointer">
              <GroupHeading>Advanced</GroupHeading>
            </CollapsibleTrigger>
            <CollapsibleTrigger className="cursor-pointer">
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm font-medium">Capture Date</Label>
              <SegmentedToggle
                className="w-[220px]"
                value={state.showCaptureDatePill}
                onChange={(value) => setState({ showCaptureDatePill: value })}
                options={[
                  { value: "off", label: "Off" },
                  { value: "date", label: "Date" },
                  { value: "source-date", label: "Source" },
                ]}
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
                <Label className="text-sm font-medium">Side Colors</Label>
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      delay={0}
                      render={
                        <span>
                          <Toggle
                            pressed={colorizeMapBordersInset}
                            onPressedChange={() => setColorizeMapBordersInset((v) => !v)}
                            size="sm"
                            aria-label={colorizeMapBordersInset ? "Switch to flush, thicker border" : "Switch to inset border"}
                            className="cursor-pointer"
                          >
                            <Frame className="h-4 w-4" />
                          </Toggle>
                        </span>
                      }
                    />
                    <TooltipContent><p>{colorizeMapBordersInset ? "Inset border (3px gap)" : "Flush border (no gap, thicker stroke)"}</p></TooltipContent>
                  </Tooltip>
                  {/* Square, no-rounded-corner swatches laid out in the exact
                      same rows/cols shape as the map grid itself — same
                      convention as SourceGridToggle (controls-components.tsx),
                      so this reads as "a tiny copy of the map layout" rather
                      than an arbitrary list. The outer group still gets a
                      rounded-md clip (matching every other input's rounded
                      corners) even though each cell itself stays square. */}
                  <div className="flex flex-col border shrink-0 overflow-hidden rounded-md divide-y divide-border">
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
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Section>
  )
}
