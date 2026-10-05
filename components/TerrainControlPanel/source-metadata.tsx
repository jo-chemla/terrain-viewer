// Everything a custom source carries, as rows: for the row's info button
// (edit mode off) and for Source info's active basemaps. Nothing is hidden:
// a field the source has is a field shown, URLs as links.
import type React from "react"
import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MapPin } from "lucide-react"
import { sourceGsd, gsdText } from "@/lib/gsd"

const LABELS: Record<string, string> = {
  name: "Name", type: "Type", url: "URL", description: "Description", role: "Role", stack: "Stack", provider: "Provider",
  resolutionM: "Resolution (m)", bulkResolutionM: "Bulk resolution (m)", maxzoom: "Max zoom", minzoom: "Min zoom", tileSize: "Tile size",
  bounds: "Extent (W, S, E, N)", infoUrl: "Page", licenseUrl: "Licence", attribution: "Attribution", opacity: "Opacity (%)",
  encoding: "Encoding", scheme: "Scheme", cogViaTitiler: "Through TiTiler", nodataFloor: "Nodata floor", nodataFill: "Nodata fill",
  linkedTerrainId: "Linked terrain", linkedBasemapId: "Linked basemap", diffMinuendId: "Difference: minuend", diffSubtrahendId: "Difference: subtrahend",
  transient: "Transient (from a timeline pick)", loadWithSamples: "In the library sample set", coordinates: "Image corners", georef: "Georeference",
}
const SKIP = new Set(["id"])
const isUrl = (v: unknown) => typeof v === "string" && /^https?:\/\//.test(v)

export const SourceMetadataRows: React.FC<{ source: Record<string, any>; className?: string }> = ({ source, className }) => {
  const keys = Object.keys(source).filter((k) => !SKIP.has(k) && source[k] !== undefined && source[k] !== null && source[k] !== "")
  const gsd = sourceGsd(source)
  return (
    <dl className={className ?? "grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"}>
      {gsd && (
        <div className="contents">
          <dt className="text-muted-foreground">Ground resolution</dt>
          <dd className="min-w-0 break-words">{gsdText(gsd)}{gsd.estimated ? " — estimated from the max zoom" : ""}</dd>
        </div>
      )}
      {keys.map((k) => {
        const v = source[k]
        const text = Array.isArray(v) ? v.map((x) => (typeof x === "number" ? +x.toFixed(5) : x)).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)
        return (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{LABELS[k] ?? k}</dt>
            <dd className="min-w-0 break-all">{isUrl(v) ? <a href={v} target="_blank" rel="noopener noreferrer" className="underline">{v}</a> : text}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/** The details dialog behind a source row's info button. */
export const SourceMetadataDialog: React.FC<{
  source: Record<string, any> | null
  onClose: () => void
  onFit?: (source: any) => void
}> = ({ source, onClose, onFit }) => (
  <Dialog open={!!source} onOpenChange={(o) => { if (!o) onClose() }}>
    <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto overflow-x-hidden">
      <DialogHeader>
        <DialogTitle className="truncate">{source?.name ?? "Source"}</DialogTitle>
        <DialogDescription>Everything this source carries. Switch the sources' edit mode on to change it.</DialogDescription>
      </DialogHeader>
      {source && <SourceMetadataRows source={source} />}
      {source && onFit && (source.bounds || ["cog", "cog-local", "vrt", "tilejson"].includes(source.type)) && (
        <Button size="sm" variant="outline" className="cursor-pointer self-start" onClick={() => { onFit(source); onClose() }}><MapPin className="h-3.5 w-3.5 mr-1" />Fit to its extent</Button>
      )}
    </DialogContent>
  </Dialog>
)

/** State helper: which source's dialog is open. */
export function useSourceInfoDialog() {
  const [infoId, setInfoId] = useState<string | null>(null)
  return { infoId, open: (id: string) => setInfoId(id), close: () => setInfoId(null) }
}
