// Everything a custom source carries, as rows: for the row's info button
// (edit mode off) and for Source info's active basemaps. Nothing is hidden:
// a field the source has is a field shown, URLs as links.
import type React from "react"
import { useEffect, useState } from "react"
import { useAtomValue } from "jotai"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MapPin } from "lucide-react"
import { sourceGsd, gsdText } from "@/lib/gsd"
import { titilerEndpointAtom, useCogProtocolVsTitilerAtom } from "@/lib/settings-atoms"
import { TITILER_CACHE_KEY } from "@/lib/titiler-health"
import { getRegisteredLocalFile, isLocalFileUrl, localFileId } from "@/lib/local-file-store"

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

// What the raster file says about itself, beyond the source record: its
// size in pixels and its CRS (Jonathan, 2026-10-12: "under GSD, the raster
// size NX x NY, and the CRS if fetchable"). A file titiler serves (a pinned
// COG, a VRT, or every COG while the protocol setting is titiler) answers
// through /cog/info (width, height, crs as an OGC URI); the others through
// the file's own header with geotiff.js: a remote COG by range requests, a
// local one from its File. Null until known, or when there is no file.
type RasterInfo = { width: number; height: number; crs: string | null }

/** "http://www.opengis.net/def/crs/EPSG/0/4083" or "EPSG:4083" → "EPSG:4083". */
const crsLabel = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null
  const m = v.match(/EPSG\/(?:[\d.]+\/)?(\d+)$/i) ?? v.match(/EPSG:(\d+)/i)
  return m ? `EPSG:${m[1]}` : v
}

function useRasterInfo(source: Record<string, any>): RasterInfo | null {
  const titilerEndpoint = useAtomValue(titilerEndpointAtom)
  const viaProtocol = useAtomValue(useCogProtocolVsTitilerAtom)
  const [info, setInfo] = useState<RasterInfo | null>(null)
  const { type, url, cogViaTitiler } = source
  useEffect(() => {
    setInfo(null)
    if (!(type === "cog" || type === "vrt" || type === "cog-local") || typeof url !== "string") return
    let cancelled = false
    const done = (r: RasterInfo | null) => { if (!cancelled && r) setInfo(r) }
    const throughTitiler = type === "vrt" || (type === "cog" && (cogViaTitiler || !viaProtocol))
    if (throughTitiler) {
      fetch(`${titilerEndpoint}/cog/info?${TITILER_CACHE_KEY}&url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => done(d && Number.isFinite(d.width) && Number.isFinite(d.height) ? { width: d.width, height: d.height, crs: crsLabel(d.crs) } : null))
        .catch(() => { /* no info, no rows */ })
    } else {
      (async () => {
        const geotiff = await import("geotiff")
        const file = isLocalFileUrl(url) ? getRegisteredLocalFile(localFileId(url)) : null
        if (isLocalFileUrl(url) && !file) return
        const tiff = file ? await geotiff.fromBlob(file) : await geotiff.fromUrl(url)
        const image = await tiff.getImage()
        const keys = (image.getGeoKeys() ?? {}) as Record<string, number | undefined>
        const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
        done({ width: image.getWidth(), height: image.getHeight(), crs: epsg ? `EPSG:${epsg}` : null })
      })().catch(() => { /* no info, no rows */ })
    }
    return () => { cancelled = true }
  }, [type, url, cogViaTitiler, viaProtocol, titilerEndpoint])
  return info
}

export const SourceMetadataRows: React.FC<{ source: Record<string, any>; className?: string }> = ({ source, className }) => {
  const keys = Object.keys(source).filter((k) => !SKIP.has(k) && source[k] !== undefined && source[k] !== null && source[k] !== "")
  const gsd = sourceGsd(source)
  const raster = useRasterInfo(source)
  return (
    <dl className={className ?? "grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"}>
      {gsd && (
        <div className="contents">
          <dt className="text-muted-foreground">Ground resolution</dt>
          <dd className="min-w-0 break-words">{gsdText(gsd)}{gsd.estimated ? " — estimated from the max zoom" : ""}</dd>
        </div>
      )}
      {raster && (
        <div className="contents">
          <dt className="text-muted-foreground">Raster size</dt>
          <dd className="min-w-0 break-words tabular-nums">{raster.width.toLocaleString()} × {raster.height.toLocaleString()} px</dd>
        </div>
      )}
      {raster?.crs && (
        <div className="contents">
          <dt className="text-muted-foreground">CRS</dt>
          <dd className="min-w-0 break-words">{raster.crs}</dd>
        </div>
      )}
      {keys.map((k) => {
        const v = source[k]
        const text = Array.isArray(v) ? v.map((x) => (typeof x === "number" ? +x.toFixed(5) : x)).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)
        return (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{LABELS[k] ?? k}</dt>
            <dd className={isUrl(v) ? "min-w-0 break-all" : "min-w-0 break-words"}>{isUrl(v) ? <a href={v} target="_blank" rel="noopener noreferrer" className="underline">{v}</a> : text}</dd>
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
      {/* min-w-0: the dialog is a grid, and a grid item's automatic minimum
          width is its min-content, which for a nowrap (truncate) title is the
          whole title; the column then grew past the dialog and every row
          overflowed with it. pr-6 keeps the title off the close button. */}
      <DialogHeader className="min-w-0 pr-6">
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
