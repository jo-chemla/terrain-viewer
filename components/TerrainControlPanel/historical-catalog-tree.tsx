// The historical catalogs tree, shared by the timeline's Catalogs select and
// the Sources Coverage section (Basemaps · Historical): imagery and old-map
// catalogs whose items covering the view become timeline ticks
// (lib/timeline-catalogs.ts), plus the coverage-only entries (Allmaps, QMS)
// whose maps carry no capture date and so draw footprints only. Three root
// groups (open data for post-crisis response, mapping agencies, old maps),
// each holding the catalogs' own groups, and inside the national archives a
// sub-heading per country. A group's box takes its whole group. Each row
// shows its tick count and a spinner while loading; a catalog a browser
// cannot query is listed, greyed, with why. Groups fold (all at once from
// the header button); the national group opens by itself only when one of
// its sources covers the view centre or is selected, and a source whose
// extent misses the view is dimmed.
import type React from "react"
import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { TIMELINE_CATALOGS, CATALOG_ROOTS, CATALOG_ROOT_ORDER, COVERAGE_ONLY_ENTRIES, catalogStatusAtom, type TimelineCatalog } from "@/lib/timeline-catalogs"
import { coverageOverlaysAtom } from "@/lib/coverage-overlays"
import { timelineFootprintsAtom, timelineWindowFilterAtom, timelineFollowViewportAtom } from "@/lib/settings-atoms"

const covers = (c: { bbox?: [number, number, number, number] }, center?: [number, number]) =>
  !c.bbox || !center || (center[0] >= c.bbox[0] && center[0] <= c.bbox[2] && center[1] >= c.bbox[1] && center[1] <= c.bbox[3])

type Entry = TimelineCatalog & { coverageOnly?: boolean }
const ENTRIES: Entry[] = [...TIMELINE_CATALOGS, ...COVERAGE_ONLY_ENTRIES.map((e) => ({ ...e, coverageOnly: true as const }))]

export const HistoricalCatalogTree: React.FC<{
  /** The timeline catalogs on (state.timelineCatalogs). */
  selected: string[]
  onChange: (ids: string[]) => void
  /** The view centre [lng, lat], to tell which regional sources cover it. */
  center?: [number, number]
  /** The timeline select shows the switches; the coverage section too. */
  className?: string
}> = ({ selected, onChange, center, className }) => {
  const { loading, counts, errors } = useAtomValue(catalogStatusAtom)
  const [coverage, setCoverage] = useAtom(coverageOverlaysAtom)
  const [footprints, setFootprints] = useAtom(timelineFootprintsAtom)
  const [windowFilter, setWindowFilter] = useAtom(timelineWindowFilterAtom)
  const [follow, setFollow] = useAtom(timelineFollowViewportAtom)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const isOn = (c: Entry) => (c.coverageOnly ? coverage.includes(c.id) : selected.includes(c.id))
  const setMany = (cats: Entry[], on: boolean) => {
    const ticks = cats.filter((c) => !c.coverageOnly).map((c) => c.id)
    const covs = cats.filter((c) => c.coverageOnly).map((c) => c.id)
    if (ticks.length) { const next = new Set(selected); for (const id of ticks) on ? next.add(id) : next.delete(id); onChange([...next]) }
    if (covs.length) setCoverage((prev) => { const next = new Set(prev); for (const id of covs) on ? next.add(id) : next.delete(id); return [...next] })
  }
  const roots = CATALOG_ROOT_ORDER.map((root) => ({ root, groups: Array.from(new Set(ENTRIES.filter((c) => (CATALOG_ROOTS[c.group] ?? CATALOG_ROOT_ORDER[1]) === root).map((c) => c.group))) }))
  const catsOf = (g: string) => ENTRIES.filter((c) => c.group === g)
  // A group of regional sources opens by itself where one covers the view.
  const isOpen = (key: string, cats: Entry[]) => {
    if (folded[key] !== undefined) return !folded[key]
    const regional = cats.every((c) => c.bbox)
    return !regional || cats.some((c) => isOn(c) || (c.bbox && covers(c, center)))
  }
  const keys = roots.flatMap((r) => [r.root, ...r.groups.map((g) => `${r.root}/${g}`)])
  const allOpen = roots.every((r) => isOpen(r.root, r.groups.flatMap(catsOf)) && r.groups.every((g) => isOpen(`${r.root}/${g}`, catsOf(g))))
  const foldAll = (fold: boolean) => setFolded(Object.fromEntries(keys.map((k) => [k, fold])))
  const toggleFold = (key: string, openNow: boolean) => setFolded((prev) => ({ ...prev, [key]: openNow }))

  const groupHeader = (key: string, label: string, cats: Entry[], openNow: boolean, depth: number) => {
    const usable = cats.filter((c) => !c.disabled)
    const on = usable.filter(isOn).length
    const regional = cats.every((c) => c.bbox)
    const here = regional ? cats.filter((c) => covers(c, center)).length : 0
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground p-0.5 shrink-0" aria-label={openNow ? "Collapse" : "Expand"} onClick={() => toggleFold(key, openNow)}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openNow ? "" : "-rotate-90"}`} />
        </button>
        <Checkbox id={`tlcat-g-${key}`} checked={on === usable.length && usable.length > 0} indeterminate={on > 0 && on < usable.length} disabled={!usable.length}
          onCheckedChange={(v) => setMany(usable, v === true)} className="cursor-pointer" />
        <Label htmlFor={`tlcat-g-${key}`} className={cn("cursor-pointer flex-1 uppercase tracking-wide text-muted-foreground", depth ? "text-[10px]" : "text-[11px] font-semibold text-foreground/80")}>{label}</Label>
        {on > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{on} on</span>}
        {regional && here > 0 && <span className="text-[10px] text-muted-foreground tabular-nums" title="Sources covering the view centre">{here} here</span>}
      </div>
    )
  }
  const row = (c: Entry) => {
    const away = !covers(c, center)
    const on = isOn(c)
    return (
      <div key={c.id} className={cn("flex items-center gap-1.5", (c.disabled || away) && "opacity-50")} title={c.disabled ?? (away ? `${c.note} (nothing at the view centre)` : c.note)}>
        <Checkbox id={`tlcat-${c.id}`} checked={on} disabled={!!c.disabled} onCheckedChange={(v) => setMany([c], v === true)} className="cursor-pointer" />
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
        <Label htmlFor={`tlcat-${c.id}`} className="text-xs cursor-pointer truncate flex-1">{c.label}</Label>
        {c.coverageOnly && <span className="text-[10px] text-muted-foreground">footprints</span>}
        {on && !c.coverageOnly && (loading[c.id]
          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          : errors[c.id]
          ? <span className="text-[10px] text-destructive" title={errors[c.id]}>error</span>
          : <span className="text-[10px] text-muted-foreground tabular-nums">{counts[c.id] ?? 0}</span>)}
      </div>
    )
  }
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-start gap-2 px-0.5 pb-1">
        <p className="text-[11px] text-muted-foreground flex-1">Items covering the view become ticks; picking one makes it the view's basemap. Refreshed as you move. Dimmed sources have nothing here.</p>
        <button type="button" className="cursor-pointer shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1" onClick={() => foldAll(allOpen)} title={allOpen ? "Fold every group" : "Expand every group"}>
          {allOpen ? <ChevronsDownUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}{allOpen ? "Fold all" : "Expand all"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 pb-1 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={footprints} onCheckedChange={setFootprints} className="cursor-pointer scale-75 origin-left" />Footprints on the map</label>
        <label className="flex items-center gap-1.5 cursor-pointer" title="Only items dated within the timeline's current window"><Switch checked={windowFilter} onCheckedChange={setWindowFilter} className="cursor-pointer scale-75 origin-left" />Within the timeline window</label>
        <label className="flex items-center gap-1.5 cursor-pointer" title="Off: the catalogs are not asked again as the map moves, so the ticks stay as they are"><Switch checked={follow} onCheckedChange={setFollow} className="cursor-pointer scale-75 origin-left" />Follow the view</label>
      </div>
      {roots.map(({ root, groups }, ri) => {
        const rootCats = groups.flatMap(catsOf)
        const rootOpen = isOpen(root, rootCats)
        return (
          <div key={root} className={ri ? "pt-1.5 border-t mt-1" : undefined}>
            {groupHeader(root, root, rootCats, rootOpen, 0)}
            {rootOpen && groups.map((g) => {
              const cats = catsOf(g)
              const key = `${root}/${g}`
              const openG = isOpen(key, cats)
              const regions = Array.from(new Set(cats.map((c) => c.region ?? "")))
              return (
                <div key={g} className="pl-[21px]">
                  {groupHeader(key, g, cats, openG, 1)}
                  {openG && (
                    <div className="pl-[42px] space-y-0.5">
                      {regions.map((r) => (
                        <div key={r || "_"} className="space-y-0.5">
                          {r && <div className="text-[10px] text-muted-foreground/80 pt-1">{r}</div>}
                          {cats.filter((c) => (c.region ?? "") === r).map(row)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
