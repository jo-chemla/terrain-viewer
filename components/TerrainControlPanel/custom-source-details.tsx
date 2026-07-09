import type React from "react"
import { useAtom } from "jotai"
import { MapPin, Edit, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCogProtocolVsTitilerAtom } from "@/lib/settings-atoms"

export const CustomSourceDetails: React.FC<{
  source: any; handleFitToBounds: any; handleEditSource: any; handleDeleteCustomSource: any
  /** Called with source.id when the label is clicked, e.g. setState({ sourceA: id }) or
   *  setState({ basemapSource: id }) — the caller decides which state key to write.
   *  Omit in contexts (e.g. split-screen A/B) where a separate control already handles
   *  selection and the label should only fit-to-bounds. */
  onSelect?: (id: string) => void
}> = ({ source, handleFitToBounds, handleEditSource, handleDeleteCustomSource, onSelect }) => {
  const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
  // VRT only streams through titiler (see custom-terrain-source-modal.tsx) — a VRT
  // source already saved in the BYOD list is just as unusable in geomatico mode as
  // picking "VRT" fresh from the Type dropdown, so disable it here too rather than
  // letting it silently fail to select/render.
  const isDisabledVrt = source.type === "vrt" && useCogProtocol

  return (
    <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Label
          htmlFor={`source-${source.id}`}
          className={`flex-1 text-sm truncate min-w-0 ${isDisabledVrt ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          onClick={() => {
            if (isDisabledVrt) return
            onSelect?.(source.id)
            handleFitToBounds(source)
          }}
          >
          {source.name}
        </Label>
      </TooltipTrigger>
      <TooltipContent> <p>{isDisabledVrt ? "VRT only works in titiler streaming mode" : source.name}</p> </TooltipContent>
    </Tooltip>

    {['cog', 'vrt', 'tilejson'].includes(source.type) && (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* force=true: this button always fits, unlike the label click above which
              only fits when smart-zoom decides the camera should actually move. */}
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" disabled={isDisabledVrt} onClick={() => handleFitToBounds(source, true)}>
            <MapPin className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>Fit to bounds</p></TooltipContent>
      </Tooltip>
    )}
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleEditSource(source.id)}>
          <Edit className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>Edit</p></TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleDeleteCustomSource(source.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>Delete</p></TooltipContent>
    </Tooltip>
    </>
  )
}
