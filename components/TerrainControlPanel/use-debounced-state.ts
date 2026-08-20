import { useState, useRef, useEffect, useCallback } from "react"

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
// Generic over the value type (numbers for sliders, strings for e.g. the
// matcap material id) — `null` doubles as the no-pending sentinel, so null
// itself isn't a usable T (no current call site needs it).
export function useDebouncedState<T extends number | string>(value: T, setValue: (v: T) => void, delayMs = 150) {
  const [pending, setPending] = useState<T | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pending !== null && value === pending) setPending(null)
  }, [value, pending])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const onChange = useCallback((v: T) => {
    setPending(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setValue(v), delayMs)
  }, [setValue, delayMs])
  return [pending !== null ? pending : value, onChange] as const
}

// Same idea as useDebouncedState above, for an XY pad's (azimuthDeg,
// elevationDeg) pair together.
export function useDebouncedLightDir(azimuthDeg: number, elevationDeg: number, setValue: (v: { azimuthDeg: number; elevationDeg: number }) => void, delayMs = 150) {
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

// A read-side debounce: unlike useDebouncedState/useDebouncedLightDir above
// (which debounce a control's own WRITE into some shared state), this
// debounces CONSUMPTION of a value that may be written by several independent
// writers at different cadences — e.g. illuminationDir/illuminationAlt is one
// shared nuqs field written by both the (cheap, undebounced) Hillshade pad and
// the (already write-debounced) Phong pad. Without a debounce at the read
// side, Phong's raster tile source would refetch on every one of Hillshade's
// undebounced writes too. `delayMs <= 0` bypasses the debounce entirely —
// returns `value` directly, same-render, so a live/cheap consumer (Phong's 2D
// Fast GPU-uniform renderer) sees the raw value with zero added lag — while
// still keeping the internal `debounced` state in sync in the background, so
// there's no stale jump if `delayMs` later becomes positive again (e.g.
// switching Phong from 2D Fast back to 3D Slow).
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    timerRef.current = setTimeout(() => setDebounced(value), delayMs)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [value, delayMs])
  return delayMs <= 0 ? value : debounced
}
