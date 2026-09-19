import { useMemo, useState } from "react"
import { Plus, Minus, ChevronDown, ArrowUp, ArrowDown, Waves, ExternalLink, Search, Library, type LucideIcon } from "lucide-react"
import { STAC_PRESETS } from "@/lib/stac-presets"
import { useAtom } from "jotai"
import { disabledStacPresetsAtom } from "@/lib/settings-atoms"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { compareWithMapterhorn, resolutionOf, formatRes, type MapterhornComparison, type MapterhornVerdict, type ResolutionMetric } from "@/lib/mapterhorn-compare"

/** The fields every sample entry (terrain or basemap) is guaranteed to have. */
export interface SampleLike {
  id: string
  name: string
  type?: string
  loadWithSamples?: boolean
  resolutionM?: number
  bulkResolutionM?: number
  url?: string
  infoUrl?: string
}

type SectionKey = "national" | "global" | "regional"

/** Bare host-and-path link for a source with no landing page recorded. */
const endpointOf = (u: string) => {
  const bare = u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "")
  return bare.startsWith("http") ? bare : `https://${bare}`
}

const SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: "national", title: "Nation-wide", blurb: "Published by a national mapping agency, covering the whole country." },
  { key: "global", title: "Global", blurb: "Worldwide and polar products from research consortia." },
  { key: "regional", title: "Sub-national and project scans", blurb: "A state, a province, or a single survey. Left out of Load all." },
]

/** Top-level split for terrain: is this an upgrade over the built-in Mapterhorn? */
type TierKey = "better" | "notBetter" | "bathy"
const TIERS: { key: TierKey; title: string; icon: LucideIcon; blurb: string }[] = [
  { key: "better", title: "Potentially better than Mapterhorn", icon: ArrowUp,
    blurb: "Finer than the bulk data Mapterhorn ingested for the country, the only national data where Mapterhorn falls back to global 30 m, or an AI bare-earth model where Mapterhorn only has the GLO-30 surface." },
  { key: "notBetter", title: "Not better than Mapterhorn", icon: ArrowDown,
    blurb: "Same or coarser grid. Worth it for data straight from the agency, or for a surface model where Mapterhorn only has bare earth." },
  { key: "bathy", title: "Bathymetry", icon: Waves,
    blurb: "Sea-floor depth, negative below sea level. Mapterhorn is land-only, so there is nothing to compare against." },
]

const VERDICT_STYLE: Record<MapterhornVerdict, { label: string; className: string; title: string }> = {
  new: { label: "New", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", title: "Mapterhorn has no national source here" },
  finer: { label: "Finer", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", title: "Finer than what Mapterhorn ingested" },
  bareearth: { label: "Bare earth", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", title: "AI terrain model on the same 30 m grid, where Mapterhorn only has the GLO-30 surface model" },
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
export function terrainKindOf(name: string): { label: string; title: string } | null {
  return kindOf(name)
}

function kindOf(name: string): { label: string; title: string } | null {
  if (/bathymetr/i.test(name)) return { label: "Bathy", title: "Bathymetry: depth below sea level" }
  // Stereo-photogrammetric mosaics (ArcticDEM, REMA, Copernicus GLO-30) and
  // close-range scans are surface models even though nothing in the name says so.
  // Derived normalised height models (DSM − DTM) and elevation-change rasters
  // are neither surface nor terrain: what stands on the ground, or what moved.
  if (/\bnDSM\b|DSM − DTM|height above ground|elevation change|\(dh\)/i.test(name)) return { label: "nDSM", title: "nDSM, normalised digital surface model: DSM − DTM, the height of what stands on the ground (a CHM, canopy height model, over forest). Also used here for elevation-change grids: 0 is the ground, or no change" }
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
  stacTarget, onBrowseStac,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  samples: readonly T[]
  current: T[]
  setCurrent: (next: T[]) => void
  compareToMapterhorn?: boolean
  /** Which half of the STAC preset list the Catalogues section offers. Omit
   *  to leave the section out entirely. */
  stacTarget?: "terrain" | "basemap"
  /** Hands the chosen catalogue back so the caller can close this dialog and
   *  open the Add dialog on its STAC tab. Omit and the section is read-only
   *  links. */
  onBrowseStac?: (presetId: string) => void
}) {
  // Which catalogues the Add dialog's own picker offers. Stored as the
  // exclusions (see disabledStacPresetsAtom) so a catalogue added in a later
  // release shows up rather than being silently absent.
  const [disabledStac, setDisabledStac] = useAtom(disabledStacPresetsAtom)
  const stacOff = useMemo(() => new Set(disabledStac), [disabledStac])
  // Functional update, not a read of `disabledStac`: two rows toggled in the
  // same tick would otherwise both start from the pre-update value and the
  // second would silently undo the first.
  const setStacEnabled = (ids: string[], on: boolean) => {
    setDisabledStac((prev) => {
      const next = new Set(prev)
      for (const id of ids) (on ? next.delete(id) : next.add(id))
      return [...next]
    })
  }
  const presentIds = useMemo(() => new Set(current.map((s) => s.id)), [current])
  const lastGlobal = useMemo(() => samples.reduce((acc, s, i) => (s.name.startsWith("Global - ") ? i : acc), -1), [samples])
  // "api": the grid the live service streams (what this viewer renders);
  // "bulk": the finest grid the agency advertises for download, i.e. what
  // Mapterhorn would ingest. Switching regroups the tiers live.
  const [metric, setMetric] = useState<ResolutionMetric>("api")
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const hasBulk = useMemo(() => samples.some((s) => s.bulkResolutionM !== undefined), [samples])
  const comparisons = useMemo(() => {
    const m = new Map<string, MapterhornComparison | null>()
    if (compareToMapterhorn) for (const s of samples) m.set(s.id, compareWithMapterhorn(s, metric))
    return m
  }, [samples, compareToMapterhorn, metric])
  // tier -> section -> rows. Without comparison everything sits in one tier.
  const grouped = useMemo(() => {
    const out: Record<TierKey, Record<SectionKey, T[]>> = {
      better: { national: [], global: [], regional: [] },
      notBetter: { national: [], global: [], regional: [] },
      bathy: { national: [], global: [], regional: [] },
    }
    samples.forEach((s, i) => {
      if (q && !`${s.name} ${s.id} ${s.type ?? ""}`.toLowerCase().includes(q)) return
      const c = comparisons.get(s.id)
      const tier: TierKey = !compareToMapterhorn ? "better"
        : kindOf(s.name)?.label === "Bathy" ? "bathy"
        : c?.verdict === "new" || c?.verdict === "finer" || c?.verdict === "bareearth" ? "better" : "notBetter"
      out[tier][sectionOf(s, i, lastGlobal)].push(s)
    })
    return out
  }, [samples, comparisons, compareToMapterhorn, lastGlobal, q])
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const isOpen = (k: string) => openSections[k] ?? true

  const add = (entries: readonly T[]) => {
    // A "dem-diff" entry is nothing without its two operands: add those from
    // the library too (unless already loaded), before it in the list.
    const operands = entries.flatMap((s) => [(s as any).diffMinuendId, (s as any).diffSubtrahendId].filter(Boolean) as string[])
      .filter((id, i, arr) => arr.indexOf(id) === i && !presentIds.has(id) && !entries.some((e) => e.id === id))
      .map((id) => samples.find((s) => s.id === id)).filter((s): s is T => !!s)
    const all = [...operands, ...entries]
    const ids = new Set(all.map((s) => s.id))
    setCurrent([...current.filter((s) => !ids.has(s.id)), ...all])
  }
  const remove = (entries: readonly T[]) => {
    const ids = new Set(entries.map((s) => s.id))
    setCurrent(current.filter((s) => !ids.has(s.id)))
  }
  // Catalogues are not datasets: a STAC endpoint is a search over thousands of
  // scenes, so it cannot be "added" the way a single URL can. Listing them here
  // anyway is the point - this dialog is where you look for data, and having to
  // know that per-scene DEMs live behind a tab of a different dialog is a
  // discoverability failure. The row hands you off instead of adding.
  const catalogues = useMemo(
    () => (!stacTarget ? [] : STAC_PRESETS.filter((p) => (p.target === "both" || p.target === stacTarget)
      && (!q || `${p.name} ${p.group} ${p.note ?? ""}`.toLowerCase().includes(q)))),
    [stacTarget, q],
  )

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
              : kind.label === "nDSM" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
              : kind.label === "Bathy" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}
          >
            {kind.label}
          </span>
        )}
        {compareToMapterhorn && !showCompare && (
          <span className="shrink-0 w-32 text-right text-xs text-muted-foreground tabular-nums">
            {resolutionOf(s, metric) !== undefined ? formatRes(resolutionOf(s, metric)!) : ""}
          </span>
        )}
        {showCompare && (
          <span className="shrink-0 w-32 text-right text-xs text-muted-foreground tabular-nums" title={`${metric === "bulk" ? "Best advertised bulk grid" : "Grid served by the live API"} vs Mapterhorn's best ingested grid for the area`}>
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
        {(s.infoUrl || s.url) && (
          <a
            href={s.infoUrl ?? endpointOf(s.url!)}
            target="_blank"
            rel="noopener noreferrer"
            title={s.infoUrl ? "Dataset page (licence, viewer)" : "Raw endpoint"}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
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

  /** Add-all / remove-all for one group, sitting left of its chevron. They live
   *  OUTSIDE the CollapsibleTrigger (itself a button) so they neither nest
   *  buttons nor toggle the fold when clicked. */
  const GroupActions = ({ rows }: { rows: T[] }) => {
    const loaded = rows.filter((s) => presentIds.has(s.id)).length
    return (
      <span className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Add every source in this group"
          disabled={loaded === rows.length} onClick={() => add(rows)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Remove every source in this group"
          disabled={loaded === 0} onClick={() => remove(rows)}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
      </span>
    )
  }

  const Section = ({ id, title, icon: Icon, blurb, rows, level }: { id: string; title: string; icon?: LucideIcon; blurb: string; rows: T[]; level: 1 | 2 }) => {
    const loaded = rows.filter((s) => presentIds.has(s.id)).length
    return (
      <Collapsible open={isOpen(id)} onOpenChange={(o) => setOpenSections((p) => ({ ...p, [id]: o }))}>
        <div className={`flex items-center gap-1 ${level === 1 ? "border-b-2" : "border-b"}`}>
          <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 py-1 cursor-pointer text-left">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className={level === 1 ? "text-sm font-bold" : "text-sm font-semibold"}>
              {title} <span className="font-normal text-muted-foreground">· {loaded}/{rows.length}</span>
            </span>
          </CollapsibleTrigger>
          <GroupActions rows={rows} />
          <CollapsibleTrigger className="cursor-pointer p-1">
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen(id) ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
        </div>
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
          <div className="flex items-center gap-1 border-b">
            <CollapsibleTrigger className="flex items-center flex-1 min-w-0 py-1 cursor-pointer text-left">
              <span className="text-sm font-semibold">
                {sec.title} <span className="font-normal text-muted-foreground">· {rows.filter((s) => presentIds.has(s.id)).length}/{rows.length}</span>
              </span>
            </CollapsibleTrigger>
            <GroupActions rows={rows} />
            <CollapsibleTrigger className="cursor-pointer p-1">
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen(id) ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
          </div>
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
      <DialogContent id="tour-source-library" className="sm:max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {loadedCount} of {samples.length} in your list. Add or remove one at a time, or take the whole set.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input autoFocus placeholder="Filter datasets…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8 cursor-text h-9" />
          </div>
          <Button className="cursor-pointer" onClick={() => add(loadAllSet)}>
            <Plus className="h-4 w-4" /> Load all
          </Button>
          <Button variant="outline" className="cursor-pointer" onClick={() => remove(samples)} disabled={loadedCount === 0}>
            <Minus className="h-4 w-4" /> Clear all
          </Button>
          {compareToMapterhorn && hasBulk && (
            <div className="ml-auto flex items-center gap-1 text-xs" title="Grade by the grid the live API streams (what this viewer renders) or by the finest grid the agency advertises for bulk download (what Mapterhorn would ingest)">
              <span className="text-muted-foreground mr-1">Resolution:</span>
              <Button size="sm" variant={metric === "api" ? "secondary" : "ghost"} className="h-7 cursor-pointer" onClick={() => setMetric("api")}>API-served</Button>
              <Button size="sm" variant={metric === "bulk" ? "secondary" : "ghost"} className="h-7 cursor-pointer" onClick={() => setMetric("bulk")}>Best bulk GSD</Button>
            </div>
          )}
        </div>
        <div className="overflow-y-auto pr-1 -mr-1 space-y-4">
          {compareToMapterhorn
            ? TIERS.map((tier) => {
                const rows = Object.values(grouped[tier.key]).flat()
                if (!rows.length) return null
                return (
                  <div key={tier.key} className="space-y-3">
                    <Section id={tier.key} title={tier.title} icon={tier.icon} blurb={tier.blurb} rows={rows} level={1} />
                    {isOpen(tier.key) && (
                      tier.key === "bathy"
                        ? <div className="pl-2 divide-y divide-border/50">{rows.map((s) => <Row key={s.id} s={s} />)}</div>
                        : <div className="pl-2 space-y-3">{renderSections(tier.key, `${tier.key}:`)}</div>
                    )}
                  </div>
                )
              })
            : renderSections("better", "")}

          {catalogues.length > 0 && (
            <Collapsible open={isOpen("catalogues")} onOpenChange={(o) => setOpenSections((p) => ({ ...p, catalogues: o }))}>
              <div className="flex items-center gap-1 border-b-2">
                <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 py-1 cursor-pointer text-left">
                  <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-bold">
                    Catalogues <span className="font-normal text-muted-foreground">· {catalogues.filter((p) => !stacOff.has(p.id)).length}/{catalogues.length}</span>
                  </span>
                </CollapsibleTrigger>
                <span className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Offer every catalogue"
                    disabled={catalogues.every((p) => !stacOff.has(p.id))}
                    onClick={() => setStacEnabled(catalogues.map((p) => p.id), true)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Hide every catalogue"
                    disabled={catalogues.every((p) => stacOff.has(p.id))}
                    onClick={() => setStacEnabled(catalogues.map((p) => p.id), false)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </span>
                <CollapsibleTrigger className="cursor-pointer p-1">
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen("catalogues") ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <p className="text-xs text-muted-foreground pt-1">
                  Searchable archives rather than single datasets — per-scene DEMs and imagery, found by area and date.
                  <b>Browse</b> opens the catalogue search with that endpoint selected; the <b>+/−</b> decides whether it
                  is offered in that search&rsquo;s own picker at all, so a list you never use can be trimmed down.
                </p>
                <div className="pl-2 divide-y divide-border/50">
                  {catalogues.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 min-w-0 py-1">
                      <span className="flex-1 min-w-0 text-sm truncate" title={p.note ?? p.name}>{p.name}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-sky-500/15 text-sky-700 dark:text-sky-300">
                        {p.group}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 w-16 text-right">{p.kind}</span>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" title="Catalogue endpoint"
                        className="shrink-0 text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <Button variant="secondary" size="sm" className="cursor-pointer shrink-0 h-8"
                        disabled={!onBrowseStac}
                        title={onBrowseStac ? `Search ${p.name} over the current view` : "Catalogue search is off (Settings → Beta)"}
                        onClick={() => onBrowseStac?.(p.id)}>
                        <Search className="h-3.5 w-3.5" /> Browse
                      </Button>
                      <Button
                        variant={stacOff.has(p.id) ? "secondary" : "outline"}
                        size="icon-sm"
                        className="cursor-pointer shrink-0"
                        aria-label={stacOff.has(p.id) ? `Offer ${p.name} in the catalogue picker` : `Hide ${p.name} from the catalogue picker`}
                        title={stacOff.has(p.id) ? "Hidden from the catalogue picker — click to offer it" : "Offered in the catalogue picker — click to hide it"}
                        onClick={() => setStacEnabled([p.id], stacOff.has(p.id))}
                      >
                        {stacOff.has(p.id) ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
