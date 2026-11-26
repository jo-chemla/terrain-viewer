// The River REM mode's own sidebar group (appMode=rem): River, Detrending,
// Display. The panels of Iconem's RiverREM_UI this app needs, in this app's
// components: the centerline's source (its OSM / Draw tabs and river mode),
// the interpolation (IDW power, samples), and the symbology (ramp, min/max,
// log). Its engine choice, runs list, basemap picker and exports are not
// ported: there is one live engine here, bookmarks are the runs, and the
// basemap, terrain source and Download sections are the app's own.
//
// Every setting is URL state (the rem* fields); results (status, rivers
// found, what the last computation used) come from lib/river-rem-atoms.ts,
// written by the engine in components/RiverRem/RiverRemLayers.tsx.

import type React from "react"
import { useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import type { TerraDraw } from "terra-draw"
import { Loader2, RotateCcw, Pencil, RefreshCw, TriangleAlert } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section, MacroSeparator, MobileSlider, DraftBoundInput, SegmentedToggle, SliderControl, clampMinCommit, clampMaxCommit } from "./controls-components"
import { drawingFeaturesAtom, activeDrawModeAtom } from "./TerraDrawSystem"
import { colorRampsClassic } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"
import { encodeLines, decodeLines, lineLengthM, type LngLat } from "@/lib/river-rem"
import {
  riverRemStatusAtom, riverRemRiversAtom, riverRemInfoAtom, riverRemRetryAtom, riverRemDrawnIdAtom, riverRemSectionsOpenAtom,
} from "@/lib/river-rem-atoms"

const km = (m: number) => (m >= 10000 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
const INPUT_CLASS = "h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"

const RIVER_DEFAULTS = { remRiver: "longest", remWaterways: "river", remRiverName: "", remSpacing: 0, remShowLine: true }
const DETREND_DEFAULTS = { remPower: 1, remNeighbors: 0, remMonotone: "min" }
const DISPLAY_DEFAULTS = { remMin: 0, remMax: 10, remColorRamp: "rem-mako", remInvertColorRamp: false, remStretch: "log", remGamma: 0.5, remOpacity: 1 }

const CENTERLINE_OPTIONS = [
  { value: "longest", label: "Longest named river in view" },
  { value: "all", label: "All waterways in view" },
  { value: "named", label: "One river, picked by name" },
  { value: "drawn", label: "Drawn line" },
]

// The REM ramps first, then every other single-registry ramp.
const REM_RAMPS: Record<string, { name: string; colors: any[] }> = (() => {
  const all = colorRampsClassic as Record<string, { name: string; colors: any[] }>
  const first = ["rem-mako", "rem-blues"]
  return Object.fromEntries([...first.map((k) => [k, all[k]] as const), ...Object.entries(all).filter(([k]) => !first.includes(k))])
})()

const ResetButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" title="Reset this panel" onClick={onClick}>
    <RotateCcw className="h-3 w-3" />
  </Button>
)

const Swatch: React.FC<{ colors: any[] }> = ({ colors }) => (
  <div className="w-12 h-4 shrink-0 rounded-sm" style={{ background: `linear-gradient(to right, ${getGradientColors(colors)})` }} />
)

// ─── River ──────────────────────────────────────────────────────────────────

const RiverPanel: React.FC<{ state: any; setState: (updates: any) => void; draw: TerraDraw | null }> = ({ state, setState, draw }) => {
  const status = useAtomValue(riverRemStatusAtom)
  const rivers = useAtomValue(riverRemRiversAtom)
  const info = useAtomValue(riverRemInfoAtom)
  const retry = useSetAtom(riverRemRetryAtom)
  const features = useAtomValue(drawingFeaturesAtom)
  const [drawnId, setDrawnId] = useAtom(riverRemDrawnIdAtom)
  const [activeDrawMode, setActiveDrawMode] = useAtom(activeDrawModeAtom)

  const source = state.remRiver ?? "longest"
  const drawn = source === "drawn"
  const named = useMemo(() => rivers.filter((r) => r.name), [rivers])
  const drawnLines = useMemo(
    () => features.filter((f) => f.geometry?.type === "LineString" && !f.properties?.currentlyDrawing && (f.geometry.coordinates?.length ?? 0) >= 2),
    [features],
  )
  const drawnItems = useMemo(() => {
    const items = drawnLines.map((f, i) => ({ value: String(f.id), label: `${f.properties?.name || `Line ${i + 1}`} · ${km(lineLengthM(f.geometry.coordinates as LngLat[]))}` }))
    // A link's line with no drawing behind it still has to show as the choice.
    if (state.remLine && !drawnLines.some((f) => String(f.id) === drawnId)) {
      const length = decodeLines(state.remLine).reduce((sum, l) => sum + lineLengthM(l), 0)
      items.unshift({ value: "__link", label: `Line from the link · ${km(length)}` })
    }
    return items
  }, [drawnLines, drawnId, state.remLine])
  const drawnValue = drawnLines.some((f) => String(f.id) === drawnId) ? drawnId! : state.remLine ? "__link" : ""
  const riverItems = useMemo(() => {
    const items = named.map((r) => ({ value: r.name, label: `${r.name} · ${km(r.lengthM)}` }))
    if (state.remRiverName && !named.some((r) => r.name === state.remRiverName)) items.unshift({ value: state.remRiverName, label: `${state.remRiverName} · not in view` })
    return items
  }, [named, state.remRiverName])

  const busy = status.phase === "rivers" || status.phase === "sampling" || status.phase === "trend"
  const startDrawing = () => {
    if (!draw) return
    try { draw.setMode("linestring"); setActiveDrawMode("linestring") } catch { /* the drawing system is not started yet */ }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Centerline</Label>
          <ResetButton onClick={() => setState(RIVER_DEFAULTS)} />
        </div>
        <Select value={source} onValueChange={(v) => v && setState({ remRiver: v })} items={CENTERLINE_OPTIONS}>
          <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CENTERLINE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!drawn && (
        <SegmentedToggle
          value={state.remWaterways === "all" ? "all" : "river"}
          onChange={(v) => setState({ remWaterways: v })}
          options={[
            { value: "river", label: "Rivers", tooltip: "OpenStreetMap waterway=river" },
            { value: "all", label: "Rivers, streams, canals", tooltip: "Also waterway=stream and waterway=canal: side channels and small valleys" },
          ]}
          className="w-full"
        />
      )}

      {source === "named" && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">River</Label>
          {riverItems.length ? (
            <Select value={state.remRiverName || ""} onValueChange={(v) => v && setState({ remRiverName: v })} items={riverItems}>
              <SelectTrigger className="w-full cursor-pointer"><SelectValue placeholder="Pick a river" /></SelectTrigger>
              <SelectContent>
                {riverItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">No named river found in view yet.</p>
          )}
        </div>
      )}

      {drawn && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0">
              {drawnItems.length ? (
                <Select value={drawnValue} onValueChange={(v) => { if (!v || v === "__link") return; setDrawnId(v); const f = drawnLines.find((l) => String(l.id) === v); if (f) setState({ remLine: encodeLines([f.geometry.coordinates as LngLat[]]) }) }} items={drawnItems}>
                  <SelectTrigger className="w-full cursor-pointer"><SelectValue placeholder="Pick a drawn line" /></SelectTrigger>
                  <SelectContent>
                    {drawnItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">No line drawn yet.</p>
              )}
            </div>
            <Button variant={activeDrawMode === "linestring" ? "default" : "outline"} size="sm" className="shrink-0 cursor-pointer" onClick={startDrawing} disabled={!draw}>
              <Pencil className="h-3.5 w-3.5" /> Draw
            </Button>
          </div>
          <p className="text-xs text-muted-foreground break-words">
            Click along the channel, double-click to finish. The line can go up or down the river: it is read from its higher end. Editing it in the Drawing tool updates the REM.
          </p>
        </div>
      )}

      <div data-slider-group="" className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Sample spacing (m)</Label>
          <div className="flex items-center gap-2">
            {!(state.remSpacing > 0) && <span className="text-xs text-muted-foreground">Auto</span>}
            <DraftBoundInput value={state.remSpacing > 0 ? state.remSpacing : undefined} placeholder={info ? String(Math.round(info.spacingM)) : "auto"} onCommit={(v) => setState({ remSpacing: Math.max(0, v ?? 0) })} className={INPUT_CLASS} step={5} />
          </div>
        </div>
        <MobileSlider sliderId="rem:spacing" min={0} max={500} step={5} value={Math.min(500, state.remSpacing ?? 0)} onValueChange={(v) => setState({ remSpacing: v as number })} className="w-full cursor-pointer" />
        <p className="text-xs text-muted-foreground break-words">
          0 spreads 1000 points over the river, as RiverREM does.
          {info && ` Now: ${info.points} heights every ${Math.round(info.spacingM)} m over ${km(info.lengthM)}, read at zoom ${info.sampleZoom}.`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="rem-show-line" checked={state.remShowLine !== false} onCheckedChange={(c) => setState({ remShowLine: c === true })} className="cursor-pointer" />
        <Label htmlFor="rem-show-line" className="text-sm font-medium cursor-pointer">Show the centerline</Label>
      </div>

      {(status.message || busy || info) && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground min-w-0">
          {busy ? <Loader2 className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-spin" />
            : status.phase === "error" || status.phase === "empty" ? <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : null}
          <p className="flex-1 min-w-0 break-words">
            {status.message || (info ? `${info.riverLabel}: ${km(info.lengthM)} in use.` : "")}
          </p>
          {status.canRetry && (
            <Button variant="outline" size="sm" className="h-6 px-2 shrink-0 cursor-pointer" onClick={() => retry((n) => n + 1)}>
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          )}
        </div>
      )}
      {!drawn && (
        <p className="text-xs text-muted-foreground break-words">
          Rivers © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, read through the Overpass API when the view rests.
        </p>
      )}
    </div>
  )
}

// ─── Detrending ─────────────────────────────────────────────────────────────

const DetrendingPanel: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const info = useAtomValue(riverRemInfoAtom)
  const auto = !(state.remNeighbors > 0)
  return (
    <div className="space-y-3">
      <div data-slider-group="" className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-sm">IDW power</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{(state.remPower ?? 1).toFixed(1)}</span>
            <ResetButton onClick={() => setState(DETREND_DEFAULTS)} />
          </div>
        </div>
        <MobileSlider sliderId="rem:power" min={0.5} max={4} step={0.5} value={state.remPower ?? 1} onValueChange={(v) => setState({ remPower: v as number })} className="w-full cursor-pointer" />
        <p className="text-xs text-muted-foreground break-words">Weights are 1 / distance^power. 1 is RiverREM's; higher follows the nearest reach more closely.</p>
      </div>

      <div data-slider-group="" className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Neighbors</Label>
          <div className="flex items-center gap-2">
            {auto && <span className="text-xs text-muted-foreground">Auto{info ? `: ${info.neighbors}` : ""}</span>}
            <DraftBoundInput value={auto ? undefined : state.remNeighbors} placeholder="auto" onCommit={(v) => setState({ remNeighbors: Math.max(0, Math.round(v ?? 0)) })} className={INPUT_CLASS} />
          </div>
        </div>
        <MobileSlider sliderId="rem:neighbors" min={0} max={200} step={1} value={Math.min(200, state.remNeighbors ?? 0)} onValueChange={(v) => setState({ remNeighbors: v as number })} className="w-full cursor-pointer" />
        <p className="text-xs text-muted-foreground break-words">
          Nearest river heights averaged at each place. 0 guesses it from the river's sinuosity, as RiverREM does
          {info ? ` (sinuosity ${info.sinuosity.toFixed(2)})` : ""}: more for a meandering river, so a tight bend does not print as a step.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Downstream cleaning</Label>
        <SegmentedToggle
          value={(state.remMonotone ?? "min") as "min" | "fit" | "none"}
          onChange={(v) => setState({ remMonotone: v })}
          options={[
            { value: "min", label: "Running minimum", tooltip: "The lowest height met so far going downstream: bridges, banks and trees read too high and are ignored" },
            { value: "fit", label: "Monotone fit", tooltip: "The falling profile closest to the heights read (least squares): steadier where the DEM has pits" },
            { value: "none", label: "Off", tooltip: "The heights as read, as RiverREM uses them" },
          ]}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground break-words">
          A river does not flow uphill; what a DEM reads along it sometimes does.
          {info && ` Water level from ${info.levelHigh.toFixed(1)} m down to ${info.levelLow.toFixed(1)} m; ${info.corrected} of ${info.points} heights moved by more than 10 cm.`}
        </p>
      </div>
    </div>
  )
}

// ─── Display ────────────────────────────────────────────────────────────────

const DisplayPanel: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const rampKey = REM_RAMPS[state.remColorRamp] ? state.remColorRamp : "rem-mako"
  const rampItems = useMemo(() => Object.entries(REM_RAMPS).map(([value, ramp]) => ({ value, label: ramp.name })), [])
  const min = state.remMin ?? 0, max = state.remMax ?? 10
  const stretch = (state.remStretch ?? "log") as "log" | "power" | "linear"
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Color ramp</Label>
          <ResetButton onClick={() => setState(DISPLAY_DEFAULTS)} />
        </div>
        <Select value={rampKey} onValueChange={(v) => v && setState({ remColorRamp: v })} items={rampItems}>
          <SelectTrigger className="w-full cursor-pointer">
            <SelectValue>
              {(v: string) => (REM_RAMPS[v] ? <div className="flex items-center gap-2 min-w-0"><Swatch colors={REM_RAMPS[v].colors} /><span className="truncate">{REM_RAMPS[v].name}</span></div> : v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(REM_RAMPS).map(([key, ramp]) => (
              <SelectItem key={key} value={key}>
                <div className="flex items-center gap-2"><Swatch colors={ramp.colors} /><span>{ramp.name}</span></div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div data-slider-group="" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">Height above the river (m)</Label>
          <div className="flex items-center gap-2">
            <DraftBoundInput value={min} onCommit={(v) => setState({ remMin: clampMinCommit(v, max) ?? 0 })} className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded" step={0.5} />
            <DraftBoundInput value={max} onCommit={(v) => setState({ remMax: clampMaxCommit(v, min) ?? 10 })} className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded" step={0.5} />
          </div>
        </div>
        <MobileSlider
          sliderId="rem:range" min={-5} max={50} step={0.5}
          value={[Math.max(-5, Math.min(50, min)), Math.max(-5, Math.min(50, max))]}
          onValueChange={([a, b]) => { const lo = Math.min(a, b), hi = Math.max(a, b); setState({ remMin: lo, remMax: hi > lo ? hi : lo + 0.5 }) }}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Stretch</Label>
        <SegmentedToggle
          value={stretch}
          onChange={(v) => setState({ remStretch: v })}
          options={[
            { value: "log", label: "Log", tooltip: "RiverREM's: most of the ramp in the first metres above the water" },
            { value: "power", label: "Power", tooltip: "height^gamma: under 1 favors low ground, over 1 high ground" },
            { value: "linear", label: "Linear" },
          ]}
          className="w-full"
        />
        {stretch === "power" && (
          <SliderControl label="Gamma" sliderId="rem:gamma" value={state.remGamma ?? 0.5} onChange={(v) => setState({ remGamma: v })} min={0.1} max={2} step={0.05} decimals={2} />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="rem-invert-ramp" checked={!!state.remInvertColorRamp} onCheckedChange={(c) => setState({ remInvertColorRamp: c === true })} className="cursor-pointer" />
        <Label htmlFor="rem-invert-ramp" className="text-sm font-medium cursor-pointer">Invert ramp</Label>
      </div>

      <SliderControl label="Opacity" sliderId="rem:opacity" value={state.remOpacity ?? 1} onChange={(v) => setState({ remOpacity: v })} min={0} max={1} step={0.01} decimals={2} />

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox id="rem-hillshade" checked={!!state.showHillshade} onCheckedChange={(c) => setState({ showHillshade: c === true })} className="cursor-pointer" />
          <Label htmlFor="rem-hillshade" className="text-sm font-medium cursor-pointer">Hillshade on top</Label>
        </div>
        {state.showHillshade && (
          <SliderControl label="Hillshade opacity" sliderId="rem:hillshade" value={state.hillshadeOpacity ?? 1} onChange={(v) => setState({ hillshadeOpacity: v })} min={0} max={1} step={0.01} decimals={2} />
        )}
      </div>
      <p className="text-xs text-muted-foreground break-words">
        Download, under General, exports the REM as a float32 GeoTIFF in metres or as colored on screen (Export layers).
      </p>
    </div>
  )
}

// ─── The group ──────────────────────────────────────────────────────────────

export const RiverRemSections: React.FC<{ state: any; setState: (updates: any) => void; draw: TerraDraw | null }> = ({ state, setState, draw }) => {
  const [open, setOpen] = useAtom(riverRemSectionsOpenAtom)
  const toggle = (key: "river" | "detrending" | "display") => (value: boolean) => setOpen((prev) => ({ ...prev, [key]: value }))
  return (
    <>
      <MacroSeparator label="River REM" isOpen={open.group !== false} onToggle={() => setOpen((prev) => ({ ...prev, group: prev.group === false }))} />
      {open.group !== false && (
        <>
          <Section title="River" isOpen={open.river} onOpenChange={toggle("river")} id="river-rem-river-section">
            <RiverPanel state={state} setState={setState} draw={draw} />
          </Section>
          <Section title="Detrending" isOpen={open.detrending} onOpenChange={toggle("detrending")} id="river-rem-detrending-section">
            <DetrendingPanel state={state} setState={setState} />
          </Section>
          <Section title="Display" isOpen={open.display} onOpenChange={toggle("display")} withSeparator={false} id="river-rem-display-section">
            <DisplayPanel state={state} setState={setState} />
          </Section>
        </>
      )}
    </>
  )
}
