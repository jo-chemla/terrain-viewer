import { useMemo, useState } from "react"
import { Plus, Minus, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

/** The two fields every sample entry (terrain or basemap) is guaranteed to have. */
export interface SampleLike {
  id: string
  name: string
  type?: string
  loadWithSamples?: boolean
}

type SectionKey = "national" | "global" | "regional"

const SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: "national", title: "Nation-wide", blurb: "Published by a national mapping agency, covering the whole country." },
  { key: "global", title: "Global", blurb: "Worldwide, polar and sea-floor products from research consortia." },
  { key: "regional", title: "Sub-national and project scans", blurb: "A state, a province, or a single survey. Left out of Load all." },
]

/**
 * Which section a sample belongs to. "Global - " is an explicit name prefix.
 * Regional entries are the ones custom-sources.json deliberately lists AFTER
 * the global block (its convention: sub-national sinks below the nationals) or
 * flags loadWithSamples: false (project scans). Nothing else needs a field.
 */
function sectionOf(s: SampleLike, index: number, lastGlobalIndex: number): SectionKey {
  if (s.name.startsWith("Global - ")) return "global"
  if (s.loadWithSamples === false || (lastGlobalIndex >= 0 && index > lastGlobalIndex)) return "regional"
  return "national"
}

/**
 * DTM vs DSM read off the name, because agencies name the same two products a
 * dozen ways (DGM/DOM in German, DMR/DMP in Czech, MNT/MNS in French, MDT in
 * Spanish) and an English-speaking user should not need to know that DMP is a
 * surface model. Names that say neither get no pill.
 */
function kindOf(name: string): { label: string; title: string } | null {
  if (/bathymetr/i.test(name)) return { label: "Bathy", title: "Bathymetry: depth below sea level" }
  // Stereo-photogrammetric mosaics (ArcticDEM, REMA, Copernicus GLO-30) and
  // close-range scans are surface models even though nothing in the name says so.
  if (/\(surface\)|\b(DSM|DOM|DMP|MNS)\b|FO_DSM|ArcticDEM|REMA|GLO-30|Amphipolis/i.test(name)) {
    return { label: "DSM", title: "Digital Surface Model: buildings and trees included" }
  }
  if (/\b(DTM|DGM\d?|DMR|MNT|MDT|MDE|DEM|CEM|3DEP|TINITALY|DEMNAS|QldDem|NSW)\b|bare-earth|ALTI|Terrain|Aguada/i.test(name)) {
    return { label: "DTM", title: "Digital Terrain Model: bare earth" }
  }
  return null
}

/**
 * Picker for the shipped sample library. "Load Sample Sources" used to dump the
 * whole list into the user's BYOD sources in one go; with ~50 national datasets
 * that is more noise than help, so this lists them by scope and lets each be
 * added or removed individually, with Load all / Clear all for the bulk case.
 *
 * Membership is by id, so a row shows a minus when the user's list already holds
 * that sample — even a copy edited locally — and a plus otherwise. Adding a row
 * that is already present refreshes the stored copy from the sample definition,
 * the same merge-by-id rule the bulk action always had.
 */
export function SampleSourcesModal<T extends SampleLike>({
  open, onOpenChange, title, samples, current, setCurrent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  samples: readonly T[]
  current: T[]
  setCurrent: (next: T[]) => void
}) {
  const presentIds = useMemo(() => new Set(current.map((s) => s.id)), [current])
  const grouped = useMemo(() => {
    const lastGlobal = samples.reduce((acc, s, i) => (s.name.startsWith("Global - ") ? i : acc), -1)
    const out: Record<SectionKey, T[]> = { national: [], global: [], regional: [] }
    samples.forEach((s, i) => out[sectionOf(s, i, lastGlobal)].push(s))
    return out
  }, [samples])
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({ national: true, global: true, regional: true })

  const add = (entries: readonly T[]) => {
    const ids = new Set(entries.map((s) => s.id))
    setCurrent([...current.filter((s) => !ids.has(s.id)), ...entries])
  }
  const remove = (entries: readonly T[]) => {
    const ids = new Set(entries.map((s) => s.id))
    setCurrent(current.filter((s) => !ids.has(s.id)))
  }
  const loadAllSet = samples.filter((s) => s.loadWithSamples !== false)
  const loadedCount = samples.filter((s) => presentIds.has(s.id)).length

  const Row = ({ s }: { s: T }) => {
    const present = presentIds.has(s.id)
    const kind = kindOf(s.name)
    return (
      <div className="flex items-center gap-2 min-w-0 py-1">
        <span className="flex-1 min-w-0 text-sm truncate" title={s.name}>{s.name}</span>
        {kind && (
          <span
            title={kind.title}
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
              kind.label === "DSM" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : kind.label === "Bathy" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}
          >
            {kind.label}
          </span>
        )}
        {s.type && <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 w-16 text-right">{s.type}</span>}
        <Button
          variant={present ? "outline" : "secondary"}
          size="icon-sm"
          className="cursor-pointer shrink-0"
          aria-label={present ? `Remove ${s.name}` : `Add ${s.name}`}
          title={present ? "Remove from your sources" : "Add to your sources"}
          onClick={() => (present ? remove([s]) : add([s]))}
        >
          {present ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {loadedCount} of {samples.length} in your list. Add or remove one at a time, or take the whole set.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button className="cursor-pointer" onClick={() => add(loadAllSet)}>
            <Plus className="h-4 w-4" /> Load all
          </Button>
          <Button variant="outline" className="cursor-pointer" onClick={() => remove(samples)} disabled={loadedCount === 0}>
            <Minus className="h-4 w-4" /> Clear all
          </Button>
        </div>
        <div className="overflow-y-auto pr-1 -mr-1 space-y-3">
          {SECTIONS.map((sec) => {
            const rows = grouped[sec.key]
            if (!rows.length) return null
            const loaded = rows.filter((s) => presentIds.has(s.id)).length
            return (
              <Collapsible key={sec.key} open={openSections[sec.key]} onOpenChange={(o) => setOpenSections((p) => ({ ...p, [sec.key]: o }))}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer border-b">
                  <span className="text-sm font-semibold">
                    {sec.title} <span className="font-normal text-muted-foreground">· {loaded}/{rows.length}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections[sec.key] ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="text-xs text-muted-foreground pt-1">{sec.blurb}</p>
                  <div className="divide-y divide-border/50">
                    {rows.map((s) => <Row key={s.id} s={s} />)}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
