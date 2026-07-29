'use client'

import * as React from 'react'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'

import { cn } from '@/lib/utils'

function Slider({
  className,
  defaultValue,
  value,
  onValueChange,
  onValueCommitted,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props<number[]>) {
  const thumbCount = value?.length ?? defaultValue?.length ?? 1

  // Base UI decides whether to report a plain number or an array based on
  // internal state that can end up out of sync with the `value`/`defaultValue`
  // array we always pass in (see SliderRoot's `useControlled` + `range`
  // check) — normalize here so every consumer's `([v]) => ...` /
  // `([min, max]) => ...` destructuring keeps working no matter what shape
  // Base UI hands back.
  const handleValueChange = React.useCallback(
    (newValue: number | number[], eventDetails: unknown) => {
      ;(onValueChange as ((v: number[], d: unknown) => void) | undefined)?.(
        Array.isArray(newValue) ? newValue : [newValue],
        eventDetails,
      )
    },
    [onValueChange],
  )
  const handleValueCommitted = React.useCallback(
    (newValue: number | number[], eventDetails: unknown) => {
      ;(onValueCommitted as ((v: number[], d: unknown) => void) | undefined)?.(
        Array.isArray(newValue) ? newValue : [newValue],
        eventDetails,
      )
    },
    [onValueCommitted],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      onValueChange={handleValueChange}
      onValueCommitted={handleValueCommitted}
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
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            index={index}
            className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden data-disabled:pointer-events-none"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
