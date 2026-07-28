import type React from "react"
import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CalendarDays, Clock, ChevronDown } from "lucide-react"
import { MobileSlider, SectionIdContext, SegmentedToggle } from "./controls-components"
import { SphericalXYPad } from "./XYPad"
import { useDebouncedState, useDebouncedLightDir } from "./use-debounced-state"
import { cn } from "@/lib/utils"
import { activeSliderAtom } from "@/lib/settings-atoms"
import { solarPosition, dayLength, formatDayOfYear, formatHour, dayOfYearToDate, dayOfYearFromDate } from "@/lib/solar-position"
import { utcOffsetHoursAt, utcInstantForDayOfYear } from "@/lib/timezone"

const SEG_WIDTH = "w-[200px]"

const wrap24 = (h: number) => ((h % 24) + 24) % 24

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
// the track. The Date/Time sliders share ONE sliderId with the XY pad below so
// that editing either day/time keeps the pad (their visualization) lit too.
const LightSlider: React.FC<{
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number; sliderId: string
  displayValue: string; displayNode?: React.ReactNode; ticks?: { value: number; label?: string }[]
  // Rendered directly after the label, on the LEFT side of the row — e.g. the
  // compact UTC/Local switch sits here so the real formatted value can stay
  // pinned to the right via the row's own justify-between.
  labelExtra?: React.ReactNode
}> = ({ label, value, onChange, min, max, step, sliderId, displayValue, displayNode, ticks, labelExtra }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const id = `${sectionId}:${sliderId}`
  const isDimmed = activeSlider !== null && activeSlider !== id
  return (
    <div className={cn("space-y-1 transition-opacity duration-150", isDimmed && "opacity-20")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm">{label}</Label>
          {labelExtra}
        </div>
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

// Mode toggle + XY pad for picking a compass light direction (azimuth +
// elevation), shared by Phong ("Lighting Effects" → Light Direction) and
// native Hillshade ("Illumination Azimuth and Elevation") — both ultimately
// drive the SAME state.illuminationDir/illuminationAlt fields, so they also
// share the same "Free vs Datetime" mode and day/time state (lightUseDatetime/
// lightDayOfYear/lightTimeOfDay) rather than each keeping an independent copy.
//
// "Free": drag the pad to set azimuth + elevation directly.
// "Datetime": solarPosition() (plus the viewport-center lat/lng) computes a
// physically-plausible sun azimuth + altitude for a day-of-year + time-of-day,
// written into illuminationDir/illuminationAlt — the pad then just displays
// the result (read-only, greyed out) instead of accepting drags.
export const LightDirectionControl: React.FC<{
  state: any; setState: (updates: any) => void
  sliderId: string
  debounceMs?: number
  padWidth?: number; padHeight?: number
  azimuthRange?: [number, number]; elevationRange?: [number, number]
  fixedAzimuth?: number | null; fixedElevation?: number | null
  // Hides the Free/Datetime mode toggle and keeps the light pinned to
  // Datetime — for callers (Sun Shadow Calculator) where a freely-dragged
  // light direction wouldn't correspond to any real date/time/place.
  forceDatetime?: boolean
  // Granularity of the Time slider/popover — Hillshade/Phong default to
  // quarter-hour steps, but a precise tool (Sun Shadow Calculator) wants
  // real minute precision.
  timeStepMinutes?: number
  // Folds the XY pad behind a closed-by-default toggle — for callers where
  // the Date/Time sliders are the whole point (Sun Shadow Calculator) and
  // the pad is just a secondary visualization of the result.
  padFoldable?: boolean
}> = ({
  state, setState, sliderId,
  debounceMs = 150,
  padWidth = 200, padHeight = 200,
  azimuthRange = [0, 360], elevationRange = [0, 90],
  fixedAzimuth = null, fixedElevation = null,
  forceDatetime = false,
  timeStepMinutes = 15,
  padFoldable = false,
}) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const [showPad, setShowPad] = useState(!padFoldable)
  const dimWhenSliding = cn("transition-opacity duration-150", activeSlider !== null && "opacity-20")

  const [lightDir, setLightDir] = useDebouncedLightDir(
    state.illuminationDir, state.illuminationAlt,
    useCallback((v: { azimuthDeg: number; elevationDeg: number }) => setState({ illuminationDir: v.azimuthDeg, illuminationAlt: v.elevationDeg }), [setState]),
    debounceMs,
  )

  // state.lightTimeOfDay ("uiHour") is displayed/edited in whichever clock
  // convention state.lightTimeMode picks — "utc" (raw UTC) or "local" (the
  // REAL civil clock at the viewport lat/lng, DST included — see
  // lib/timezone.ts). solarPosition() itself only understands true solar time
  // (solar noon = 12:00, a pure function of longitude — see solar-position.ts's
  // own header), so solarHourFromUi converts uiHour → solar hour right before
  // every sun-position computation; uiHourFromSolarHour is its inverse, used
  // to place the sunrise/sunset ticks (computed in solar time by dayLength)
  // onto the Time slider's own axis, and to rebase lightTimeOfDay across a
  // UTC↔Local toggle so flipping it changes units only, not the actual light.
  const solarHourFromUi = useCallback((day: number, uiHour: number) => {
    if (state.lightTimeMode === "utc") return wrap24(uiHour + state.lng / 15)
    const offsetH = utcOffsetHoursAt(state.lat, state.lng, utcInstantForDayOfYear(day))
    return wrap24(uiHour - offsetH + state.lng / 15)
  }, [state.lightTimeMode, state.lat, state.lng])

  const uiHourFromSolarHour = useCallback((day: number, solarHour: number, mode: "utc" | "local") => {
    if (mode === "utc") return wrap24(solarHour - state.lng / 15)
    const offsetH = utcOffsetHoursAt(state.lat, state.lng, utcInstantForDayOfYear(day))
    return wrap24(solarHour - state.lng / 15 + offsetH)
  }, [state.lat, state.lng])

  // sunToIllum computes the (azimuth, altitude) pair for a given day+uiHour so
  // the Date/Time setters can write the day/time AND the resulting light
  // direction in ONE setState — a single re-render / terrain re-drape instead
  // of two. Writing them separately (slider setState, then an effect
  // rewriting the light) was an "old/new/old/new" flicker in 3D/globe, where
  // each re-render triggers a full terrain re-drape.
  const sunToIllum = useCallback((day: number, uiHour: number) => {
    const s = solarPosition(state.lat, state.lng, day, solarHourFromUi(day, uiHour))
    return {
      illuminationDir: Math.round((((s.azimuth % 360) + 360) % 360) * 10) / 10,
      illuminationAlt: Math.round(Math.max(0, Math.min(90, s.altitude)) * 10) / 10,
    }
  }, [state.lat, state.lng, solarHourFromUi])

  const [dayOfYear, setDayOfYear] = useDebouncedState(
    state.lightDayOfYear,
    useCallback((v: number) => {
      const d = Math.round(v)
      setState({ lightDayOfYear: d, ...(state.lightUseDatetime ? sunToIllum(d, state.lightTimeOfDay) : {}) })
    }, [setState, sunToIllum, state.lightUseDatetime, state.lightTimeOfDay]),
    debounceMs,
  )
  // Granularity the Time slider/setter/popover all agree on — quarter-hour by
  // default (Hillshade/Phong), or down to real minutes for a precise caller.
  const stepsPerHour = 60 / timeStepMinutes
  const [timeOfDay, setTimeOfDay] = useDebouncedState(
    state.lightTimeOfDay,
    useCallback((v: number) => {
      const t = Math.round(v * stepsPerHour) / stepsPerHour
      setState({ lightTimeOfDay: t, ...(state.lightUseDatetime ? sunToIllum(state.lightDayOfYear, t) : {}) })
    }, [setState, sunToIllum, state.lightUseDatetime, state.lightDayOfYear, stepsPerHour]),
    debounceMs,
  )
  // For the hour/minute Select popover — timeOfDay is always a multiple of
  // timeStepMinutes (slider step + setTimeOfDay's own rounding both agree).
  // %24 folds the slider's reachable 24.0 (== 0:00, same instant) onto a
  // normal 0-23 hour.
  const timeHour = Math.floor(timeOfDay) % 24
  const timeMinute = Math.round((timeOfDay - Math.floor(timeOfDay)) * 60)
  const minuteOptions = useMemo(
    () => Array.from({ length: stepsPerHour }, (_, i) => i * timeStepMinutes),
    [stepsPerHour, timeStepMinutes],
  )

  const dayRange = useMemo(() => dayLength(state.lat, state.lightDayOfYear), [state.lat, state.lightDayOfYear])
  // Sunrise/sunset from dayRange are in true solar time — convert onto the
  // Time slider's own (uiHour) axis so the ticks line up with what the slider
  // actually displays.
  const sunTicks = useMemo(() => {
    if (dayRange.polarDay || dayRange.polarNight) return undefined
    const sunriseUi = uiHourFromSolarHour(state.lightDayOfYear, dayRange.sunrise, state.lightTimeMode)
    const sunsetUi = uiHourFromSolarHour(state.lightDayOfYear, dayRange.sunset, state.lightTimeMode)
    return [
      { value: sunriseUi, label: `↑${formatHour(sunriseUi)}` },
      { value: sunsetUi, label: `↓${formatHour(sunsetUi)}` },
    ]
  }, [dayRange, state.lightDayOfYear, state.lightTimeMode, uiHourFromSolarHour])
  // Catches the cases the setters don't: toggling datetime ON, and viewport
  // pans (lat/lng change the sun for the same day/time). For a day/time change
  // the setter already wrote the matching light, so the guard makes this a
  // no-op (no second render) rather than a fighting rewrite.
  useEffect(() => {
    if (!state.lightUseDatetime) return
    const { illuminationDir: dir, illuminationAlt: alt } = sunToIllum(state.lightDayOfYear, state.lightTimeOfDay)
    if (Math.abs(dir - state.illuminationDir) > 0.05 || Math.abs(alt - state.illuminationAlt) > 0.05) {
      setState({ illuminationDir: dir, illuminationAlt: alt })
    }
  }, [state.lightUseDatetime, sunToIllum, state.lightDayOfYear, state.lightTimeOfDay, state.illuminationDir, state.illuminationAlt, setState])

  // forceDatetime callers (Sun Shadow Calculator) have no use for a freely
  // dragged light — pin the shared mode to Datetime for as long as this
  // instance is mounted.
  useEffect(() => {
    if (forceDatetime && !state.lightUseDatetime) setState({ lightUseDatetime: true })
  }, [forceDatetime, state.lightUseDatetime, setState])

  return (
    <div className="space-y-3">
      {!forceDatetime && (
        <div className={cn("flex items-center justify-between gap-2", dimWhenSliding)}>
          <Label className="text-sm font-medium">Mode</Label>
          <SegmentedToggle
            className={SEG_WIDTH}
            value={state.lightUseDatetime ? "datetime" : "free"}
            onChange={(value) => setState({ lightUseDatetime: value === "datetime" })}
            options={[
              { value: "free", label: "Free", tooltip: "Drag the pad to set any light azimuth + elevation freely." },
              { value: "datetime", label: "Datetime", tooltip: "Derive the light from the sun's position for a day + time at the viewport-center latitude/longitude." },
            ]}
          />
        </div>
      )}

      {state.lightUseDatetime && (
        <div className="space-y-3">
          {/* Day of year → calendar date, with seasonal tick marks. Shares
              `sliderId` with the Time slider and XY pad so editing any of
              them keeps the whole group lit (and dims everything else). */}
          <LightSlider
            label="Date"
            value={dayOfYear}
            onChange={setDayOfYear}
            min={1} max={365} step={1}
            sliderId={sliderId}
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
          {/* Ticked at the day's sunrise/sunset, converted onto whichever
              clock convention (UTC/Local) is currently selected. UTC vs Local
              is purely a display/input convention — the compact switch next
              to the "Time" label rebases timeOfDay on toggle so the actual
              light direction doesn't jump, see uiHourFromSolarHour above. */}
          <LightSlider
            label="Time"
            value={timeOfDay}
            onChange={setTimeOfDay}
            min={0} max={24} step={1 / stepsPerHour}
            sliderId={sliderId}
            displayValue={formatHour(timeOfDay)}
            displayNode={
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums cursor-pointer hover:text-foreground" title="Pick a time">
                    {formatHour(timeOfDay)}
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-2">
                  <div className="flex items-center gap-1">
                    <Select value={String(timeHour)} onValueChange={(v) => setTimeOfDay(Number(v) + timeMinute / 60)}>
                      <SelectTrigger className="w-[68px] cursor-pointer"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, h) => (
                          <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">:</span>
                    <Select value={String(timeMinute)} onValueChange={(v) => setTimeOfDay(timeHour + Number(v) / 60)}>
                      <SelectTrigger className="w-[68px] cursor-pointer"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {minuteOptions.map((m) => (
                          <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverContent>
              </Popover>
            }
            ticks={sunTicks}
            labelExtra={
              <TooltipProvider>
                <div className="flex items-center gap-1.5">
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Label className="text-xs text-muted-foreground cursor-pointer">Local</Label>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs max-w-xs">
                      Local: the real civil clock at the viewport latitude/longitude, including that location's own daylight-saving rules.<br />
                      UTC: reads UTC directly, independent of viewport location.
                    </TooltipContent>
                  </Tooltip>
                  <Switch
                    checked={state.lightTimeMode === "utc"}
                    onCheckedChange={(checked) => {
                      const mode = checked ? "utc" : "local"
                      const solarHour = solarHourFromUi(state.lightDayOfYear, state.lightTimeOfDay)
                      const rebasedUiHour = Math.round(uiHourFromSolarHour(state.lightDayOfYear, solarHour, mode) * stepsPerHour) / stepsPerHour
                      setState({ lightTimeMode: mode, lightTimeOfDay: rebasedUiHour })
                    }}
                    className="h-5 w-9 bg-muted data-[state=checked]:bg-primary rounded-full p-1 cursor-pointer border-transparent"
                  />
                  <Label className="text-xs text-muted-foreground">UTC</Label>
                </div>
              </TooltipProvider>
            }
          />
        </div>
      )}

      {padFoldable && (
        <button
          type="button"
          onClick={() => setShowPad((v) => !v)}
          className="flex items-center justify-between gap-2 w-full cursor-pointer"
        >
          <Label className="text-sm font-medium cursor-pointer">Pad</Label>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", showPad && "rotate-180")} />
        </button>
      )}
      {/* In datetime mode the pad is a read-only visualization of the
          computed sun direction (the sliders drive it), so pointer events are
          disabled and it's greyed (desaturated + dimmed) to read as "display
          only" while still showing the light direction. Shares `sliderId`
          with the datetime sliders so it stays lit while they're edited. */}
      {showPad && (
        <div className={cn("flex flex-col items-center gap-1", state.lightUseDatetime && "pointer-events-none")}>
          <div className={cn(state.lightUseDatetime && "opacity-60 grayscale")}>
            <SphericalXYPad
              width={padWidth}
              height={padHeight}
              azimuthRange={azimuthRange}
              elevationRange={elevationRange}
              sliderId={sliderId}
              value={lightDir}
              onChange={setLightDir}
              fixedAzimuth={fixedAzimuth}
              fixedElevation={fixedElevation}
            />
          </div>
          {state.lightUseDatetime && (
            <span className="text-[10px] text-muted-foreground italic">Set by date &amp; time · display only</span>
          )}
        </div>
      )}
    </div>
  )
}
