import type React from "react"
import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"

// Thin draggable divider between map A and map B in split-screen mode.
// `ratio` is map A's share of `availableWidthPx` (space actually available
// for map content, i.e. viewport minus the floating sidebar's footprint when
// open) — NOT of the raw container width, so the divider stays positioned
// relative to what's actually visible rather than drifting toward/under the
// sidebar overlay as it opens/closes.
export const SplitResizeHandle: React.FC<{
  ratio: number
  onRatioChange: (next: number) => void
  availableWidthPx: number
  min: number
  max: number
}> = ({ ratio, onRatioChange, availableWidthPx, min, max }) => {
  const [isDragging, setIsDragging] = useState(false)

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const containerRect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!containerRect || availableWidthPx <= 0) return
    const next = (e.clientX - containerRect.left) / availableWidthPx
    onRatioChange(Math.min(max, Math.max(min, next)))
  }, [availableWidthPx, min, max, onRatioChange])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={cn(
        // The box itself takes up NO real layout width — map A and map B
        // sit flush against each other with no visible seam at rest — but
        // the ::before pseudo-element still gives it the same ~18px total
        // grabbable hit-area it always had (9px either side of the true
        // boundary), invisible until a drag is in progress.
        "relative z-10 w-0 shrink-0 cursor-col-resize select-none touch-none",
        "before:absolute before:inset-y-0 before:-left-[9px] before:-right-[9px] before:content-['']",
        "after:absolute after:inset-y-0 after:left-0 after:w-px after:content-['']",
        isDragging ? "after:w-0.5 after:-translate-x-px after:bg-primary" : "after:bg-transparent",
      )}
    />
  )
}
