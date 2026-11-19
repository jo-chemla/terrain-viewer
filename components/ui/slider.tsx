'use client'

import * as React from 'react'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'

import { cn } from '@/lib/utils'

// Generic over the value shape, mirroring Base UI's own SliderRoot<Value> —
// the original non-generic `SliderPrimitive.Root.Props` erased that parameter
// to the `number | readonly number[]` union, which is why every range call
// site failed to destructure `([min, max]) => ...` under tsc and every
// single-value site needed a `v as number` cast. With the generic preserved,
// `value={[a, b]}` infers an array-typed onValueChange automatically.
/** Where a single-thumb slider's filled track starts, if not at `min`. Pass 0
 *  on a signed scale so the fill reads as a signed offset from the middle
 *  rather than as a quantity measured from the far left. */
type SliderExtras = { origin?: number }

function Slider<Value extends number | readonly number[]>({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  origin,
  step = 1,
  onValueChange,
  onValueCommitted,
  ref: outerRef,
  ...props
}: SliderPrimitive.Root.Props<Value> & SliderExtras) {
  // Fine drag. With Ctrl or Shift held, a pointer drag moves the value by
  // the distance travelled, twenty times slower and in steps twenty times finer,
  // instead of putting the thumb under the cursor. The modifier can be
  // pressed before the press (nothing jumps, wherever the track is grabbed)
  // or in the middle of a drag (the thumb carries on from where it is).
  // Base UI still reports the value under the cursor: it is replaced here.
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const lastRef = React.useRef<number | readonly number[] | undefined>(undefined)
  const anchorRef = React.useRef<{ x: number; from: number | readonly number[] | undefined } | null>(null)
  const draggingRef = React.useRef(false)
  const fineRef = React.useRef<number | readonly number[] | null>(null)
  const current = (value ?? lastRef.current ?? defaultValue) as number | readonly number[] | undefined
  const currentRef = React.useRef(current)
  currentRef.current = current
  const handleChange = (next: number | readonly number[], details: SliderPrimitive.Root.ChangeEventDetails) => {
    const e = details.event as PointerEvent
    const pointer = typeof e?.clientX === 'number' && /^(pointer|mouse|touch)/.test(e.type)
    const fine = pointer && (e.shiftKey || e.ctrlKey || e.metaKey)
    let out = next
    if (fine) {
      const index = Math.max(0, details.activeThumbIndex ?? 0)
      const cur = currentRef.current
      const at = (v: number | readonly number[] | undefined) => (Array.isArray(v) ? v[index] : v) as number | undefined
      if (!anchorRef.current) anchorRef.current = { x: e.clientX, from: cur }
      const start = at(anchorRef.current.from) ?? at(next) ?? min
      const control = rootRef.current?.querySelector('[data-slot="slider-control"]')
      const width = control?.getBoundingClientRect().width || 200
      const fineStep = (Number(step) || 1) / 20
      const raw = start + ((e.clientX - anchorRef.current.x) / width) * (max - min) * 0.05
      let v = Math.round(raw / fineStep) * fineStep
      // Rounding noise of the division (0.30000000000000004).
      v = Number(v.toFixed(Math.min(12, Math.max(0, Math.ceil(-Math.log10(fineStep)) + 2))))
      const base = Array.isArray(cur) ? cur : Array.isArray(next) ? next : null
      if (base) {
        const lo = index > 0 ? base[index - 1] : min
        const hi = index < base.length - 1 ? base[index + 1] : max
        const arr = base.slice()
        arr[index] = Math.min(hi, Math.max(lo, v))
        out = arr
      } else {
        out = Math.min(max, Math.max(min, v))
      }
      fineRef.current = out
    } else {
      anchorRef.current = null
      fineRef.current = null
    }
    lastRef.current = out
    ;(onValueChange as ((v: unknown, d: unknown) => void) | undefined)?.(out, details)
  }
  // The anchor is taken on the first move with the modifier down, here and
  // not in handleChange: Base UI reports nothing while the value under the
  // cursor has not changed, and the anchor would be taken late.
  React.useEffect(() => {
    const doc = rootRef.current?.ownerDocument
    if (!doc) return
    const move = (e: PointerEvent) => {
      if (!draggingRef.current) return
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (!anchorRef.current) anchorRef.current = { x: e.clientX, from: currentRef.current }
      } else anchorRef.current = null
    }
    const up = () => { draggingRef.current = false }
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', up, true)
    return () => {
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointerup', up, true)
      doc.removeEventListener('pointercancel', up, true)
    }
  }, [])
  const handleCommitted = (next: number | readonly number[], details: SliderPrimitive.Root.CommitEventDetails) => {
    // The release reports the value under the cursor: keep the fine one.
    const out = fineRef.current ?? next
    anchorRef.current = null
    fineRef.current = null
    ;(onValueCommitted as ((v: unknown, d: unknown) => void) | undefined)?.(out, details)
  }
  // The official pattern's `_values` fallback only accounts for array vs.
  // "nothing passed" — it renders 2 <Thumb>s (`[min, max]`) whenever `value`/
  // `defaultValue` isn't an array, even for a genuine single-thumb slider
  // passing a plain number. Handle that case explicitly, or every single-value
  // slider mounts two stacked (visually-identical) thumbs instead of one.
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : typeof value === 'number'
        ? [value]
        : typeof defaultValue === 'number'
          ? [defaultValue]
          : [min, max]

  return (
    <SliderPrimitive.Root
      ref={(el: HTMLDivElement | null) => {
        rootRef.current = el
        if (typeof outerRef === 'function') outerRef(el)
        else if (outerRef) (outerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      }}
      step={step}
      onValueChange={handleChange as never}
      onValueCommitted={handleCommitted as never}
      // A drag that ended without a commit leaves no stale anchor.
      onPointerDownCapture={() => { anchorRef.current = null; fineRef.current = null; draggingRef.current = true }}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      // "center" (Base UI's default), not "edge": in edge mode the thumb is
      // placed from a measurement of the track and the thumb (ResizeObserver
      // plus a layout effect) and stays `visibility: hidden` until that
      // measurement is finite. Jonathan (Chrome on a Pixel 10 Pro, 2026-10-12)
      // saw every thumb missing on the phone sheet expanded to full until a
      // slider was touched (a value change re-measures): a measure taken
      // while the track had no width. Center mode is a percentage, nothing
      // to measure, and matches the indicator drawn below by percentage.
      thumbAlignment="center"
      className={cn(
        'relative flex w-full items-center data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex w-full touch-none items-center select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        >
          {origin === undefined || _values.length !== 1 ? (
            <SliderPrimitive.Indicator
              data-slot="slider-indicator"
              className="bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            />
          ) : (
            // Base UI's own Indicator always runs from the track's start, so a
            // signed slider read as "how far from the far left" rather than
            // "how far from zero". This spans origin-to-thumb instead.
            (() => {
              const span = max - min || 1
              const at = (v: number) => ((v - min) / span) * 100
              const a = at(Math.min(origin, _values[0] as number))
              const b = at(Math.max(origin, _values[0] as number))
              return (
                <div
                  data-slot="slider-indicator"
                  className="bg-primary absolute h-full"
                  style={{ left: `${a}%`, width: `${Math.max(b - a, 0)}%` }}
                />
              )
            })()
          )}
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="border-primary border-2 ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden data-disabled:pointer-events-none"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
