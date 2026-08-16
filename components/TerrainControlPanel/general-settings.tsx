import type React from "react"
import { useMemo } from "react"
import { useAtom } from "jotai"
import { Globe, RotateCcw } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Section, SegmentedToggle } from "./controls-components"
import { activeProjectConfigAtom } from "@/lib/settings-atoms"
import { ImportExportProjectDialog } from "./import-export-project-dialog"
import { OpenInLinksButton } from "./open-in-links"
import { useWaybackItemsWithLocalChanges } from "@/lib/wayback"

export const GeneralSettings: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  // Historical mode is 2D-only by construction (see TerrainControlPanel's
  // own forcing effect) — there's nothing left to toggle, so the row is
  // dropped rather than shown disabled/single-option.
  historicalMode?: boolean
  mapRef: React.RefObject<MapRef>
}> = ({ state, setState, isOpen, onOpenChange, historicalMode = false, mapRef }) => {
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const disabledViewModes = activeProjectConfig?.disableViewModes ?? []
  const hideSplitScreen = activeProjectConfig?.hiddenSections?.includes("splitScreen") ?? false
  // Terrain mode's own "Open in..." fallback, below — a second copy of the
  // one already living in the historical timeline panel's A/B caption row
  // (historical-timeline-panel.tsx), which only renders once the timeline
  // panel itself is showing (a historical basemap active, exactly 2 views,
  // not collapsed). This one is unconditional, so there's always a path to
  // it in Terrain mode regardless of any of that — same
  // hook/pattern comparison-mix-section.tsx uses for its own (historical
  // mode) copy, just gated the other way round (!historicalMode).
  const { items: rawWaybackItems } = useWaybackItemsWithLocalChanges(state.lat, state.lng, state.zoom)
  const latestWaybackRelease = useMemo(
    () => rawWaybackItems.reduce<number | null>((max, item) => (max === null || item.releaseNum > max ? item.releaseNum : max), null),
    [rawWaybackItems],
  )

  return (
    <Section id="tour-general-settings" title="General Settings" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={true}>
      {!historicalMode && (
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">View Mode</Label>
          <SegmentedToggle
            className="w-[140px]"
            value={state.viewMode}
            onChange={(value) => setState({ viewMode: value })}
            options={[
              !disabledViewModes.includes("2d") && { value: "2d", label: "2D" },
              !disabledViewModes.includes("globe") && { value: "globe", label: <Globe className="h-4 w-4 mx-auto" strokeWidth={state.viewMode === "globe" ? 2 : 1.5} /> },
              !disabledViewModes.includes("3d") && { value: "3d", label: "3D" },
            ].filter(Boolean) as { value: string; label: React.ReactNode }[]}
          />
        </div>
      )}
      {/* Terrain mode's own minimal comparison control — historical mode gets
          the full Compare and Blend section instead (grid layout picker,
          blend mode/opacity, per-side border colors, capture-date pill), a
          full N-map grid being a historical-imagery-comparison feature more
          than a terrain-visualization one. Always forces gridLayout "2x1"
          regardless of state.gridLayout's own stored value — see
          TerrainViewer.tsx's effectiveGridLayout. */}
      {!historicalMode && !hideSplitScreen && (
        <div id="tour-split-mode" className="flex items-center justify-between gap-2">
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
      )}
      <ImportExportProjectDialog setState={setState} />
      {(state.viewMode === "3d" || state.viewMode === "globe") && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Terrain Exaggeration</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{state.exaggeration.toFixed(1)}x</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState({ exaggeration: 1 })}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <Slider value={state.exaggeration} onValueChange={(value) => setState({ exaggeration: value })} min={0.1} max={10} step={0.1} className="cursor-pointer" />
        </div>
      )}
      {/* Last row, terrain mode only — historical mode gets its own copy at
          the bottom of Compare and Blend instead (comparison-mix-section.tsx).
          Deliberately always shown here too, even though the timeline panel
          usually also has one — see the hook comment above. */}
      {!historicalMode && (
        <OpenInLinksButton state={state} mapRef={mapRef} waybackLatestRelease={latestWaybackRelease} className="w-full" />
      )}
    </Section>
  )
}
