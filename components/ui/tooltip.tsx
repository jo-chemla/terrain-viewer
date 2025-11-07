'use client'

// import * as React from 'react'
// import * as TooltipPrimitive from '@radix-ui/react-tooltip'

// import { cn } from '@/lib/utils'

// function TooltipProvider({
//   delayDuration = 0,
//   ...props
// }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
//   return (
//     <TooltipPrimitive.Provider
//       data-slot="tooltip-provider"
//       delayDuration={delayDuration}
//       {...props}
//     />
//   )
// }

// function Tooltip({
//   ...props
// }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
//   return (
//     <TooltipProvider>
//       <TooltipPrimitive.Root data-slot="tooltip" {...props} />
//     </TooltipProvider>
//   )
// }

// function TooltipTrigger({
//   ...props
// }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
//   return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
// }

// function TooltipContent({
//   className,
//   sideOffset = 0,
//   children,
//   ...props
// }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
//   return (
//     <TooltipPrimitive.Portal>
//       <TooltipPrimitive.Content
//         data-slot="tooltip-content"
//         sideOffset={sideOffset}
//         className={cn(
//           'bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
//           className,
//         )}
//         {...props}
//       >
//         {children}
//         <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
//       </TooltipPrimitive.Content>
//     </TooltipPrimitive.Portal>
//   )
// }

// export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

// The issue is in your tooltip.tsx - you're creating a TooltipProvider inside each Tooltip
// This causes issues with Radix UI's tooltip system. Here's the corrected version:

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal container={document.body}>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[9999] overflow-hidden rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

// Then in your terrain-controls.tsx, wrap buttons like this:
// 
// <Tooltip>
//   <TooltipTrigger asChild>
//     <Button variant="ghost" size="icon">
//       <Info className="h-4 w-4" />
//     </Button>
//   </TooltipTrigger>
//   <TooltipContent>
//     <p>View source details</p>
//   </TooltipContent>
// </Tooltip>
//
// And make sure TooltipProvider wraps your entire TerrainControls component