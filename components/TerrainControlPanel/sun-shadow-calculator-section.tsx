import type React from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import type { MapMouseEvent } from "maplibre-gl"
import type { MapRef } from "react-map-gl/maplibre"
import type { TerraDraw } from "terra-draw"
import { Section } from "./controls-components"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LightDirectionControl } from "./light-direction-control"
import { dayLength, formatHour } from "@/lib/solar-position"
import { track } from "@/lib/analytics"

interface PickedPoint {
  lng: number
  lat: number
}

const MARKER_COLOR = "#f59e0b"
// Anything past this is the sun grazing the horizon — the shadow is
// technically infinite/off-screen, so it's clearer to say so than to draw a
// wildly long line across the map.
const MAX_DRAWABLE_SHADOW_M = 50_000

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
  const [drawModeActive, setDrawModeActive] = useState(false)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  // Same drawing-mode conflict guard as Elevation Picker — TerraDraw's own
  // click handling would otherwise fight with ours.
  useEffect(() => {
    if (!draw) return
    const update = () => {
      try {
        const mode = draw.getMode()
        const isDrawing = !!mode && mode !== "select"
        setDrawModeActive(isDrawing)
        if (isDrawing) setIsActive(false)
      } catch { /* ignore */ }
    }
    draw.on("change", update)
    return () => { try { draw.off("change", update) } catch { /* ignore */ } }
  }, [draw])

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

  // Shadow line on the map: from the picked point, pointing away from the
  // sun (azimuth + 180°), length = shadowLength. Meters→degrees uses a flat
  // equirectangular approximation (fine at these lengths).
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const SRC = "sun-shadow-calc-line"
    const LYR = "sun-shadow-calc-line"
    const canDraw = isActive && point && shadowLength !== null && shadowLength > 0 && shadowLength < MAX_DRAWABLE_SHADOW_M
    if (!canDraw) {
      if (map.getLayer(LYR)) map.removeLayer(LYR)
      if (map.getSource(SRC)) map.removeSource(SRC)
      return
    }

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

    const redraw = () => {
      if (!map.isStyleLoaded()) return
      const existing = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
      if (existing) {
        existing.setData(data as any)
      } else {
        map.addSource(SRC, { type: "geojson", data: data as any })
        map.addLayer({
          id: LYR,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round" },
          paint: { "line-width": 3, "line-color": "#1e293b", "line-dasharray": [2, 1.5] },
        })
      }
    }
    redraw()
    map.on("styledata", redraw)
    return () => {
      map.off("styledata", redraw)
      if (map.getLayer(LYR)) map.removeLayer(LYR)
      if (map.getSource(SRC)) map.removeSource(SRC)
    }
  }, [isActive, point, shadowLength, azimuthDeg, mapRef])

  const handleToggle = useCallback((checked: boolean) => {
    setIsActive(checked)
    if (checked) track("tools-sun-shadow-calculator")
    if (!checked) setPoint(null)
  }, [])

  const formatLatLng = (p: PickedPoint) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
  const formatLength = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`)

  // Sunrise/sunset for the picked point's own latitude (dayLength is a cheap
  // pure function of lat + day-of-year — no reason to settle for the
  // viewport-center approximation here like illuminationAlt/Dir do above).
  const dayRange = point ? dayLength(point.lat, state.lightDayOfYear) : null

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

          <LightDirectionControl state={state} setState={setState} sliderId="sun-shadow-calc" />

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

          {point ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MARKER_COLOR }} />
                  Point
                </span>
                <span className="font-mono text-xs text-muted-foreground">{formatLatLng(point)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                <span>Azimuth / Altitude</span>
                <span className="font-mono text-xs">{azimuthDeg.toFixed(1)}° / {altitudeDeg.toFixed(1)}°</span>
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
              {state.lightUseDatetime && dayRange && (
                dayRange.polarDay ? (
                  <p className="text-xs text-muted-foreground px-2">Polar day — sun does not set.</p>
                ) : dayRange.polarNight ? (
                  <p className="text-xs text-muted-foreground px-2">Polar night — sun does not rise.</p>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                    <span>Sunrise / Sunset</span>
                    <span className="font-mono text-xs">{formatHour(dayRange.sunrise)} / {formatHour(dayRange.sunset)}</span>
                  </div>
                )
              )}
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
