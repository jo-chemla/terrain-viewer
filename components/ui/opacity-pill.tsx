// A small pill showing an opacity (percent); clicking it opens a vertical
// 100 px slider right over the pill, the pill's centre on the current value,
// so a drag up or down from where the pointer already is changes it: bottom
// 0, top 100. Used for overlay opacities (the basemap section) where a full
// slider per row would not fit.
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const TRACK = 100

export const OpacityPill: React.FC<{
  /** 0..1 */
  value: number
  onChange: (value: number) => void
  title?: string
  className?: string
}> = ({ value, onChange, title, className }) => {
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!trackRef.current?.contains(e.target as Node) && !pillRef.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", close, true)
    document.addEventListener("keydown", key)
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", key) }
  }, [open])

  const valueAt = (clientY: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (r.bottom - clientY) / r.height))
  }
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button ref={pillRef} type="button" title={title ?? "Opacity"}
        className={cn("cursor-pointer rounded-full border px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground", open && "invisible")}
        onClick={() => setOpen(true)}>
        {pct}%
      </button>
      {open && (
        // The track sits so its point for the current value is on the pill.
        <div ref={trackRef}
          className="absolute left-1/2 z-50 -translate-x-1/2 w-6 rounded-full border bg-popover shadow-md touch-none cursor-ns-resize select-none"
          style={{ height: TRACK, top: `calc(50% - ${TRACK - pct}px)` }}
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); onChange(valueAt(e.clientY)) }}
          onPointerMove={(e) => { if (dragging.current) onChange(valueAt(e.clientY)) }}
          onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
          onPointerCancel={() => { dragging.current = false }}>
          <div className="absolute inset-x-0 bottom-0 rounded-full bg-primary/30" style={{ height: `${pct}%` }} />
          <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-1 text-[10px] leading-4 tabular-nums shadow" style={{ top: `${100 - pct}%` }}>{pct}%</div>
        </div>
      )}
    </span>
  )
}
