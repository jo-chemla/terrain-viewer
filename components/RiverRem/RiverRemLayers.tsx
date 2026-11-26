// The River REM mode on the map (appMode=rem): one raster-dem source of
// riverrem:// tiles drawn with a color-relief ramp, the centerline over it,
// optional contours of the same heights and, in view A only, the engine that
// finds the river, samples the DEM along it and builds the trend surface.
//
// First version, on purpose: the trend AND the heights it is subtracted from
// come from view A's terrain source, on every view that shows the mode. A
// trend built on one DEM and subtracted from another would mostly show the
// two DEMs' datum and survey differences.

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Loader2 } from "lucide-react"
import { customTerrainSourcesAtom, mapboxKeyAtom, maptilerKeyAtom, titilerEndpointAtom } from "@/lib/settings-atoms"
import { useClientDemUpstream, type ClientDemUpstream } from "@/components/LayersAndSources/MapSources"
import { LAYER_SLOTS } from "@/components/LayersAndSources/MapLayers"
import { ContoursLayer } from "@/components/LayersAndSources/ContoursLayer"
import { drawingFeaturesAtom } from "@/components/TerrainControlPanel/TerraDrawSystem"
import { pushToast, dismissToastByKey } from "@/components/ui/toast"
import { colorRampsFlat } from "@/lib/color-ramps"
import { yieldToMainThread } from "@/lib/normal-derived-protocol"
import {
  mergeWaterways, chooseRiverLines, decodeLines, encodeLines, lineLengthM, resampleLine, resolveSpacingM,
  cleanProfile, rampProfile, smoothProfile, medianFilter, runsUphill, sinuosity, estimateNeighbors, createTrendGrid, fillTrendRows,
  burnCenterline, labelNearestSeed, refineNearest, refineReach, blendTrendByDistance, subSamplePoints, reduceStations,
  lngToMercX, latToMercY, mercYToLat, MERCATOR_HALF, REM_GRID_SIZE,
  type Bbox, type LngLat, type Waterway, type MonotoneMode, type RiverChoice, type TrendMethod,
} from "@/lib/river-rem"
import { fetchWaterways, OverpassError, OVERPASS_MAX_AREA_DEG2, type WaterwayKinds } from "@/lib/overpass-rivers"
import { sampleRiverElevations, pickSampleZoom, samplePixelM } from "@/lib/river-rem-sample"
import { jumpFloodLabels } from "@/lib/river-rem-gpu"
import { buildRiverRemProtocolUrl, setRiverRemTrend, onRiverRemTile, riverRemElevationRange } from "@/lib/river-rem-protocol"
import { buildRemColorExpression, type RemStretch } from "@/lib/river-rem-style"
import {
  riverRemStatusAtom, riverRemRiversAtom, riverRemRevisionAtom, riverRemLinesAtom, riverRemInfoAtom,
  riverRemRetryAtom, riverRemDrawnIdAtom, riverRemProgressAtom, riverRemElevRangeAtom, type RiverRemProgress,
} from "@/lib/river-rem-atoms"

export const RIVER_REM_SOURCE_ID = "riverRemSource"
export const RIVER_REM_LAYER_ID = "river-rem-relief"

/** How long the view must rest before OpenStreetMap is asked again. */
const OVERPASS_DEBOUNCE_MS = 700
/** The searched box is the view grown by this share on each side, so a small
 *  pan stays inside it and asks nothing. */
const SEARCH_PAD = 0.3
const DEFAULT_RAMP = "rem-mako"
const PROGRESS_TOAST_KEY = "river-rem-progress"
/** A recompute shorter than this shows no toast. */
const PROGRESS_TOAST_DELAY_MS = 1000

const contains = (outer: Bbox, inner: Bbox) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
const area = (b: Bbox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
function pad(b: Bbox, share: number): Bbox {
  const dx = (b[2] - b[0]) * share, dy = (b[3] - b[1]) * share
  return [b[0] - dx, Math.max(-85, b[1] - dy), b[2] + dx, Math.min(85, b[3] + dy)]
}

interface Samples {
  key: string; perLine: LngLat[][]; elevations: Float64Array; zoom: number; spacingM: number; lengthM: number; lines: LngLat[][]; label: string; banks: number
  /** Readings of the terrain behind each height, and the pixel they were read at (m). */
  perStation: number; pixelM: number
  /** Terrain tiles read for it, and how long the reading took. */
  tiles: number; sampleMs: number
}

/** Most readings of the terrain per height along the river. */
const MAX_READINGS_PER_HEIGHT = 8
/** How far into a long flat reach (a reservoir) the ramp of a step may run. */
const RAMP_REACH_M = 5000
/** Half width of each of the two box passes that follow the ramps: a lone
 *  step is spread over four times this. */
const SMOOTH_RADIUS_M = 300
/** The trend grid of the distance-transform and jump-flood methods: one cell
 *  for this many screen pixels, between these sizes. */
const TREND_PX_PER_CELL = 2
const TREND_GRID_MIN = 512
const TREND_GRID_MAX = 2048
const METHOD_LABEL: Record<TrendMethod, string> = {
  idw: "Inverse-distance weighting of the river's level",
  nearest: "Nearest point of the centerline, by a scan",
  edt: "Nearest point of the centerline, by a distance transform",
  jfa: "Nearest point of the centerline, by a jump flood on the GPU",
}

/** Above this share of heights read from a bank (no height on the water), the
 *  profile is median-filtered before it is cleaned. */
const BANK_SHARE_FOR_MEDIAN = 0.2

// ─── The progress toast ─────────────────────────────────────────────────────

const STEP_LABELS = ["Finding the river", "Reading heights along it", "Detrending", "Drawing"] as const

/** The toast's body: reads the progress itself, so the toast is pushed once
 *  and updates in place. Four segments, the current one filling when the
 *  step reports how far it is and pulsing when it cannot. */
function ProgressBody() {
  const progress = useAtomValue(riverRemProgressAtom)
  if (!progress) return null
  return (
    <div className="mt-1 w-[280px] max-w-full space-y-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-popover-foreground">{progress.step}/4</span> {STEP_LABELS[progress.step - 1]}
          {progress.fraction != null && ` · ${Math.round(progress.fraction * 100)} %`}
        </span>
      </div>
      <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={progress.step - 1 + (progress.fraction ?? 0)}>
        {STEP_LABELS.map((label, i) => {
          const fill = i + 1 < progress.step ? 1 : i + 1 > progress.step ? 0 : progress.fraction ?? 1
          const spinning = i + 1 === progress.step && progress.fraction == null
          return (
            <div key={label} title={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full bg-primary transition-[width] duration-200 ${spinning ? "animate-pulse" : ""}`} style={{ width: `${Math.round(fill * 100)}%` }} />
            </div>
          )
        })}
      </div>
      {progress.detail && <p className="break-words">{progress.detail}</p>}
    </div>
  )
}

/** Shows the toast while the engine works: at once for the first REM of a
 *  session (nothing is on screen yet), after a second for a recompute. */
function useProgressToast(progress: RiverRemProgress | null, hasRem: boolean, enabled: boolean) {
  const busy = !!progress && enabled
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout>; shown: boolean }>({ shown: false })
  useEffect(() => {
    const t = timers.current
    if (busy) {
      // Between two steps nothing is running for a render or two: the end is
      // only believed after a moment, so the toast neither blinks nor
      // restarts its one-second wait at every step.
      clearTimeout(t.hide); t.hide = undefined
      if (t.shown || t.show) return
      const show = () => { t.show = undefined; t.shown = true; pushToast({ key: PROGRESS_TOAST_KEY, title: "Computing the River REM", body: <ProgressBody />, duration: Infinity }) }
      if (!hasRem) show()
      else t.show = setTimeout(show, PROGRESS_TOAST_DELAY_MS)
      return
    }
    if (t.hide) return
    t.hide = setTimeout(() => {
      t.hide = undefined
      clearTimeout(t.show); t.show = undefined
      t.shown = false
      dismissToastByKey(PROGRESS_TOAST_KEY)
    }, 400)
    // `hasRem` is read when the work starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])
  useEffect(() => () => {
    const t = timers.current
    clearTimeout(t.show); clearTimeout(t.hide)
    dismissToastByKey(PROGRESS_TOAST_KEY)
  }, [])
}

// ─── Engine (view A) ────────────────────────────────────────────────────────

function RiverRemEngine({ state, setState, upstream }: { state: any; setState: (updates: any) => void; upstream: ClientDemUpstream | null }) {
  const { current: mapRef } = useMap()
  const setStatus = useSetAtom(riverRemStatusAtom)
  const setRivers = useSetAtom(riverRemRiversAtom)
  const [revision, setRevision] = useAtom(riverRemRevisionAtom)
  const setLines = useSetAtom(riverRemLinesAtom)
  const setInfo = useSetAtom(riverRemInfoAtom)
  const [progress, setProgress] = useAtom(riverRemProgressAtom)
  const setElevRange = useSetAtom(riverRemElevRangeAtom)
  const retry = useAtomValue(riverRemRetryAtom)
  const features = useAtomValue(drawingFeaturesAtom)
  const [drawnId, setDrawnId] = useAtom(riverRemDrawnIdAtom)

  const drawn = state.remRiver === "drawn"
  const kinds: WaterwayKinds = state.remWaterways === "all" ? "all" : "river"
  const showElevation = state.remShow === "elevation"

  // ── 1a. The centerline from OpenStreetMap, for the view ──
  const [osm, setOsm] = useState<{ bbox: Bbox; kinds: WaterwayKinds; ways: Waterway[] } | null>(null)
  const osmRef = useRef(osm)
  osmRef.current = osm
  const [osmProblem, setOsmProblem] = useState<{ message: string; canRetry: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const map = mapRef?.getMap()
    if (drawn || !map) { setSearching(false); setOsmProblem(null); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | null = null
    let disposed = false
    const run = () => {
      const b = map.getBounds()
      const view: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      const last = osmRef.current
      if (last && last.kinds === kinds && contains(last.bbox, view)) { setOsmProblem(null); return }
      if (area(view) > OVERPASS_MAX_AREA_DEG2) {
        setSearching(false)
        setOsmProblem({ message: "Zoom in to look for rivers in OpenStreetMap.", canRetry: false })
        return
      }
      const padded = pad(view, SEARCH_PAD)
      const box = area(padded) > OVERPASS_MAX_AREA_DEG2 ? view : padded
      controller?.abort()
      const mine = (controller = new AbortController())
      setSearching(true)
      setSlow(false)
      setOsmProblem(null)
      fetchWaterways(box, kinds, { signal: mine.signal, onSlow: () => { if (!disposed && !mine.signal.aborted) setSlow(true) } }).then((ways) => {
        if (disposed || mine.signal.aborted) return
        setSearching(false)
        setOsm({ bbox: box, kinds, ways })
      }).catch((error) => {
        if (disposed || mine.signal.aborted) return
        setSearching(false)
        const busy = error instanceof OverpassError && (error.kind === "busy" || error.kind === "timeout")
        setOsmProblem({
          message: busy
            ? "The OpenStreetMap query servers (QLever, Overpass) are busy or too slow right now. Try again in a moment, or draw the centerline."
            : error instanceof OverpassError ? `${error.message}.` : "The river search failed.",
          canRetry: true,
        })
      })
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(run, OVERPASS_DEBOUNCE_MS) }
    schedule()
    map.on("moveend", schedule)
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); map.off("moveend", schedule) }
  }, [mapRef, drawn, kinds, retry])

  const rivers = useMemo(() => (osm ? mergeWaterways(osm.ways, osm.bbox) : []), [osm])
  useEffect(() => {
    setRivers(rivers.map((r) => ({ name: r.name, kind: r.kind, lengthM: r.lengthM })))
  }, [rivers, setRivers])

  // ── 1b. A drawn line: the followed Terra Draw feature is copied to the URL ──
  const knownIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!drawn) { knownIds.current = null; return }
    const finished = features.filter((f) => f.geometry?.type === "LineString" && !f.properties?.currentlyDrawing && (f.geometry.coordinates?.length ?? 0) >= 2)
    // A line finished while the mode waits for one becomes the centerline.
    const fresh = knownIds.current ? finished.find((f) => !knownIds.current!.has(String(f.id))) : undefined
    const adopt = fresh ?? (!state.remLine && !drawnId ? finished[finished.length - 1] : undefined)
    knownIds.current = new Set(finished.map((f) => String(f.id)))
    if (adopt && String(adopt.id) !== drawnId) { setDrawnId(String(adopt.id)); return }
    const followed = finished.find((f) => String(f.id) === drawnId)
    if (!followed) return
    const encoded = encodeLines([followed.geometry.coordinates as LngLat[]])
    if (encoded && encoded !== state.remLine) setState({ remLine: encoded })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, drawn, drawnId, state.remLine])

  // ── The lines in use ──
  const choice = useMemo(() => {
    if (drawn) {
      const lines = decodeLines(state.remLine ?? "")
      return { lines, label: lines.length ? "Drawn line" : "" }
    }
    return chooseRiverLines(rivers, state.remRiver as RiverChoice, state.remRiverName ?? "")
  }, [drawn, rivers, state.remLine, state.remRiver, state.remRiverName])
  const linesKey = useMemo(() => encodeLines(choice.lines), [choice])
  useEffect(() => { setLines(choice.lines) }, [linesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Heights along them ──
  const [samples, setSamples] = useState<Samples | null>(null)
  const [sampling, setSampling] = useState(false)
  const [sampleProgress, setSampleProgress] = useState<{ done: number; total: number; points: number } | null>(null)
  const [sampleProblem, setSampleProblem] = useState("")
  const template = upstream?.template, encoding = upstream?.encoding, tileSize = upstream?.tileSize, minzoom = upstream?.minzoom, maxzoom = upstream?.maxzoom
  const spacingSetting = Number(state.remSpacing) || 0
  useEffect(() => {
    setSampleProblem("")
    if (!template || !encoding || !tileSize || !choice.lines.length) { setSamples(null); setSampling(false); return }
    const controller = new AbortController()
    const key = `${linesKey}|${spacingSetting}|${template}|${maxzoom}`
    setSampling(true)
    setSampleProgress(null)
    const timer = setTimeout(async () => {
      try {
        const lengthM = choice.lines.reduce((sum, l) => sum + lineLengthM(l), 0)
        const spacingM = resolveSpacingM(lengthM, spacingSetting)
        const perLine = choice.lines.map((l) => resampleLine(l, spacingM))
        const points = perLine.flat()
        // The zoom is the finest the tile budget allows; the terrain is then
        // read about once a pixel along the line (several readings per
        // height, a low quantile of them kept) rather than once per spacing:
        // a bar the centerline cuts across, a bridge or one pit no longer
        // decide a height on their own.
        const source = { template, encoding, tileSize, minzoom, maxzoom }
        const zoom = pickSampleZoom(points, source)
        const pixelM = samplePixelM(zoom, points[0]?.[1] ?? 0, tileSize)
        const perStation = Math.max(1, Math.min(MAX_READINGS_PER_HEIGHT, Math.round(spacingM / pixelM)))
        const readings = perLine.flatMap((l) => subSamplePoints(l, perStation))
        const started = performance.now()
        const read = await sampleRiverElevations(readings, source, controller.signal,
          (done, total) => setSampleProgress({ done, total, points: points.length }), zoom)
        if (controller.signal.aborted) return
        // Dev-only: every reading's cost (the panel shows the last one, which is a cached re-read when the lines were found twice).
        if (import.meta.env.DEV) ((window as any).__tvRemSampleRuns ??= []).push({ zoom, tiles: read.tiles, ms: Math.round(performance.now() - started), readings: readings.length })
        setSamples({
          key, perLine, elevations: reduceStations(read.elevations, perStation), zoom, spacingM, lengthM, lines: choice.lines, label: choice.label,
          banks: Math.round(read.banks / perStation), perStation, pixelM, tiles: read.tiles, sampleMs: Math.round(performance.now() - started),
        })
      } catch {
        if (controller.signal.aborted) return
        setSamples(null)
        setSampleProblem("The terrain source could not be read along the river.")
      } finally {
        if (!controller.signal.aborted) setSampling(false)
      }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey, spacingSetting, template, encoding, tileSize, minzoom, maxzoom])

  // ── 3. Cleaning and the trend surface ──
  const [building, setBuilding] = useState(false)
  const [buildFraction, setBuildFraction] = useState(0)
  const [trendProblem, setTrendProblem] = useState("")
  // ── 4. The first tiles of a new trend ──
  const [rendering, setRendering] = useState<{ since: number; tiles: number } | null>(null)
  const monotone = (state.remMonotone ?? "min") as MonotoneMode
  const power = Number(state.remPower) > 0 ? Number(state.remPower) : 1
  const neighborsSetting = Math.max(0, Math.floor(Number(state.remNeighbors) || 0))
  const method: TrendMethod = state.remInterp === "idw" || state.remInterp === "nearest" || state.remInterp === "jfa" ? state.remInterp : "edt"
  const blend = method === "idw" ? 0 : Math.min(2, Math.max(0, Number(state.remBlend ?? 0.5) || 0))
  const gridSetting = Math.max(0, Math.floor(Number(state.remGrid) || 0))
  const smooth = state.remSmooth !== false
  useEffect(() => {
    setTrendProblem("")
    if (!samples) { setBuilding(false); return }
    let cancelled = false
    setBuilding(true)
    setBuildFraction(0)
    const timer = setTimeout(async () => {
      const xs: number[] = [], ys: number[] = [], zs: number[] = [], starts: number[] = []
      let offset = 0, corrected = 0, levelHigh = -Infinity, levelLow = Infinity, maxStep = 0
      const rampReach = Math.max(2, Math.round(RAMP_REACH_M / samples.spacingM))
      const smoothRadius = Math.max(1, Math.round(SMOOTH_RADIUS_M / samples.spacingM))
      // A DEM with no heights on water was read from the banks: noisy, with
      // pits a running minimum would latch onto (GEM-15 on the Mississippi:
      // bank readings from -29 to 36 m around a river at 30 m). A long
      // running median, then the monotone fit instead of the minimum.
      const despike = samples.banks > BANK_SHARE_FOR_MEDIAN * samples.elevations.length
      const cleaning: MonotoneMode = despike && monotone === "min" ? "fit" : monotone
      for (const line of samples.perLine) {
        const read = samples.elevations.subarray(offset, offset + line.length)
        const raw = despike ? medianFilter(read, 31) : read
        offset += line.length
        // OpenStreetMap draws a waterway the way it flows; a hand-drawn line
        // can go either way, so it is read from its higher end.
        const reversed = drawn && runsUphill(raw)
        const ordered = reversed ? Float64Array.from(raw).reverse() : raw
        const cleaned = cleanProfile(ordered, cleaning)
        // The staircase left by rounded heights, survey seams and the
        // running minimum, read as ramps: each step would otherwise be
        // printed across the floodplain as a straight line.
        const levels = smooth ? smoothProfile(rampProfile(cleaned, rampReach), smoothRadius) : cleaned
        let first = true, previous = NaN
        for (let i = 0; i < line.length; i++) {
          const level = levels[i]
          if (!Number.isFinite(level)) continue
          const point = line[reversed ? line.length - 1 - i : i]
          xs.push(lngToMercX(point[0])); ys.push(latToMercY(point[1])); zs.push(level); starts.push(first ? 1 : 0)
          first = false
          if (Math.abs(previous - level) > maxStep) maxStep = Math.abs(previous - level)
          previous = level
          if (Math.abs(cleaned[i] - ordered[i]) > 0.1) corrected++
          if (level > levelHigh) levelHigh = level
          if (level < levelLow) levelLow = level
        }
      }
      if (xs.length < 2) {
        setBuilding(false)
        setTrendProblem("The terrain source has no heights along this river.")
        return
      }
      // Dev-only: the profile in use, for a console or an automated browser.
      if (import.meta.env.DEV) (window as any).__tvRemProfile = { read: Array.from(samples.elevations), levels: zs.slice(), starts: starts.slice(), spacingM: samples.spacingM }
      const riverSinuosity = sinuosity(samples.lines)
      const neighbors = neighborsSetting > 0 ? Math.min(neighborsSetting, xs.length) : estimateNeighbors(xs.length, riverSinuosity)
      // The grid covers the samples with a margin, the searched box and what
      // is on screen now; beyond it the tiles read its edge.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < xs.length; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]) }
      const margin = Math.max(3000, 0.3 * Math.max(x1 - x0, y1 - y0))
      x0 -= margin; y0 -= margin; x1 += margin; y1 += margin
      const include = (b: Bbox | null | undefined) => {
        if (!b) return
        x0 = Math.min(x0, lngToMercX(b[0])); y0 = Math.min(y0, latToMercY(b[1])); x1 = Math.max(x1, lngToMercX(b[2])); y1 = Math.max(y1, latToMercY(b[3]))
      }
      if (!drawn) include(osmRef.current?.bbox)
      const view = mapRef?.getMap()?.getBounds()
      if (view && (view.getEast() - view.getWest()) * (view.getNorth() - view.getSouth()) <= OVERPASS_MAX_AREA_DEG2) include([view.getWest(), view.getSouth(), view.getEast(), view.getNorth()])

      const points = { x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs), starts: Uint8Array.from(starts) }
      // IDW and the scanned nearest cost cells x samples and stay on 256
      // cells. The distance transform and the jump flood cost cells alone and
      // follow the screen: one cell for two pixels of the view the trend is
      // built for, or the size asked for.
      const transform = method === "edt" || method === "jfa"
      let size = REM_GRID_SIZE
      if (transform) {
        const zoomNow = mapRef?.getMap()?.getZoom() ?? 10
        const pixels = Math.max(x1 - x0, y1 - y0) / ((2 * MERCATOR_HALF) / (512 * 2 ** zoomNow))
        size = gridSetting > 0
          ? Math.min(TREND_GRID_MAX, Math.max(REM_GRID_SIZE, gridSetting))
          : Math.min(TREND_GRID_MAX, Math.max(TREND_GRID_MIN, Math.ceil(pixels / TREND_PX_PER_CELL / 64) * 64))
      }
      const grid = createTrendGrid({ x0, y0, x1, y1 }, size)
      // Only the computing is timed: the yields between chunks are the page's.
      let fillMs = 0, blendMs = 0
      let gpu: boolean | undefined
      const step = async (fraction: number, run: () => void) => {
        const t0 = performance.now()
        run()
        fillMs += performance.now() - t0
        setBuildFraction(Math.min(1, fraction))
        await yieldToMainThread()
        return !cancelled
      }
      if (transform) {
        let seeds!: Int32Array, labels: Int32Array | null = null
        if (!(await step(0.05, () => { seeds = burnCenterline(grid, points) }))) return
        if (!(await step(0.3, () => {
          // The same labels by either road; the GPU's when it can.
          if (method === "jfa") { labels = jumpFloodLabels(seeds, grid.w, grid.h)?.labels ?? null; gpu = labels !== null }
          labels ??= labelNearestSeed(seeds, grid.w, grid.h)
        }))) return
        const reach = refineReach(grid, points)
        const chunk = Math.max(16, Math.round(120000 / grid.w))
        for (let row = 0; row < grid.h; row += chunk) {
          if (!(await step(0.3 + (0.5 * (row + chunk)) / grid.h, () => refineNearest(grid, points, labels!, row, Math.min(grid.h, row + chunk), reach)))) return
        }
      } else {
        if (method === "nearest") grid.dist = new Float32Array(grid.w * grid.h)
        const options = { power, neighbors, method }
        for (let row = 0; row < grid.h; row += 16) {
          if (!(await step(((blend > 0 ? 0.8 : 1) * (row + 16)) / grid.h, () => fillTrendRows(grid, points, options, row, Math.min(grid.h, row + 16))))) return
        }
      }
      const cell = Math.max((grid.x1 - grid.x0) / (grid.w - 1), (grid.y1 - grid.y0) / (grid.h - 1))
      if (blend > 0 && grid.dist) {
        const before = fillMs
        if (!(await step(1, () => blendTrendByDistance(grid.data, grid.dist!, grid.w, grid.h, cell, blend)))) return
        blendMs = fillMs - before
      }
      // Only the blending reads the distances: 16 MB at 2048 cells.
      grid.dist = undefined
      setRendering({ since: performance.now(), tiles: 0 })
      setRevision(setRiverRemTrend(grid))
      setInfo({
        riverLabel: samples.label, lengthM: samples.lengthM, points: xs.length, spacingM: samples.spacingM, sampleZoom: samples.zoom,
        neighbors, sinuosity: riverSinuosity, levelHigh, levelLow, corrected, buildMs: Math.round(fillMs), gridW: grid.w, gridH: grid.h, method, banks: samples.banks,
        blendMs: Math.round(blendMs), cellM: cell * Math.cos((mercYToLat((y0 + y1) / 2) * Math.PI) / 180), gpu,
        perStation: samples.perStation, pixelM: samples.pixelM, maxStep, sampleTiles: samples.tiles, sampleMs: samples.sampleMs,
      })
      setBuilding(false)
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, monotone, power, neighborsSetting, method, blend, gridSetting, smooth])

  // The drawing step ends a moment after the first tile of the new trend, or
  // after a few seconds when none comes (the REM hidden, every tile cached).
  // The tiles are counted by a listener that is there from the start: the
  // first ones of a new trend are computed before an effect started by that
  // trend would have had time to listen (measured: 30 tiles, one burst).
  useEffect(() => onRiverRemTile(() => setRendering((r) => (r ? { ...r, tiles: r.tiles + 1 } : r))), [])
  const renderingSince = rendering?.since, renderingDrawn = (rendering?.tiles ?? 0) > 0
  useEffect(() => {
    if (renderingSince == null) return
    const timer = setTimeout(() => setRendering(null), renderingDrawn ? 500 : 8000)
    return () => clearTimeout(timer)
  }, [renderingSince, renderingDrawn])

  // ── Elevation display: the range of the heights in view ──
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !showElevation) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      const b = map.getBounds()
      const range = riverRemElevationRange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      if (range) setElevRange((prev) => (prev && prev.min === range.min && prev.max === range.max ? prev : range))
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(read, 250) }
    schedule()
    map.on("moveend", schedule)
    const off = onRiverRemTile(schedule)
    return () => { clearTimeout(timer); map.off("moveend", schedule); off() }
  }, [mapRef, showElevation, setElevRange])

  // ── One status line for the panel, one progress for the toast ──
  const hasLines = choice.lines.length > 0
  useEffect(() => {
    if (!upstream) setStatus({ phase: "error", message: "This terrain source cannot be read in the browser, so no REM can be computed from it." })
    else if (searching && !hasLines) setStatus({ phase: "rivers", message: slow ? "The first OpenStreetMap server is slow to answer: asking another too…" : "Looking for rivers in OpenStreetMap…" })
    else if (osmProblem && !hasLines) setStatus({ phase: "error", message: osmProblem.message, canRetry: osmProblem.canRetry })
    else if (!hasLines) setStatus({ phase: "empty", message: drawn ? "Draw a line along the river, import one, or pick one already drawn." : "No river found in view. Pan, zoom out, include streams and canals, or draw the centerline." })
    else if (sampleProblem || trendProblem) setStatus({ phase: "error", message: sampleProblem || trendProblem })
    else if (sampling) setStatus({ phase: "sampling", message: "Reading heights along the river…" })
    else if (building) setStatus({ phase: "trend", message: "Interpolating the river's level…" })
    else if (osmProblem) setStatus({ phase: "ready", message: `${osmProblem.message} The last rivers found stay in use.`, canRetry: osmProblem.canRetry })
    else if (searching) setStatus({ phase: "ready", message: slow ? "The first OpenStreetMap server is slow to answer; the last rivers found stay in use meanwhile." : "Looking for rivers in OpenStreetMap…" })
    else setStatus({ phase: "ready", message: "" })
  }, [upstream, searching, slow, osmProblem, hasLines, drawn, sampleProblem, trendProblem, sampling, building, setStatus])

  useEffect(() => {
    let next: RiverRemProgress | null = null
    if (!upstream || sampleProblem || trendProblem) next = null
    else if (searching && !hasLines) next = { step: 1, detail: slow ? "The first OpenStreetMap server is slow: asking another too." : "Asking OpenStreetMap for the rivers in view." }
    else if (sampling) {
      next = sampleProgress
        ? { step: 2, detail: `${sampleProgress.points} heights, ${sampleProgress.done} of ${sampleProgress.total} terrain tiles read.`, fraction: sampleProgress.total ? sampleProgress.done / sampleProgress.total : undefined }
        : { step: 2, detail: choice.label ? `${choice.label}: reading the terrain under the centerline.` : "Reading the terrain under the centerline." }
    } else if (building) next = { step: 3, detail: `${METHOD_LABEL[method]}.`, fraction: buildFraction }
    else if (rendering) next = { step: 4, detail: rendering.tiles ? `${rendering.tiles} tiles drawn.` : "Subtracting the river's level from the terrain tiles." }
    setProgress(next)
  }, [upstream, searching, slow, hasLines, sampling, sampleProgress, building, buildFraction, rendering, sampleProblem, trendProblem, method, choice.label, setProgress])
  useEffect(() => () => setProgress(null), [setProgress])

  // The Elevation display needs no trend: its picture is not waiting on this.
  useProgressToast(progress, revision > 0, !showElevation)

  return null
}

// ─── Tile borders ───────────────────────────────────────────────────────────

/** Copies each loaded tile's one-pixel border again from its loaded
 *  neighbors, for a raster-dem source whose tiles were reloaded in place.
 *
 *  MapLibre (6.13, tile_manager_raster_dem.ts) fills a tile's border from a
 *  neighbor once, when the tile loads, and marks the pair done. When the
 *  source's tiles are all reloaded with new contents (a new trend: the
 *  revision in the tile address), a tile that arrives before its neighbor
 *  copies the neighbor's OLD edge, and nothing refreshes it when the neighbor
 *  arrives. Arriving from another river (a bookmark) the old edge is the
 *  terrain minus the other river's level, far out of the ramp: a one-pixel
 *  line of the ramp's first color along some tile edges, at fractional zooms
 *  (found 2026-11-26 on the Mississippi bookmark, 189 m of difference).
 *
 *  Reads MapLibre's tiles through private fields, so everything is checked
 *  and a miss does nothing. */
function refreshDemBorders(map: any, sourceId: string): void {
  try {
    const tiles: Record<string, any> | undefined = map?.style?.tileManagers?.[sourceId]?._inViewTiles?._tiles
    if (!tiles) return
    let touched = false
    for (const tile of Object.values(tiles)) {
      if (!tile?.dem || !tile.neighboringTiles || typeof tile.dem.backfillBorder !== "function") continue
      const here = tile.tileID.canonical
      const world = 2 ** here.z
      let filled = false
      for (const key of Object.keys(tile.neighboringTiles)) {
        const other = tiles[key]
        if (!other?.dem || other.dem.dim !== tile.dem.dim) continue
        let dx = other.tileID.canonical.x - here.x
        const dy = other.tileID.canonical.y - here.y
        if (Math.abs(dx) > 1) { if (Math.abs(dx + world) === 1) dx += world; else if (Math.abs(dx - world) === 1) dx -= world }
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) continue
        tile.dem.backfillBorder(other.dem, dx, dy)
        tile.neighboringTiles[key].backfilled = true
        filled = true
      }
      if (filled) { tile.needsHillshadePrepare = true; tile.needsTerrainPrepare = true; tile.needsColorReliefPrepare = true; touched = true }
    }
    if (touched) map.triggerRepaint()
  } catch { /* MapLibre's internals moved: the borders stay as MapLibre left them */ }
}

/** Refreshes the borders of the REM tiles after each new trend: once the
 *  burst of reloaded tiles has settled, and again until the source reports
 *  itself loaded. */
function useFreshDemBorders(revision: number, active: boolean) {
  const { current: mapRef } = useMap()
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !active || revision <= 0) return
    let dirty = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      refreshDemBorders(map, RIVER_REM_SOURCE_ID)
      try { if (map.isSourceLoaded(RIVER_REM_SOURCE_ID)) dirty = false } catch { dirty = false }
    }
    const onData = (e: any) => {
      if (!dirty || e?.sourceId !== RIVER_REM_SOURCE_ID) return
      clearTimeout(timer)
      timer = setTimeout(run, 120)
    }
    map.on("sourcedata", onData)
    timer = setTimeout(run, 120)
    return () => { clearTimeout(timer); map.off("sourcedata", onData) }
  }, [mapRef, revision, active])
}

// ─── Layers (every view) ────────────────────────────────────────────────────

function RiverRemInner({ primary, state, setState, terrainSource, mapLoaded, theme }: {
  primary: boolean; state: any; setState: (updates: any) => void; terrainSource: string; mapLoaded: boolean; theme: string
}) {
  const customTerrainSources = useAtomValue(customTerrainSourcesAtom)
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const maptilerKey = useAtomValue(maptilerKeyAtom)
  const titilerEndpoint = useAtomValue(titilerEndpointAtom)
  const upstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const revision = useAtomValue(riverRemRevisionAtom)
  const lines = useAtomValue(riverRemLinesAtom)
  const elevRange = useAtomValue(riverRemElevRangeAtom)

  const showElevation = state.remShow === "elevation"
  // The Elevation range: what is in view while it follows, the saved bounds
  // otherwise (and until the first tiles are read).
  const elevMin = state.remElevAuto !== false && elevRange ? elevRange.min : state.remElevMin ?? 0
  const elevMax = state.remElevAuto !== false && elevRange ? elevRange.max : state.remElevMax ?? 100

  const paint = useMemo(() => {
    const ramps = colorRampsFlat as Record<string, { colors: unknown[] }>
    const ramp = ramps[state.remColorRamp] ?? ramps[DEFAULT_RAMP]
    const min = showElevation ? elevMin : state.remMin ?? 0
    const max = showElevation ? elevMax : state.remMax ?? 10
    return {
      "color-relief-color": buildRemColorExpression(ramp.colors, min, max, (state.remStretch ?? "log") as RemStretch, state.remGamma ?? 0.5, !!state.remInvertColorRamp),
      "color-relief-opacity": Math.min(1, Math.max(0, state.remOpacity ?? 1)),
    }
  }, [state.remColorRamp, state.remMin, state.remMax, showElevation, elevMin, elevMax, state.remStretch, state.remGamma, state.remInvertColorRamp, state.remOpacity])

  const lineData = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: lines.map((coordinates) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } })),
  }), [lines])

  // The Elevation display has no trend to wait for.
  const ready = !!upstream && (showElevation || revision > 0)
  useFreshDemBorders(revision, ready && !showElevation)
  // Heights read `detail` zoom levels deeper than the screen needs: the
  // source is declared with smaller tiles, so MapLibre asks for the level
  // below and each tile still comes at its full size. A source that rounds
  // its heights by zoom (Mapterhorn: 1 m up to z11, half of it per level
  // after) is twice as fine one level down. Auto (-1) is one level, except
  // for a WMS or an ImageServer read as raw floats: its heights are exact at
  // any zoom and every tile is a render on the server (IGN LiDAR HD took
  // minutes to fill a view at four times the requests).
  const detailSetting = Math.round(Number(state.remDetail ?? -1))
  const detail = detailSetting >= 0 ? Math.min(2, detailSetting) : upstream?.template.startsWith("float32dem-bbox://") ? 0 : 1
  const mapTileSize = upstream ? Math.max(128, upstream.tileSize >> detail) : 256
  const tileUrl = upstream ? buildRiverRemProtocolUrl(upstream.template, upstream.encoding, upstream.tileSize, revision, showElevation) : ""
  const contourInterval = Math.max(0.05, Number(state.remContourInterval) || 1)
  const contourDem = useMemo(
    () => (upstream && ready ? { template: tileUrl, encoding: "terrarium" as const, tileSize: upstream.tileSize, maxzoom: upstream.maxzoom } : undefined),
    [upstream, ready, tileUrl],
  )
  return (
    <>
      {primary && <RiverRemEngine state={state} setState={setState} upstream={upstream} />}
      {ready && upstream && (
        <Source
          id={RIVER_REM_SOURCE_ID}
          // Remounted only when the DEM behind it (or its tile size) changes;
          // a new trend changes `tiles` (the revision), which reloads the
          // tiles in place.
          key={`${RIVER_REM_SOURCE_ID}-${terrainSource}-${upstream.template}-z${upstream.maxzoom}-t${mapTileSize}`}
          type="raster-dem"
          tiles={[tileUrl]}
          tileSize={mapTileSize}
          encoding="terrarium"
          attribution="River centerline © OpenStreetMap contributors"
          {...(upstream.minzoom != null ? { minzoom: upstream.minzoom } : {})}
          {...(upstream.maxzoom != null ? { maxzoom: upstream.maxzoom } : {})}
        >
          <Layer beforeId={LAYER_SLOTS.RIVER_REM} id={RIVER_REM_LAYER_ID} type="color-relief" paint={paint as any} />
        </Source>
      )}
      {/* Contours of the same heights: every metre above the river (or of
          elevation, in the Elevation display), traced by the app's contour
          engine over the riverrem:// tiles. */}
      {state.remContours && contourDem && (
        <ContoursLayer
          idPrefix="remcontour"
          showContours
          showContourLabels
          sourceId={terrainSource}
          dem={contourDem}
          referenceMode="absolute"
          lrmRadius={16}
          contourMinor={contourInterval}
          contourMajor={contourInterval * 5}
          contourWeight={1}
          // White by default: the theme's translucent black is lost on the
          // ramp's dark high ground.
          contourColor={state.contourColor || "rgba(255,255,255,0.6)"}
          mapboxKey={mapboxKey}
          maptilerKey={maptilerKey}
          customTerrainSources={customTerrainSources}
          titilerEndpoint={titilerEndpoint}
          mapLoaded={mapLoaded}
          theme={theme}
        />
      )}
      <Source id="riverRemLineSource" type="geojson" data={lineData}>
        <Layer
          beforeId={LAYER_SLOTS.CONTOURS}
          id="river-rem-centerline"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round", visibility: state.remShowLine === false ? "none" : "visible" }}
          paint={{ "line-color": "#ff5a36", "line-width": 1.5, "line-opacity": 0.9 }}
        />
      </Source>
    </>
  )
}

export const RiverRemLayers = memo(({ enabled, primary, state, setState, terrainSource, mapLoaded, theme }: {
  enabled: boolean
  /** View A: runs the engine. */
  primary: boolean
  state: any
  setState: (updates: any) => void
  /** View A's terrain source, on every view (see the header). */
  terrainSource: string
  /** For the contours: the map has fired `load`. */
  mapLoaded: boolean
  theme: string
}) => {
  if (!enabled) return null
  return <RiverRemInner primary={primary} state={state} setState={setState} terrainSource={terrainSource} mapLoaded={mapLoaded} theme={theme} />
})
RiverRemLayers.displayName = "RiverRemLayers"
