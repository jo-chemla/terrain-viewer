import type React from "react"
import { ChevronDown } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { CREDITS_MARKDOWN, CREDITS_MARKDOWN_COMPONENTS } from "./settings-dialog"

/** Not a shared `Section` instance on purpose — that component carries
 *  pulse/dimming machinery (breathing-dot activation, cross-section
 *  dimming) tied to viz-mode state, none of which applies to this static
 *  credits block. Same Collapsible primitives, deliberately smaller/muted
 *  title so it doesn't compete with the real sections above it. */
export const FooterSection: React.FC<{
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ isOpen, onOpenChange }) => (
  // No leading Separator here — whichever section renders immediately above
  // (Animation or Source Info, per TerrainControlPanel.tsx) already draws
  // its own trailing one via Section's default withSeparator=true.
  <Collapsible open={isOpen} onOpenChange={onOpenChange}>
    <CollapsibleTrigger className="flex items-center justify-between w-full py-2 cursor-pointer text-xs font-medium text-muted-foreground text-left">
      <span>About</span>
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-180")} />
    </CollapsibleTrigger>
    <CollapsibleContent className="text-xs text-muted-foreground space-y-1.5 pb-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={CREDITS_MARKDOWN_COMPONENTS}>
        {CREDITS_MARKDOWN}
      </ReactMarkdown>
    </CollapsibleContent>
  </Collapsible>
)
