import type React from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import maplibregl from "maplibre-gl"
import type { MapMouseEvent } from "maplibre-gl"
import type { MapRef } from "react-map-gl/maplibre"
import type { TerraDraw } from "terra-draw"
import { Section, MobileSlider, SegmentedToggle } from "./controls-components"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LightDirectionControl } from "./light-direction-control"
import { ColorAlphaSwatch } from "./color-picker"
import { track } from "@/lib/analytics"
import { activeDrawModeAtom } from "./TerraDrawSystem"
import { inverseSunPosition, formatDayOfYear, formatHour } from "@/lib/solar-position"
import { utcOffsetHoursAt, utcInstantForDayOfYear } from "@/lib/timezone"

interface PickedPoint {
  lng: number
  lat: number
}

const MARKER_COLOR = "#f59e0b"
const SHADOW_TIP_COLOR = "#3b82f6"
const DEFAULT_LINE_COLOR = "#ffffff"
const DEFAULT_LINE_WIDTH = 3
const SRC = "sun-shadow-calc-line"
const LYR = "sun-shadow-calc-line"
// Anything past this is the sun grazing the horizon — the shadow is
// technically infinite/off-screen, so it's clearer to say so than to draw a
// wildly long line across the map.
const MAX_DRAWABLE_SHADOW_M = 50_000
const EMPTY_LINE = {
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates: [[0, 0], [0, 0]] },
  properties: {},
}

const wrap24 = (h: number) => ((h % 24) + 24) % 24

// Flat equirectangular approximation, matching the forward calc's own
// lat/lng-per-meter conversion (fine at these lengths) so a round trip
// through both directions agrees — a real distance measure (haversine)
// would introduce a mismatch too small to matter here, but an inconsistent
// one is still worse than a consistent approximation.
function distanceAndBearing(from: PickedPoint, to: PickedPoint): { distanceM: number; bearingDeg: number } {
  const latRad = (from.lat * Math.PI) / 180
  const dLatM = (to.lat - from.lat) * 111_320
  const dLngM = (to.lng - from.lng) * 111_320 * Math.cos(latRad)
  const distanceM = Math.sqrt(dLatM * dLatM + dLngM * dLngM)
  const bearingDeg = ((Math.atan2(dLngM, dLatM) * 180) / Math.PI + 360) % 360
  return { distanceM, bearingDeg }
}

export const SunShadowCalculatorSection: React.FC<{
  state: any
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  draw: TerraDraw | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, mapRef, draw, isOpen, onOpenChange }) => {
  const [isActive, setIsActive] = useState(false)
  // "forward": pick where the object stands, drive the light with the pad —
  // the shadow tip is computed and drawn. "reverse": the light itself is
  // unknown — click the object's base, then the real shadow's tip as seen in
  // the imagery, and the light direction (and closest matching day/time) is
  // back-solved from the two points + object height instead.
  const [mode, setMode] = useState<"forward" | "reverse">("forward")
  const [point, setPoint] = useState<PickedPoint | null>(null)
  const [tipPoint, setTipPoint] = useState<PickedPoint | null>(null)
  const [height, setHeight] = useState(10)
  const [lineColor, setLineColor] = useState(DEFAULT_LINE_COLOR)
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const tipMarkerRef = useRef<maplibregl.Marker | null>(null)

  // Same drawing-mode conflict guard as Elevation Picker — TerraDraw's own
  // click handling would otherwise fight with ours. Derived from the shared
  // activeDrawModeAtom (TerraDrawSystem.tsx) rather than a local mirror kept
  // in sync via draw's own 'change' event — that event only fires on feature
  // store mutations, never from a bare draw.setMode() call, so a
  // listener-only copy goes stale the moment the user switches back to
  // Select without the store itself changing, permanently disabling this
  // toggle.
  const activeDrawMode = useAtomValue(activeDrawModeAtom)
  const drawModeActive = activeDrawMode !== "select"
  useEffect(() => {
    if (drawModeActive) setIsActive(false)
  }, [drawModeActive])

  const handleMapClick = useCallback((e: MapMouseEvent) => {
    const clicked = { lng: e.lngLat.lng, lat: e.lngLat.lat }
    if (mode === "forward") {
      setPoint(clicked)
      return
    }
    // Reverse mode is a two-click sequence: base, then shadow tip. A third
    // click starts over at a new base (rather than requiring an explicit
    // "Clear points" first), so re-measuring a different object is just a
    // click-click-click-click… loop.
    if (!point) {
      setPoint(clicked)
      setTipPoint(null)
    } else if (!tipPoint) {
      setTipPoint(clicked)
    } else {
      setPoint(clicked)
      setTipPoint(null)
    }
  }, [mode, point, tipPoint])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !isActive) return
    map.on("click", handleMapClick)
    // Reuses the same crosshair cursor styling as Elevation Picker (see
    // src/index.css) — the visual affordance ("clicking the map places
    // something") isn't elevation-specific.
    const container = map.getContainer()
    container.classList.add("elevation-picker-active")
    return () => {
      map.off("click", handleMapClick)
      container.classList.remove("elevation-picker-active")
    }
  }, [isActive, mapRef, handleMapClick])

  // Marker at the picked point.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    markerRef.current?.remove()
    markerRef.current = null
    if (!point) return
    const el = document.createElement("div")
    el.style.width = "14px"
    el.style.height = "14px"
    el.style.borderRadius = "50%"
    el.style.border = "2px solid white"
    el.style.boxShadow = "0 0 4px rgba(0,0,0,0.6)"
    el.style.background = MARKER_COLOR
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map)
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [point, mapRef])

  // Marker at the clicked shadow tip — reverse mode only, distinct color from
  // the base-point marker so the two clicked points read unambiguously.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    tipMarkerRef.current?.remove()
    tipMarkerRef.current = null
    if (!tipPoint) return
    const el = document.createElement("div")
    el.style.width = "14px"
    el.style.height = "14px"
    el.style.borderRadius = "50%"
    el.style.border = "2px solid white"
    el.style.boxShadow = "0 0 4px rgba(0,0,0,0.6)"
    el.style.background = SHADOW_TIP_COLOR
    tipMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([tipPoint.lng, tipPoint.lat]).addTo(map)
    return () => {
      tipMarkerRef.current?.remove()
      tipMarkerRef.current = null
    }
  }, [tipPoint, mapRef])

  // state.illuminationDir/illuminationAlt is the SAME shared light direction
  // driven by <LightDirectionControl> below (and by Hillshade/Phong/Shadows
  // elsewhere) — reused as-is rather than recomputed for the picked point's
  // own lat/lng, since sun altitude/azimuth barely changes over the scale of
  // a single visible viewport. Only meaningful in "forward" mode — "reverse"
  // mode derives the light FROM the two clicked points instead (see
  // reverseSolve below), so it doesn't read these at all.
  const altitudeDeg: number = state.illuminationAlt
  const azimuthDeg: number = state.illuminationDir
  const shadowLength = altitudeDeg > 0.05 ? height / Math.tan((altitudeDeg * Math.PI) / 180) : null

  // Reverse mode: both points + height fully determine a light direction
  // (azimuth from the base→tip bearing, reversed — light comes from the
  // opposite side of the shadow; elevation from the height/length ratio),
  // which inverseSunPosition then back-solves to a day/time. Written into
  // the SAME shared illuminationDir/illuminationAlt/lightDayOfYear/
  // lightTimeOfDay fields LightDirectionControl itself reads/writes, so the
  // rest of the app's lighting (Hillshade/Phong/Shadows) updates to match
  // too — this is just another way of setting the same shared light.
  const reverseSolve = mode === "reverse" && point && tipPoint && height > 0
    ? (() => {
        const { distanceM, bearingDeg } = distanceAndBearing(point, tipPoint)
        if (distanceM < 0.5) return null // clicked ~the same spot twice
        const elevationDeg = (Math.atan2(height, distanceM) * 180) / Math.PI
        const azimuthDeg2 = (bearingDeg + 180) % 360
        const inv = inverseSunPosition(point.lat, azimuthDeg2, elevationDeg, state.lightDayOfYear)
        return { distanceM, azimuthDeg: azimuthDeg2, elevationDeg, ...inv }
      })()
    : null

  // Pushes the reverse-solved light into shared state once per (point, tip,
  // height) combination — guarded against re-firing every render by only
  // writing when the computed values actually differ from what's already
  // there (reverseSolve itself is recomputed every render since it's cheap
  // trig, not memoized).
  useEffect(() => {
    if (!reverseSolve) return
    const offsetH = utcOffsetHoursAt(point!.lat, point!.lng, utcInstantForDayOfYear(reverseSolve.dayOfYear))
    const uiHour = state.lightTimeMode === "utc"
      ? wrap24(reverseSolve.hourLocalSolar - point!.lng / 15)
      : wrap24(reverseSolve.hourLocalSolar - point!.lng / 15 + offsetH)
    const next = {
      illuminationDir: reverseSolve.azimuthDeg,
      illuminationAlt: reverseSolve.elevationDeg,
      lightDayOfYear: reverseSolve.dayOfYear,
      lightTimeOfDay: Math.round(uiHour * 4) / 4, // quarter-hour, matching LightDirectionControl's own default granularity
      lightUseDatetime: true,
    }
    const unchanged = Math.abs(next.illuminationDir - state.illuminationDir) < 0.05
      && Math.abs(next.illuminationAlt - state.illuminationAlt) < 0.05
      && next.lightDayOfYear === state.lightDayOfYear
      && Math.abs(next.lightTimeOfDay - state.lightTimeOfDay) < 0.01
      && state.lightUseDatetime
    if (!unchanged) setState(next)
    // reverseSolve is a plain object recomputed every render (see above) —
    // depending on its scalar fields individually avoids re-running this
    // effect on every unrelated render even though reverseSolve itself is a
    // fresh reference each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reverseSolve?.azimuthDeg, reverseSolve?.elevationDeg, reverseSolve?.dayOfYear, reverseSolve?.hourLocalSolar, state.lightTimeMode])

  // Mounts the source/layer ONCE while the tool is active (and re-mounts on a
  // style reload) — kept separate from the position/color updates below so
  // that dragging a slider (which recomputes shadowLength on every tick with
  // debounceMs=0) never removes+re-adds the layer, which was visibly
  // flickering the line off and back on every edit.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !isActive) return
    const ensure = () => {
      if (!map.isStyleLoaded()) return
      if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: EMPTY_LINE })
      if (!map.getLayer(LYR)) {
        map.addLayer({
          id: LYR,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round", visibility: "none" },
          paint: { "line-width": lineWidth, "line-color": lineColor },
        })
      }
    }
    ensure()
    map.on("styledata", ensure)
    return () => {
      map.off("styledata", ensure)
      if (map.getLayer(LYR)) map.removeLayer(LYR)
      if (map.getSource(SRC)) map.removeSource(SRC)
    }
    // lineColor/lineWidth are only read here as the layer's INITIAL paint —
    // later changes go through the dedicated setPaintProperty effect below,
    // so they're deliberately excluded from this effect's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, mapRef])

  // Shadow line geometry. Forward mode: from the picked point, pointing away
  // from the sun (azimuth + 180°), length = shadowLength — meters→degrees
  // uses a flat equirectangular approximation (fine at these lengths).
  // Reverse mode: drawn directly between the two clicked points (the tip is
  // an observation, not a computed value). Either way, only ever calls
  // setData/setLayoutProperty on the layer mounted above — never
  // add/removeLayer — so repeated edits update the line in place instead of
  // toggling it off and back on.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !map.getSource(SRC) || !map.getLayer(LYR)) return

    if (mode === "reverse") {
      const canDraw = point && tipPoint
      map.setLayoutProperty(LYR, "visibility", canDraw ? "visible" : "none")
      if (!canDraw) return
      const data = {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: [[point!.lng, point!.lat], [tipPoint!.lng, tipPoint!.lat]] },
        properties: {},
      }
      ;(map.getSource(SRC) as maplibregl.GeoJSONSource).setData(data as any)
      return
    }

    const canDraw = point && shadowLength !== null && shadowLength > 0 && shadowLength < MAX_DRAWABLE_SHADOW_M
    map.setLayoutProperty(LYR, "visibility", canDraw ? "visible" : "none")
    if (!canDraw) return

    const shadowAzRad = (((azimuthDeg + 180) % 360) * Math.PI) / 180
    const latRad = (point!.lat * Math.PI) / 180
    const dLat = (shadowLength! * Math.cos(shadowAzRad)) / 111_320
    const dLng = (shadowLength! * Math.sin(shadowAzRad)) / (111_320 * Math.cos(latRad))
    const tip: [number, number] = [point!.lng + dLng, point!.lat + dLat]
    const data = {
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: [[point!.lng, point!.lat], tip] },
      properties: {},
    }
    ;(map.getSource(SRC) as maplibregl.GeoJSONSource).setData(data as any)
  }, [mode, point, tipPoint, shadowLength, azimuthDeg, mapRef, isActive])

  // Color/width changes update the already-mounted layer's paint directly.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !map.getLayer(LYR)) return
    map.setPaintProperty(LYR, "line-color", lineColor)
    map.setPaintProperty(LYR, "line-width", lineWidth)
  }, [lineColor, lineWidth, mapRef])

  const handleToggle = useCallback((checked: boolean) => {
    setIsActive(checked)
    if (checked) track("tools-sun-shadow-calculator")
    if (!checked) { setPoint(null); setTipPoint(null) }
  }, [])

  const handleModeChange = useCallback((next: "forward" | "reverse") => {
    setMode(next)
    // Stale points from the other mode's click sequence (a single object
    // point in forward mode; a base+tip pair in reverse) aren't meaningful
    // once the mode itself changes what a click means.
    setPoint(null)
    setTipPoint(null)
  }, [])

  const formatLatLng = (p: PickedPoint) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
  const formatLength = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`)

  return (
    <Section title="Sun Shadow Calculator" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="sun-shadow-calc-toggle" className="text-sm font-medium">
          Pick point on click
        </Label>
        <Switch
          id="sun-shadow-calc-toggle"
          checked={isActive}
          onCheckedChange={handleToggle}
          disabled={drawModeActive}
          className="cursor-pointer"
        />
      </div>

      {drawModeActive && (
        <p className="text-xs text-muted-foreground">
          Unavailable while a drawing tool is active — switch Tools: Drawing back to Select first.
        </p>
      )}

      {isActive && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Mode</Label>
            <SegmentedToggle
              className="w-[220px]"
              value={mode}
              onChange={(value) => handleModeChange(value as "forward" | "reverse")}
              options={[
                { value: "forward", label: "Forward", tooltip: "Set the light (pad or date/time), click to place an object — the shadow it would cast is computed and drawn." },
                { value: "reverse", label: "Reverse", tooltip: "Click the object's base, then its real shadow tip as seen in the imagery — the light direction (and closest matching day/time) is back-solved from the two points." },
              ]}
            />
          </div>

          {mode === "forward" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Click the map to place an object and measure the shadow it casts at the current sun position.
              </p>
              <p className="text-xs text-muted-foreground">
                The <span className="font-semibold text-foreground">precise capture date</span> of the imagery
                matters a lot here — it directly sets the sun's elevation, which the shadow length is
                very sensitive to. Also pick the point as the object's{" "}
                <span className="font-semibold text-foreground">ground projection</span> — where its base
                meets the flat, horizontal ground — since that's the point the drawn line connects to the
                shadow's tip; it doesn't account for real terrain slope.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Click the object's <span className="font-semibold text-foreground">ground-projected base</span>,
              then the <span className="font-semibold text-foreground">real shadow tip</span> visible in the
              imagery — the light direction those two points + the object's height imply is back-solved into a
              closest-matching day/time below (there are generically two candidate days per year; whichever is
              nearer the day already set is picked). Assumes flat ground between the two points, same as
              Forward mode.
            </p>
          )}

          <LightDirectionControl
            state={state}
            setState={setState}
            sliderId="sun-shadow-calc"
            debounceMs={0}
            timeStepMinutes={1}
            padFoldable
          />

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="sun-shadow-height" className="text-sm font-medium">Object height</Label>
            <div className="flex items-center gap-1">
              <Input
                id="sun-shadow-height"
                type="number"
                min={0}
                step={1}
                value={height}
                onChange={(e) => setHeight(Math.max(0, Number(e.target.value) || 0))}
                className="h-7 w-16 px-2 text-xs text-right"
              />
              <span className="text-xs text-muted-foreground">m</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 items-center">
            <Label className="text-sm font-medium">Color</Label>
            <ColorAlphaSwatch color={lineColor} onChange={setLineColor} title="Shadow line color" className="rounded" />
            <Label className="text-sm font-medium">Width</Label>
            <MobileSlider
              sliderId="sun-shadow-calc-line-width"
              value={lineWidth}
              onValueChange={(v) => setLineWidth(v as number)}
              min={1}
              max={10}
              step={1}
              className="cursor-pointer"
            />
          </div>

          {mode === "forward" ? (
            point ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MARKER_COLOR }} />
                    Point
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{formatLatLng(point)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted text-sm font-medium">
                  <span>Shadow length</span>
                  <span className="font-mono">
                    {shadowLength === null
                      ? "Sun below horizon"
                      : shadowLength >= MAX_DRAWABLE_SHADOW_M
                        ? "Very long (sun near horizon)"
                        : formatLength(shadowLength)}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={() => setPoint(null)} className="w-full cursor-pointer">
                  Clear point
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No point picked yet.</p>
            )
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MARKER_COLOR }} />
                  Base
                </span>
                <span className="font-mono text-xs text-muted-foreground">{point ? formatLatLng(point) : "click the map"}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SHADOW_TIP_COLOR }} />
                  Shadow tip
                </span>
                <span className="font-mono text-xs text-muted-foreground">{tipPoint ? formatLatLng(tipPoint) : point ? "click the shadow's tip" : "—"}</span>
              </div>
              {reverseSolve ? (
                <>
                  <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted text-sm font-medium">
                    <span>Shadow length</span>
                    <span className="font-mono">{formatLength(reverseSolve.distanceM)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted text-sm font-medium">
                    <span>Light direction</span>
                    <span className="font-mono">{reverseSolve.azimuthDeg.toFixed(1)}° az · {reverseSolve.elevationDeg.toFixed(1)}° el</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted text-sm font-medium">
                    <span>Closest match</span>
                    <span className="font-mono">
                      {formatDayOfYear(reverseSolve.dayOfYear)} · {formatHour(reverseSolve.hourLocalSolar)} solar
                    </span>
                  </div>
                </>
              ) : point && tipPoint ? (
                <p className="text-xs text-destructive">Base and shadow tip are (almost) the same point — click a real shadow tip.</p>
              ) : null}
              <Button
                variant="outline" size="sm"
                onClick={() => { setPoint(null); setTipPoint(null) }}
                className="w-full cursor-pointer"
                disabled={!point && !tipPoint}
              >
                Clear points
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
