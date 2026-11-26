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
import { useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import type { TerraDraw } from "terra-draw"
import { Loader2, RotateCcw, Pencil, RefreshCw, TriangleAlert, Download, Upload } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section, MacroSeparator, MobileSlider, DraftBoundInput, SegmentedToggle, SliderControl, GroupHeading, clampMinCommit, clampMaxCommit } from "./controls-components"
import { pushToast } from "@/components/ui/toast"
import { parseVector, vectorFormatFromName } from "@/lib/remote-vector"
import { drawingFeaturesAtom, activeDrawModeAtom } from "./TerraDrawSystem"
import { colorRampsClassic } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"
import { encodeLines, decodeLines, lineLengthM, linesToGeoJson, linesFromGeoJson, encodeLinesForUrl, type LngLat } from "@/lib/river-rem"
import {
  riverRemStatusAtom, riverRemRiversAtom, riverRemInfoAtom, riverRemRetryAtom, riverRemDrawnIdAtom, riverRemSectionsOpenAtom,
  riverRemLinesAtom, riverRemElevRangeAtom, type RiverRemSectionKey,
} from "@/lib/river-rem-atoms"

const km = (m: number) => (m >= 10000 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
const INPUT_CLASS = "h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"

const RIVER_DEFAULTS = { remRiver: "main", remWaterways: "river", remRiverName: "", remSpacing: 0, remShowLine: true }
const DETREND_DEFAULTS = { remInterp: "idw", remPower: 1, remNeighbors: 0, remMonotone: "min" }
const DISPLAY_DEFAULTS = {
  remShow: "rem", remMin: 0, remMax: 10, remElevAuto: true, remColorRamp: "rem-mako", remInvertColorRamp: false, remStretch: "log", remGamma: 0.5, remOpacity: 1,
  remContours: false, remContourInterval: 1, remDetail: -1,
}

// "Main river" first: the default. The words are Jonathan's ("Longest,
// tributary, named river"), each with what it does as its hover title.
const CENTERLINE_OPTIONS = [
  { value: "main", label: "Main river", hint: "The largest river in view: length there times how fully OpenStreetMap describes it" },
  { value: "longest", label: "Longest river", hint: "The named river with the most length in view (RiverREM's rule); on a floodplain this is often a winding creek" },
  { value: "all", label: "Main river and tributaries", hint: "Every waterway found feeds the trend: confluences, deltas, braided reaches" },
  { value: "named", label: "Named river", hint: "One river, picked from the names found in view" },
  { value: "drawn", label: "Drawn or imported line", hint: "A line drawn with the Drawing tool, or a GeoJSON, KML or GPX file" },
]

const DETAIL_OPTIONS = [
  { value: "-1", label: "Auto" },
  { value: "0", label: "As on screen" },
  { value: "1", label: "One level finer" },
  { value: "2", label: "Two levels finer" },
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
  const linesInUse = useAtomValue(riverRemLinesAtom)
  const fileInput = useRef<HTMLInputElement>(null)

  const source = state.remRiver ?? "main"
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
  // The centerline in use (found, named, drawn or imported), as it is drawn.
  const exportLine = () => {
    if (!linesInUse.length) return
    const name = (info?.riverLabel || "centerline").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "centerline"
    const geojson = linesToGeoJson(linesInUse, { name: info?.riverLabel ?? "", source: drawn ? "drawn or imported" : "OpenStreetMap contributors, ODbL" })
    const url = URL.createObjectURL(new Blob([JSON.stringify(geojson)], { type: "application/geo+json" }))
    const a = document.createElement("a")
    a.href = url; a.download = `river-rem-${name}.geojson`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  // A GeoJSON, KML or GPX file: its lines become the centerline, carried by
  // the link like a drawn one (simplified when too long for a URL).
  const importLine = async (file: File) => {
    try {
      const format = vectorFormatFromName(file.name) ?? "geojson"
      const lines = linesFromGeoJson(await parseVector(await file.arrayBuffer(), format))
      if (!lines.length) throw new Error("no line in this file (a LineString or MultiLineString is expected)")
      const { text, simplified } = encodeLinesForUrl(lines)
      setDrawnId(null)
      setState({ remRiver: "drawn", remLine: text })
      const length = lines.reduce((sum, l) => sum + lineLengthM(l), 0)
      pushToast({ key: "river-rem-import", title: `Centerline imported: ${km(length)}`, body: `${lines.length === 1 ? "One line" : `${lines.length} lines`} from ${file.name}${simplified ? ", simplified to fit in the link" : ""}.` })
    } catch (error) {
      pushToast({ key: "river-rem-import", tone: "warn", title: "The centerline could not be imported", body: `${file.name}: ${error instanceof Error ? error.message : "unreadable file"}.` })
    }
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
            {CENTERLINE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} title={o.hint}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="outline" size="sm" className="flex-1 min-w-0 cursor-pointer" title="A GeoJSON, KML or GPX line becomes the centerline" onClick={() => fileInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> <span className="truncate">Import line</span>
          </Button>
          <Button variant="outline" size="sm" className="flex-1 min-w-0 cursor-pointer" title="The centerline in use, as GeoJSON" disabled={!linesInUse.length} onClick={exportLine}>
            <Download className="h-3.5 w-3.5" /> <span className="truncate">Export GeoJSON</span>
          </Button>
          <input ref={fileInput} type="file" accept=".geojson,.json,.kml,.gpx" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importLine(file) }} />
        </div>
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
                <p className="text-xs text-muted-foreground">No line drawn or imported yet.</p>
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
          {info && info.banks > 0 && ` This terrain source has no heights on the water at ${info.banks} of them: the nearest bank is read there, which is rougher (the profile is smoothed and fitted rather than taken at its minimum).`}
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
          Rivers © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, read through QLever (Overpass as a fallback) when the view rests.
        </p>
      )}
    </div>
  )
}

// ─── Detrending ─────────────────────────────────────────────────────────────

const DetrendingPanel: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const info = useAtomValue(riverRemInfoAtom)
  const auto = !(state.remNeighbors > 0)
  const nearest = state.remInterp === "nearest"
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Interpolation</Label>
          <ResetButton onClick={() => setState(DETREND_DEFAULTS)} />
        </div>
        <SegmentedToggle
          value={nearest ? "nearest" : "idw"}
          onChange={(v) => setState({ remInterp: v })}
          options={[
            { value: "idw", label: "IDW", tooltip: "Inverse-distance weighting of the nearest river heights, RiverREM's: smooth across a meander neck" },
            { value: "nearest", label: "Nearest centerline", tooltip: "The river's level at the nearest place on the centerline (what a distance transform gives): exact beside the channel, with a seam where two reaches are equally near" },
          ]}
          className="w-full"
        />
        {info && (
          <p className="text-xs text-muted-foreground break-words">
            Last trend: {info.gridW} x {info.gridH} cells from {info.points} heights in {info.buildMs} ms ({info.method === "nearest" ? "nearest centerline" : `IDW, ${info.neighbors} neighbors`}).
          </p>
        )}
      </div>

      {!nearest && (<>
      <div data-slider-group="" className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-sm">IDW power</Label>
          <span className="text-sm text-muted-foreground">{(state.remPower ?? 1).toFixed(1)}</span>
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
      </>)}

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
  const elevation = state.remShow === "elevation"
  const elevRange = useAtomValue(riverRemElevRangeAtom)
  const elevAuto = state.remElevAuto !== false
  // The Elevation bounds on show: the view's while they follow it.
  const elevMin = elevAuto && elevRange ? elevRange.min : state.remElevMin ?? 0
  const elevMax = elevAuto && elevRange ? elevRange.max : state.remElevMax ?? 100
  // The slider's track: the heights in view with room on both sides.
  const elevSpan = Math.max(10, (elevRange ? elevRange.max - elevRange.min : elevMax - elevMin))
  const trackMin = Math.floor(Math.min(elevMin, elevRange?.min ?? elevMin) - elevSpan * 0.25)
  const trackMax = Math.ceil(Math.max(elevMax, elevRange?.max ?? elevMax) + elevSpan * 0.25)
  const elevStep = elevSpan > 200 ? 5 : elevSpan > 40 ? 1 : 0.5
  const detail = String(Math.max(-1, Math.min(2, Math.round(Number(state.remDetail ?? -1)))))
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Show</Label>
          <ResetButton onClick={() => setState(DISPLAY_DEFAULTS)} />
        </div>
        <SegmentedToggle
          value={elevation ? "elevation" : "rem"}
          onChange={(v) => setState({ remShow: v })}
          options={[
            { value: "rem", label: "REM", tooltip: "Height above the river" },
            { value: "elevation", label: "Elevation", tooltip: "The terrain source's own heights, with the same ramp and their own range. The river's trend is kept: switching back is instant" },
          ]}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Color ramp</Label>
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

      {elevation ? (
        <div data-slider-group="" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Elevation (m)</Label>
            <div className="flex items-center gap-2">
              <DraftBoundInput value={Math.round(elevMin * 10) / 10} onCommit={(v) => setState({ remElevAuto: false, remElevMin: clampMinCommit(v, elevMax) ?? elevMin, remElevMax: elevMax })} className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded" step={elevStep} />
              <DraftBoundInput value={Math.round(elevMax * 10) / 10} onCommit={(v) => setState({ remElevAuto: false, remElevMin: elevMin, remElevMax: clampMaxCommit(v, elevMin) ?? elevMax })} className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded" step={elevStep} />
            </div>
          </div>
          <MobileSlider
            sliderId="rem:elev-range" min={trackMin} max={trackMax} step={elevStep}
            value={[Math.max(trackMin, Math.min(trackMax, elevMin)), Math.max(trackMin, Math.min(trackMax, elevMax))]}
            onValueChange={([a, b]) => { const lo = Math.min(a, b), hi = Math.max(a, b); setState({ remElevAuto: false, remElevMin: lo, remElevMax: hi > lo ? hi : lo + elevStep }) }}
            className="w-full cursor-pointer"
          />
          <div className="flex items-center gap-2">
            <Checkbox id="rem-elev-auto" checked={elevAuto} onCheckedChange={(c) => setState(c === true ? { remElevAuto: true } : { remElevAuto: false, remElevMin: Math.round(elevMin * 10) / 10, remElevMax: Math.round(elevMax * 10) / 10 })} className="cursor-pointer" />
            <Label htmlFor="rem-elev-auto" className="text-sm font-medium cursor-pointer">Follow the heights in view</Label>
          </div>
        </div>
      ) : (
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
      )}

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
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Checkbox id="rem-contours" checked={!!state.remContours} onCheckedChange={(c) => setState({ remContours: c === true })} className="cursor-pointer" />
            <Label htmlFor="rem-contours" className="text-sm font-medium cursor-pointer truncate">{elevation ? "Contour lines" : "Contours above the river"}</Label>
          </div>
          {state.remContours && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground">every</span>
              <DraftBoundInput value={state.remContourInterval ?? 1} onCommit={(v) => setState({ remContourInterval: Math.max(0.1, v ?? 1) })} className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded" step={0.5} />
              <span className="text-xs text-muted-foreground">m</span>
            </div>
          )}
        </div>
        {state.remContours && (
          <p className="text-xs text-muted-foreground break-words">
            {elevation ? "Lines of equal elevation" : "Lines of equal height above the river"}, every fifth one bold and labeled. White unless a color is picked in the Contours section.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Height detail</Label>
        <Select value={detail} onValueChange={(v) => v != null && setState({ remDetail: Number(v) })} items={DETAIL_OPTIONS}>
          <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DETAIL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground break-words">
          How much deeper than the screen needs the terrain is read. Some sources round their heights more at low zoom (Mapterhorn: 1 m up to zoom 11, half of it per level after), which bands a floodplain into a few colors; a level finer halves the step for four times the tiles. Auto reads one level finer, except from a WMS, whose heights are exact at any zoom. Rounded heights are also smoothed within their own half step.
        </p>
      </div>

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
        Download, under General, exports what is shown (the REM, or the elevation) as a float32 GeoTIFF in metres or as colored on screen (Export layers).
      </p>
    </div>
  )
}

// ─── The group ──────────────────────────────────────────────────────────────

export const RiverRemSections: React.FC<{ state: any; setState: (updates: any) => void; draw: TerraDraw | null }> = ({ state, setState, draw }) => {
  const [open, setOpen] = useAtom(riverRemSectionsOpenAtom)
  const toggle = (key: RiverRemSectionKey) => (value: boolean) => setOpen((prev) => ({ ...prev, [key]: value }))
  return (
    <>
      <MacroSeparator label="River REM" isOpen={open.group !== false} onToggle={() => setOpen((prev) => ({ ...prev, group: prev.group === false }))} />
      {open.group !== false && (
        <>
          <Section title="River" isOpen={open.river} onOpenChange={toggle("river")} id="river-rem-river-section">
            <RiverPanel state={state} setState={setState} draw={draw} />
          </Section>
          {/* Advanced: the defaults are RiverREM's and rarely need a hand.
              Marked the way the app marks its advanced blocks (the
              "Advanced" group heading), folded by default. */}
          <Section title="Detrending" isOpen={open.detrending} onOpenChange={toggle("detrending")} id="river-rem-detrending-section" headerExtra={<GroupHeading className="mr-2">Advanced</GroupHeading>}>
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
