// The card over a hovered timeline tick: what the item is (source and date,
// name, catalog, resolution, licence, thumbnail when the catalog has one),
// which views show it, and buttons to put it on a view as its basemap or as
// an overlay, or to keep it among the user's own sources. Stays while the
// pointer is on it (the panel's hide timer is cancelled on enter).
import type React from "react"
import { createPortal } from "react-dom"
import { ExternalLink } from "lucide-react"
import type { ViewId, GridLayoutId } from "@/lib/grid-layouts"
import { Button } from "@/components/ui/button"
import { SourceGridToggle } from "./controls-components"
import { cn } from "@/lib/utils"
import type { TickMeta } from "@/lib/timeline-catalogs"

const gsdLabel = (g: number) => (g < 1 ? `${Math.round(g * 100)} cm` : `${g % 1 ? g.toFixed(1) : g} m`)

export const TickCard: React.FC<{
  tick: { source: string; dateMs: number; label: string; ref?: string; meta?: TickMeta }
  left: number
  top: number
  sourceLabel: string
  headline: string
  itemName: string | null
  activeSides: ViewId[]
  views: ViewId[]
  gridLayout: GridLayoutId
  /** Whether the item is that view's basemap, or in its overlay stack. */
  isOn: (side: ViewId, as: "basemap" | "overlay") => boolean
  kept: boolean
  onSend: (side: ViewId, as: "basemap" | "overlay") => void
  onKeep: () => void
  onEnter: () => void
  onLeave: () => void
}> = ({ tick, left, top, sourceLabel, headline, itemName, activeSides, views, gridLayout, isOn, kept, onSend, onKeep, onEnter, onLeave }) => {
  const m = tick.meta
  const catalogItem = !!tick.ref
  return createPortal(
    <div
      className="fixed z-[60] w-72 -translate-x-1/2 -translate-y-full rounded-md border bg-popover p-2 text-xs shadow-md"
      style={{ left: Math.max(150, Math.min(window.innerWidth - 150, left)), top: top - 6 }}
      onPointerEnter={onEnter} onPointerLeave={onLeave}
    >
      <div className="font-semibold">{headline}</div>
      {itemName ? <div className="leading-snug">{itemName}</div> : <div>{sourceLabel}</div>}
      {itemName && <div className="text-[10px] text-muted-foreground">{sourceLabel}</div>}
      {m && (m.gsd || m.licence || m.provider) && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {m.gsd ? <span>{gsdLabel(m.gsd)}/px</span> : null}
          {m.gsd && m.licence ? " · " : null}
          {m.licence ? <span>{m.licence}</span> : null}
        </div>
      )}
      {m?.thumb && <img src={m.thumb} alt="" className="mt-1 max-h-24 w-auto rounded border object-contain" loading="lazy" />}
      {m?.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] underline text-muted-foreground hover:text-foreground">item page <ExternalLink className="h-2.5 w-2.5" /></a>}
      {activeSides.length > 0 && <div className="text-[10px] text-muted-foreground">On map {activeSides.join(", ")}</div>}
      {catalogItem && (
        <div className="mt-1.5 space-y-1">
          {(["basemap", "overlay"] as const).map((as) => (
            <div key={as} className="flex items-center gap-2">
              <span className="w-16 text-[10px] text-muted-foreground">as {as}</span>
              {/* The view grid, like the sidebar's: a lit view holds the item. */}
              {views.length > 1 ? (
                <SourceGridToggle gridLayout={gridLayout} isActive={(side) => isOn(side, as)} onSelect={(side) => onSend(side, as)} allowUnpress={as === "overlay"} />
              ) : (
                <button type="button" className={cn("cursor-pointer rounded border px-2 text-[10px] leading-5", isOn(views[0], as) ? "bg-primary text-primary-foreground" : "hover:bg-accent")} onClick={() => onSend(views[0], as)}>{isOn(views[0], as) ? "on" : "put"}</button>
              )}
            </div>
          ))}
          <Button size="sm" variant={kept ? "outline" : "default"} className="h-6 w-full cursor-pointer text-[11px]" disabled={kept} onClick={onKeep}>
            {kept ? "In your sources" : "Keep in my sources"}
          </Button>
        </div>
      )}
    </div>,
    document.body,
  )
}
