// The Vector tab of the Library dialog (LibraryDialogHost in
// sample-sources-modal.tsx): the Library's vector sources
// (SAMPLE_VECTOR_SOURCES, lib/vector-sources.ts) by group, with the same
// header, tabs, search and rows as the Terrain and Basemap tabs. A row's plus
// lists the source under Vector overlays in the sidebar, where it is switched
// on per view. Adding one row also switches it on in the current view (the
// selected view of a split with per-view basemaps, else view A, which every
// view follows); removing switches it off everywhere. A row with a place to
// go offers Zoom to.
//
// Unlike the two tile libraries, this list belongs to no sidebar section: it
// reads and writes atoms only, so the host renders it directly.
import type React from "react"
import { useMemo, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import type { MapRef } from "react-map-gl/maplibre"
import { ChevronDown, ExternalLink, Maximize2, Minus, Plus, Search, Shapes } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { activeViewAtom, libraryQueryAtom, vectorLibraryIdsAtom } from "@/lib/settings-atoms"
import { VIEW_IDS, type ViewId } from "@/lib/grid-layouts"
import { searchLibrary } from "@/lib/library-search"
import type { VectorSourceEntry } from "@/lib/source-schema"
import { VECTOR_LIBRARY, vectorLibraryGroups, vectorSearchText, vectorZoomTarget } from "@/lib/vector-sources"
import { CopyModalLinkButton } from "./controls-components"
import { LibraryTabBar, libraryMatchCount } from "./sample-sources-modal"

/** What a row says its tiles are. */
const TRANSPORT: Record<VectorSourceEntry["type"], string> = { pmtiles: "pmtiles", mvt: "mvt", tilejson: "tilejson", style: "style", geojson: "geojson" }

/** Moves a map to a source: its bounds, else the place it names as a sample. */
export function zoomToVectorSource(map: MapRef | null | undefined, entry: VectorSourceEntry): boolean {
  const target = vectorZoomTarget(entry)
  const m = map?.getMap()
  if (!target || !m) return false
  if ("bounds" in target) m.fitBounds([[target.bounds[0], target.bounds[1]], [target.bounds[2], target.bounds[3]]], { padding: 40, duration: 800 })
  else m.flyTo({ center: target.center, zoom: Math.max(target.zoom, entry.minzoom ?? 0), duration: 1200 })
  return true
}

/** The URL field of a view's vector overlays. */
export const vectorOverlayField = (side: ViewId) => (side === "A" ? "vectorOverlayIds" : `vectorOverlayIds${side}`)

export const VectorLibraryPanel: React.FC<{ mapRef: React.RefObject<MapRef | null>; terrainTab?: boolean; state?: any; setState?: (updates: any) => void }> = ({ mapRef, terrainTab = true, state, setState }) => {
  const [listed, setListed] = useAtom(vectorLibraryIdsAtom)
  const activeView = useAtomValue(activeViewAtom)
  const [query, setQuery] = useAtom(libraryQueryAtom)
  const q = query.trim().toLowerCase()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const isOpen = (k: string) => (q ? true : openSections[k] ?? true)
  const present = useMemo(() => new Set(listed), [listed])
  const matches = useMemo(() => searchLibrary(VECTOR_LIBRARY, vectorSearchText, q), [q])
  const groups = useMemo(() => vectorLibraryGroups(matches), [matches])
  const idsOf = (side: ViewId): string[] => state?.[vectorOverlayField(side)] || []
  // One row added: listed and switched on in the current view. A whole group
  // (the header's plus) is only listed: land cover over buildings over
  // heritage at once is nobody's intent.
  const add = (rows: readonly VectorSourceEntry[], show = false) => {
    setListed((prev) => [...prev, ...rows.map((s) => s.id).filter((id) => !prev.includes(id))])
    if (!show || !state || !setState) return
    const side: ViewId = state.basemapPerView && state.splitStyle !== "off" ? activeView ?? "A" : "A"
    const missing = rows.map((s) => s.id).filter((id) => !idsOf(side).includes(id))
    if (missing.length) setState({ [vectorOverlayField(side)]: [...idsOf(side), ...missing] })
  }
  // Off the list and off every view: a source a view still shows stays
  // listed, so the minus would otherwise seem to do nothing.
  const remove = (rows: readonly VectorSourceEntry[]) => {
    setListed((prev) => prev.filter((id) => !rows.some((s) => s.id === id)))
    if (!state || !setState) return
    const gone = new Set(rows.map((s) => s.id))
    const updates: Record<string, string[]> = {}
    for (const side of VIEW_IDS) if (idsOf(side).some((id) => gone.has(id))) updates[vectorOverlayField(side)] = idsOf(side).filter((id) => !gone.has(id))
    if (Object.keys(updates).length) setState(updates)
  }
  const loadedCount = VECTOR_LIBRARY.filter((s) => present.has(s.id)).length

  return (
    <>
      <div data-slot="dialog-header" className="flex min-w-0 flex-col gap-2 break-words text-center sm:text-left">
        <h2 id="library-dialog-title" data-slot="dialog-title" className="min-w-0 text-lg leading-none font-semibold break-words flex items-center gap-2">
          Vector library <CopyModalLinkButton param="openLibrary" value="vector" label="the Vector library" />
        </h2>
        <p id="library-dialog-description" data-slot="dialog-description" className="text-muted-foreground min-w-0 text-sm break-words">
          {loadedCount} of {VECTOR_LIBRARY.length} in your list. Add one to list it under Vector overlays and switch it on in the current view.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 min-w-0">
        <LibraryTabBar active="vector" terrainTab={terrainTab}
          count={(k) => (!q ? null : k === "vector" ? matches.length : libraryMatchCount(k, q))} />
        <div className="relative min-w-0 w-full sm:w-64 sm:ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input autoFocus placeholder="Filter datasets…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8 cursor-text h-9" />
        </div>
      </div>
      <div className="overflow-y-auto pr-1 -mr-1 space-y-4 min-w-0">
        {groups.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground break-words">No vector sources match “{query.trim()}”.</p>
        )}
        {groups.map((g) => {
          const id = `vector:${g.key}`
          const loaded = g.rows.filter((s) => present.has(s.id)).length
          return (
            <div key={id} className="space-y-1 min-w-0">
              <Collapsible open={isOpen(id)} onOpenChange={(o) => setOpenSections((p) => ({ ...p, [id]: o }))}>
                <div className="flex items-center gap-1 border-b-2">
                  <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 min-w-0 py-1 cursor-pointer text-left">
                    <Shapes className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-bold min-w-0 break-words">
                      {g.title} <span className="font-normal text-muted-foreground">· {loaded}/{g.rows.length}</span>
                    </span>
                  </CollapsibleTrigger>
                  <span className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Add every source in this group to your list (not switched on)" disabled={loaded === g.rows.length} onClick={() => add(g.rows)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="cursor-pointer h-7 w-7" title="Remove every source in this group" disabled={loaded === 0} onClick={() => remove(g.rows)}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                  <CollapsibleTrigger className="cursor-pointer p-1">
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen(id) ? "rotate-180" : ""}`} />
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  {g.blurb && <p className="text-xs text-muted-foreground pt-1 break-words">{g.blurb}</p>}
                </CollapsibleContent>
              </Collapsible>
              {isOpen(id) && (
                <div className="pl-2 divide-y divide-border/50 min-w-0">
                  {g.rows.map((s) => {
                    const on = present.has(s.id)
                    const canZoom = !!vectorZoomTarget(s)
                    return (
                      <div key={s.id} className="py-1 min-w-0" data-vector-library-row={s.id}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex-1 min-w-0 text-sm truncate" title={s.name}>{s.name}</span>
                          {s.licenseName && <span className="hidden sm:inline text-[10px] text-muted-foreground shrink-0 max-w-40 truncate" title={s.licenseName}>{s.licenseName}</span>}
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 w-16 text-right">{TRANSPORT[s.type]}</span>
                          {s.infoUrl && (
                            <a href={s.infoUrl} target="_blank" rel="noopener noreferrer" title="Dataset page (licence, viewer)" className="shrink-0 text-muted-foreground hover:text-foreground">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {canZoom && (
                            <Button variant="outline" size="icon-sm" className="cursor-pointer shrink-0" aria-label={`Zoom to ${s.name}`}
                              title={s.bounds ? "Zoom to this source's extent" : "Zoom to a place that shows this source"}
                              onClick={() => zoomToVectorSource(mapRef.current, s)}>
                              <Maximize2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant={on ? "outline" : "secondary"} size="icon-sm" className="cursor-pointer shrink-0"
                            aria-label={on ? `Remove ${s.name}` : `Add ${s.name}`}
                            title={on ? "Remove from your Vector overlays list, and from the views showing it" : "Add to your Vector overlays list and switch it on"}
                            onClick={() => (on ? remove([s]) : add([s], true))}>
                            {on ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          </Button>
                        </div>
                        {s.description && <p className="text-xs text-muted-foreground break-words line-clamp-2" title={s.description}>{s.description}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
