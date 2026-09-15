import { useMemo, useState } from "react"
import { Plus, Minus, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { compareWithMapterhorn, formatRes, type MapterhornComparison, type MapterhornVerdict } from "@/lib/mapterhorn-compare"

/** The fields every sample entry (terrain or basemap) is guaranteed to have. */
export interface SampleLike {
  id: string
  name: string
  type?: string
  loadWithSamples?: boolean
  resolutionM?: number
}

type SectionKey = "national" | "global" | "regional"

const SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: "national", title: "Nation-wide", blurb: "Published by a national mapping agency, covering the whole country." },
  { key: "global", title: "Global", blurb: "Worldwide and polar products from research consortia." },
  { key: "regional", title: "Sub-national and project scans", blurb: "A state, a province, or a single survey. Left out of Load all." },
]

/** Top-level split for terrain: is this an upgrade over the built-in Mapterhorn? */
type TierKey = "better" | "notBetter" | "bathy"
const TIERS: { key: TierKey; title: string; blurb: string }[] = [
  { key: "better", title: "⬆️ Better than Mapterhorn here",
    blurb: "Either finer than the bulk data Mapterhorn ingested for the country, or the only national data at all where Mapterhorn falls back to global 30 m." },
  { key: "notBetter", title: "⬇️ Not better than Mapterhorn",
    blurb: "Same or coarser grid. Worth it for data straight from the agency, or for a surface model where Mapterhorn only has bare earth." },
  { key: "bathy", title: "🌊 Bathymetry",
    blurb: "Sea-floor depth, negative below sea level. Mapterhorn is land-only, so there is nothing to compare against." },
]

const VERDICT_STYLE: Record<MapterhornVerdict, { label: string; className: string; title: string }> = {
  new: { label: "New", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", title: "Mapterhorn has no national source here" },
  finer: { label: "Finer", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", title: "Finer than what Mapterhorn ingested" },
  same: { label: "Same", className: "bg-muted text-muted-foreground", title: "Same resolution as Mapterhorn" },
  coarser: { label: "Coarser", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300", title: "Mapterhorn ingested finer data" },
}

/**
 * Which scope a sample belongs to. "Global - " is an explicit name prefix.
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
 *
 * With `compareToMapterhorn` (terrain only) the list is first split into what
 * beats the built-in Mapterhorn terrain and what does not, each with its own
 * Nation-wide / Global / Sub-national sections and a per-row verdict.
 */
export function SampleSourcesModal<T extends SampleLike>({
  open, onOpenChange, title, samples, current, setCurrent, compareToMapterhorn = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  samples: readonly T[]
  current: T[]
  setCurrent: (next: T[]) => void
  compareToMapterhorn?: boolean
}) {
  const presentIds = useMemo(() => new Set(current.map((s) => s.id)), [current])
  const lastGlobal = useMemo(() => samples.reduce((acc, s, i) => (s.name.startsWith("Global - ") ? i : acc), -1), [samples])
  const comparisons = useMemo(() => {
    const m = new Map<string, MapterhornComparison | null>()
    if (compareToMapterhorn) for (const s of samples) m.set(s.id, compareWithMapterhorn(s))
    return m
  }, [samples, compareToMapterhorn])
  // tier -> section -> rows. Without comparison everything sits in one tier.
  const grouped = useMemo(() => {
    const out: Record<TierKey, Record<SectionKey, T[]>> = {
      better: { national: [], global: [], regional: [] },
      notBetter: { national: [], global: [], regional: [] },
      bathy: { national: [], global: [], regional: [] },
    }
    samples.forEach((s, i) => {
      const c = comparisons.get(s.id)
      const tier: TierKey = !compareToMapterhorn ? "better"
        : kindOf(s.name)?.label === "Bathy" ? "bathy"
        : c?.verdict === "new" || c?.verdict === "finer" ? "better" : "notBetter"
      out[tier][sectionOf(s, i, lastGlobal)].push(s)
    })
    return out
  }, [samples, comparisons, compareToMapterhorn, lastGlobal])
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const isOpen = (k: string) => openSections[k] ?? true

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
    const c = comparisons.get(s.id)
    const showCompare = compareToMapterhorn && kind?.label !== "Bathy"
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
        {compareToMapterhorn && !showCompare && (
          <span className="shrink-0 w-32 text-right text-xs text-muted-foreground tabular-nums">
            {s.resolutionM !== undefined ? formatRes(s.resolutionM) : ""}
          </span>
        )}
        {showCompare && (
          <span className="shrink-0 w-32 text-right text-xs text-muted-foreground tabular-nums" title="This source vs Mapterhorn's best ingested grid for the area">
            {c ? (c.verdict === "same" ? formatRes(c.ours) : `${formatRes(c.ours)} vs ${formatRes(c.theirs)}`) : "—"}
          </span>
        )}
        {showCompare && (
          <span
            title={c ? VERDICT_STYLE[c.verdict].title : "No resolution recorded"}
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 w-14 text-center ${c ? VERDICT_STYLE[c.verdict].className : "bg-muted text-muted-foreground"}`}
          >
            {c ? VERDICT_STYLE[c.verdict].label : "—"}
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

  const Section = ({ id, title, blurb, rows, level }: { id: string; title: string; blurb: string; rows: T[]; level: 1 | 2 }) => {
    const loaded = rows.filter((s) => presentIds.has(s.id)).length
    return (
      <Collapsible open={isOpen(id)} onOpenChange={(o) => setOpenSections((p) => ({ ...p, [id]: o }))}>
        <CollapsibleTrigger className={`flex items-center justify-between w-full py-1 cursor-pointer ${level === 1 ? "border-b-2" : "border-b"}`}>
          <span className={level === 1 ? "text-sm font-bold" : "text-sm font-semibold"}>
            {title} <span className="font-normal text-muted-foreground">· {loaded}/{rows.length}</span>
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen(id) ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="text-xs text-muted-foreground pt-1">{blurb}</p>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  const renderSections = (tier: TierKey, prefix: string) =>
    SECTIONS.map((sec) => {
      const rows = grouped[tier][sec.key]
      if (!rows.length) return null
      const id = `${prefix}${sec.key}`
      return (
        <Collapsible key={id} open={isOpen(id)} onOpenChange={(o) => setOpenSections((p) => ({ ...p, [id]: o }))}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer border-b">
            <span className="text-sm font-semibold">
              {sec.title} <span className="font-normal text-muted-foreground">· {rows.filter((s) => presentIds.has(s.id)).length}/{rows.length}</span>
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen(id) ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-xs text-muted-foreground pt-1">{sec.blurb}</p>
            <div className="divide-y divide-border/50">
              {rows.map((s) => <Row key={s.id} s={s} />)}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )
    })

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
        <div className="overflow-y-auto pr-1 -mr-1 space-y-4">
          {compareToMapterhorn
            ? TIERS.map((tier) => {
                const rows = Object.values(grouped[tier.key]).flat()
                if (!rows.length) return null
                return (
                  <div key={tier.key} className="space-y-3">
                    <Section id={tier.key} title={tier.title} blurb={tier.blurb} rows={rows} level={1} />
                    {isOpen(tier.key) && (
                      tier.key === "bathy"
                        ? <div className="pl-2 divide-y divide-border/50">{rows.map((s) => <Row key={s.id} s={s} />)}</div>
                        : <div className="pl-2 space-y-3">{renderSections(tier.key, `${tier.key}:`)}</div>
                    )}
                  </div>
                )
              })
            : renderSections("better", "")}
        </div>
      </DialogContent>
    </Dialog>
  )
}
