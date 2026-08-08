import type React from "react"
import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"

// Draggable divider/pill between two panes in gridLayout "2x1" — the only
// layout with a user-adjustable ratio at all (every other grid divides its
// row into fixed, equal columns instead, see lib/grid-layouts.ts). Two modes:
//
// - 1D (side-by-side style): a thin divider, absolutely positioned at
//   `leftPercent` (every pane is itself absolutely positioned now — see
//   TerrainViewer.tsx's paneLayouts — rather than a flex sibling, so this
//   needs an explicit position instead of just landing in the flex gap
//   between two children). `ratio` is pane A's share of `availableWidthPx`
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
//   sidebar-extension math — NOT the same number as `ratio * 100`). The pill
//   circle itself (cursor-move) drives BOTH `ratio` (horizontal drag) and
//   `onOpacityChange` (vertical drag — top of the pane = fully opaque/
//   blended, bottom = fully transparent). The rest of the vertical gutter
//   strip around it (cursor-col-resize) drives `ratio` only — grabbing
//   anywhere along the seam that ISN'T the pill itself was, before this
//   split, indistinguishable from grabbing the pill, so a drag started a
//   little off-target silently changed opacity too.
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
  // Both the gutter strip and the pill circle need the SAME container rect
  // (the map split container, i.e. the gutter's own parent) regardless of
  // which of the two actually received the pointer event. This ref is
  // attached to the GUTTER div itself (below) — that div is only ~32px wide
  // and its own `left` moves with the ratio, so reading `wrapperRef.current`
  // directly (as this used to) fed the pill's horizontal drag a moving,
  // too-narrow rect instead of the true container's, producing a visible
  // horizontal drift the vertical (opacity) drag never had, since that half
  // of the math only ever used top/height — which happen to already match
  // the true container's (inset-y-0 spans the same full height). Always go
  // one level up, to the gutter's OWN parent (the real container), instead.
  const wrapperRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }, [])

  const applyRatio = useCallback((clientX: number, containerRect: DOMRect) => {
    if (availableWidthPx <= 0) return
    const nextRatio = (clientX - containerRect.left) / availableWidthPx
    onRatioChange(Math.min(max, Math.max(min, nextRatio)))
  }, [availableWidthPx, min, max, onRatioChange])

  // 1D (side-by-side) and the 2D gutter strip: ratio only, no opacity.
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const containerRect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!containerRect) return
    applyRatio(e.clientX, containerRect)
  }, [applyRatio])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }, [])

  // 2D pill circle only: ratio (horizontal) AND opacity (vertical).
  const handlePillPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }, [])

  const handlePillPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const containerRect = wrapperRef.current?.parentElement?.getBoundingClientRect()
    if (!containerRect) return
    applyRatio(e.clientX, containerRect)
    if (containerRect.height > 0) {
      const nextOpacity = 1 - Math.min(1, Math.max(0, (e.clientY - containerRect.top) / containerRect.height))
      onOpacityChange!(nextOpacity)
    }
  }, [applyRatio, onOpacityChange])

  const handlePillPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }, [])

  if (is2D) {
    return (
      <div
        ref={wrapperRef}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute inset-y-0 z-10 w-8 -translate-x-1/2 cursor-col-resize touch-none select-none"
        style={{ left: `${leftPercent ?? ratio * 100}%` }}
      >
        <div
          onPointerDown={handlePillPointerDown}
          onPointerMove={handlePillPointerMove}
          onPointerUp={handlePillPointerUp}
          className={cn(
            "absolute left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background shadow-md transition-shadow cursor-move touch-none",
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
        // Absolute (not a flex "gap" item) — every pane is absolutely
        // positioned now (see TerrainViewer.tsx's paneLayouts), so this
        // needs its own explicit left% instead of relying on flex flow to
        // land it between two siblings.
        "absolute inset-y-0 z-10 w-0 cursor-col-resize select-none touch-none",
        "before:absolute before:inset-y-0 before:-left-[9px] before:-right-[9px] before:content-['']",
        "after:absolute after:inset-y-0 after:left-0 after:w-px after:content-['']",
        isDragging ? "after:w-0.5 after:-translate-x-px after:bg-primary" : "after:bg-transparent",
      )}
      style={{ left: `${leftPercent ?? ratio * 100}%` }}
    />
  )
}
