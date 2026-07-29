'use client'

import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

// Base UI moved the open/close delay from Tooltip.Root down to Tooltip.Trigger
// (Root has no delay prop at all). This context lets `<Tooltip delayDuration>`
// keep working as a single call-site prop even though Trigger is authored
// separately by the consumer as a child.
const TooltipDelayContext = React.createContext<number | undefined>(undefined)

function Tooltip({
  delayDuration,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  delayDuration?: number
}) {
  return (
    <TooltipDelayContext.Provider value={delayDuration}>
      <TooltipPrimitive.Root disableHoverablePopup {...props} />
    </TooltipDelayContext.Provider>
  )
}

const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
    asChild?: boolean
  }
>(({ asChild = false, render, children, delay, ...props }, ref) => {
  const contextDelay = React.useContext(TooltipDelayContext)
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      delay={delay ?? contextDelay}
      render={asChild ? (children as React.ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </TooltipPrimitive.Trigger>
  )
})
TooltipTrigger.displayName = 'TooltipTrigger'

const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof TooltipPrimitive.Popup> &
    Pick<
      React.ComponentProps<typeof TooltipPrimitive.Positioner>,
      'side' | 'sideOffset' | 'align' | 'alignOffset'
    > & {
      disablePointerEvents?: boolean
    }
>(
  (
    {
      className,
      side,
      sideOffset = 4,
      align,
      alignOffset,
      disablePointerEvents = true,
      ...props
    },
    ref,
  ) => {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          className="z-[9999]"
        >
          <TooltipPrimitive.Popup
            ref={ref}
            className={cn(
              'max-w-[240px] overflow-hidden rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md origin-(--transform-origin) transition-[transform,opacity] data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
              disablePointerEvents && 'pointer-events-none',
              className,
            )}
            {...props}
          />
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    )
  },
)
TooltipContent.displayName = 'TooltipContent'

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
