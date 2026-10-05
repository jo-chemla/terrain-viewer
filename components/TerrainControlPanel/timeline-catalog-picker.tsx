// The timeline's "Catalogs" select: the historical catalogs tree
// (historical-catalog-tree.tsx, the same tree the Sources Coverage section
// shows under Basemaps · Historical) in a popover.
import type React from "react"
import { useState } from "react"
import { useAtomValue } from "jotai"
import { ChevronDown, Loader2, Library } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { catalogStatusAtom } from "@/lib/timeline-catalogs"
import { HistoricalCatalogTree } from "./historical-catalog-tree"

export const TimelineCatalogPicker: React.FC<{
  selected: string[]
  onChange: (ids: string[]) => void
  /** The view centre [lng, lat], to tell which regional sources cover it. */
  center?: [number, number]
}> = ({ selected, onChange, center }) => {
  const [open, setOpen] = useState(false)
  const { loading } = useAtomValue(catalogStatusAtom)
  const anyLoading = selected.some((id) => loading[id])
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
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-1rem)] p-2 max-h-[min(54rem,calc(100vh-7rem))] overflow-y-auto">
        <HistoricalCatalogTree selected={selected} onChange={onChange} center={center} />
      </PopoverContent>
    </Popover>
  )
}
