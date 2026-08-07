import type React from "react"
import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"

// Draggable divider/pill between two panes in gridLayout "2x1" — the only
// layout with a user-adjustable ratio at all (every other grid divides its
// row into fixed, equal columns instead, see lib/grid-layouts.ts). Two modes:
//
// - 1D (side-by-side style): a thin flex-child divider, same as this
//   component always was — `ratio` is pane A's share of `availableWidthPx`
//   (space actually available for map content, i.e. viewport minus the
//   floating sidebar's footprint when open) — NOT of the raw container
//   width, so the divider stays positioned relative to what's actually
//   visible rather than drifting toward/under the sidebar overlay as it
//   opens/closes. The box itself takes up no real layout width; an
//   invisible ::before hit-area gives it a ~18px grabbable target.
// - 2D (overlay style): pane B is absolutely stacked over pane A rather than
//   a flex sibling, so there's no natural "gap" to sit in — this renders a
//   circular pill instead, absolutely positioned at `leftPercent` (the
//   caller-computed clip-path boundary, which already accounts for the
//   sidebar-extension math — NOT the same number as `ratio * 100`). Dragging
//   it horizontally still drives `ratio` (identical math to 1D); dragging it
//   vertically drives `onOpacityChange` — top of the pane = fully opaque/
//   blended (opacity 1), bottom = fully transparent (opacity 0).
export const SplitPill: React.FC<{
  ratio: number
  onRatioChange: (next: number) => void
  availableWidthPx: number
  min: number
  max: number
  /** Presence of both opacity props switches this into 2D pill mode. */
  opacity?: number
  onOpacityChange?: (next: number) => void
  /** 2D mode only — see header comment on why this differs from `ratio * 100`. */
  leftPercent?: number
}> = ({ ratio, onRatioChange, availableWidthPx, min, max, opacity, onOpacityChange, leftPercent }) => {
  const [isDragging, setIsDragging] = useState(false)
  const is2D = onOpacityChange !== undefined

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const containerRect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!containerRect || availableWidthPx <= 0) return
    const nextRatio = (e.clientX - containerRect.left) / availableWidthPx
    onRatioChange(Math.min(max, Math.max(min, nextRatio)))
    if (is2D && containerRect.height > 0) {
      const nextOpacity = 1 - Math.min(1, Math.max(0, (e.clientY - containerRect.top) / containerRect.height))
      onOpacityChange!(nextOpacity)
    }
  }, [availableWidthPx, min, max, onRatioChange, is2D, onOpacityChange])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }, [])

  if (is2D) {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute inset-y-0 z-10 w-8 -translate-x-1/2 cursor-move touch-none select-none"
        style={{ left: `${leftPercent ?? ratio * 100}%` }}
      >
        <div
          className={cn(
            "absolute left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background shadow-md transition-shadow",
            isDragging ? "border-primary shadow-lg" : "border-primary/70",
          )}
          style={{ top: `${(1 - Math.min(1, Math.max(0, opacity ?? 1))) * 100}%` }}
        />
      </div>
    )
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={cn(
        "relative z-10 w-0 shrink-0 cursor-col-resize select-none touch-none",
        "before:absolute before:inset-y-0 before:-left-[9px] before:-right-[9px] before:content-['']",
        "after:absolute after:inset-y-0 after:left-0 after:w-px after:content-['']",
        isDragging ? "after:w-0.5 after:-translate-x-px after:bg-primary" : "after:bg-transparent",
      )}
    />
  )
}
