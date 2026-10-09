// The historical catalogs tree, shared by the timeline's Catalogs select and
// the Sources Coverage section: imagery and old-map catalogs whose items
// covering the view become timeline ticks (lib/timeline-catalogs.ts), plus
// the coverage-only entries (Allmaps, QMS) whose maps carry no capture date
// and so draw footprints only. Root groups (open data for post-crisis
// response, community indexes, mapping agencies, old maps); the national
// archives sit under a continent, then a country (ISO alpha-3), everything
// sorted by name; the old maps and the open data rows sit right under their
// root. A group's box takes its whole group. Each row shows its tick count
// and a spinner while loading; a catalog a browser cannot query is listed,
// greyed, with why. In the timeline's picker the four root groups start
// open and everything under them folded; in the coverage section every
// group starts folded. What the user opens is kept (coverageFoldsAtom, the
// same state in both places); a source whose extent misses the view is
// dimmed. The last root, My catalogs, holds the STAC catalogs the visitor
// attached (customTimelineCatalogsAtom) and the shipped ones: an "Add a catalog" row opens
// add-timeline-catalog-dialog.tsx, and each row has a remove button.
import type React from "react"
import { useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2, Plus, X, BookmarkPlus } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TIMELINE_CATALOGS, CATALOG_ROOTS, CATALOG_ROOT_ORDER, COVERAGE_ONLY_ENTRIES, ISO3_NAMES, MY_CATALOGS_ROOT, catalogStatusAtom, timelineCatalogsAtom, isStacCatalogId, stacCatalogDef, stacSpecOfId, type TimelineCatalog } from "@/lib/timeline-catalogs"
import { coverageOverlaysAtom } from "@/lib/coverage-overlays"
import { timelineFootprintsAtom, timelineWindowFilterAtom, timelineFollowViewportAtom, coverageFoldsAtom, customTimelineCatalogsAtom } from "@/lib/settings-atoms"
import { AddTimelineCatalogDialog } from "./add-timeline-catalog-dialog"

const SwitchRow: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; tip: string }> = ({ checked, onChange, label, tip }) => (
  <Tooltip>
    <TooltipTrigger render={<label className="flex items-center gap-1.5 cursor-pointer"><Switch checked={checked} onCheckedChange={onChange} className="cursor-pointer scale-75 origin-left" />{label}</label>} />
    <TooltipContent><p>{tip}</p></TooltipContent>
  </Tooltip>
)

const covers = (c: { bbox?: [number, number, number, number] }, center?: [number, number]) =>
  !c.bbox || !center || (center[0] >= c.bbox[0] && center[0] <= c.bbox[2] && center[1] >= c.bbox[1] && center[1] <= c.bbox[3])

type Entry = TimelineCatalog & { coverageOnly?: boolean; /** Selected by a link, not in this browser's My catalogs: a Keep button stores it. */ unlisted?: boolean }
// Footprint-only rows first within their group (Allmaps, Rumsey, QMS).
const entriesOf = (catalogs: TimelineCatalog[]): Entry[] => [...COVERAGE_ONLY_ENTRIES.map((e) => ({ ...e, coverageOnly: true as const })), ...catalogs]
const BUILTIN_ENTRIES = entriesOf(TIMELINE_CATALOGS)
const rootOf = (c: Entry) => CATALOG_ROOTS[c.group] ?? CATALOG_ROOT_ORDER[2]
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)

/** A node of the tree: a root, a continent, a country; rows under it. */
interface Node { key: string; label: string; depth: number; rows: Entry[]; children: Node[] }
function buildNodes(roots: string[], bare = false, entries: Entry[] = BUILTIN_ENTRIES): Node[] {
  return roots.map((root) => {
    const cats = entries.filter((c) => rootOf(c) === root)
    const node: Node = { key: root, label: root, depth: 0, rows: [], children: [] }
    if (root === CATALOG_ROOT_ORDER[2]) {
      // continent → country (ISO alpha-3) → sources, every level sorted.
      const continents = Array.from(new Set(cats.map((c) => c.continent ?? "Europe"))).sort()
      for (const continent of continents) {
        const inContinent = cats.filter((c) => (c.continent ?? "Europe") === continent)
        const cn: Node = { key: `${root}/${continent}`, label: continent, depth: 1, rows: [], children: [] }
        const countries = Array.from(new Set(inContinent.map((c) => c.iso3 || c.region || ""))).sort((a, b) => (ISO3_NAMES[a] ?? a).localeCompare(ISO3_NAMES[b] ?? b))
        for (const iso of countries) {
          const rows = inContinent.filter((c) => (c.iso3 || c.region || "") === iso).sort(byLabel)
          if (!iso || iso === "WLD") { cn.rows.push(...rows); continue }
          cn.children.push({ key: `${cn.key}/${iso}`, label: ISO3_NAMES[iso] ? `${iso} · ${ISO3_NAMES[iso]}` : iso, depth: 2, rows, children: [] })
        }
        node.children.push(cn)
      }
    } else {
      // Rows right under the root: the footprint-only ones first, then by
      // name; the community indexes in a fixed order (the Editor Layer
      // Index, ArcGIS Online, QMS).
      const fixed = root === CATALOG_ROOT_ORDER[1] ? ["eli", "cat-agol", "qmsAll"] : null
      node.rows = cats.filter((c) => !(bare && c.coverageOnly)).sort((a, b) => fixed ? fixed.indexOf(a.id) - fixed.indexOf(b.id) : Number(!!b.coverageOnly) - Number(!!a.coverageOnly) || byLabel(a, b))
    }
    return node
  })
}
const nodeCats = (n: Node): Entry[] => [...n.rows, ...n.children.flatMap(nodeCats)]
const nodeKeys = (n: Node): string[] => [n.key, ...n.children.flatMap(nodeKeys)]
/** Every foldable key of the tree, for the picker's expand/fold all; down
 *  to `maxDepth` (0 the roots, 1 the continents) when given. */
export const catalogTreeKeys = (roots: string[] = CATALOG_ROOT_ORDER, maxDepth = Infinity): string[] => {
  const walk = (n: Node): string[] => (n.depth > maxDepth ? [] : [n.key, ...n.children.flatMap(walk)])
  return buildNodes(roots).flatMap(walk).map((k) => `cat:${k}`)
}

export const HistoricalCatalogTree: React.FC<{
  /** The timeline catalogs on (state.timelineCatalogs). */
  selected: string[]
  onChange: (ids: string[]) => void
  /** The view centre [lng, lat], to tell which regional sources cover it. */
  center?: [number, number]
  /** In the coverage section: no explanation and no switches (they sit
   *  above the whole tree there). */
  compact?: boolean
  /** Which root groups to show (all by default). */
  roots?: string[]
  /** Rows without the root header: the Community indexes rows inside the
   *  static basemaps' group of the same name. */
  bare?: boolean
  className?: string
}> = ({ selected, onChange, center, compact = false, roots = CATALOG_ROOT_ORDER, bare = false, className }) => {
  const { loading, counts, errors } = useAtomValue(catalogStatusAtom)
  const catalogs = useAtomValue(timelineCatalogsAtom)
  // A STAC catalog a link selected that this browser never saved: listed
  // from its id (its endpoint is in it) with a Keep button.
  const unlisted = selected.filter((id) => isStacCatalogId(id) && !catalogs.some((c) => c.id === id)).map((id) => stacCatalogDef(id)).filter((c): c is TimelineCatalog => !!c)
  const entries = useMemo(() => [...entriesOf(catalogs), ...unlisted.map((c) => ({ ...c, unlisted: true }))], [catalogs, unlisted.map((c) => c.id).join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
  const setCustomCatalogs = useSetAtom(customTimelineCatalogsAtom)
  const [addOpen, setAddOpen] = useState(false)
  const removeCustom = (id: string) => {
    setCustomCatalogs((prev) => prev.filter((c) => c.id !== id))
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id))
  }
  const keepCustom = (c: TimelineCatalog) => {
    const spec = stacSpecOfId(c.id)
    if (!spec) return
    setCustomCatalogs((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, { id: c.id, label: c.label, short: c.short, endpoint: spec.endpoint, kind: spec.kind, collection: spec.collection, color: c.color }]))
  }
  const [coverage, setCoverage] = useAtom(coverageOverlaysAtom)
  const [footprints, setFootprints] = useAtom(timelineFootprintsAtom)
  const [windowFilter, setWindowFilter] = useAtom(timelineWindowFilterAtom)
  const [follow, setFollow] = useAtom(timelineFollowViewportAtom)
  const [folds, setFolds] = useAtom(coverageFoldsAtom)
  const isOn = (c: Entry) => (c.coverageOnly ? coverage.includes(c.id) : selected.includes(c.id))
  const setMany = (cats: Entry[], on: boolean) => {
    const ticks = cats.filter((c) => !c.coverageOnly).map((c) => c.id)
    const covs = cats.filter((c) => c.coverageOnly).map((c) => c.id)
    if (ticks.length) { const next = new Set(selected); for (const id of ticks) on ? next.add(id) : next.delete(id); onChange([...next]) }
    if (covs.length) setCoverage((prev) => { const next = new Set(prev); for (const id of covs) on ? next.add(id) : next.delete(id); return [...next] })
  }
  const nodes = buildNodes(roots, bare, entries)
  const allNodes = (ns: Node[]): Node[] => ns.flatMap((n) => [n, ...allNodes(n.children)])
  const isOpen = (n: Node) => folds[`cat:${n.key}`] ?? (n.depth === 0 && !compact)
  const keys = nodes.flatMap(nodeKeys)
  const allOpen = allNodes(nodes).every(isOpen)
  const foldAll = (fold: boolean) => setFolds((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [`cat:${k}`, !fold])) }))
  const toggleFold = (key: string, openNow: boolean) => setFolds((prev) => ({ ...prev, [`cat:${key}`]: !openNow }))

  const loadingHere = (cats: Entry[]) => cats.some((c) => isOn(c) && loading[c.id])
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
        {loadingHere(cats) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
        <Label htmlFor={`tlcat-g-${key}`} className={cn("cursor-pointer flex-1 tracking-wide text-muted-foreground", depth === 0 ? "uppercase text-[11px] font-semibold text-foreground/80" : depth === 1 ? "uppercase text-[10px]" : "text-[10px]")}>{label}</Label>
        {on > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{on} on</span>}
        {regional && here > 0 && <span className="text-[10px] text-muted-foreground tabular-nums" title="Sources covering the view centre">{here} here</span>}
      </div>
    )
  }
  const row = (c: Entry) => {
    const away = !covers(c, center)
    const on = isOn(c)
    return (
      <div key={c.id} className={cn("flex items-center gap-1.5", (c.disabled || away) && "opacity-50")}>
        <Checkbox id={`tlcat-${c.id}`} checked={on} disabled={!!c.disabled} onCheckedChange={(v) => setMany([c], v === true)} className="cursor-pointer" />
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
        <Tooltip>
          <TooltipTrigger render={<Label htmlFor={`tlcat-${c.id}`} className="text-xs cursor-pointer truncate flex-1">{c.label}</Label>} />
          <TooltipContent className="max-w-80"><p>{c.disabled ?? c.note}{away && !c.disabled ? " (nothing at the view centre)" : ""}</p></TooltipContent>
        </Tooltip>
        {c.coverageOnly && <span className="text-[10px] text-muted-foreground">footprints</span>}
        {on && !c.coverageOnly && (loading[c.id]
          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          : errors[c.id]
          ? <span className="text-[10px] text-destructive" title={errors[c.id]}>error</span>
          : <span className="text-[10px] text-muted-foreground tabular-nums">{counts[c.id] ?? 0}</span>)}
        {c.unlisted && (
          <button type="button" className="cursor-pointer shrink-0 text-muted-foreground hover:text-foreground p-0.5" aria-label={`Keep ${c.label} in My STAC catalogs`} title="From the link you opened: keep it in My STAC catalogs" onClick={() => keepCustom(c)}>
            <BookmarkPlus className="h-3 w-3" />
          </button>
        )}
        {c.custom && (
          <button type="button" className="cursor-pointer shrink-0 text-muted-foreground hover:text-destructive p-0.5" aria-label={`Remove ${c.label} from My STAC catalogs`} title={c.unlisted ? "Drop it from the timeline" : "Remove from My STAC catalogs"} onClick={() => removeCustom(c.id)}>
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }
  // The My catalogs root ends with the row that adds one.
  const addRow = (
    <button type="button" className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-0.5" onClick={() => setAddOpen(true)}>
      <Plus className="h-3.5 w-3.5" /> Add a catalog…
    </button>
  )
  const renderNode = (n: Node, withHeader: boolean): React.ReactNode => {
    const open = !withHeader || isOpen(n)
    return (
      <div key={n.key} className={n.depth ? "pl-[21px]" : undefined}>
        {withHeader && groupHeader(n.key, n.label, nodeCats(n), open, n.depth)}
        {open && (n.rows.length > 0 || n.key === MY_CATALOGS_ROOT) && (
          <div className={withHeader ? "pl-[42px] space-y-0.5" : "space-y-0.5"}>
            {n.rows.map(row)}
            {n.key === MY_CATALOGS_ROOT && (n.rows.length ? addRow : <div className="space-y-0.5"><p className="text-[11px] text-muted-foreground">Your own STAC catalogs (an API or a static catalog.json), one tick per item in view.</p>{addRow}</div>)}
          </div>
        )}
        {open && n.children.map((c) => renderNode(c, true))}
      </div>
    )
  }
  return (
    <div className={cn("space-y-1", className)}>
      {!compact && (
        <div className="flex items-start gap-2 px-0.5 pb-1">
          <p className="text-[11px] text-muted-foreground flex-1">Items covering the view become ticks; picking one makes it the view's basemap. Refreshed as you move. Dimmed sources have nothing here.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] flex-1">
            <SwitchRow checked={follow} onChange={setFollow} label="Follow the view" tip="Off: the catalogs are not asked again as the map moves, so the ticks stay as they are; on again asks them for the current view" />
            <SwitchRow checked={windowFilter} onChange={setWindowFilter} label="Within the timeline window" tip="Only items dated within the timeline's current window (STAC searches pass it to the server); the catalogs are asked again when this changes" />
            <SwitchRow checked={footprints} onChange={setFootprints} label="Footprints on the map" tip="Every item found drawn as an outline in its catalog's colour" />
          </div>
          <Tooltip>
            <TooltipTrigger render={
              <button type="button" className="cursor-pointer shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1" onClick={() => foldAll(allOpen)}>
                {allOpen ? <ChevronsDownUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}{allOpen ? "Fold all" : "Expand all"}
              </button>
            } />
            <TooltipContent><p>{allOpen ? "Fold every group" : "Expand every group"}</p></TooltipContent>
          </Tooltip>
        </div>
      )}
      {nodes.map((n, i) => (
        <div key={n.key} className={i && !bare ? (compact ? "pt-1 border-t border-dashed mt-1" : "pt-1.5 border-t mt-1") : undefined}>{renderNode(n, !bare)}</div>
      ))}
      {addOpen && (
        <AddTimelineCatalogDialog open={addOpen} onOpenChange={setAddOpen} onAdd={(entry) => {
          setCustomCatalogs((prev) => (prev.some((c) => c.id === entry.id) ? prev : [...prev, entry]))
          if (!selected.includes(entry.id)) onChange([...selected, entry.id])
        }} />
      )}
    </div>
  )
}
