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
  ...props
}: SliderPrimitive.Root.Props<Value> & SliderExtras) {
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
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
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
