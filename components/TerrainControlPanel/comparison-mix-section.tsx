import type React from "react"
import { useMemo, useState } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Frame, Hourglass } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, SegmentedToggle, SliderControl, GroupHeading } from "./controls-components"
import { ColorAlphaSwatch } from "./color-picker"
import { OpenInLinksButton } from "./open-in-links"
import { activeProjectConfigAtom } from "@/lib/settings-atoms"
import { colorizeMapBordersAtom, colorizeMapBordersInsetAtom, isComparisonMixAdvancedOpenAtom, sideColorOverridesAtom } from "@/lib/layout-constants"
import { GRID_LAYOUTS, GRID_LAYOUT_IDS, BLEND_MODE_GROUPS, SIDE_COLORS, type GridLayoutId, type ViewId } from "@/lib/grid-layouts"
import { useWaybackItemsWithLocalChanges } from "@/lib/wayback"
import { cn } from "@/lib/utils"

// RGB is the only space cheap enough for a live CSS filter (see
// HistogramMatchFilter.tsx) — the rest need a real per-pixel JS conversion,
// flagged here with an hourglass so the tradeoff is visible before picking one.
const COLOR_SPACE_OPTIONS: { value: "rgb" | "hsl" | "hsv" | "lab" | "lch"; label: string; slow?: boolean }[] = [
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL", slow: true },
  { value: "hsv", label: "HSV", slow: true },
  { value: "lab", label: "LAB", slow: true },
  { value: "lch", label: "LCH", slow: true },
]

// "Table size picker" style control (Excel/Docs "insert table" convention) —
// an 8-cell grid standing in for the text SegmentedToggle Grid Layout used
// to be: no per-cell text (same convention as the ABCDEF basemap-source
// toggle / color swatches elsewhere in this section), the selected layout's
// own NxM rectangle of cells lit up in solid primary, everything outside it
// plain background. Hovering a DIFFERENT valid cell previews what clicking
// it would select (same rectangle logic, lighter primary) without
// committing anything until an actual click. Fixed at 2 rows x 4 cols —
// every cell is a real, fully wired-up GridLayoutId (up to "4x2", 8 views
// A-H) EXCEPT row 0/col 0 ("1x1", a single unsplit view, meaningless as a
// grid-layout choice since this control only ever shows once isSplit is
// already true) — disabled rather than hidden, so the control still reads
// as a clean fixed rectangle instead of a lopsided 7-cell one.
const GRID_PICKER_ROWS = 2
const GRID_PICKER_COLS = 4

const GridLayoutPicker: React.FC<{ value: GridLayoutId; onChange: (id: GridLayoutId) => void }> = ({ value, onChange }) => {
  const [hovered, setHovered] = useState<{ r: number; c: number } | null>(null)
  const idFor = (r: number, c: number): GridLayoutId | null => {
    const candidate = `${c + 1}x${r + 1}`
    return (GRID_LAYOUT_IDS as readonly string[]).includes(candidate) ? (candidate as GridLayoutId) : null
  }
  const previewId = hovered ? idFor(hovered.r, hovered.c) : null
  const activeConfig = GRID_LAYOUTS[previewId ?? value]
  return (
    <div className="flex items-center gap-2">
      <div
        className="grid grid-cols-4 gap-px bg-border p-px rounded-md border overflow-hidden shrink-0"
        onPointerLeave={() => setHovered(null)}
      >
        {Array.from({ length: GRID_PICKER_ROWS }).flatMap((_, r) =>
          Array.from({ length: GRID_PICKER_COLS }).map((_, c) => {
            const id = idFor(r, c)
            const isActive = r < activeConfig.rows && c < activeConfig.cols
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                disabled={!id}
                onClick={() => id && onChange(id)}
                onPointerEnter={() => id && setHovered({ r, c })}
                title={id ? `${c + 1}×${r + 1}` : "Not available yet"}
                aria-label={id ? `Grid layout ${c + 1} by ${r + 1}` : "Not available yet"}
                className={cn(
                  "h-6 w-6 cursor-pointer disabled:cursor-not-allowed transition-colors",
                  isActive ? (previewId ? "bg-primary/50" : "bg-primary") : (id ? "bg-background hover:bg-accent" : "bg-muted/40"),
                )}
              />
            )
          }),
        )}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{previewId ?? value}</span>
    </div>
  )
}

// Sidebar home for every split/grid/blend control — split out of General
// Settings (which used to hold just the old on/off "Split Screen" row) once
// that grew into: split style (off/overlay/side-by-side), grid layout
// (2x1..3x2), blend mode + opacity (overlay only), and per-side border
// colorization. "Compare and Blend" felt closer to what it actually covers.
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
  // Persisted (atomWithStorage) so a user who opens it once doesn't have to
  // re-open it on every reload.
  const [advancedOpen, setAdvancedOpen] = useAtom(isComparisonMixAdvancedOpenAtom)
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
    <Section title="Compare and Blend" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={true}>
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
          <GridLayoutPicker value={state.gridLayout ?? "2x1"} onChange={(id) => setState({ gridLayout: id })} />
        </div>
      )}

      {isOverlay && (
        <>
          <div className="flex items-center justify-between gap-2">
            {/* Off falls back to plain "normal" (no visual blending) while
                leaving the actual picked mode in the Select below untouched
                — a quick blended/unblended flip for the same mode, instead
                of having to re-pick it every time. */}
            <div className="flex items-center gap-2">
              {/* inline-flex (not a bare span) — Checkbox's own root
                  renders as a plain <span role="checkbox">, display:inline
                  by default, which makes its explicit size-4 width/height
                  a no-op on a non-replaced inline element. It normally
                  only looks right because it sits as a DIRECT flex child
                  of a `flex` row (flex "blockifies" child elements, which
                  is what actually makes the explicit size stick) — a bare
                  wrapping span here breaks that, collapsing it down to a
                  thin content-sized sliver instead of a 16px box. */}
              <Tooltip>
                <TooltipTrigger
                  delay={0}
                  render={
                    <span className="inline-flex">
                      <Checkbox
                        id="split-blend-mode-enabled"
                        checked={state.splitBlendModeEnabled}
                        onCheckedChange={(checked) => setState({ splitBlendModeEnabled: checked === true })}
                        className="cursor-pointer"
                      />
                    </span>
                  }
                />
                <TooltipContent><p>Turn the blend mode effect on or off — the picker below stays fully usable either way, so you can line up a different mode (dimmed while off, since it won't apply yet) without losing the current one first.</p></TooltipContent>
              </Tooltip>
              <Label htmlFor="split-blend-mode-enabled" className="text-sm font-medium cursor-pointer">Blend Mode</Label>
            </div>
            <Select
              value={state.splitBlendMode}
              onValueChange={(value) => value && setState({ splitBlendMode: value })}
              items={BLEND_MODE_GROUPS}
            >
              {/* Stays fully interactive (not `disabled`) even with the
                  checkbox off — picking a mode ahead of time, to have it
                  ready the moment blending is switched back on, is exactly
                  what that checkbox is for. Only dimmed to *look*
                  disabled, as a "won't currently apply" cue. */}
              <SelectTrigger className={cn("w-[140px] cursor-pointer", !state.splitBlendModeEnabled && "opacity-50")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLEND_MODE_GROUPS.map((group, i) => (
                  <SelectGroup key={group.label}>
                    {i > 0 && <SelectSeparator />}
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.items.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectGroup>
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

      {isSplit && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="match-colors-to-a"
              checked={state.matchColorsToA}
              onCheckedChange={(checked) => setState({ matchColorsToA: checked === true })}
              className="cursor-pointer"
            />
            <Tooltip>
              <TooltipTrigger
                delay={0}
                render={<Label htmlFor="match-colors-to-a" className="text-sm font-medium cursor-pointer">Match Colors</Label>}
              />
              <TooltipContent className="max-w-60">
                <p>Histogram matching onto reference View A in the chosen color space — computes a lookup table (LUT) and applies it as a CSS filter for RGB, or a per-pixel 3D LUT mapping for the others.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          {/* Always shown (not just once checked) — same "pick it ahead of
              time, dimmed to look disabled rather than actually locked"
              convention as Blend Mode's own Select above. */}
          <Select
            value={state.matchColorsColorSpace}
            onValueChange={(value) => value && setState({ matchColorsColorSpace: value })}
          >
            <SelectTrigger size="sm" className={cn("w-[140px] cursor-pointer", !state.matchColorsToA && "opacity-50")}>
              <SelectValue>
                <span className="flex items-center gap-1 text-xs uppercase">
                  {state.matchColorsColorSpace}
                  {state.matchColorsColorSpace !== "rgb" && <Hourglass className="h-3 w-3" />}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COLOR_SPACE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-1.5">
                    {opt.label}
                    {opt.slow && <Hourglass className="h-3 w-3 text-muted-foreground" />}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Moved out of the historical timeline panel's own footer (it used to
          sit centered between the A/B date captions there) to keep that
          panel tighter — this is the natural sidebar home for it regardless
          of split state, since it's about jumping the CURRENT view into
          another viewer, not specifically about comparison/mix. AFTER
          Advanced closes (not inside it, not before it) per request — it's
          a frequently-used action, not a cosmetic/advanced setting, so it
          stays outside the collapsible, just at the very end of the
          section instead of competing for attention near the top. No
          adjacent Label — the button's own text already says "Open in
          {destination}", so a row label would just repeat "open in" — and
          full width (not paired against a label in a justify-between row)
          since it's the only control on this line. */}
      <OpenInLinksButton state={state} mapRef={mapRef} waybackLatestRelease={latestWaybackRelease} className="w-full" />
    </Section>
  )
}
