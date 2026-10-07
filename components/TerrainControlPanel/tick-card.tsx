// The card over a hovered timeline tick: what the item is (source and date,
// name, catalog, resolution, licence, thumbnail when the catalog has one),
// which views show it, one view grid to put it on a view (as the view's
// basemap, or in its overlay stack when the item is an overlay such as a
// warped IIIF map), a button to frame its extent, and one to keep it among
// the user's own sources. Stays while the pointer is on it (the panel's
// hide timer is cancelled on enter).
import type React from "react"
import { createPortal } from "react-dom"
import { ExternalLink, Maximize2 } from "lucide-react"
import type { ViewId, GridLayoutId } from "@/lib/grid-layouts"
import { Button } from "@/components/ui/button"
import { SourceGridToggle } from "./controls-components"
import { cn } from "@/lib/utils"
import type { TickMeta } from "@/lib/timeline-catalogs"
import { gsdLabel } from "@/lib/gsd"

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
  /** The item is an overlay (stacks on the basemap) rather than a basemap. */
  asOverlay: boolean
  /** Whether the view shows the item. */
  isOn: (side: ViewId) => boolean
  kept: boolean
  /** The item's extent, for the frame button. */
  bounds?: [number, number, number, number]
  onSend: (side: ViewId) => void
  onFit?: () => void
  onKeep: () => void
  onEnter: () => void
  onLeave: () => void
}> = ({ tick, left, top, sourceLabel, headline, itemName, activeSides, views, gridLayout, asOverlay, isOn, kept, bounds, onSend, onFit, onKeep, onEnter, onLeave }) => {
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
      {m && (m.gsd || m.licence || m.provider || m.date) && (
        <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0.5">
          {m.gsd ? <div><span className="font-medium text-foreground/80">GSD:</span> {gsdLabel(m.gsd)}/px</div> : null}
          {m.date ? <div><span className="font-medium text-foreground/80">Date:</span> {m.date}</div> : null}
          {m.provider ? <div><span className="font-medium text-foreground/80">Source:</span> {m.provider}</div> : null}
          {m.licence ? <div><span className="font-medium text-foreground/80">Licence:</span> {m.licence}</div> : null}
        </div>
      )}
      {m?.thumb && <img src={m.thumb} alt="" className="mt-1 max-h-24 w-auto rounded border object-contain" loading="lazy" />}
      {m?.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] underline text-muted-foreground hover:text-foreground">item page <ExternalLink className="h-2.5 w-2.5" /></a>}
      {activeSides.length > 0 && <div className="text-[10px] text-muted-foreground">On map {activeSides.join(", ")}</div>}
      {catalogItem && (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-16 text-[10px] text-muted-foreground">{asOverlay ? "overlay on" : "basemap of"}</span>
            {/* The view grid, like the sidebar's: a lit view holds the item;
                an overlay comes off a view with a second press. */}
            {views.length > 1 ? (
              <SourceGridToggle gridLayout={gridLayout} isActive={isOn} onSelect={onSend} allowUnpress={asOverlay} />
            ) : (
              <button type="button" className={cn("cursor-pointer rounded border px-2 text-[10px] leading-5", isOn(views[0]) ? "bg-primary text-primary-foreground" : "hover:bg-accent")} onClick={() => onSend(views[0])}>{isOn(views[0]) ? "on" : "put"}</button>
            )}
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-6 flex-1 cursor-pointer text-[11px]" disabled={!bounds || !onFit} title="Frame its extent" onClick={onFit}>
              <Maximize2 className="h-3 w-3 mr-1" />Fit
            </Button>
            {/* Keep: the item joins the sources, and goes on the view if it is on none. */}
            <Button size="sm" variant={kept ? "outline" : "default"} className="h-6 flex-1 cursor-pointer text-[11px]" disabled={kept} onClick={onKeep}>
              {kept ? "In your sources" : "Keep in my sources"}
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
