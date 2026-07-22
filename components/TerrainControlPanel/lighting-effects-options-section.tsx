import type React from "react"
import { useState, useRef, useEffect, useCallback, useMemo, useContext } from "react"
import { useAtom } from "jotai"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, CheckboxWithSlider, SliderControl, MobileSlider, SectionIdContext } from "./controls-components"
import { SphericalXYPad } from './XYPad'
import { cn } from "@/lib/utils"
import { activeSliderAtom } from "@/lib/settings-atoms"
import { MATCAP_TEXTURES } from "@/lib/matcap-textures"
import { solarPosition, dayLength, formatDayOfYear, formatHour } from "@/lib/solar-position"

// Segmented-control styling for the Phong toggle groups (Renderer, Light Mode,
// Direction). Two problems made "which option is active" ambiguous before:
//  1. data-[state=on]:bg-white is invisible on light themes (white pill on a
//     white popover).
//  2. more fundamentally, every item here is ALSO a TooltipTrigger asChild,
//     which merges the TOOLTIP's data-state (open/closed) onto the very same
//     element — clobbering the ToggleGroupItem's own data-state (on/off), so
//     `data-[state=on]:…` styling literally never applied (same asChild/
//     data-state collision noted on AdvancedModeToggle in controls-components).
// So the active pill is driven by an explicit `active` boolean (segItem below)
// from the actual state value, not data-state — a muted track + elevated
// "background" pill that reads clearly in both light and dark.
const SEG_GROUP = "w-[200px] gap-0.5 rounded-md bg-muted p-0.5"
const SEG_ITEM_BASE = "flex-1 rounded-sm px-2 text-xs cursor-pointer transition-colors text-muted-foreground font-normal hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
const SEG_ITEM_ACTIVE = "bg-background shadow-sm font-semibold text-foreground"
const segItem = (active: boolean) => cn(SEG_ITEM_BASE, active && SEG_ITEM_ACTIVE)

// Seasonal reference points for the day-of-year slider (non-leap 2026), so the
// physical meaning of a date is legible at a glance (winter = low sun, etc.).
const SEASON_TICKS = [
  { value: 79, label: "Spr" },  // ~Mar 20 equinox
  { value: 172, label: "Sum" }, // ~Jun 21 solstice
  { value: 265, label: "Aut" }, // ~Sep 22 equinox
  { value: 355, label: "Win" }, // ~Dec 21 solstice
]

// A slider row that (a) participates in the "dim everything except the control
// being edited" behavior exactly like SliderControl (composes the same
// section-scoped id + reads activeSliderAtom), (b) shows an arbitrary formatted
// value string rather than value.toFixed, and (c) can render tick marks under
// the track. The datetime sliders share ONE sliderId with the XY pad below so
// that editing either day/time keeps the pad (their visualization) lit too.
const LightSlider: React.FC<{
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number; sliderId: string
  displayValue: string; ticks?: { value: number; label?: string }[]
}> = ({ label, value, onChange, min, max, step, sliderId, displayValue, ticks }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const id = `${sectionId}:${sliderId}`
  const isDimmed = activeSlider !== null && activeSlider !== id
  return (
    <div className={cn("space-y-1 transition-opacity duration-150", isDimmed && "opacity-20")}>
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="text-sm text-muted-foreground tabular-nums">{displayValue}</span>
      </div>
      <MobileSlider sliderId={id} value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} className="cursor-pointer" />
      {ticks && ticks.length > 0 && (
        <div className="relative h-3">
          {ticks.map((t) => {
            const pos = Math.min(1, Math.max(0, (t.value - min) / (max - min)))
            return (
              <div key={t.value} className="absolute flex flex-col items-center -translate-x-1/2" style={{ left: `${pos * 100}%` }}>
                <div className="w-px h-1 bg-muted-foreground/60" />
                {t.label && <span className="text-[9px] leading-none text-muted-foreground whitespace-nowrap">{t.label}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const MATCAP_IDS = MATCAP_TEXTURES.map((t) => t.id)

// matcapRotationDeg/illuminationDir/illuminationAlt/phongDiffuseStrength/
// phongSpecularStrength/exaggeration each feed directly into the matcap:// /
// phong:// tile URL (see lib/matcap-protocol.ts, lib/phong-protocol.ts) —
// every change re-fetches/recomputes every currently-visible tile. Dragging
// a slider or the XY pad fires many changes per second, so this debounces
// the actual `setState` call (which is what rebuilds the tile URL) while
// tracking a LOCAL value for the control itself, so the slider/pad still
// feels instantly responsive to drag even though the expensive recompute
// only happens ~150ms after the user stops moving it.
// `pending` is null whenever there's no in-flight drag — the displayed value
// is then just the real prop. While dragging, `pending` holds the optimistic
// local value and only clears once the prop actually catches up to it (not
// on a fixed timer and not via an unconditional "resync from props" effect,
// which risks a render loop if the round-tripped prop is ever a fraction off
// from what was sent — e.g. float precision through a URL-backed store).
function useDebouncedState(value: number, setValue: (v: number) => void, delayMs = 150) {
  const [pending, setPending] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pending !== null && value === pending) setPending(null)
  }, [value, pending])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const onChange = useCallback((v: number) => {
    setPending(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setValue(v), delayMs)
  }, [setValue, delayMs])
  return [pending !== null ? pending : value, onChange] as const
}

// Same idea as useDebouncedState above, for the XY pad's (azimuthDeg,
// elevationDeg) pair together.
function useDebouncedLightDir(azimuthDeg: number, elevationDeg: number, setValue: (v: { azimuthDeg: number; elevationDeg: number }) => void, delayMs = 150) {
  type Dir = { azimuthDeg: number; elevationDeg: number }
  const [pending, setPending] = useState<Dir | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pending !== null && azimuthDeg === pending.azimuthDeg && elevationDeg === pending.elevationDeg) setPending(null)
  }, [azimuthDeg, elevationDeg, pending])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const onChange = useCallback((v: Dir) => {
    setPending(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setValue(v), delayMs)
  }, [setValue, delayMs])
  return [pending !== null ? pending : { azimuthDeg, elevationDeg }, onChange] as const
}

// "Lighting Effects" houses two independent shading sub-modes, mirroring
// Relief Visualization's LRM/SVF/Openness pattern (master checkbox+opacity at
// the top, each sub-mode its own CheckboxWithSlider + detail fields):
//  - "Matcap" (lib/matcap-protocol.ts): a material-capture lookup by surface
//    normal, rendered as a plain draped raster tile.
//  - "Phong" (lib/phong-protocol.ts): real ambient+diffuse+specular shading
//    from a compass-fixed light, same raster-tile approach.
// Both are plain `raster` layers draped over 3D terrain AND globe
// automatically — see either protocol module's header for why that's a
// prior hand-written WebGL layer (with its own mesh/depth-buffer handling
// AND its own globe-projection matrix) unnecessary, and the whole reason
// dragging any of these controls is debounced above: unlike a native
// `type: "hillshade"` paint property (a pure GPU uniform update), every
// change here re-fetches/recomputes a raster tile.
export const LightingEffectsOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({
  state,
  setState,
  isOpen,
  onOpenChange,
}) => {
  const [isLightDirOpen, setIsLightDirOpen] = useState(true)

  const cycleMatcap = useCallback((direction: number) => {
    const currentIndex = MATCAP_IDS.indexOf(state.matcapTextureId)
    const newIndex = (currentIndex + direction + MATCAP_IDS.length) % MATCAP_IDS.length
    setState({ matcapTextureId: MATCAP_IDS[newIndex] })
  }, [state.matcapTextureId, setState])

  const [matcapRotationDeg, setMatcapRotationDeg] = useDebouncedState(
    state.matcapRotationDeg, useCallback((v: number) => setState({ matcapRotationDeg: v }), [setState]),
  )
  // The "live" (2D Fast) renderer updates via GPU uniforms with zero tile
  // refetch, so it isn't debounced at all (0ms — every drag frame applies
  // immediately); "raster" (3D Slow) re-fetches every visible tile per change,
  // so it keeps the gentler 150ms debounce.
  const phongDebounceMs = state.phongRenderer === "live" ? 0 : 150
  const [phongDiffuseStrength, setPhongDiffuseStrength] = useDebouncedState(
    state.phongDiffuseStrength, useCallback((v: number) => setState({ phongDiffuseStrength: v }), [setState]), phongDebounceMs,
  )
  const [phongSpecularStrength, setPhongSpecularStrength] = useDebouncedState(
    state.phongSpecularStrength, useCallback((v: number) => setState({ phongSpecularStrength: v }), [setState]), phongDebounceMs,
  )
  const [lightDir, setLightDir] = useDebouncedLightDir(
    state.illuminationDir, state.illuminationAlt,
    useCallback((v: { azimuthDeg: number; elevationDeg: number }) => setState({ illuminationDir: v.azimuthDeg, illuminationAlt: v.elevationDeg }), [setState]),
    phongDebounceMs,
  )

  // ─── Datetime-driven light ───────────────────────────────────────────────
  // When "Datetime-based" is on, the day-of-year + time-of-day sliders drive
  // the light: solarPosition() turns them (plus the viewport-center lat/lng)
  // into a compass azimuth + altitude that we write straight into
  // illuminationDir/illuminationAlt — the same fields the XY pad reflects, so
  // the pad shows the resulting sun direction. Only writes when the computed
  // values actually differ (rounded) so it never fights itself into a loop.
  const sun = useMemo(
    () => solarPosition(state.lat, state.lng, state.phongLightDayOfYear, state.phongLightTimeOfDay),
    [state.lat, state.lng, state.phongLightDayOfYear, state.phongLightTimeOfDay],
  )
  const dayRange = useMemo(() => dayLength(state.lat, state.phongLightDayOfYear), [state.lat, state.phongLightDayOfYear])
  useEffect(() => {
    if (!state.phongLightUseDatetime) return
    const dir = Math.round(((sun.azimuth % 360) + 360) % 360 * 10) / 10
    const alt = Math.round(Math.max(0, Math.min(90, sun.altitude)) * 10) / 10
    if (Math.abs(dir - state.illuminationDir) > 0.05 || Math.abs(alt - state.illuminationAlt) > 0.05) {
      setState({ illuminationDir: dir, illuminationAlt: alt })
    }
  }, [state.phongLightUseDatetime, sun, state.illuminationDir, state.illuminationAlt, setState])

  if (!state.showLightingEffects) return null

  return (
    <Section title="Lighting Effects" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-4">
        {/* ─── Matcap sub-mode ─── */}
        <div className="space-y-2">
          <CheckboxWithSlider
            id="lighting-matcap"
            label="Matcap"
            tooltip="Shades the terrain surface from a material-capture image (like a 3D sculpting tool) instead of a directional light."
            checked={state.showMatcap}
            onCheckedChange={(checked) => setState({ showMatcap: checked })}
            sliderValue={state.matcapOpacity}
            onSliderChange={(value) => setState({ matcapOpacity: value })}
          />
          {state.showMatcap && (
            <div className="space-y-3 pl-1">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Material</Label>
                <div className="flex gap-2">
                  <Select value={state.matcapTextureId} onValueChange={(value) => setState({ matcapTextureId: value })}>
                    <SelectTrigger className="flex-1 min-w-0 w-full cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCAP_TEXTURES.map((tex) => (
                        <SelectItem key={tex.id} value={tex.id}>
                          <div className="flex items-center gap-2">
                            <img src={tex.url} alt="" className="w-6 h-6 rounded-full object-cover border shrink-0" />
                            <span>{tex.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex border rounded-md shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => cycleMatcap(-1)} className="rounded-r-none border-r cursor-pointer">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => cycleMatcap(1)} className="rounded-l-none cursor-pointer">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <SliderControl
                label="Sphere Rotation"
                value={matcapRotationDeg}
                onChange={setMatcapRotationDeg}
                min={0} max={360} step={1} suffix="°"
                sliderId="matcap-rotation"
              />
            </div>
          )}
        </div>

        {/* ─── Phong sub-mode ─── */}
        <div className="space-y-2">
          <CheckboxWithSlider
            id="lighting-phong"
            label="Phong"
            tooltip="Ambient+diffuse+specular shading against the raster basemap as albedo, with a movable light — a physically-flavored alternative to a matcap material."
            checked={state.showPhong}
            onCheckedChange={(checked) => setState({ showPhong: checked })}
            sliderValue={state.phongOpacity}
            onSliderChange={(value) => setState({ phongOpacity: value })}
          />
          {state.showPhong && (
            <div className="space-y-3 pl-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">Renderer</Label>
                <ToggleGroup
                  type="single"
                  value={state.phongRenderer}
                  onValueChange={(value) => value && setState({ phongRenderer: value })}
                  className={SEG_GROUP}
                >
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="raster" className={segItem(state.phongRenderer === "raster")}>
                        3D Slow
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Drapes correctly over 3D terrain exaggeration and globe, but every light/strength change re-fetches a tile (~150ms debounced).</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="live" disabled={state.viewMode === "globe"} className={segItem(state.phongRenderer === "live")}>
                        2D Fast
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{state.viewMode === "globe" ? "Not available in Globe view — this renderer doesn't drape onto globe curvature." : "A live GPU shader, instant light/strength updates, zero tile refetch — but flat only: doesn't drape onto 3D terrain elevation."}</p>
                    </TooltipContent>
                  </Tooltip>
                </ToggleGroup>
              </div>
              {state.phongRenderer === "live" && (
                <p className="text-xs text-muted-foreground">
                  2D Fast renders a flat shaded plane and won't follow 3D terrain elevation — switch to 3D Slow for a correct drape.
                </p>
              )}
              {/* Light Mode: Absolute keeps the light fixed to compass
                  directions (matches maplibre's own hillshade illumination);
                  Camera adds the settled map bearing to the azimuth so the
                  light appears to follow the view like a headlamp. Wired into
                  BOTH renderers' lightDir prop in TerrainViewer.tsx. */}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">Light Mode</Label>
                <ToggleGroup
                  type="single"
                  value={state.phongLightRelativeToCamera ? "relative" : "absolute"}
                  onValueChange={(value) => value && setState({ phongLightRelativeToCamera: value === "relative" })}
                  className={SEG_GROUP}
                >
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="absolute" className={segItem(!state.phongLightRelativeToCamera)}>
                        Absolute
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent><p>Light stays fixed to compass directions as you rotate the map — matches maplibre's own hillshade illumination direction.</p></TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="relative" className={segItem(state.phongLightRelativeToCamera)}>
                        Camera
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent><p>Light stays fixed relative to the camera — it appears to follow you as you rotate the map, like a headlamp.</p></TooltipContent>
                  </Tooltip>
                </ToggleGroup>
              </div>
              <Collapsible open={isLightDirOpen} onOpenChange={setIsLightDirOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  Light Direction<ChevronDown className={`h-4 w-4 transition-transform ${isLightDirOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1 overflow-visible">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium">Direction</Label>
                    <ToggleGroup
                      type="single"
                      value={state.phongLightUseDatetime ? "datetime" : "free"}
                      onValueChange={(value) => value && setState({ phongLightUseDatetime: value === "datetime" })}
                      className={SEG_GROUP}
                    >
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <ToggleGroupItem value="free" className={segItem(!state.phongLightUseDatetime)}>
                            Free
                          </ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent><p>Drag the pad to set any light azimuth + elevation freely.</p></TooltipContent>
                      </Tooltip>
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <ToggleGroupItem value="datetime" className={segItem(state.phongLightUseDatetime)}>
                            Datetime
                          </ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent><p>Derive the light from the sun's position for a day + time at the viewport-center latitude/longitude.</p></TooltipContent>
                      </Tooltip>
                    </ToggleGroup>
                  </div>

                  {state.phongLightUseDatetime && (
                    <div className="space-y-3">
                      {/* Day of year → calendar date, with seasonal tick marks.
                          Shares the "phong-light" sliderId with the Time slider
                          and XY pad so editing any of them keeps the whole group
                          lit (and dims everything else). */}
                      <LightSlider
                        label="Date"
                        value={state.phongLightDayOfYear}
                        onChange={(v) => setState({ phongLightDayOfYear: Math.round(v) })}
                        min={1} max={365} step={1}
                        sliderId="phong-light"
                        displayValue={formatDayOfYear(state.phongLightDayOfYear)}
                        ticks={SEASON_TICKS}
                      />
                      {/* Time of day (local solar time), ticked at the day's
                          sunrise/sunset for the viewport-center latitude. */}
                      <LightSlider
                        label="Time"
                        value={state.phongLightTimeOfDay}
                        onChange={(v) => setState({ phongLightTimeOfDay: Math.round(v * 4) / 4 })}
                        min={0} max={24} step={0.25}
                        sliderId="phong-light"
                        displayValue={formatHour(state.phongLightTimeOfDay)}
                        ticks={dayRange.polarDay || dayRange.polarNight ? undefined : [
                          { value: dayRange.sunrise, label: `↑${formatHour(dayRange.sunrise)}` },
                          { value: dayRange.sunset, label: `↓${formatHour(dayRange.sunset)}` },
                        ]}
                      />
                      <p className="text-xs text-muted-foreground">
                        {dayRange.polarNight
                          ? "Polar night — sun stays below the horizon all day"
                          : dayRange.polarDay
                            ? "Midnight sun — sun stays above the horizon all day"
                            : `Daylight ${formatHour(dayRange.sunrise)}–${formatHour(dayRange.sunset)} · sun ${sun.altitude >= 0 ? `${Math.round(sun.altitude)}° above` : `${Math.round(-sun.altitude)}° below`} horizon (solar time @ ${state.lat.toFixed(2)}°, ${state.lng.toFixed(2)}°)`}
                      </p>
                    </div>
                  )}

                  {/* In datetime mode the pad is a read-only visualization of the
                      computed sun direction (the sliders drive it), so pointer
                      events are disabled to avoid fighting the sliders. Shares
                      the "phong-light" sliderId with the datetime sliders so it
                      stays lit (not dimmed) while they're being edited. */}
                  <div className={`flex justify-center ${state.phongLightUseDatetime ? "pointer-events-none" : ""}`}>
                    <SphericalXYPad
                      width={200}
                      height={200}
                      azimuthRange={[0, 360]}
                      elevationRange={[0, 90]}
                      sliderId="phong-light"
                      value={lightDir}
                      onChange={setLightDir}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <SliderControl
                label="Albedo (Raster Basemap Opacity)"
                value={state.rasterBasemapOpacity}
                onChange={(v) => setState({ rasterBasemapOpacity: v })}
                min={0} max={1} step={0.05} decimals={2}
                sliderId="phong-albedo"
              />
              <SliderControl
                label="Diffuse Strength"
                value={phongDiffuseStrength}
                onChange={setPhongDiffuseStrength}
                min={0} max={1} step={0.05} decimals={2}
                sliderId="phong-diffuse"
              />
              <SliderControl
                label="Specular Strength"
                value={phongSpecularStrength}
                onChange={setPhongSpecularStrength}
                min={0} max={1} step={0.05} decimals={2}
                sliderId="phong-specular"
              />
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
