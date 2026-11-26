// The "Vector overlays" list of the Bring Your Own Data section: the
// Library's vector sources (lib/vector-sources.ts: Overture, VIDA and OSM
// building footprints, OSM roads and labels), each with its switch (one per
// view in a split), its opacity and a settings popover (flat or 3D, color
// by, color, outlines, legend, credit). No list of your own yet: the rows
// are the Library's entries, switched on in place.
import type React from "react"
import { useAtom, useAtomValue } from "jotai"
import { ChevronDown, ExternalLink, Settings2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { OpacityPill } from "@/components/ui/opacity-pill"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { VIEW_IDS, type ViewId } from "@/lib/grid-layouts"
import { activeViewAtom, byodVectorOverlaysOpenAtom, vectorOverlayStylesAtom } from "@/lib/settings-atoms"
import type { VectorSourceEntry } from "@/lib/source-schema"
import { VECTOR_LIBRARY, VECTOR_FOOTPRINT_MINZOOM, vectorLegend, vectorStyleOf, type VectorOverlayStyle } from "@/lib/vector-sources"
import { GroupHeading, SourceGridToggle } from "./controls-components"

const fieldOf = (side: ViewId) => (side === "A" ? "vectorOverlayIds" : `vectorOverlayIds${side}`)

export const VectorOverlaysSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [open, setOpen] = useAtom(byodVectorOverlaysOpenAtom)
  const [styles, setStyles] = useAtom(vectorOverlayStylesAtom)
  const activeView = useAtomValue(activeViewAtom)
  const perView = !!state.basemapPerView && state.splitStyle !== "off"
  const idsOf = (side: ViewId): string[] => state[fieldOf(side)] || []
  const toggle = (side: ViewId, id: string) => {
    const current = idsOf(side)
    setState({ [fieldOf(side)]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
  }
  const patch = (id: string, change: Partial<VectorOverlayStyle>) => setStyles((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }))
  const active = VECTOR_LIBRARY.filter((s) => idsOf("A").includes(s.id)).length
  if (VECTOR_LIBRARY.length === 0) return null

  return (
    <div className="space-y-2 pt-2 mt-2 border-t">
      <button type="button" className="flex items-center gap-1 w-full cursor-pointer text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <GroupHeading>Vector overlays</GroupHeading>
        {!open && <span className="text-[10px] text-muted-foreground tabular-nums ml-1">{active}/{VECTOR_LIBRARY.length}</span>}
      </button>
      {open && (
        <>
          {(state.zoom ?? 0) < VECTOR_FOOTPRINT_MINZOOM && VECTOR_LIBRARY.some((s) => s.type !== "style" && (perView ? VIEW_IDS : (["A"] as ViewId[])).some((side) => idsOf(side).includes(s.id))) && (
            <p className="text-[11px] text-muted-foreground">Footprints draw from zoom {VECTOR_FOOTPRINT_MINZOOM}: zoom in to see them.</p>
          )}
          {VECTOR_LIBRARY.map((source) => {
            const style = vectorStyleOf(source, styles[source.id])
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
                <VectorOverlaySettings source={source} style={style} onChange={(change) => patch(source.id, change)} />
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

const VectorOverlaySettings: React.FC<{ source: VectorSourceEntry; style: VectorOverlayStyle; onChange: (change: Partial<VectorOverlayStyle>) => void }> = ({ source, style, onChange }) => {
  const styled = source.type !== "style"
  const colorByItems: Record<string, string> = { single: "One color", ...(source.sourceField ? { source: "Origin" } : {}), ...(source.heightField ? { height: "Height" } : {}) }
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
        {styled && source.heightField && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0 w-16">Draw as</span>
            <Select value={style.mode} items={{ flat: "Footprints", "3d": "3D, by height" }} onValueChange={(v) => v && onChange({ mode: v as VectorOverlayStyle["mode"] })}>
              <SelectTrigger className="h-7 flex-1 min-w-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Footprints</SelectItem>
                <SelectItem value="3d">3D, by height</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {styled && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0 w-16">Color by</span>
            <Select value={style.colorBy} items={colorByItems} onValueChange={(v) => v && onChange({ colorBy: v as VectorOverlayStyle["colorBy"] })}>
              <SelectTrigger className="h-7 flex-1 min-w-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(colorByItems).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <input type="color" value={style.color} onChange={(e) => onChange({ color: e.target.value })} title={style.colorBy === "single" ? "Fill color" : "Color of a feature with no listed origin"} className="h-7 w-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
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
        {source.infoUrl && (
          <a href={source.infoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            About this dataset <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </PopoverContent>
    </Popover>
  )
}
