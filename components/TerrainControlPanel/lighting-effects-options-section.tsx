import type React from "react"
import { useState, useRef, useEffect, useCallback, useMemo, useContext } from "react"
import { useAtom } from "jotai"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { CalendarDays } from "lucide-react"
import { Section, CheckboxWithSlider, SliderControl, MobileSlider, SectionIdContext, SegmentedToggle } from "./controls-components"
import { SphericalXYPad } from './XYPad'
import { cn } from "@/lib/utils"
import { activeSliderAtom } from "@/lib/settings-atoms"
import { MATCAP_TEXTURES } from "@/lib/matcap-textures"
import { solarPosition, dayLength, formatDayOfYear, formatHour, dayOfYearToDate, dayOfYearFromDate } from "@/lib/solar-position"

// Common width for the Phong toggle groups (see SegmentedToggle in
// controls-components for the segmented-control styling + why the active pill
// is driven by an explicit value match rather than data-[state=on]).
const SEG_WIDTH = "w-[200px]"

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
  displayValue: string; displayNode?: React.ReactNode; ticks?: { value: number; label?: string }[]
}> = ({ label, value, onChange, min, max, step, sliderId, displayValue, displayNode, ticks }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const id = `${sectionId}:${sliderId}`
  const isDimmed = activeSlider !== null && activeSlider !== id
  return (
    <div className={cn("space-y-1 transition-opacity duration-150", isDimmed && "opacity-20")}>
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        {displayNode ?? <span className="text-sm text-muted-foreground tabular-nums">{displayValue}</span>}
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
  const [isIntensitiesOpen, setIsIntensitiesOpen] = useState(true)

  // When ANY slider (a MobileSlider/SphericalXYPad) is actively being dragged,
  // everything that isn't the active control dims (the transparent-UI "silence
  // everything except what I'm editing" behavior). Toggle groups + section
  // labels aren't sliders so they never set/own the active id — so dim them
  // whenever an active slider exists. The datetime Date/Time sliders + the XY
  // pad share the "phong-light" id, so editing them dims these toggle rows
  // while keeping only the pad + sliders lit, as requested.
  const [activeSlider] = useAtom(activeSliderAtom)
  const dimWhenSliding = cn("transition-opacity duration-150", activeSlider !== null && "opacity-20")

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
  // the light: solarPosition() (plus the viewport-center lat/lng) → compass
  // azimuth + altitude written into illuminationDir/illuminationAlt (the same
  // fields the XY pad reflects). sunToIllum computes that pair for a given
  // day+time so the Date/Time setters can write the day/time AND the resulting
  // light direction in ONE setState — a single re-render / terrain re-drape
  // instead of two. Writing them separately (slider setState, then an effect
  // rewriting the light) was the "old/new/old/new" flicker in 3D/globe, where
  // each re-render triggers a full terrain re-drape.
  const sunToIllum = useCallback((day: number, time: number) => {
    const s = solarPosition(state.lat, state.lng, day, time)
    return {
      illuminationDir: Math.round((((s.azimuth % 360) + 360) % 360) * 10) / 10,
      illuminationAlt: Math.round(Math.max(0, Math.min(90, s.altitude)) * 10) / 10,
    }
  }, [state.lat, state.lng])

  // Datetime sliders are debounced by the same renderer-based delay so RASTER
  // (3D Slow) doesn't re-fetch per drag step (150ms); live (2D Fast, 0ms) stays
  // instant. Each writes the light direction together with the day/time.
  const [dayOfYear, setDayOfYear] = useDebouncedState(
    state.phongLightDayOfYear,
    useCallback((v: number) => {
      const d = Math.round(v)
      setState({ phongLightDayOfYear: d, ...(state.phongLightUseDatetime ? sunToIllum(d, state.phongLightTimeOfDay) : {}) })
    }, [setState, sunToIllum, state.phongLightUseDatetime, state.phongLightTimeOfDay]),
    phongDebounceMs,
  )
  const [timeOfDay, setTimeOfDay] = useDebouncedState(
    state.phongLightTimeOfDay,
    useCallback((v: number) => {
      const t = Math.round(v * 4) / 4
      setState({ phongLightTimeOfDay: t, ...(state.phongLightUseDatetime ? sunToIllum(state.phongLightDayOfYear, t) : {}) })
    }, [setState, sunToIllum, state.phongLightUseDatetime, state.phongLightDayOfYear]),
    phongDebounceMs,
  )

  const sun = useMemo(
    () => solarPosition(state.lat, state.lng, state.phongLightDayOfYear, state.phongLightTimeOfDay),
    [state.lat, state.lng, state.phongLightDayOfYear, state.phongLightTimeOfDay],
  )
  const dayRange = useMemo(() => dayLength(state.lat, state.phongLightDayOfYear), [state.lat, state.phongLightDayOfYear])
  // Catches the cases the setters don't: toggling datetime ON, and viewport
  // pans (lat/lng change the sun for the same day/time). For a day/time change
  // the setter already wrote the matching light, so the guard makes this a
  // no-op (no second render) rather than a fighting rewrite.
  useEffect(() => {
    if (!state.phongLightUseDatetime) return
    const { illuminationDir: dir, illuminationAlt: alt } = sunToIllum(state.phongLightDayOfYear, state.phongLightTimeOfDay)
    if (Math.abs(dir - state.illuminationDir) > 0.05 || Math.abs(alt - state.illuminationAlt) > 0.05) {
      setState({ illuminationDir: dir, illuminationAlt: alt })
    }
  }, [state.phongLightUseDatetime, sunToIllum, state.phongLightDayOfYear, state.phongLightTimeOfDay, state.illuminationDir, state.illuminationAlt, setState])

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
              <div className={cn("flex items-center justify-between gap-2", dimWhenSliding)}>
                <Label className="text-sm font-medium">Renderer</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  value={state.phongRenderer}
                  onChange={(value) => setState({ phongRenderer: value })}
                  options={[
                    { value: "raster", label: "3D Slow", tooltip: "Drapes correctly over 3D terrain exaggeration and globe, but every light/strength change re-fetches a tile (~150ms debounced)." },
                    { value: "live", label: "2D Fast", tooltip: "A live GPU shader, instant light/strength updates, zero tile refetch — projects correctly under mercator and globe, but flat only: doesn't drape onto 3D terrain elevation." },
                  ]}
                />
              </div>
              {/* Intensities — albedo/diffuse/specular, foldable, above Light Anchor. */}
              <Collapsible open={isIntensitiesOpen} onOpenChange={setIsIntensitiesOpen}>
                <CollapsibleTrigger className={cn("flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer", dimWhenSliding)}>
                  Intensities<ChevronDown className={`h-4 w-4 transition-transform ${isIntensitiesOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1">
                  <SliderControl label="Albedo (Raster Basemap Opacity)" value={state.rasterBasemapOpacity} onChange={(v) => setState({ rasterBasemapOpacity: v })} min={0} max={1} step={0.05} decimals={2} sliderId="phong-albedo" />
                  <SliderControl label="Diffuse Strength" value={phongDiffuseStrength} onChange={setPhongDiffuseStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-diffuse" />
                  <SliderControl label="Specular Strength" value={phongSpecularStrength} onChange={setPhongSpecularStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-specular" />
                </CollapsibleContent>
              </Collapsible>
              {/* Light Anchor: Absolute keeps the light fixed to compass
                  directions; Camera makes it a headlamp fixed to the view.
                  Only 2D Fast (live) can do a true per-frame camera headlamp,
                  so this is disabled + forced to Absolute in 3D Slow (raster),
                  which always renders absolute (see TerrainViewer.tsx). */}
              <div className={cn("flex items-center justify-between gap-2", dimWhenSliding)}>
                <Label className="text-sm font-medium">Light Anchor</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  disabled={state.phongRenderer === "raster"}
                  value={state.phongRenderer === "raster" ? "absolute" : (state.phongLightRelativeToCamera ? "relative" : "absolute")}
                  onChange={(value) => setState({ phongLightRelativeToCamera: value === "relative" })}
                  options={[
                    { value: "absolute", label: "Absolute", tooltip: "Light stays fixed to compass directions as you rotate the map — matches maplibre's own hillshade illumination direction." },
                    { value: "relative", label: "Camera", tooltip: state.phongRenderer === "raster" ? "Camera-relative light is only available in 2D Fast." : "Light stays fixed relative to the camera — it appears to follow you as you rotate the map, like a headlamp." },
                  ]}
                />
              </div>
              <Collapsible open={isLightDirOpen} onOpenChange={setIsLightDirOpen}>
                <CollapsibleTrigger className={cn("flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer", dimWhenSliding)}>
                  Light Direction<ChevronDown className={`h-4 w-4 transition-transform ${isLightDirOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1 overflow-visible">
                  <div className={cn("flex items-center justify-between gap-2", dimWhenSliding)}>
                    <Label className="text-sm font-medium">Mode</Label>
                    <SegmentedToggle
                      className={SEG_WIDTH}
                      value={state.phongLightUseDatetime ? "datetime" : "free"}
                      onChange={(value) => setState({ phongLightUseDatetime: value === "datetime" })}
                      options={[
                        { value: "free", label: "Free", tooltip: "Drag the pad to set any light azimuth + elevation freely." },
                        { value: "datetime", label: "Datetime", tooltip: "Derive the light from the sun's position for a day + time at the viewport-center latitude/longitude." },
                      ]}
                    />
                  </div>

                  {state.phongLightUseDatetime && (
                    <div className="space-y-3">
                      {/* Day of year → calendar date, with seasonal tick marks.
                          Shares the "phong-light" sliderId with the Time slider
                          and XY pad so editing any of them keeps the whole group
                          lit (and dims everything else). */}
                      <LightSlider
                        label="Date"
                        value={dayOfYear}
                        onChange={setDayOfYear}
                        min={1} max={365} step={1}
                        sliderId="phong-light"
                        displayValue={formatDayOfYear(dayOfYear)}
                        displayNode={
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums cursor-pointer hover:text-foreground" title="Pick a date">
                                {formatDayOfYear(dayOfYear)}
                                <CalendarDays className="h-3.5 w-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={dayOfYearToDate(dayOfYear)}
                                defaultMonth={dayOfYearToDate(dayOfYear)}
                                onSelect={(d) => { if (d) setDayOfYear(dayOfYearFromDate(d)) }}
                              />
                            </PopoverContent>
                          </Popover>
                        }
                        ticks={SEASON_TICKS}
                      />
                      {/* Time of day (local solar time), ticked at the day's
                          sunrise/sunset for the viewport-center latitude. */}
                      <LightSlider
                        label="Time"
                        value={timeOfDay}
                        onChange={setTimeOfDay}
                        min={0} max={24} step={0.25}
                        sliderId="phong-light"
                        displayValue={formatHour(timeOfDay)}
                        ticks={dayRange.polarDay || dayRange.polarNight ? undefined : [
                          { value: dayRange.sunrise, label: `↑${formatHour(dayRange.sunrise)}` },
                          { value: dayRange.sunset, label: `↓${formatHour(dayRange.sunset)}` },
                        ]}
                      />
                    </div>
                  )}

                  {/* In datetime mode the pad is a read-only visualization of the
                      computed sun direction (the sliders drive it), so pointer
                      events are disabled and it's greyed (desaturated + dimmed)
                      to read as "display only" while still showing the light
                      direction. Shares the "phong-light" sliderId with the
                      datetime sliders so it stays lit while they're edited. */}
                  <div className={cn("flex flex-col items-center gap-1", state.phongLightUseDatetime && "pointer-events-none")}>
                    <div className={cn(state.phongLightUseDatetime && "opacity-60 grayscale")}>
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
                    {state.phongLightUseDatetime && (
                      <span className="text-[10px] text-muted-foreground italic">Set by date &amp; time · display only</span>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
