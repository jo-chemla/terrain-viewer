// The "Vector overlays" list of the Bring Your Own Data section: the
// Library's vector sources listed by the Library dialog's Vector tab
// (vector-library-panel.tsx) and your own (Add vector: a PMTiles archive, a
// TileJSON, a tile template, a MapLibre style, a GeoJSON, KML or GPX file,
// read by lib/vector-source-detect.ts), each with its switch (one per view
// in a split), its opacity, a Zoom to button and a settings popover (color
// with transparency, point size, outlines, legend, credit, and Remove for
// your own).
import type React from "react"
import { useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import type { MapRef } from "react-map-gl/maplibre"
import { ChevronDown, ExternalLink, Library, Maximize2, Plus, Settings2, Shapes, Trash2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { OpacityPill } from "@/components/ui/opacity-pill"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { VIEW_IDS, type ViewId } from "@/lib/grid-layouts"
import { activeViewAtom, byodVectorOverlaysOpenAtom, customVectorSourcesAtom, vectorLibraryIdsAtom, vectorLibraryOpenAtom, vectorOverlaySharedAtom, vectorOverlayStylesAtom } from "@/lib/settings-atoms"
import type { VectorSourceEntry } from "@/lib/source-schema"
import { allVectorSources, drawsPoints, hasCategories, POINT_RADIUS_MAX, POINT_RADIUS_MIN, splitAlpha, VECTOR_FOOTPRINT_MINZOOM, vectorLegend, vectorStyleOf, vectorZoomTarget, withAlpha, type VectorOverlayStyle, type VectorSharedStyle } from "@/lib/vector-sources"
import { detectVectorSource, heightFieldsOf, type DetectedVectorSource } from "@/lib/vector-source-detect"
import { GroupHeading, SourceGridToggle, TooltipButton } from "./controls-components"
import { ColorAlphaSwatch } from "./color-picker"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { vectorOverlayField as fieldOf, zoomToVectorSource } from "./vector-library-panel"

export const VectorOverlaysSection: React.FC<{ state: any; setState: (updates: any) => void; mapRef?: React.RefObject<MapRef | null> }> = ({ state, setState, mapRef }) => {
  const [open, setOpen] = useAtom(byodVectorOverlaysOpenAtom)
  const [styles, setStyles] = useAtom(vectorOverlayStylesAtom)
  const activeView = useAtomValue(activeViewAtom)
  const [customs, setCustoms] = useAtom(customVectorSourcesAtom)
  const [adding, setAdding] = useState(false)
  const openLibrary = useSetAtom(vectorLibraryOpenAtom)
  const [shared, setShared] = useAtom(vectorOverlaySharedAtom)
  const libraryIds = useAtomValue(vectorLibraryIdsAtom)
  const everySource = allVectorSources(customs)
  const perView = !!state.basemapPerView && state.splitStyle !== "off"
  const idsOf = (side: ViewId): string[] => state[fieldOf(side)] || []
  const toggle = (side: ViewId, id: string) => {
    const current = idsOf(side)
    setState({ [fieldOf(side)]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
  }
  const patch = (id: string, change: Partial<VectorOverlayStyle>) => setStyles((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }))
  // Listed: the Library entries ticked in the Vector library, your own, and
  // whatever a view shows (a link can switch on one that is not ticked).
  const onAnyView = (id: string) => VIEW_IDS.some((side) => idsOf(side).includes(id))
  const sources = everySource.filter((s) => s.section === "custom" || libraryIds.includes(s.id) || onAnyView(s.id))
  const active = sources.filter((s) => idsOf("A").includes(s.id)).length
  const shown = sources.filter((s) => onAnyView(s.id) && s.type !== "style")
  const anyHeight = sources.some((s) => !!s.heightField)
  const add = (entry: VectorSourceEntry) => {
    setCustoms((prev) => [...prev.filter((s) => s.id !== entry.id), entry])
    if (!idsOf("A").includes(entry.id)) toggle("A", entry.id)
  }
  // Removed from the list and from every view that showed it.
  const remove = (id: string) => {
    setCustoms((prev) => prev.filter((s) => s.id !== id))
    const updates: Record<string, string[]> = {}
    for (const side of VIEW_IDS) if (idsOf(side).includes(id)) updates[fieldOf(side)] = idsOf(side).filter((x) => x !== id)
    if (Object.keys(updates).length) setState(updates)
  }

  return (
    <div className="space-y-2 pt-2 mt-2 border-t">
      <button type="button" className="flex items-center gap-1 w-full cursor-pointer text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <Shapes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <GroupHeading>Vector overlays</GroupHeading>
        {!open && <span className="text-[10px] text-muted-foreground tabular-nums ml-1">{active}/{sources.length}</span>}
      </button>
      {open && (
        <>
          {/* Shared by every vector overlay: footprints or 3D, and what
              colors them. A source that has no height or no category
              falls back to what it has. */}
          <div className="flex items-center gap-2 min-w-0">
            {anyHeight && (
              <Select value={shared.mode} items={{ flat: "Footprints", "3d": "3D, by height" }} onValueChange={(v) => v && setShared({ ...shared, mode: v as VectorSharedStyle["mode"] })}>
                <SelectTrigger className="h-7 flex-1 min-w-0 text-xs" title="Draw every vector overlay flat or extruded by its height"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Footprints</SelectItem>
                  <SelectItem value="3d">3D, by height</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={shared.colorBy} items={{ auto: "Color by category", single: "One color each", height: "Color by height" }} onValueChange={(v) => v && setShared({ ...shared, colorBy: v as VectorSharedStyle["colorBy"] })}>
              <SelectTrigger className="h-7 flex-1 min-w-0 text-xs" title="What colors every vector overlay"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto"><span className="block">Color by category</span><span className="block text-[10px] text-muted-foreground">Origin, kind or condition, where a source has one</span></SelectItem>
                <SelectItem value="single"><span className="block">One color each</span><span className="block text-[10px] text-muted-foreground">Each source in its own color</span></SelectItem>
                <SelectItem value="height"><span className="block">Color by height</span><span className="block text-[10px] text-muted-foreground">Where a source has heights</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(state.zoom ?? 0) < VECTOR_FOOTPRINT_MINZOOM && shown.some((s) => s.section !== "custom" && s.libraryGroup === "buildings") && (
            <p className="text-[11px] text-muted-foreground">Building footprints draw from zoom {VECTOR_FOOTPRINT_MINZOOM}: zoom in to see them.</p>
          )}
          {sources.map((source) => {
            const style = vectorStyleOf(source, styles[source.id], shared)
            return (
              <div key={source.id} className="flex items-center gap-2 min-w-0">
                {perView ? (
                  <SourceGridToggle
                    gridLayout={state.splitStyle === "overlay" ? "2x1" : state.gridLayout}
                    isActive={(side: ViewId) => idsOf(side).includes(source.id)}
                    onSelect={(side: ViewId) => toggle(side, source.id)}
                    allowUnpress
                    onlySide={activeView}
                  />
                ) : (
                  <Checkbox checked={idsOf("A").includes(source.id)} onCheckedChange={() => toggle("A", source.id)} className="cursor-pointer shrink-0" />
                )}
                <OpacityPill value={style.opacity} onChange={(v) => patch(source.id, { opacity: v })} title="This overlay's opacity" />
                <span className="flex-1 min-w-0 truncate text-sm cursor-pointer" title={source.name} onClick={() => (perView ? undefined : toggle("A", source.id))}>
                  {source.shortName ?? source.name}
                </span>
                {mapRef && vectorZoomTarget(source) && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 cursor-pointer" aria-label={`Zoom to ${source.shortName ?? source.name}`}
                    title={source.bounds ? "Zoom to this source's extent" : "Zoom to a place that shows this source"}
                    onClick={() => zoomToVectorSource(mapRef.current, source)}>
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <VectorOverlaySettings source={source} style={style} onChange={(change) => patch(source.id, change)} onRemove={source.section === "custom" ? () => remove(source.id) : undefined} />
              </div>
            )
          })}
          <TooltipProvider>
            <div className="flex gap-2 min-w-0">
              <TooltipButton icon={Library} label="Vector library" className="flex-1 min-w-0"
                tooltip="Buildings, heritage sites and monuments, land use and land cover, reference layers: the Vector tab of the Library"
                onClick={() => openLibrary(true)} />
              <TooltipButton icon={Plus} label="Add vector" className="flex-1 min-w-0"
                tooltip="A PMTiles archive, a TileJSON, a {z}/{x}/{y} vector tile template, a MapLibre style, or a GeoJSON, KML or GPX file"
                onClick={() => setAdding(true)} />
            </div>
          </TooltipProvider>
        </>
      )}
      <AddVectorSourceDialog open={adding} onOpenChange={setAdding} onAdd={add} taken={(id) => everySource.some((s) => s.id === id && s.section !== "custom")} />
    </div>
  )
}

/** Add a vector source of your own: paste its address, Read finds what it
 *  is and which layers it declares, Add saves it and switches it on. */
const AddVectorSourceDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; onAdd: (entry: VectorSourceEntry) => void; taken: (id: string) => boolean }> = ({ open, onOpenChange, onAdd, taken }) => {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<DetectedVectorSource | null>(null)
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [typed, setTyped] = useState("")
  const reset = () => { setUrl(""); setBusy(false); setError(null); setFound(null); setName(""); setPicked([]); setTyped("") }
  const read = async () => {
    setBusy(true); setError(null); setFound(null)
    try {
      const d = await detectVectorSource(url)
      setFound(d); setName(d.entry.name); setPicked(d.layers.map((l) => l.id)); setTyped("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "The address could not be read.")
    } finally { setBusy(false) }
  }
  const isStyle = found?.entry.type === "style" || found?.entry.type === "geojson"
  const layerNames = found ? (found.layers.length ? picked : typed.split(",").map((t) => t.trim()).filter(Boolean)) : []
  const canAdd = !!found && (isStyle || layerNames.length > 0) && !taken(found.entry.id)
  const save = () => {
    if (!found || !canAdd) return
    const chosen = found.layers.filter((l) => layerNames.includes(l.id))
    const { heightField: _h, minHeightField: _m, floorsField: _f, ...rest } = found.entry
    onAdd({ ...rest, name: name.trim() || found.entry.name, ...(isStyle ? {} : { sourceLayers: layerNames, ...heightFieldsOf(chosen) }) })
    reset(); onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a vector source</DialogTitle>
          <DialogDescription>
            The address of a PMTiles archive of vector tiles, a TileJSON, a {"{z}/{x}/{y}"} vector tile template, a MapLibre style (drawn with its own layers; its sources may be PMTiles), or a GeoJSON, KML or GPX file of 10 MB at most. The host must allow requests from other sites (CORS).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          <div className="flex gap-2 min-w-0">
            <Input value={url} onChange={(e) => { setUrl(e.target.value); setFound(null); setError(null) }} onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !busy) read() }} placeholder="https://example.com/buildings.pmtiles" className="flex-1 min-w-0" aria-label="Address" />
            <Button variant="outline" className="shrink-0 cursor-pointer" disabled={!url.trim() || busy} onClick={read}>{busy ? "Reading…" : "Read"}</Button>
          </div>
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
          {found && (
            <>
              <p className="text-xs text-muted-foreground break-words">
                {found.label}{found.entry.maxzoom !== undefined ? `, zoom ${found.entry.minzoom ?? 0} to ${found.entry.maxzoom}` : ""}{found.entry.heightField ? `, heights in "${found.entry.heightField}"` : ""}.{found.note ? ` ${found.note}` : ""}
              </p>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="min-w-0" aria-label="Name" />
              {!isStyle && found.layers.length > 0 && (
                <div className="max-h-44 overflow-y-auto space-y-1 rounded-md border p-2">
                  {found.layers.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-xs cursor-pointer min-w-0">
                      <Checkbox checked={picked.includes(l.id)} onCheckedChange={(c) => setPicked((p) => (c === true ? [...p, l.id] : p.filter((x) => x !== l.id)))} className="cursor-pointer shrink-0" />
                      <span className="truncate" title={l.fields.length ? `${l.id}: ${l.fields.join(", ")}` : l.id}>{l.id}</span>
                    </label>
                  ))}
                </div>
              )}
              {!isStyle && found.layers.length === 0 && (
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Layer names, comma-separated (building, road)" className="min-w-0" aria-label="Layer names" />
              )}
              {taken(found.entry.id) && <p className="text-xs text-destructive">This address is already in the Library's list.</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={() => { reset(); onOpenChange(false) }}>Cancel</Button>
          <Button className="cursor-pointer" disabled={!canAdd} onClick={save}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const VectorOverlaySettings: React.FC<{ source: VectorSourceEntry; style: VectorOverlayStyle; onChange: (change: Partial<VectorOverlayStyle>) => void; onRemove?: () => void }> = ({ source, style, onChange, onRemove }) => {
  const styled = source.type !== "style"
  const legend = vectorLegend(source, style)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" title="Style, legend and credit" aria-label={`${source.shortName ?? source.name}: style and credit`}>
            <Settings2 className="h-4 w-4" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3 space-y-2.5 text-xs">
        <p className="font-medium text-sm break-words">{source.name}</p>
        {styled && style.colorBy === "single" && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0 w-16">Color</span>
            {/* One opacity per overlay: the picker's transparency and the
                row's pill are the same number. */}
            <ColorAlphaSwatch title="This overlay's color and opacity" size="h-7 w-7" className="rounded border-0"
              color={withAlpha(style.color, style.opacity)}
              onChange={(hex) => onChange(splitAlpha(hex))} />
            <span className="text-muted-foreground tabular-nums">{Math.round(style.opacity * 100)} %</span>
          </div>
        )}
        {styled && style.colorBy === "source" && hasCategories(source) && (
          <p className="text-muted-foreground">Colored by {(source.categoryLabel ?? "origin").toLowerCase()}.</p>
        )}
        {styled && drawsPoints(source) && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0 w-16">Point size</span>
            <Slider className="flex-1 min-w-0" aria-label="Point size" min={POINT_RADIUS_MIN} max={POINT_RADIUS_MAX} step={0.5}
              value={style.pointRadius} onValueChange={(v) => onChange({ pointRadius: v as number })} />
            <span className="text-muted-foreground tabular-nums shrink-0 w-10 text-right" title="Radius of a point at zoom 16 and beyond; smaller when zoomed out">{style.pointRadius} px</span>
          </div>
        )}
        {styled && (
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={style.outline} onCheckedChange={(c) => onChange({ outline: c === true })} className="cursor-pointer" />
            <span>Outlines</span>
          </label>
        )}
        {legend.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {legend.map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1 min-w-0">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0 border border-black/20" style={{ background: color }} />
                <span className="truncate">{label}</span>
              </span>
            ))}
          </div>
        )}
        {source.description && <p className="text-muted-foreground break-words">{source.description}</p>}
        <p className="text-muted-foreground break-words">
          {source.licenseName && (source.licenseUrl
            ? <a href={source.licenseUrl} target="_blank" rel="noreferrer" className="underline">{source.licenseName}</a>
            : source.licenseName)}
          {source.licenseName && source.attribution ? ". " : ""}{source.attribution}
        </p>
        {onRemove && <p className="text-muted-foreground break-all">{source.url}</p>}
        {onRemove && (
          <Button variant="outline" size="sm" className="cursor-pointer bg-transparent text-destructive" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" /> Remove from my list
          </Button>
        )}
        {source.infoUrl && (
          <a href={source.infoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            About this dataset <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </PopoverContent>
    </Popover>
  )
}
