import type React from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import maplibregl from "maplibre-gl"
import type { MapMouseEvent } from "maplibre-gl"
import type { MapRef } from "react-map-gl/maplibre"
import type { TerraDraw } from "terra-draw"
import { Section, MobileSlider } from "./controls-components"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LightDirectionControl } from "./light-direction-control"
import { ColorAlphaSwatch } from "./color-picker"
import { track } from "@/lib/analytics"
import { activeDrawModeAtom } from "./TerraDrawSystem"

interface PickedPoint {
  lng: number
  lat: number
}

const MARKER_COLOR = "#f59e0b"
const DEFAULT_LINE_COLOR = "#1e293b"
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

export const SunShadowCalculatorSection: React.FC<{
  state: any
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  draw: TerraDraw | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, mapRef, draw, isOpen, onOpenChange }) => {
  const [isActive, setIsActive] = useState(false)
  const [point, setPoint] = useState<PickedPoint | null>(null)
  const [height, setHeight] = useState(10)
  const [lineColor, setLineColor] = useState(DEFAULT_LINE_COLOR)
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH)
  const markerRef = useRef<maplibregl.Marker | null>(null)

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
    setPoint({ lng: e.lngLat.lng, lat: e.lngLat.lat })
  }, [])

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

  // state.illuminationDir/illuminationAlt is the SAME shared light direction
  // driven by <LightDirectionControl> below (and by Hillshade/Phong/Shadows
  // elsewhere) — reused as-is rather than recomputed for the picked point's
  // own lat/lng, since sun altitude/azimuth barely changes over the scale of
  // a single visible viewport.
  const altitudeDeg: number = state.illuminationAlt
  const azimuthDeg: number = state.illuminationDir
  const shadowLength = altitudeDeg > 0.05 ? height / Math.tan((altitudeDeg * Math.PI) / 180) : null

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

  // Shadow line geometry: from the picked point, pointing away from the sun
  // (azimuth + 180°), length = shadowLength. Meters→degrees uses a flat
  // equirectangular approximation (fine at these lengths). Only ever calls
  // setData/setLayoutProperty on the layer mounted above — never
  // add/removeLayer — so repeated edits update the line in place instead of
  // toggling it off and back on.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !map.getSource(SRC) || !map.getLayer(LYR)) return
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
  }, [point, shadowLength, azimuthDeg, mapRef, isActive])

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
    if (!checked) setPoint(null)
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
            <ColorAlphaSwatch color={lineColor} onChange={setLineColor} title="Shadow line color" />
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

          {point ? (
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
          )}
        </div>
      )}
    </Section>
  )
}
