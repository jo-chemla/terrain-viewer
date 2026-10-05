// The card over a hovered timeline tick: what the item is (source and date,
// name, catalog, resolution, licence, thumbnail when the catalog has one),
// which views show it, and buttons to put it on a view as its basemap or as
// an overlay, or to keep it among the user's own sources. Stays while the
// pointer is on it (the panel's hide timer is cancelled on enter).
import type React from "react"
import { createPortal } from "react-dom"
import { ExternalLink } from "lucide-react"
import type { ViewId } from "@/lib/grid-layouts"
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
  kept: boolean
  onSend: (side: ViewId, as: "basemap" | "overlay") => void
  onKeep: () => void
  onEnter: () => void
  onLeave: () => void
}> = ({ tick, left, top, sourceLabel, headline, itemName, activeSides, views, kept, onSend, onKeep, onEnter, onLeave }) => {
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
            <div key={as} className="flex items-center gap-1">
              <span className="w-14 text-[10px] text-muted-foreground">as {as}</span>
              {views.map((side) => (
                <button key={side} type="button" className="cursor-pointer rounded border px-1.5 text-[10px] leading-4 hover:bg-primary hover:text-primary-foreground" title={`View ${side}, as ${as}`} onClick={() => onSend(side, as)}>{side}</button>
              ))}
            </div>
          ))}
          <button type="button" className="cursor-pointer text-[10px] underline text-muted-foreground hover:text-foreground disabled:no-underline disabled:cursor-default" disabled={kept} onClick={onKeep}>
            {kept ? "In your sources" : "Keep in my sources"}
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
