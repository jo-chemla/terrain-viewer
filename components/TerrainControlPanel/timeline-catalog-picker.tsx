// The historical timeline's "Catalogs" tree: imagery and old-map catalogs
// whose items covering the view become ticks (lib/timeline-catalogs.ts).
// Grouped like the coverage overlay picker; a group's box takes its whole
// group. Each row shows its tick count and a spinner while loading; a
// catalog a browser cannot query is listed, greyed, with why. Groups fold
// (all at once from the header button); the national group opens by itself
// only when one of its sources covers the view centre or is selected, its
// rows sit under country sub-headings, and a source whose extent misses the
// view is dimmed.
import type React from "react"
import { useState } from "react"
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2, Library } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { TIMELINE_CATALOGS, type TimelineCatalog } from "@/lib/timeline-catalogs"

const covers = (c: TimelineCatalog, center?: [number, number]) =>
  !c.bbox || !center || (center[0] >= c.bbox[0] && center[0] <= c.bbox[2] && center[1] >= c.bbox[1] && center[1] <= c.bbox[3])

export const TimelineCatalogPicker: React.FC<{
  selected: string[]
  onChange: (ids: string[]) => void
  loading: Record<string, boolean>
  counts: Record<string, number>
  errors: Record<string, string>
  /** The view centre [lng, lat], to tell which regional sources cover it. */
  center?: [number, number]
  /** Items' footprints drawn on the map. */
  footprints: boolean
  onFootprints: (on: boolean) => void
  /** Only items dated within the timeline's current window. */
  windowFilter: boolean
  onWindowFilter: (on: boolean) => void
}> = ({ selected, onChange, loading, counts, errors, center, footprints, onFootprints, windowFilter, onWindowFilter }) => {
  const [open, setOpen] = useState(false)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const groups = Array.from(new Set(TIMELINE_CATALOGS.map((c) => c.group)))
  const set = new Set(selected)
  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected)
    for (const id of ids) on ? next.add(id) : next.delete(id)
    onChange([...next])
  }
  const anyLoading = selected.some((id) => loading[id])
  const isOpen = (g: string) => {
    if (folded[g] !== undefined) return !folded[g]
    const cats = TIMELINE_CATALOGS.filter((c) => c.group === g)
    const regional = cats.every((c) => c.bbox)
    return !regional || cats.some((c) => set.has(c.id) || (c.bbox && covers(c, center)))
  }
  const allOpen = groups.every(isOpen)
  const foldAll = (fold: boolean) => setFolded(Object.fromEntries(groups.map((g) => [g, fold])))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <button type="button" className={cn(
          "cursor-pointer flex items-center gap-1 shrink-0 whitespace-nowrap rounded-full border transition-colors font-medium px-3 py-1.5 text-xs sm:px-2.5 sm:py-0.5 sm:text-[11px]",
          selected.length ? "text-slate-900 bg-amber-100 border-transparent" : "text-muted-foreground border-border hover:bg-primary hover:text-primary-foreground hover:border-transparent",
        )}>
          <Library className="h-3 w-3" />
          Catalogs{selected.length ? ` (${selected.length})` : ""}
          {anyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      } />
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-1rem)] p-2 max-h-[36rem] overflow-y-auto space-y-1">
        <div className="flex items-start gap-2 px-0.5 pb-1">
          <p className="text-[11px] text-muted-foreground flex-1">Items covering the view become ticks; picking one makes it the view's basemap. Refreshed as you move. Dimmed sources have nothing here.</p>
          <button type="button" className="cursor-pointer shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1" onClick={() => foldAll(allOpen)} title={allOpen ? "Fold every group" : "Expand every group"}>
            {allOpen ? <ChevronsDownUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}{allOpen ? "Fold all" : "Expand all"}
          </button>
        </div>
        <div className="flex items-center gap-4 px-0.5 pb-1 text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={footprints} onCheckedChange={onFootprints} className="cursor-pointer scale-75 origin-left" />Footprints on the map</label>
          <label className="flex items-center gap-1.5 cursor-pointer" title="Only items dated within the timeline's current window"><Switch checked={windowFilter} onCheckedChange={onWindowFilter} className="cursor-pointer scale-75 origin-left" />Within the timeline window</label>
        </div>
        {groups.map((g, gi) => {
          const cats = TIMELINE_CATALOGS.filter((c) => c.group === g)
          const usable = cats.filter((c) => !c.disabled)
          const on = usable.filter((c) => set.has(c.id)).length
          const here = cats.filter((c) => c.bbox && covers(c, center)).length
          const regional = cats.every((c) => c.bbox)
          const openG = isOpen(g)
          // Country sub-headings inside the national group, in the order
          // the sources are listed.
          const regions = Array.from(new Set(cats.map((c) => c.region ?? "")))
          return (
            <div key={g} className={gi ? "pt-1.5 border-t mt-1" : undefined}>
              <div className="flex items-center gap-1.5 py-0.5">
                <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground p-0.5 shrink-0" aria-label={openG ? "Collapse" : "Expand"}
                  onClick={() => setFolded((prev) => ({ ...prev, [g]: openG }))}>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openG ? "" : "-rotate-90"}`} />
                </button>
                <Checkbox id={`tlcat-g-${gi}`} checked={on === usable.length && usable.length > 0} indeterminate={on > 0 && on < usable.length} disabled={!usable.length}
                  onCheckedChange={(v) => setMany(usable.map((c) => c.id), v === true)} className="cursor-pointer" />
                <Label htmlFor={`tlcat-g-${gi}`} className="text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer flex-1">{g}</Label>
                {regional && <span className="text-[10px] text-muted-foreground tabular-nums" title="Sources covering the view centre">{here ? `${here} here` : ""}</span>}
              </div>
              {openG && (
                <div className="pl-[42px] space-y-0.5">
                  {regions.map((r) => (
                    <div key={r || "_"} className="space-y-0.5">
                      {r && <div className="text-[10px] text-muted-foreground/80 pt-1">{r}</div>}
                      {cats.filter((c) => (c.region ?? "") === r).map((c) => {
                        const away = !covers(c, center)
                        return (
                          <div key={c.id} className={cn("flex items-center gap-1.5", (c.disabled || away) && "opacity-50")} title={c.disabled ?? (away ? `${c.note} (nothing at the view centre)` : c.note)}>
                            <Checkbox id={`tlcat-${c.id}`} checked={set.has(c.id)} disabled={!!c.disabled} onCheckedChange={(v) => setMany([c.id], v === true)} className="cursor-pointer" />
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                            <Label htmlFor={`tlcat-${c.id}`} className="text-xs cursor-pointer truncate flex-1">{c.label}</Label>
                            {set.has(c.id) && (loading[c.id]
                              ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                              : errors[c.id]
                              ? <span className="text-[10px] text-destructive" title={errors[c.id]}>error</span>
                              : <span className="text-[10px] text-muted-foreground tabular-nums">{counts[c.id] ?? 0}</span>)}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
