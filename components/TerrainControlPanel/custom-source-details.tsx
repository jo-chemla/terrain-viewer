import type React from "react"
import { useRef } from "react"
import { useSetAtom, useAtomValue, useAtom } from "jotai"
import { MapPin, Edit, Trash2, Upload, HardDrive, Link, ExternalLink, LibraryBig, Info, Lock, LockOpen } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { registerLocalFileAtom, resolveLocalFileUrl, localFileId, localFileVersionAtom } from "@/lib/local-file-store"
import { sourcesEditModeAtom, viewportCenterAtom, customBasemapSourcesAtom } from "@/lib/settings-atoms"
import { sourceGsd, gsdLabel, gsdText } from "@/lib/gsd"

const providerName = (p?: string) => (p === "qms" ? "NextGIS QMS" : p === "eli" ? "OSM Editor Layer Index" : p === "allmaps" ? "Allmaps" : p || null)

export const CustomSourceDetails: React.FC<{
  source: any; handleFitToBounds: any; handleEditSource: any; handleDeleteCustomSource: any
  /** Rendered right after the name, before the fit / edit / delete buttons. */
  extraActions?: React.ReactNode
  /** Rendered last, right-most (an overlay's opacity pill). */
  trailingActions?: React.ReactNode
  /** Edit mode off (sourcesEditModeAtom): the row shows info, fit and the
   *  trailing actions, no edit or delete. */
  onInfo?: (id: string) => void
  /** Called with source.id when the label is clicked, e.g. setState({ sourceA: id }) or
   *  setState({ basemapSource: id }) — the caller decides which state key to write.
   *  Omit in contexts (e.g. split-screen A/B) where a separate control already handles
   *  selection and the label should only fit-to-bounds. */
  /** Returns false when the click switched the source off: no camera move then. */
  onSelect?: (id: string) => void | boolean
  /** Name of the paired terrain/basemap source this one is linked to (see
   *  CustomTerrainSource.linkedBasemapId / CustomBasemapSource.linkedTerrainId)
   *  — the caller resolves this since it needs the OTHER list to look it up.
   *  Undefined/empty renders no badge at all. */
  linkedSourceName?: string
  /** Ids of every terrain source that currently exists, so a difference source
   *  can tell whether its two operands are still there. */
  liveSourceIds?: Set<string>
  /** Ids the terrain LIBRARY can still supply. A library nDSM carries its two
   *  operands by id, so loading the difference on its own - or deleting one
   *  side later - leaves a row that is only missing something one click away.
   *  When every missing operand is in here, the row offers to fetch them. */
  libraryIds?: Set<string>
  /** Adds the given library entries to the user's sources. */
  onLoadFromLibrary?: (ids: string[]) => void
}> = ({ source, handleFitToBounds, handleEditSource, handleDeleteCustomSource, onSelect, linkedSourceName, liveSourceIds, libraryIds, onLoadFromLibrary, extraActions, trailingActions, onInfo }) => {
  const editMode = useAtomValue(sourcesEditModeAtom)
  // The lock (basemaps and overlays only): a locked source is never removed
  // by an automatic step, such as a timeline overlay pill dragged to another
  // tick, which otherwise swaps the old catalog item out of the sources.
  const [customBasemaps, setCustomBasemaps] = useAtom(customBasemapSourcesAtom)
  // Overlays only: a basemap is never removed by an automatic step.
  const basemapEntry = customBasemaps.find((b) => b.id === source.id && b.role === "overlay")
  const toggleLock = () => setCustomBasemaps((prev) => prev.map((b) => (b.id === source.id ? { ...b, locked: !b.locked } : b)))
  const viewportCenter = useAtomValue(viewportCenterAtom)
  const gsd = sourceGsd(source, viewportCenter?.lat ?? 0)
  const belowMinZoom = typeof source.minzoom === "number" && viewportCenter != null && viewportCenter.zoom < source.minzoom - 0.01
  const registerLocalFile = useSetAtom(registerLocalFileAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The File behind a "cog-local" source only lives in this tab's memory — after
  // a reload (or in a fresh tab) it's gone until re-picked, so re-render whenever
  // one is (re-)registered to flip between "Re-select file…" and the normal row.
  useAtomValue(localFileVersionAtom)
  const isLocalFile = source.type === "cog-local" || source.type === "image-local"
  const isLocalFileMissing = isLocalFile && !resolveLocalFileUrl(localFileId(source.url))
  // A difference source holds its two operands by id, and deleting one leaves
  // the difference behind pointing at nothing: it selects, renders nothing,
  // and gives no hint why. Name the missing side and disable the row instead.
  const missingOperands = source.type === "dem-diff" && liveSourceIds
    ? ([source.diffMinuendId, source.diffSubtrahendId] as (string | undefined)[])
        .filter((id): id is string => !!id && !liveSourceIds.has(id))
    : []
  const isOrphanedDiff = missingOperands.length > 0
  // Only offer the shortcut when the library can supply EVERY missing side -
  // half a difference is still a dead row, so a button that fixes half of it
  // would just move the dead end one click further along.
  const restorable = libraryIds && onLoadFromLibrary && missingOperands.every((id) => libraryIds.has(id))
    ? missingOperands
    : []

  if (isLocalFileMissing) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept={source.type === "image-local" ? "image/png,image/jpeg,image/webp" : ".tif,.tiff,image/tiff"}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) registerLocalFile({ id: localFileId(source.url), file })
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className="flex-1 justify-start text-sm truncate min-w-0 text-muted-foreground cursor-pointer h-8"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1 shrink-0" /> <span className="truncate min-w-0">{source.name} — re-select file…</span>
              </Button>
            }
          />
          <TooltipContent><p>This browser couldn't restore "{source.name}" locally (unsupported browser, storage limit, or it was cleared) — pick it again to use it this session</p></TooltipContent>
        </Tooltip>
        {/* Remote COGs can be inspected in a standalone viewer: source.coop's
            COG viewer (metadata, overviews, band stats) or GeoLibre. */}
        {source.type === "cog" && /^https?:\/\//.test(source.url) && (
          <Tooltip>
            <TooltipTrigger
              render={
                <a href={`https://source-cooperative.github.io/cog-viewer/?url=${encodeURIComponent(source.url)}`} target="_blank" rel="noopener noreferrer"
                  className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              }
            />
            <TooltipContent>
              <p>Open in the source.coop COG viewer</p>
              <p className="text-muted-foreground">or in <a href={`https://web.geolibre.app/?data=${encodeURIComponent(source.url)}`} target="_blank" rel="noopener noreferrer" className="underline">GeoLibre</a></p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleEditSource(source.id)}>
                <Edit className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent><p>Edit</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleDeleteCustomSource(source.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent><p>Delete</p></TooltipContent>
        </Tooltip>
      </>
    )
  }

  return (
    <>
    {/* Local COGs still look exactly like any other working source once picked
        (or restored from OPFS) — this badge is the only remaining hint that
        it's a browser-local file (like a QGIS scratch/memory layer) rather
        than a portable, shareable URL anyone else could open. */}
    {isLocalFile && (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0"><HardDrive className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
        <TooltipContent><p>Local file — lives only in this browser's storage, not a shareable URL</p></TooltipContent>
      </Tooltip>
    )}
    {basemapEntry?.locked && !editMode && (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0"><Lock className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
        <TooltipContent><p>Locked: never removed automatically (unlock in edit mode)</p></TooltipContent>
      </Tooltip>
    )}
    {linkedSourceName && (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0"><Link className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
        <TooltipContent><p>Linked to "{linkedSourceName}" — selecting either one auto-selects the other</p></TooltipContent>
      </Tooltip>
    )}
    <Tooltip>
      <TooltipTrigger
        render={
          <Label
            htmlFor={`source-${source.id}`}
            className={`flex-1 text-sm truncate min-w-0 ${isOrphanedDiff ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            onClick={() => {
              if (isOrphanedDiff) return
              const activated = onSelect?.(source.id)
              if (activated !== false) handleFitToBounds(source)
            }}
            >
            <span className="truncate min-w-0">{source.name}</span>
            {gsd && <span className="ml-1 text-[10px] text-muted-foreground tabular-nums shrink-0">{gsd.estimated ? "~" : ""}{gsdLabel(gsd.m)}</span>}
            {belowMinZoom && <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300 shrink-0" title={`Nothing is served below zoom ${source.minzoom}; zoom in`}>z≥{source.minzoom}</span>}
          </Label>
        }
      />
      <TooltipContent className="max-w-80">
        {isOrphanedDiff ? (
          <p>{restorable.length
              ? `This difference needs ${missingOperands.length === 2 ? "both of its sources" : "a source"}, and the library has ${missingOperands.length === 2 ? "them" : "it"} — use the button on the right to load ${missingOperands.length === 2 ? "them" : "it"}.`
              : `This difference needs ${missingOperands.length === 2 ? "both of its sources" : "a source"} that ${missingOperands.length === 2 ? "have" : "has"} been deleted — edit it to pick ${missingOperands.length === 2 ? "new ones" : "another"}, or delete it.`}</p>
        ) : (
          // What the source is, before clicking: its type, where it comes
          // from, its ground resolution (declared or from the max zoom),
          // attribution and description. The info button has every field.
          <div className="space-y-0.5">
            <p className="font-medium">{source.name}</p>
            {gsd && <p className="text-muted-foreground"><span className="font-medium text-foreground/80">GSD:</span> {gsd.estimated ? "about " : ""}{gsdLabel(gsd.m)}/px{gsd.zoom !== undefined ? ` (zoom ${gsd.zoom})` : ""}</p>}
            <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Type:</span> {source.type}{source.role === "overlay" ? ", overlay" : ""}</p>
            {providerName(source.provider) && <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Source:</span> {providerName(source.provider)}</p>}
            {source.attribution && <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Attribution:</span> {source.attribution}</p>}
            {source.description && <p className="text-muted-foreground line-clamp-4"><span className="font-medium text-foreground/80">Description:</span> {source.description}</p>}
          </div>
        )}
      </TooltipContent>
    </Tooltip>

    {extraActions}
    {restorable.length > 0 && (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer text-primary" onClick={() => onLoadFromLibrary!(restorable)}>
              <LibraryBig className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent>
          <p>Load {restorable.length === 2 ? "both missing sources" : "the missing source"} from the terrain library</p>
        </TooltipContent>
      </Tooltip>
    )}

    {(['cog', 'cog-local', 'vrt', 'tilejson'].includes(source.type) || !!source.bounds) && (
      <Tooltip>
        {/* force=true: this button always fits, unlike the label click above which
            only fits when smart-zoom decides the camera should actually move. */}
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleFitToBounds(source, true)}>
              <MapPin className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent><p>Fit to bounds</p></TooltipContent>
      </Tooltip>
    )}
    {editMode ? (<>
      {basemapEntry && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon" className={`h-8 w-8 shrink-0 cursor-pointer ${basemapEntry.locked ? "text-primary" : ""}`} onClick={toggleLock}>
                {basemapEntry.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              </Button>
            }
          />
          <TooltipContent><p>{basemapEntry.locked ? "Locked: never removed automatically (a timeline pill drag swapping it out, for instance). Click to unlock." : "Lock: keep this source whatever the timeline does (a pill drag can otherwise replace a catalog item)"}</p></TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleEditSource(source.id)}>
              <Edit className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent><p>Edit</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleDeleteCustomSource(source.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent><p>Delete</p></TooltipContent>
      </Tooltip>
    </>) : onInfo ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => onInfo(source.id)}>
              <Info className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent><p>Details</p></TooltipContent>
      </Tooltip>
    ) : null}
    {trailingActions}
    </>
  )
}
