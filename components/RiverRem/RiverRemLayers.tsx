// The River REM mode on the map (appMode=rem): one raster-dem source of
// riverrem:// tiles drawn with a color-relief ramp, the centerline over it,
// and, in view A only, the engine that finds the river, samples the DEM
// along it and builds the trend surface.
//
// First version, on purpose: the trend AND the heights it is subtracted from
// come from view A's terrain source, on every view that shows the mode. A
// trend built on one DEM and subtracted from another would mostly show the
// two DEMs' datum and survey differences.

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { customTerrainSourcesAtom, mapboxKeyAtom, maptilerKeyAtom, titilerEndpointAtom } from "@/lib/settings-atoms"
import { useClientDemUpstream, type ClientDemUpstream } from "@/components/LayersAndSources/MapSources"
import { LAYER_SLOTS } from "@/components/LayersAndSources/MapLayers"
import { drawingFeaturesAtom } from "@/components/TerrainControlPanel/TerraDrawSystem"
import { colorRampsFlat } from "@/lib/color-ramps"
import { yieldToMainThread } from "@/lib/normal-derived-protocol"
import {
  mergeWaterways, chooseRiverLines, decodeLines, encodeLines, lineLengthM, resampleLine, resolveSpacingM,
  cleanProfile, runsUphill, sinuosity, estimateNeighbors, createTrendGrid, fillTrendRows,
  lngToMercX, latToMercY, type Bbox, type LngLat, type Waterway, type MonotoneMode, type RiverChoice,
} from "@/lib/river-rem"
import { fetchWaterways, OverpassError, OVERPASS_MAX_AREA_DEG2, type WaterwayKinds } from "@/lib/overpass-rivers"
import { sampleRiverElevations } from "@/lib/river-rem-sample"
import { buildRiverRemProtocolUrl, setRiverRemTrend } from "@/lib/river-rem-protocol"
import { buildRemColorExpression, type RemStretch } from "@/lib/river-rem-style"
import {
  riverRemStatusAtom, riverRemRiversAtom, riverRemRevisionAtom, riverRemLinesAtom, riverRemInfoAtom,
  riverRemRetryAtom, riverRemDrawnIdAtom,
} from "@/lib/river-rem-atoms"

export const RIVER_REM_SOURCE_ID = "riverRemSource"
export const RIVER_REM_LAYER_ID = "river-rem-relief"

/** How long the view must rest before OpenStreetMap is asked again. */
const OVERPASS_DEBOUNCE_MS = 700
/** The searched box is the view grown by this share on each side, so a small
 *  pan stays inside it and asks nothing. */
const SEARCH_PAD = 0.3
const DEFAULT_RAMP = "rem-mako"

const contains = (outer: Bbox, inner: Bbox) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
const area = (b: Bbox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
function pad(b: Bbox, share: number): Bbox {
  const dx = (b[2] - b[0]) * share, dy = (b[3] - b[1]) * share
  return [b[0] - dx, Math.max(-85, b[1] - dy), b[2] + dx, Math.min(85, b[3] + dy)]
}

interface Samples { key: string; perLine: LngLat[][]; elevations: Float64Array; zoom: number; spacingM: number; lengthM: number; lines: LngLat[][]; label: string }

// ─── Engine (view A) ────────────────────────────────────────────────────────

function RiverRemEngine({ state, setState, upstream }: { state: any; setState: (updates: any) => void; upstream: ClientDemUpstream | null }) {
  const { current: mapRef } = useMap()
  const setStatus = useSetAtom(riverRemStatusAtom)
  const setRivers = useSetAtom(riverRemRiversAtom)
  const setRevision = useSetAtom(riverRemRevisionAtom)
  const setLines = useSetAtom(riverRemLinesAtom)
  const setInfo = useSetAtom(riverRemInfoAtom)
  const retry = useAtomValue(riverRemRetryAtom)
  const features = useAtomValue(drawingFeaturesAtom)
  const [drawnId, setDrawnId] = useAtom(riverRemDrawnIdAtom)

  const drawn = state.remRiver === "drawn"
  const kinds: WaterwayKinds = state.remWaterways === "all" ? "all" : "river"

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
            ? "OpenStreetMap's Overpass servers are busy or too slow right now. Try again in a moment, or draw the centerline."
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
  const [sampleProblem, setSampleProblem] = useState("")
  const template = upstream?.template, encoding = upstream?.encoding, tileSize = upstream?.tileSize, minzoom = upstream?.minzoom, maxzoom = upstream?.maxzoom
  const spacingSetting = Number(state.remSpacing) || 0
  useEffect(() => {
    setSampleProblem("")
    if (!template || !encoding || !tileSize || !choice.lines.length) { setSamples(null); setSampling(false); return }
    const controller = new AbortController()
    const key = `${linesKey}|${spacingSetting}|${template}|${maxzoom}`
    setSampling(true)
    const timer = setTimeout(async () => {
      try {
        const lengthM = choice.lines.reduce((sum, l) => sum + lineLengthM(l), 0)
        const spacingM = resolveSpacingM(lengthM, spacingSetting)
        const perLine = choice.lines.map((l) => resampleLine(l, spacingM))
        const { elevations, zoom } = await sampleRiverElevations(perLine.flat(), { template, encoding, tileSize, minzoom, maxzoom }, controller.signal)
        if (controller.signal.aborted) return
        setSamples({ key, perLine, elevations, zoom, spacingM, lengthM, lines: choice.lines, label: choice.label })
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
  const [trendProblem, setTrendProblem] = useState("")
  const monotone = (state.remMonotone ?? "min") as MonotoneMode
  const power = Number(state.remPower) > 0 ? Number(state.remPower) : 1
  const neighborsSetting = Math.max(0, Math.floor(Number(state.remNeighbors) || 0))
  useEffect(() => {
    setTrendProblem("")
    if (!samples) { setBuilding(false); return }
    let cancelled = false
    setBuilding(true)
    const timer = setTimeout(async () => {
      const started = performance.now()
      const xs: number[] = [], ys: number[] = [], zs: number[] = []
      let offset = 0, corrected = 0, levelHigh = -Infinity, levelLow = Infinity
      for (const line of samples.perLine) {
        const raw = samples.elevations.subarray(offset, offset + line.length)
        offset += line.length
        // OpenStreetMap draws a waterway the way it flows; a hand-drawn line
        // can go either way, so it is read from its higher end.
        const reversed = drawn && runsUphill(raw)
        const ordered = reversed ? Float64Array.from(raw).reverse() : raw
        const cleaned = cleanProfile(ordered, monotone)
        for (let i = 0; i < line.length; i++) {
          const level = cleaned[i]
          if (!Number.isFinite(level)) continue
          const point = line[reversed ? line.length - 1 - i : i]
          xs.push(lngToMercX(point[0])); ys.push(latToMercY(point[1])); zs.push(level)
          if (Math.abs(level - ordered[i]) > 0.1) corrected++
          if (level > levelHigh) levelHigh = level
          if (level < levelLow) levelLow = level
        }
      }
      if (xs.length < 2) {
        setBuilding(false)
        setTrendProblem("The terrain source has no heights along this river.")
        return
      }
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

      const points = { x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs) }
      const grid = createTrendGrid({ x0, y0, x1, y1 })
      const options = { power, neighbors }
      for (let row = 0; row < grid.h; row += 16) {
        fillTrendRows(grid, points, options, row, Math.min(grid.h, row + 16))
        await yieldToMainThread()
        if (cancelled) return
      }
      setRevision(setRiverRemTrend(grid))
      setInfo({
        riverLabel: samples.label, lengthM: samples.lengthM, points: xs.length, spacingM: samples.spacingM, sampleZoom: samples.zoom,
        neighbors, sinuosity: riverSinuosity, levelHigh, levelLow, corrected, buildMs: Math.round(performance.now() - started),
      })
      setBuilding(false)
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, monotone, power, neighborsSetting])

  // ── One status line for the panel ──
  const hasLines = choice.lines.length > 0
  useEffect(() => {
    if (!upstream) setStatus({ phase: "error", message: "This terrain source cannot be read in the browser, so no REM can be computed from it." })
    else if (searching && !hasLines) setStatus({ phase: "rivers", message: slow ? "Overpass is slow to answer: asking another of its servers too…" : "Looking for rivers in OpenStreetMap…" })
    else if (osmProblem && !hasLines) setStatus({ phase: "error", message: osmProblem.message, canRetry: osmProblem.canRetry })
    else if (!hasLines) setStatus({ phase: "empty", message: drawn ? "Draw a line along the river, or pick one already drawn." : "No river found in view. Pan, zoom out, include streams and canals, or draw the centerline." })
    else if (sampleProblem || trendProblem) setStatus({ phase: "error", message: sampleProblem || trendProblem })
    else if (sampling) setStatus({ phase: "sampling", message: "Reading heights along the river…" })
    else if (building) setStatus({ phase: "trend", message: "Interpolating the river's level…" })
    else if (osmProblem) setStatus({ phase: "ready", message: `${osmProblem.message} The last rivers found stay in use.`, canRetry: osmProblem.canRetry })
    else if (searching) setStatus({ phase: "ready", message: slow ? "Overpass is slow to answer; the last rivers found stay in use meanwhile." : "Looking for rivers in OpenStreetMap…" })
    else setStatus({ phase: "ready", message: "" })
  }, [upstream, searching, slow, osmProblem, hasLines, drawn, sampleProblem, trendProblem, sampling, building, setStatus])

  return null
}

// ─── Layers (every view) ────────────────────────────────────────────────────

function RiverRemInner({ primary, state, setState, terrainSource }: { primary: boolean; state: any; setState: (updates: any) => void; terrainSource: string }) {
  const customTerrainSources = useAtomValue(customTerrainSourcesAtom)
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const maptilerKey = useAtomValue(maptilerKeyAtom)
  const titilerEndpoint = useAtomValue(titilerEndpointAtom)
  const upstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const revision = useAtomValue(riverRemRevisionAtom)
  const lines = useAtomValue(riverRemLinesAtom)

  const paint = useMemo(() => {
    const ramps = colorRampsFlat as Record<string, { colors: unknown[] }>
    const ramp = ramps[state.remColorRamp] ?? ramps[DEFAULT_RAMP]
    return {
      "color-relief-color": buildRemColorExpression(ramp.colors, state.remMin ?? 0, state.remMax ?? 10, (state.remStretch ?? "log") as RemStretch, state.remGamma ?? 0.5, !!state.remInvertColorRamp),
      "color-relief-opacity": Math.min(1, Math.max(0, state.remOpacity ?? 1)),
    }
  }, [state.remColorRamp, state.remMin, state.remMax, state.remStretch, state.remGamma, state.remInvertColorRamp, state.remOpacity])

  const lineData = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: lines.map((coordinates) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } })),
  }), [lines])

  const ready = !!upstream && revision > 0
  return (
    <>
      {primary && <RiverRemEngine state={state} setState={setState} upstream={upstream} />}
      {ready && (
        <Source
          id={RIVER_REM_SOURCE_ID}
          // Remounted only when the DEM behind it changes; a new trend changes
          // `tiles` (the revision), which reloads the tiles in place.
          key={`${RIVER_REM_SOURCE_ID}-${terrainSource}-${upstream.template}-z${upstream.maxzoom}`}
          type="raster-dem"
          tiles={[buildRiverRemProtocolUrl(upstream.template, upstream.encoding, upstream.tileSize, revision)]}
          tileSize={upstream.tileSize}
          encoding="terrarium"
          attribution="River centerline © OpenStreetMap contributors"
          {...(upstream.minzoom != null ? { minzoom: upstream.minzoom } : {})}
          {...(upstream.maxzoom != null ? { maxzoom: upstream.maxzoom } : {})}
        >
          <Layer beforeId={LAYER_SLOTS.RIVER_REM} id={RIVER_REM_LAYER_ID} type="color-relief" paint={paint as any} />
        </Source>
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

export const RiverRemLayers = memo(({ enabled, primary, state, setState, terrainSource }: {
  enabled: boolean
  /** View A: runs the engine. */
  primary: boolean
  state: any
  setState: (updates: any) => void
  /** View A's terrain source, on every view (see the header). */
  terrainSource: string
}) => {
  if (!enabled) return null
  return <RiverRemInner primary={primary} state={state} setState={setState} terrainSource={terrainSource} />
})
RiverRemLayers.displayName = "RiverRemLayers"
