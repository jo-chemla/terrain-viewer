import type React from "react"
import { ExternalLink } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Bounds } from "@/lib/controls-utils"
import type { TerrainSourceEntry } from "@/lib/source-schema"
import { SourceInfoDialog } from "./source-info-dialog"

/** A Worldwide Default's name in its row: a library entry's region prefix
 *  ("Global - ") says nothing in a list of global sources. */
export function defaultsRowName(entry: TerrainSourceEntry): string {
  return entry.name.replace(/^(Global|[A-Z]{3}) - /, "")
}

/** A Worldwide Default's row: its name, the info dialog, its documentation. */
export const SourceDetails: React.FC<{
  entry: TerrainSourceEntry; linkCallback: (link: string) => () => void; getMapBounds: () => Bounds; state?: any
  /** Split layouts: the label click activates the source on every view
   *  (the grid toggle beside it picks single views). */
  onSelect?: (key: string) => void
}> = ({ entry, linkCallback, getMapBounds, state, onSelect }) => (
  <>
    <Label htmlFor={`source-${entry.id}`} onClick={onSelect ? () => onSelect(entry.id) : undefined} title={onSelect ? "Use on every view" : entry.name} className="flex-1 text-sm truncate min-w-0 cursor-pointer">
      <span className="truncate min-w-0">{defaultsRowName(entry)}</span>
    </Label>
    {/* No datum badge here. An "ellipsoidal" pill next to the name read as a
     *  warning on a source that is not wrong, just referenced differently, and
     *  it crowded a row that already carries two icon buttons. The fact still
     *  lives in the source info dialog (i) and in the Terrain Sources docs. */}
    <SourceInfoDialog entry={entry} getMapBounds={getMapBounds} state={state} />
    {entry.infoUrl && (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={linkCallback(entry.infoUrl)}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent><p>Open documentation</p></TooltipContent>
      </Tooltip>
    )}
  </>
)
