import type React from "react"
import { MapPin, Edit, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const CustomSourceDetails: React.FC<{
  source: any; handleFitToBounds: any; handleEditSource: any; handleDeleteCustomSource: any
}> = ({ source, handleFitToBounds, handleEditSource, handleDeleteCustomSource }) => (
  <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Label htmlFor={`source-${source.id}`} className="flex-1 text-sm cursor-pointer truncate min-w-0">
          {source.name}
        </Label>
      </TooltipTrigger>
      <TooltipContent> <p>{source.name}</p> </TooltipContent>
    </Tooltip>

    {['cog', 'vrt'].includes(source.type) && (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleFitToBounds(source)}>
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
