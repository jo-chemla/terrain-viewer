import type React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
import { useAtom } from "jotai"
import maplibregl from "maplibre-gl"
import type { MapMouseEvent } from "maplibre-gl"
import type { MapRef } from "react-map-gl/maplibre"
import type { TerraDraw } from "terra-draw"
import { distance as turfDistance } from "@turf/turf"
import { Section } from "./controls-components"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSourceConfig } from "@/lib/controls-utils"
import { customTerrainSourcesAtom } from "@/lib/settings-atoms"
import { getClientExportSource } from "@/lib/client-export"
import { queryTerrainElevationAtPoint, sampleClientElevationAtPoint, sampleClientElevationProfile, type ProfilePoint } from "@/lib/elevation-query"
import { ElevationProfileChart, computeLineOfSight } from "./elevation-profile-chart"
import { PlaneSlicerFields } from "./plane-slicer-fields"

const PROFILE_SAMPLES = 160

interface PickedPoint {
  lng: number
  lat: number
  elevation: number | null
  error?: string
}

const MARKER_COLORS = ["#3b82f6", "#ef4444"]

export const ElevationPickerSection: React.FC<{
  state: any
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  draw: TerraDraw | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, mapRef, draw, isOpen, onOpenChange }) => {
  const [isActive, setIsActive] = useState(false)
  const [points, setPoints] = useState<PickedPoint[]>([])
  const [drawModeActive, setDrawModeActive] = useState(false)
  // Profile / line-of-sight sub-tool: samples the DEM along the line between the
  // two picked points and charts it, flagging terrain that blocks the direct
  // sight line (with an optional equal mast/pole height at each end).
  const [profileMode, setProfileMode] = useState(false)
  const [profilePoints, setProfilePoints] = useState<ProfilePoint[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [poleHeight, setPoleHeight] = useState(0)
  const { getTilesUrl } = useSourceConfig()
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const markersRef = useRef<maplibregl.Marker[]>([])

  // TerraDraw's own click handling (placing vertices) would otherwise fight with
  // ours — turn the picker off the moment an actual drawing mode (not just the
  // idle "select" mode) is armed, and keep it off until drawing mode returns to
  // select, mirroring TerraDrawControls' own mode tracking (TerraDrawSystem.tsx).
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

  // Click handling is registered once per toggle-on, so the handler needs live
  // access to state/customTerrainSources without re-subscribing map.on('click').
  const stateRef = useRef(state)
  stateRef.current = state
  const customTerrainSourcesRef = useRef(customTerrainSources)
  customTerrainSourcesRef.current = customTerrainSources
  const getTilesUrlRef = useRef(getTilesUrl)
  getTilesUrlRef.current = getTilesUrl

  const sampleElevation = useCallback(async (
    map: maplibregl.Map, lng: number, lat: number,
  ): Promise<{ elevation: number | null; error?: string }> => {
    const s = stateRef.current
    if (s.viewMode === "3d" || s.viewMode === "globe") {
      const elevation = queryTerrainElevationAtPoint(map, lng, lat, s.exaggeration || 1)
      if (elevation === null) return { elevation: null, error: "No terrain elevation at this point" }
      return { elevation }
    }

    const clientSource = getClientExportSource(s.sourceA, customTerrainSourcesRef.current, getTilesUrlRef.current)
    if (!clientSource) {
      return { elevation: null, error: "2D elevation lookup only supports COG/TerrainRGB/Terrarium sources" }
    }
    try {
      const elevation = await sampleClientElevationAtPoint(clientSource, lng, lat)
      if (elevation === null) return { elevation: null, error: "No data at this point" }
      return { elevation }
    } catch (err) {
      return { elevation: null, error: err instanceof Error ? err.message : "Elevation lookup failed" }
    }
  }, [])

  // Samples PROFILE_SAMPLES elevations along the segment a→b. Routes exactly like
  // the single-point sampleElevation above so the profile always agrees with a
  // manual pick: in 3D/globe MapLibre's already-decoded terrain is the source of
  // truth (queryTerrainElevation per point — cheap, no fetch); in 2D there's no
  // terrain object, so one batched mosaic covers the whole line (see
  // sampleClientElevationProfile).
  const sampleProfile = useCallback(async (
    a: { lng: number; lat: number }, b: { lng: number; lat: number },
  ): Promise<ProfilePoint[]> => {
    const s = stateRef.current
    const lerp = (t: number) => ({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t })

    let elevations: (number | null)[]
    if (s.viewMode === "3d" || s.viewMode === "globe") {
      const map = mapRef.current?.getMap()
      elevations = map
        ? Array.from({ length: PROFILE_SAMPLES }, (_, i) => {
            const { lng, lat } = lerp(i / (PROFILE_SAMPLES - 1))
            return queryTerrainElevationAtPoint(map, lng, lat, s.exaggeration || 1)
          })
        : new Array(PROFILE_SAMPLES).fill(null)
    } else {
      const clientSource = getClientExportSource(s.sourceA, customTerrainSourcesRef.current, getTilesUrlRef.current)
      elevations = clientSource
        ? await sampleClientElevationProfile(clientSource, a, b, PROFILE_SAMPLES)
        : new Array(PROFILE_SAMPLES).fill(null)
    }

    return elevations.map((elevation, i) => {
      const { lng, lat } = lerp(i / (PROFILE_SAMPLES - 1))
      return { lng, lat, elevation, distanceM: turfDistance([a.lng, a.lat], [lng, lat], { units: "meters" }) }
    })
  }, [mapRef])

  // Recompute the profile only when the actual line (endpoint coords) changes —
  // NOT when the two picks' async elevation lookups later resolve (which mutate
  // `points` without moving the line), hence keying on the coords rather than
  // depending on `points` directly. pointsRef gives the effect the live coords
  // without re-subscribing on every points update.
  const pointsRef = useRef(points)
  pointsRef.current = points
  const lineKey = points.length === 2
    ? `${points[0].lng},${points[0].lat},${points[1].lng},${points[1].lat}`
    : ""
  useEffect(() => {
    if (!profileMode || pointsRef.current.length !== 2) { setProfilePoints([]); return }
    const [pa, pb] = pointsRef.current
    let cancelled = false
    setProfileLoading(true)
    sampleProfile({ lng: pa.lng, lat: pa.lat }, { lng: pb.lng, lat: pb.lat })
      .then((pts) => { if (!cancelled) setProfilePoints(pts) })
      .catch(() => { if (!cancelled) setProfilePoints([]) })
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [profileMode, lineKey, sampleProfile])

  const handleMapClick = useCallback((e: MapMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const { lng, lat } = e.lngLat

    // A pair already exists (or this is the very first click) — start a fresh
    // pair rather than accumulating a growing list of points.
    setPoints((prev) => (prev.length >= 2 ? [{ lng, lat, elevation: null }] : [...prev, { lng, lat, elevation: null }]))

    sampleElevation(map, lng, lat).then(({ elevation, error }) => {
      setPoints((prev) => {
        const idx = prev.findIndex((p) => p.lng === lng && p.lat === lat && p.elevation === null && !p.error)
        if (idx === -1) return prev
        const next = [...prev]
        next[idx] = { lng, lat, elevation, error }
        return next
      })
    })
  }, [mapRef, sampleElevation])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !isActive) return
    map.on("click", handleMapClick)
    // A CSS class (see src/index.css) rather than a plain inline style — maplibre's
    // drag-pan handler keeps re-setting the canvas cursor to grab/grabbing during
    // interaction, which would otherwise stomp a one-time inline assignment.
    const container = map.getContainer()
    container.classList.add("elevation-picker-active")
    return () => {
      map.off("click", handleMapClick)
      container.classList.remove("elevation-picker-active")
    }
  }, [isActive, mapRef, handleMapClick])

  // Keep on-map markers in sync with picked points.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = points.map((point, idx) => {
      const el = document.createElement("div")
      el.style.width = "14px"
      el.style.height = "14px"
      el.style.borderRadius = "50%"
      el.style.border = "2px solid white"
      el.style.boxShadow = "0 0 4px rgba(0,0,0,0.6)"
      el.style.background = MARKER_COLORS[idx] || MARKER_COLORS[0]
      return new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map)
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
    }
  }, [points, mapRef])

  const handleToggle = useCallback((checked: boolean) => {
    setIsActive(checked)
    if (!checked) { setPoints([]); setProfilePoints([]) }
  }, [])

  const lineOfSight = profileMode ? computeLineOfSight(profilePoints, poleHeight) : null

  const formatElevation = (p: PickedPoint) => {
    if (p.error) return p.error
    if (p.elevation === null) return "…"
    return `${p.elevation.toFixed(1)} m`
  }

  // 6 decimal places in degrees ≈ 11cm at the equator — plenty for the "10cm
  // precision" ask; 4326 is just the lng/lat degrees this app already works in
  // (no reprojection needed).
  const formatLatLng = (p: PickedPoint) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`

  const formatDistance = (meters: number) =>
    meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`

  const delta = points.length === 2 && points[0].elevation !== null && points[1].elevation !== null
    ? points[1].elevation - points[0].elevation
    : null

  // Horizontal (great-circle) distance between the two picks — independent of
  // elevation, so it's available as soon as both clicks land, unlike Δ
  // Elevation above which waits on both async elevation lookups to resolve.
  const horizontalDistanceM = points.length === 2
    ? turfDistance([points[0].lng, points[0].lat], [points[1].lng, points[1].lat], { units: "meters" })
    : null

  return (
    <Section title="Elevation Picker" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="elevation-picker-toggle" className="text-sm font-medium">
          Pick elevation on click
        </Label>
        <Switch
          id="elevation-picker-toggle"
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
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Click the map to sample elevation. A second click measures the difference; a third starts a new pair.
          </p>
          {points.map((p, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: MARKER_COLORS[idx] }}
                />
                Point {idx + 1}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{formatLatLng(p)}</span>
                <span className="font-mono text-xs text-right">{formatElevation(p)}</span>
              </span>
            </div>
          ))}
          {horizontalDistanceM !== null && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted text-sm font-medium">
              <span>Distance</span>
              <span className="font-mono">{formatDistance(horizontalDistanceM)}</span>
            </div>
          )}
          {delta !== null && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted text-sm font-medium">
              <span>Δ Elevation</span>
              <span className="font-mono">{delta >= 0 ? "+" : ""}{delta.toFixed(1)} m</span>
            </div>
          )}

          {/* ─── Profile / line of sight ─── */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Label htmlFor="elevation-profile-toggle" className="text-sm font-medium">
              Line profile / sight
            </Label>
            <Switch
              id="elevation-profile-toggle"
              checked={profileMode}
              onCheckedChange={setProfileMode}
              className="cursor-pointer"
            />
          </div>

          {profileMode && (
            <div className="space-y-2">
              {points.length < 2 ? (
                <p className="text-xs text-muted-foreground">
                  Pick two points to sample the terrain along the line between them.
                </p>
              ) : profileLoading ? (
                <p className="text-xs text-muted-foreground">Sampling terrain along the line…</p>
              ) : (
                <>
                  <ElevationProfileChart points={profilePoints} poleHeightM={poleHeight} />
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="pole-height" className="text-sm font-medium">Mast height</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        id="pole-height"
                        type="number"
                        min={0}
                        step={1}
                        value={poleHeight}
                        onChange={(e) => setPoleHeight(Math.max(0, Number(e.target.value) || 0))}
                        className="h-7 w-16 px-2 text-xs text-right"
                      />
                      <span className="text-xs text-muted-foreground">m</span>
                    </div>
                  </div>
                  {lineOfSight && (
                    <div className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-sm font-medium ${lineOfSight.clear ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-700 dark:text-red-400"}`}>
                      <span>Line of sight</span>
                      <span className="font-mono">
                        {lineOfSight.clear ? "Clear" : `Blocked by ${lineOfSight.maxIntrusionM.toFixed(1)} m`}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {points.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setPoints([])} className="w-full cursor-pointer">
              Clear points
            </Button>
          )}
        </div>
      )}

      <PlaneSlicerFields state={state} setState={setState} />
    </Section>
  )
}
