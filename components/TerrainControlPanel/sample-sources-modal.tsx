import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Plus, Minus, ChevronDown, ArrowUp, ArrowDown, ArrowRight, Waves, ExternalLink, Search, Library, Layers2, Maximize2, Mountain, Shapes, Map as MapIcon, type LucideIcon } from "lucide-react"
import { STAC_PRESETS } from "@/lib/stac-presets"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { disabledStacPresetsAtom, savedStacCatalogsAtom, libraryQueryAtom, terrainLibraryOpenAtom, basemapLibraryOpenAtom, vectorLibraryOpenAtom, libraryDialogHostAtom, libraryMountedAtom, type LibraryStacLink, type LibraryBrowseEntry } from "@/lib/settings-atoms"
import { sectionOpenAtom, macroGroupOpenAtom } from "./TerrainControlPanel"
import customSources from "@/lib/custom-sources.json"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { CopyModalLinkButton } from "./controls-components"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { searchLibrary } from "@/lib/library-search"
import { VECTOR_LIBRARY, vectorSearchText } from "@/lib/vector-sources"
import { libraryGroup, usedLibraryGroups } from "@/lib/library-groups"
import { compareWithMapterhorn, resolutionOf, formatRes, type MapterhornComparison, type MapterhornVerdict, type ResolutionMetric } from "@/lib/mapterhorn-compare"

/** The fields every sample entry (terrain or basemap) is guaranteed to have. */
export interface SampleLike {
  id: string
  name: string
  type?: string
  loadWithSamples?: boolean
  resolutionM?: number
  bulkResolutionM?: number
  /** [west, south, east, north] - the only thing that can tell a 4 km city
   *  survey from a national mosaic, since neither declares its scope. */
  bounds?: [number, number, number, number]
  url?: string
  infoUrl?: string
  /** Extra words the search finds the entry by and nothing shows: the other
   *  spellings of its subject ("landcover land use LULC"). */
  keywords?: string
  /** A catalog search for the same data: adds a Browse button beside Add. */
  stac?: LibraryStacLink
  /** A thematic section of its own (lib/library-groups.ts), listed after the
   *  scope sections instead of in them. */
  libraryGroup?: string
}

/** A Browse-only row (LibraryBrowseEntry), marked so it is never added. */
type BrowseRow = LibraryBrowseEntry & { browseOnly: true; type?: undefined; url?: undefined }
const isBrowseRow = (s: SampleLike | BrowseRow): s is BrowseRow => (s as BrowseRow).browseOnly === true

/** What a dataset's Browse button hands the caller: the catalog, the
 *  collection, and a search over the current view straight away. */
export type BrowseStacRequest = { collection?: string; search?: boolean }

/** "Search <collection> in <catalog> over the current view", for the title. */
function browseTitle(stac: LibraryStacLink): string {
  const preset = STAC_PRESETS.find((p) => p.id === stac.preset)
  const col = stac.collection ? stac.collection.replace(/\/collection\.json$/, "").split("/").filter(Boolean).slice(-3).join("/") : ""
  return `Search ${col ? `${col} in ` : ""}${preset?.name ?? stac.preset} over the current view`
}

/** What the search reads of a row (see lib/library-search.ts). */
const rowText = (s: SampleLike | BrowseRow) => {
  // A thematic group's title and keywords count as the row's own words.
  const g = s.libraryGroup ? libraryGroup(s.libraryGroup) : null
  return `${s.name} ${s.id} ${s.type ?? ""} ${(s as SampleLike).keywords ?? ""}${isBrowseRow(s) ? " stac browse" : ""}${g ? ` ${g.title} ${g.keywords ?? ""}` : ""}`
}

export type LibraryKind = "terrain" | "basemap"

/** Every row a library lists, Browse-only ones included, for the count the
 *  other tab shows. Read straight from the library file: the other library's
 *  section may not be mounted (a folded Raster Basemap section unmounts its
 *  content), and its count must not depend on that. */
const LIBRARY_ROWS: Record<LibraryKind, readonly (SampleLike | BrowseRow)[]> = {
  terrain: [
    ...(customSources.SAMPLE_TERRAIN_SOURCES as SampleLike[]),
    ...(((customSources as any).SAMPLE_TERRAIN_BROWSE_ONLY ?? []) as LibraryBrowseEntry[]).map((s) => ({ ...s, browseOnly: true as const })),
  ],
  basemap: customSources.SAMPLE_BASEMAPS_SOURCES as SampleLike[],
}

/** How many rows of a library a filter keeps: the same search as the list. */
export function libraryMatchCount(kind: LibraryKind, query: string): number {
  return searchLibrary(LIBRARY_ROWS[kind], rowText, query.trim().toLowerCase()).length
}

/** At or under this many matches in the open tab, a search that finds some
 *  in the other library says so with a button, not only a count on the tab. */
const FEW_MATCHES = 3

/** The dialog's tabs: the two tile libraries and the vector one, whose list
 *  is vector-library-panel.tsx. */
export type LibraryTabKey = LibraryKind | "vector"

const LIBRARY_TAB: Record<LibraryTabKey, { label: string; plural: string; button: string; icon: LucideIcon }> = {
  terrain: { label: "Terrain", plural: "terrain datasets", button: "Terrain", icon: Mountain },
  basemap: { label: "Basemap", plural: "basemaps or overlays", button: "Basemaps", icon: MapIcon },
  vector: { label: "Vector", plural: "vector sources", button: "Vector", icon: Shapes },
}

/** How many vector sources a filter keeps (the Vector tab's count). */
export function vectorLibraryMatchCount(query: string): number {
  return searchLibrary(VECTOR_LIBRARY, vectorSearchText, query.trim().toLowerCase()).length
}

/** A hook: go to a tab of the Library dialog. One library is open at a time;
 *  a tile library's list lives in its sidebar section, which is unfolded so
 *  the list is mounted. */
export function useLibraryTabSwitch(): (to: LibraryTabKey) => void {
  const setTerrain = useSetAtom(terrainLibraryOpenAtom)
  const setBasemap = useSetAtom(basemapLibraryOpenAtom)
  const setVector = useSetAtom(vectorLibraryOpenAtom)
  const setSectionOpen = useSetAtom(sectionOpenAtom)
  const setMacroGroupOpen = useSetAtom(macroGroupOpenAtom)
  return (to) => {
    if (to !== "vector") {
      setMacroGroupOpen((p) => ({ ...p, Sources: true }))
      setSectionOpen((p) => ({ ...p, [to === "terrain" ? "terrainSource" : "rasterBasemap"]: true }))
    }
    setTerrain(to === "terrain")
    setBasemap(to === "basemap")
    setVector(to === "vector")
  }
}

/** The tab row of the Library dialog, the same in its three lists. `count`
 *  gives a tab's number of matches while a filter is typed, else null. */
export function LibraryTabBar({ active, count, terrainTab = true }: { active: LibraryTabKey; count: (tab: LibraryTabKey) => number | null; terrainTab?: boolean }) {
  const switchTab = useLibraryTabSwitch()
  const tabs = (["terrain", "basemap", "vector"] as const).filter((k) => terrainTab || k !== "terrain")
  return (
    <div role="tablist" aria-label="Library" className="flex items-end gap-1 border-b flex-1 min-w-0 self-stretch">
      {tabs.map((k) => {
        const t = LIBRARY_TAB[k]
        const on = k === active
        const n = count(k)
        return (
          <button key={k} role="tab" aria-selected={on} type="button"
            onClick={() => { if (!on) switchTab(k) }}
            title={n !== null ? `${n} ${n === 1 ? "match" : "matches"} in the ${t.label} library` : `The ${t.label} library`}
            className={`flex items-center gap-1.5 min-w-0 px-3.5 py-1.5 -mb-px border-b-2 text-[15px] cursor-pointer ${on ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{t.label}</span>
            {n !== null && <span className="text-xs font-normal text-muted-foreground tabular-nums">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

type SectionKey = "national" | "global" | "regional" | "city"

/** Bare host-and-path link for a source with no landing page recorded. */
const endpointOf = (u: string) => {
  const bare = u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "")
  return bare.startsWith("http") ? bare : `https://${bare}`
}

const SECTIONS: { key: SectionKey; title: string; blurb: string }[] = [
  { key: "national", title: "Nation-wide", blurb: "Published by a national mapping agency, covering the whole country." },
  { key: "global", title: "Global", blurb: "Worldwide and polar products from research consortia." },
  { key: "regional", title: "Sub-national", blurb: "A state, a province, an island or a region - roughly 50 to 300 km across." },
  { key: "city", title: "City and single-survey", blurb: "One city or one flight line, a few kilometres across. The finest data in the library, and useful for almost nowhere else." },
]

/** Above this width (km) an entry is not a city survey, however it was filed.
 *  Klaipeda, the largest thing on the city list, is 28 km across; the smallest
 *  genuinely national entry, the Netherlands, is 332 km. */
const CITY_MAX_KM = 30

/** Top-level split for terrain: is this an upgrade over the built-in Mapterhorn? */
type TierKey = "better" | "derived" | "notBetter" | "bathy"
const TIERS: { key: TierKey; title: string; icon: LucideIcon; blurb: string }[] = [
  { key: "better", title: "Potentially better than Mapterhorn", icon: ArrowUp,
    blurb: "Finer than the bulk data Mapterhorn ingested for the country, the only national data where Mapterhorn falls back to global 30 m, or an AI bare-earth model where Mapterhorn only has the GLO-30 surface." },
  { key: "derived", title: "nDSM and change", icon: Layers2,
    blurb: "Differences computed in the browser: height above ground (a surface model minus a terrain model) and change between two surveys of one event, with the before and after surveys they need. Not comparable to Mapterhorn." },
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

/** Whether declared bounds are an extent to zoom to: four numbers, smaller
 *  than the world (the test of the Vector tab's vectorZoomTarget). */
export function hasExtent(b?: readonly number[] | null): b is [number, number, number, number] {
  return !!b && b.length === 4 && b.every(Number.isFinite) && (b[2] - b[0] < 300 || b[3] - b[1] < 140)
}

/** Width and height of a declared bounds box in km, or null. */
function extentKm(bounds?: [number, number, number, number]): { x: number; y: number } | null {
  if (!bounds || bounds.length !== 4) return null
  const [w, s, e, n] = bounds
  const midLat = (((s + n) / 2) * Math.PI) / 180
  return { x: Math.abs(e - w) * 111.32 * Math.cos(midLat), y: Math.abs(n - s) * 110.57 }
}

/**
 * Which scope a sample belongs to. "Global - " is an explicit name prefix.
 * Regional entries are the ones custom-sources.json deliberately lists AFTER
 * the global block (its convention: sub-national sinks below the nationals) or
 * flags loadWithSamples: false (project scans).
 *
 * City scale is read off the declared bounds instead, because position in the
 * file cannot see it: Dar es Salaam's Msimbazi basin is 4 x 4 km and Klaipeda
 * is 28 x 25 km, and both sat under "Nation-wide" purely by being listed above
 * the global block. Size alone would not do either - the Netherlands is 332 km
 * across and unambiguously national - so it only ever promotes INTO the
 * narrowest bucket, and the editorial ordering still decides everything else.
 */
function sectionOf(s: SampleLike, index: number, lastGlobalIndex: number): SectionKey {
  if (s.name.startsWith("Global - ")) return "global"
  const extent = extentKm(s.bounds)
  if (extent && Math.max(extent.x, extent.y) < CITY_MAX_KM) return "city"
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
  if (/\bnDSM\b|DSM − DTM|height above ground|canopy height|elevation change|\(dh\)|\bChange:/i.test(name)) return { label: "nDSM", title: "nDSM, normalised digital surface model: DSM − DTM, the height of what stands on the ground (a CHM, canopy height model, over forest). Also used here for elevation-change grids: 0 is the ground, or no change" }
  if (/\(surface\)|\b(DSM|DOM|DMP|MNS)\b|FO_DSM|ArcticDEM|REMA|GLO-30|Amphipolis/i.test(name)) {
    return { label: "DSM", title: "Digital Surface Model: buildings and trees included" }
  }
  if (/\b(DTM|DGM\d?|DMR|MNT|MDT|MDE|DEM|CEM|3DEP|TINITALY|DEMNAS|QldDem|NSW)\b|bare-earth|ALTI|Terrain|Aguada/i.test(name)) {
    return { label: "DTM", title: "Digital Terrain Model: bare earth" }
  }
  return null
}

/**
 * The one Library dialog. Both libraries render into it: each section still
 * owns its list (its Add dialog, its STAC hand-off, its fallbacks) and
 * portals it into this box, so switching between the Terrain and Basemap
 * tabs swaps the content in place instead of closing one dialog and opening
 * another. Open while any library's atom is; closing clears them all.
 * The Vector tab's list needs no section: it is the host's own child
 * (`children`, shown while the vector library is the open one).
 * Mounted once by TerrainControlPanel.
 */
export function LibraryDialogHost({ children }: { children?: React.ReactNode }) {
  const [terrainOpen, setTerrainOpen] = useAtom(terrainLibraryOpenAtom)
  const [basemapOpen, setBasemapOpen] = useAtom(basemapLibraryOpenAtom)
  const [vectorOpen, setVectorOpen] = useAtom(vectorLibraryOpenAtom)
  // The vector list stays while the dialog fades out after a close.
  const lastVector = useRef(false)
  if (terrainOpen || basemapOpen) lastVector.current = false
  else if (vectorOpen) lastVector.current = true
  const setHost = useSetAtom(libraryDialogHostAtom)
  // The list lives in its section, so opening a library from anywhere
  // (?openLibrary=, the tour, a tab) unfolds that section to mount it.
  const setSectionOpen = useSetAtom(sectionOpenAtom)
  const setMacroGroupOpen = useSetAtom(macroGroupOpenAtom)
  useEffect(() => {
    if (!terrainOpen && !basemapOpen) return
    const key = terrainOpen ? "terrainSource" : "rasterBasemap"
    setMacroGroupOpen((p) => (p.Sources ? p : { ...p, Sources: true }))
    setSectionOpen((p) => (p[key] ? p : { ...p, [key]: true }))
  }, [terrainOpen, basemapOpen, setSectionOpen, setMacroGroupOpen])
  return (
    <Dialog open={terrainOpen || basemapOpen || vectorOpen} onOpenChange={(o) => { if (!o) { setTerrainOpen(false); setBasemapOpen(false); setVectorOpen(false) } }}>
      <DialogContent id="tour-source-library" aria-labelledby="library-dialog-title" aria-describedby="library-dialog-description" className="sm:max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* display: contents, so the portaled header, toolbar and list are
            the dialog's own flex rows (the list scrolls, the rest stays). */}
        <div ref={setHost} className="contents" />
        {lastVector.current && children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Picker for the shipped sample library. "Load Sample Sources" used to dump the
 * whole list into the user's BYOD sources in one go; with ~50 national datasets
 * that is more noise than help, so this lists them by scope and lets each be
 * added or removed individually.
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
  open, title, samples, current, setCurrent, compareToMapterhorn = false,
  stacTarget, onBrowseStac, onAdded, browseOnly = [], terrainTabAvailable = true, onZoomTo,
}: {
  /** Moves the map to a row's extent: rows that state bounds smaller than
   *  the world get a Zoom to button, as the Vector tab's rows do. */
  onZoomTo?: (source: T) => void
  open: boolean
  /** Unused since the two libraries share one dialog (LibraryDialogHost),
   *  which closes both; kept so a caller may still pass its setter. */
  onOpenChange?: (open: boolean) => void
  title: string
  samples: readonly T[]
  current: T[]
  setCurrent: (next: T[]) => void
  compareToMapterhorn?: boolean
  /** Which half of the STAC preset list the Catalogs section offers. Omit
   *  to leave the section out entirely. */
  stacTarget?: "terrain" | "basemap"
  /** Hands the chosen catalog back so the caller can close this dialog and
   *  open the Add dialog on its STAC tab. Omit and the section is read-only
   *  links. A dataset row's Browse (its `stac` field) passes its collection
   *  and asks for a search over the current view; the Catalogs section
   *  passes the catalog alone. */
  onBrowseStac?: (presetId: string, request?: BrowseStacRequest) => void
  /** Datasets with no mosaic, only a STAC collection: listed among the
   *  others with Browse in place of Add, never added, never counted. */
  browseOnly?: readonly LibraryBrowseEntry[]
  /** The entries just added (the rows clicked, not the operands a difference
   *  pulls in), for the caller to select one. */
  onAdded?: (added: readonly T[]) => void
  /** False where the sidebar has no Terrain section (historical mode): the
   *  tabs are then left out, and with them the cross-library hint. */
  terrainTabAvailable?: boolean
}) {
  // Two libraries behind two tabs, Terrain and Basemap, in one dialog
  // (LibraryDialogHost). Each library is still owned by its own section (its
  // Add dialog, its STAC hand-off, its list's fallbacks), so a tab switch
  // flips the two open atoms and unfolds the other section so its list is
  // mounted; the search carries over (libraryQueryAtom).
  const kind: LibraryKind = stacTarget === "basemap" ? "basemap" : "terrain"
  const otherKind: LibraryKind = kind === "terrain" ? "basemap" : "terrain"
  // The tabs: Terrain (where the sidebar has that section), Basemap, Vector.
  const showTabs = !!stacTarget
  const switchLibrary = useLibraryTabSwitch()
  const switchTab = (to: LibraryKind) => { if (to !== kind) switchLibrary(to) }
  const vectorOpen = useAtomValue(vectorLibraryOpenAtom)
  // Where this list shows: in the shared dialog, while this library is the
  // open one, and still after a close (the dialog fades out with its content)
  // or while the other library's list is not mounted yet (a tab switch to a
  // folded section shows this list for the frame it takes to unfold).
  const host = useAtomValue(libraryDialogHostAtom)
  const [mounted, setMounted] = useAtom(libraryMountedAtom)
  useEffect(() => {
    setMounted((p) => ({ ...p, [kind]: true }))
    return () => setMounted((p) => ({ ...p, [kind]: false }))
  }, [kind, setMounted])
  const otherOpen = useAtomValue(kind === "terrain" ? basemapLibraryOpenAtom : terrainLibraryOpenAtom)
  const shownRef = useRef(false)
  if (!host) shownRef.current = false
  if (open) shownRef.current = true
  else if (vectorOpen || (otherOpen && mounted[otherKind])) shownRef.current = false
  // Which catalogs the Add dialog's own picker offers. Stored as the
  // exclusions (see disabledStacPresetsAtom) so a catalog added in a later
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
  // Shared by both libraries, so switching tab keeps the filter.
  const [query, setQuery] = useAtom(libraryQueryAtom)
  const q = query.trim().toLowerCase()
  const hasBulk = useMemo(() => samples.some((s) => s.bulkResolutionM !== undefined), [samples])
  const browseRows = useMemo<BrowseRow[]>(() => browseOnly.map((s) => ({ ...s, browseOnly: true as const })), [browseOnly])
  const comparisons = useMemo(() => {
    const m = new Map<string, MapterhornComparison | null>()
    if (compareToMapterhorn) for (const s of [...samples, ...browseRows]) m.set(s.id, compareWithMapterhorn(s, metric))
    return m
  }, [samples, browseRows, compareToMapterhorn, metric])
  // The before and after surveys of an event ("Change:" differences), which
  // are nothing on their own: listed with their difference, not graded
  // against Mapterhorn. A national DSM behind an nDSM stays with the nationals.
  const eventOperands = useMemo(() => new Set(samples
    .filter((s) => s.type === "dem-diff" && /\bChange:/.test(s.name))
    .flatMap((s) => [(s as any).diffMinuendId, (s as any).diffSubtrahendId])
    .filter((id): id is string => typeof id === "string" && samples.some((x) => x.id === id && x.loadWithSamples === false))), [samples])
  // tier -> section -> rows. Without comparison everything sits in one tier.
  // A row with a libraryGroup goes to that group instead (`groups`).
  const { grouped, groups } = useMemo(() => {
    const out: Record<TierKey, Record<SectionKey, Array<T | BrowseRow>>> = {
      better: { national: [], global: [], regional: [], city: [] },
      derived: { national: [], global: [], regional: [], city: [] },
      notBetter: { national: [], global: [], regional: [], city: [] },
      bathy: { national: [], global: [], regional: [], city: [] },
    }
    // Browse-only rows take index -1: they are not in the file's editorial
    // order, so only their name ("Global - "), bounds and loadWithSamples
    // place them, and they sort after the mosaics of their section.
    const all = [...samples.map((s, i) => [s, i] as const), ...browseRows.map((s) => [s, -1] as const)]
    const groups = new Map<string, Array<T | BrowseRow>>()
    searchLibrary(all, ([s]) => rowText(s), q).forEach(([s, i]) => {
      if (s.libraryGroup) {
        groups.set(s.libraryGroup, [...(groups.get(s.libraryGroup) ?? []), s])
        return
      }
      const c = comparisons.get(s.id)
      const tier: TierKey = !compareToMapterhorn ? "better"
        : kindOf(s.name)?.label === "Bathy" ? "bathy"
        : s.type === "dem-diff" || eventOperands.has(s.id) ? "derived"
        : c?.verdict === "new" || c?.verdict === "finer" || c?.verdict === "bareearth" ? "better" : "notBetter"
      out[tier][sectionOf(s, i, lastGlobal)].push(s)
    })
    return { grouped: out, groups }
  }, [samples, browseRows, comparisons, compareToMapterhorn, lastGlobal, q, eventOperands])
  /** The rows that can be added: every one but the Browse-only. */
  const addable = (rows: readonly (T | BrowseRow)[]): T[] => rows.filter((s): s is T => !isBrowseRow(s))
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  // Everything is open by default EXCEPT the "not better than Mapterhorn"
  // tier. That tier is the majority of the list and, by its own definition,
  // the part you do not need: the default terrain already has the same grid or
  // finer. Leaving it expanded buried the handful of genuinely new datasets
  // under three screens of also-rans. It is one click away, and a search still
  // reaches into it.
  // ...and a live filter opens everything, or typing a name that only exists
  // in the collapsed tier would show nothing at all.
  // A thematic group (`group:<key>`) is folded unless its registry entry
  // says otherwise (lib/library-groups.ts).
  const isOpen = (k: string) => (q ? true : openSections[k] ?? (k.startsWith("group:") ? !!libraryGroup(k.slice(6)).defaultOpen : k !== "notBetter"))

  const add = (entries: readonly T[]) => {
    // A "dem-diff" entry is nothing without its two operands: add those from
    // the library too (unless already loaded), before it in the list.
    const operands = entries.flatMap((s) => [(s as any).diffMinuendId, (s as any).diffSubtrahendId].filter(Boolean) as string[])
      .filter((id, i, arr) => arr.indexOf(id) === i && !presentIds.has(id) && !entries.some((e) => e.id === id))
      .map((id) => samples.find((s) => s.id === id)).filter((s): s is T => !!s)
    const all = [...operands, ...entries]
    const ids = new Set(all.map((s) => s.id))
    setCurrent([...current.filter((s) => !ids.has(s.id)), ...all])
    onAdded?.(entries)
  }
  const remove = (entries: readonly T[]) => {
    const ids = new Set(entries.map((s) => s.id))
    setCurrent(current.filter((s) => !ids.has(s.id)))
  }
  // Catalogs are not datasets: a STAC endpoint is a search over thousands of
  // scenes, so it cannot be "added" the way a single URL can. Listing them here
  // anyway is the point - this dialog is where you look for data, and having to
  // know that per-scene DEMs live behind a tab of a different dialog is a
  // discoverability failure. The row hands you off instead of adding.
  const [savedCatalogs, setSavedCatalogs] = useAtom(savedStacCatalogsAtom)
  const [newCatalogUrl, setNewCatalogUrl] = useState("")
  const addCatalog = () => {
    const url = newCatalogUrl.trim().replace(/\/+$/, "")
    if (!url) return
    setSavedCatalogs((prev) => prev.some((c) => c.url === url) ? prev : [...prev, {
      id: `saved:${url}`,
      name: (() => { try { return new URL(url).host } catch { return url } })(),
      url,
      // A .json path is a static catalog to crawl; anything else is an API root.
      kind: /\.json($|\?)/i.test(url) ? "static" : "api",
      target: "both",
    }])
    setNewCatalogUrl("")
  }
  const catalogs = useMemo(
    () => (!stacTarget ? [] : searchLibrary([
      ...STAC_PRESETS,
      // Catalogs the visitor pasted into the search and kept. Same rows, same
      // Browse, same on/off - the only difference is where they came from.
      ...savedCatalogs.map((c) => ({ ...c, group: "Yours" as const, note: "Added by you." })),
    ].filter((p) => p.target === "both" || p.target === stacTarget), (p) => `${p.name} ${p.group} ${p.note ?? ""}`, q)),
    [stacTarget, q, savedCatalogs],
  )

  const matchCount = useMemo(() => Object.values(grouped).reduce((n, secs) => n + Object.values(secs).reduce((m, rows) => m + rows.length, 0), 0), [grouped])
  const otherCount = useMemo(() => (showTabs && terrainTabAvailable && q ? libraryMatchCount(otherKind, q) : 0), [showTabs, terrainTabAvailable, q, otherKind])
  const vectorCount = useMemo(() => (showTabs && q ? vectorLibraryMatchCount(q) : 0), [showTabs, q])

  const loadedCount = samples.filter((s) => presentIds.has(s.id)).length

  const Row = ({ s }: { s: T | BrowseRow }) => {
    const browseOnlyRow = isBrowseRow(s)
    const present = !browseOnlyRow && presentIds.has(s.id)
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
        {(s.type || browseOnlyRow) && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 w-16 text-right"
            title={browseOnlyRow ? "Strips or tiles in a STAC collection, no single mosaic: found by a search over the view" : undefined}>
            {browseOnlyRow ? "stac" : s.type}
          </span>
        )}
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
        {/* Same look as the Catalogs section's Browse; the label folds away
            on a phone, where the row is already full. */}
        {s.stac && (
          <Button variant="secondary" size="sm" className="cursor-pointer shrink-0 h-8"
            disabled={!onBrowseStac}
            aria-label={`Browse ${s.name}`}
            title={onBrowseStac ? browseTitle(s.stac) : "Catalog search is not available here"}
            onClick={() => onBrowseStac?.(s.stac!.preset, { collection: s.stac!.collection, search: true })}>
            <Search className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Browse</span>
          </Button>
        )}
        {!browseOnlyRow && onZoomTo && hasExtent(s.bounds) && (
          <Button variant="outline" size="icon-sm" className="cursor-pointer shrink-0" aria-label={`Zoom to ${s.name}`}
            title="Zoom to this source's extent" onClick={() => onZoomTo(s)}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
        {!browseOnlyRow && (
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
        )}
      </div>
    )
  }

  /** Add-all / remove-all for one group, sitting left of its chevron. They live
   *  OUTSIDE the CollapsibleTrigger (itself a button) so they neither nest
   *  buttons nor toggle the fold when clicked. */
  const GroupActions = ({ rows: all }: { rows: Array<T | BrowseRow> }) => {
    const rows = addable(all)
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

  /** "· 3/12" for the rows that can be added; Browse-only rows are not
   *  counted, since they are never in your list. */
  const countLabel = (rows: Array<T | BrowseRow>) => {
    const add = addable(rows)
    return add.length ? `· ${add.filter((s) => presentIds.has(s.id)).length}/${add.length}` : "· browse"
  }
  const Section = ({ id, title, icon: Icon, blurb, rows, level }: { id: string; title: string; icon?: LucideIcon; blurb: string; rows: Array<T | BrowseRow>; level: 1 | 2 }) => {
    return (
      <Collapsible open={isOpen(id)} onOpenChange={(o) => setOpenSections((p) => ({ ...p, [id]: o }))}>
        <div className={`flex items-center gap-1 ${level === 1 ? "border-b-2" : "border-b"}`}>
          <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 py-1 cursor-pointer text-left">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className={level === 1 ? "text-sm font-bold" : "text-sm font-semibold"}>
              {title} <span className="font-normal text-muted-foreground">{countLabel(rows)}</span>
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
                {sec.title} <span className="font-normal text-muted-foreground">{countLabel(rows)}</span>
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

  if (!host || !shownRef.current) return null
  return createPortal(
      <>
        {/* Plain elements styled as DialogHeader / Title / Description: a
            portal keeps the React context of the section it renders from,
            which has no Dialog, and Base UI's Title needs one. The host
            points aria-labelledby / -describedby at these ids. */}
        <div data-slot="dialog-header" className="flex min-w-0 flex-col gap-2 break-words text-center sm:text-left">
          <h2 id="library-dialog-title" data-slot="dialog-title" className="min-w-0 text-lg leading-none font-semibold break-words flex items-center gap-2">{title} <CopyModalLinkButton param="openLibrary" value={stacTarget === "basemap" ? "basemap" : "terrain"} label={`the ${stacTarget === "basemap" ? "Basemap" : "Terrain"} library`} /></h2>
          <p id="library-dialog-description" data-slot="dialog-description" className="text-muted-foreground min-w-0 text-sm break-words">
            {loadedCount} of {samples.length} in your list. Add or remove one at a time.
          </p>
        </div>
        {/* The tabs and the search share a row: the search on the right,
            wrapping under the tabs (full width) when the dialog is narrow.
            The resolution toggle (terrain) stays on the row below. */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 min-w-0">
          {showTabs && (
            <LibraryTabBar active={kind} terrainTab={terrainTabAvailable}
              count={(k) => (!q ? null : k === kind ? matchCount : k === "vector" ? vectorCount : otherCount)} />
          )}
          <div className={`relative min-w-0 w-full sm:w-64 ${showTabs ? "sm:ml-auto" : ""}`}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input autoFocus placeholder="Filter datasets…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8 cursor-text h-9" />
          </div>
        </div>
        {compareToMapterhorn && hasBulk && (
        <div className="flex items-center gap-2 flex-wrap">
            <div className="ml-auto flex items-center gap-1 text-xs" title="Grade by the grid the live API streams (what this viewer renders) or by the finest grid the agency advertises for bulk download (what Mapterhorn would ingest)">
              <span className="text-muted-foreground mr-1">Resolution:</span>
              <Button size="sm" variant={metric === "api" ? "secondary" : "ghost"} className="h-7 cursor-pointer" onClick={() => setMetric("api")}>API-served</Button>
              <Button size="sm" variant={metric === "bulk" ? "secondary" : "ghost"} className="h-7 cursor-pointer" onClick={() => setMetric("bulk")}>Best bulk GSD</Button>
            </div>
        </div>
        )}
        <div className="overflow-y-auto pr-1 -mr-1 space-y-4">
          {showTabs && q && matchCount <= FEW_MATCHES && otherCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-dashed px-3 py-2 text-sm min-w-0">
              <span className="min-w-0 break-words text-muted-foreground">
                {matchCount === 0 ? `No ${LIBRARY_TAB[kind].plural} match “${query.trim()}”.` : `Only ${matchCount} here.`}
              </span>
              <Button size="sm" variant="secondary" className="cursor-pointer h-8 ml-auto" onClick={() => switchTab(otherKind)}>
                {otherCount} {otherCount === 1 ? "match" : "matches"} in {LIBRARY_TAB[otherKind].button} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
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

          {usedLibraryGroups(groups.keys()).map((g) => {
            const rows = groups.get(g.key)!
            const id = `group:${g.key}`
            return (
              <div key={id} className="space-y-3">
                <Section id={id} title={g.title} icon={Mountain} blurb={g.blurb} rows={rows} level={1} />
                {isOpen(id) && <div className="pl-2 divide-y divide-border/50">{rows.map((s) => <Row key={s.id} s={s} />)}</div>}
              </div>
            )
          })}

          {catalogs.length > 0 && (
            <Collapsible open={isOpen("catalogs")} onOpenChange={(o) => setOpenSections((p) => ({ ...p, catalogs: o }))}>
              <div className="flex items-center gap-1 border-b-2">
                <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 py-1 cursor-pointer text-left">
                  <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-bold">
                    Catalogs <span className="font-normal text-muted-foreground">· {catalogs.filter((p) => !stacOff.has(p.id)).length}/{catalogs.length}</span>
                  </span>
                </CollapsibleTrigger>
                <span className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Offer every catalog"
                    disabled={catalogs.every((p) => !stacOff.has(p.id))}
                    onClick={() => setStacEnabled(catalogs.map((p) => p.id), true)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Hide every catalog"
                    disabled={catalogs.every((p) => stacOff.has(p.id))}
                    onClick={() => setStacEnabled(catalogs.map((p) => p.id), false)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </span>
                <CollapsibleTrigger className="cursor-pointer p-1">
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen("catalogs") ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <p className="text-xs text-muted-foreground pt-1">
                  Searchable archives rather than single datasets — per-scene DEMs and imagery, found by area and date.
                  <b>Browse</b> opens the catalog search with that endpoint selected; the <b>+/−</b> decides whether it
                  is offered in that search&rsquo;s own picker at all, so a list you never use can be trimmed down.
                </p>
                <div className="pl-2 divide-y divide-border/50">
                  {/* Adding one here rather than only from inside the search:
                      the Library is where you go looking for data, so "I have a
                      catalog URL" belongs in the same place as "I want one of
                      yours". */}
                  <div className="flex items-center gap-2 py-1">
                    <Input
                      value={newCatalogUrl}
                      onChange={(e) => setNewCatalogUrl(e.target.value)}
                      placeholder="Add a catalog: https://…/v1 or https://…/catalog.json"
                      className="cursor-text h-8 flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter") addCatalog() }}
                    />
                    <Button
                      variant="secondary" size="sm" className="cursor-pointer shrink-0 h-8"
                      disabled={!newCatalogUrl.trim()}
                      onClick={addCatalog}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                  {/* Split so a catalog you saved is not lost among the
                      shipped ones - the Library is "ours" by default, and this
                      is the one part of it that is yours. */}
                  {(["shipped", "yours"] as const).flatMap((bucket) => {
                    const rows = catalogs.filter((p) => (bucket === "yours") === (p.group === "Yours"))
                    if (!rows.length) return []
                    return [
                      <p key={`h-${bucket}`} className="pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">
                        {bucket === "yours" ? "Yours" : "Included"}
                      </p>,
                      ...rows.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 min-w-0 py-1">
                      <span className="flex-1 min-w-0 text-sm truncate" title={p.note ?? p.name}>{p.name}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-sky-500/15 text-sky-700 dark:text-sky-300">
                        {p.group}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 w-16 text-right">{p.kind}</span>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" title="Catalog endpoint"
                        className="shrink-0 text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <Button variant="secondary" size="sm" className="cursor-pointer shrink-0 h-8"
                        disabled={!onBrowseStac}
                        title={onBrowseStac ? `Search ${p.name} over the current view` : "Catalog search is off (Settings → Beta)"}
                        onClick={() => onBrowseStac?.(p.id)}>
                        <Search className="h-3.5 w-3.5" /> Browse
                      </Button>
                      <Button
                        variant={stacOff.has(p.id) ? "secondary" : "outline"}
                        size="icon-sm"
                        className="cursor-pointer shrink-0"
                        aria-label={stacOff.has(p.id) ? `Offer ${p.name} in the catalog picker` : `Hide ${p.name} from the catalog picker`}
                        title={stacOff.has(p.id) ? "Hidden from the catalog picker — click to offer it" : "Offered in the catalog picker — click to hide it"}
                        onClick={() => setStacEnabled([p.id], stacOff.has(p.id))}
                      >
                        {stacOff.has(p.id) ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      </Button>
                    </div>
                      )),
                    ]
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </>,
      host,
  )
}
