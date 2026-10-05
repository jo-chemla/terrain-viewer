// A small pill showing an opacity (percent). Pressing it opens a vertical
// 100 px gutter right where the pill is, placed so the pill (which becomes
// the gutter's thumb) sits at its current value under the pointer: without
// lifting the pointer, dragging up or down moves the thumb in the gutter
// (bottom 0, top 100) and sets the value; release closes it. Used for the
// per-overlay opacities, where a full slider per row would not fit.
import type React from "react"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

const TRACK = 100

export const OpacityPill: React.FC<{
  /** 0..1 */
  value: number
  onChange: (value: number) => void
  title?: string
  className?: string
}> = ({ value, onChange, title, className }) => {
  // The gutter's top, relative to the pill's centre, fixed while dragging.
  const [gutterTop, setGutterTop] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)

  const valueAt = (clientY: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (r.bottom - clientY) / r.height))
  }
  const open = gutterTop !== null
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button type="button" title={title ?? "Opacity: press and drag up or down"}
        className={cn("cursor-ns-resize rounded-full border px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground touch-none select-none", open && "invisible")}
        onPointerDown={(e) => {
          e.preventDefault()
          // The gutter's point for the current value lands under the pointer.
          setGutterTop(-(TRACK - pct))
          const el = e.currentTarget
          el.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => { if (open && trackRef.current) onChange(valueAt(e.clientY)) }}
        onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setGutterTop(null) }}
        onPointerCancel={() => setGutterTop(null)}>
        {pct}%
      </button>
      {open && (
        <div ref={trackRef} className="pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 w-6 rounded-full border bg-popover shadow-md select-none"
          style={{ height: TRACK, top: `calc(50% + ${gutterTop}px)` }}>
          <div className="absolute inset-x-0 bottom-0 rounded-full bg-primary/30" style={{ height: `${pct}%` }} />
          <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-1 text-[10px] leading-4 tabular-nums shadow" style={{ top: `${100 - pct}%` }}>{pct}%</div>
        </div>
      )}
    </span>
  )
}
