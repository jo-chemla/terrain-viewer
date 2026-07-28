import type React from "react"
import { ChevronDown, ExternalLink } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/** One "also see" / "inspired by" row: a link plus its external-link icon,
 *  spaced apart in a flex row. Pulled out since every entry below repeats
 *  this exact shape. */
const LinkRow: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <li>
    <div className="flex items-center justify-between">
      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">
        {children}
      </a>
      <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
    </div>
  </li>
)

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
      <p>
        Made by{" "}
        <a href="https://github.com/jo-chemla/" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">jo-chemla</a>
        {", "}
        <a href="https://iconem.com" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">Iconem</a>
        {" — see "}
        <a href="https://github.com/iconem/terrain-viewer" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">repo</a>
      </p>

      <div>
        <p>Also see:</p>
        <ul className="list-disc pl-6 space-y-0.5">
          <LinkRow href="https://rem.prod.heritagewatch.ai/">RiverREM (Relative Elevation Model)</LinkRow>
          <LinkRow href="/maplibre-raster-dem-wms-float32-generic.html">French IGN LidarHD DTM/DSM raw WMS Float32</LinkRow>
        </ul>
      </div>

      <div>
        <p>Inspired by:</p>
        <ul className="list-disc pl-6 space-y-0.5">
          <LinkRow href="https://mapterhorn.com/">Mapterhorn</LinkRow>
          <LinkRow href="https://tangrams.github.io/heightmapper/">Tangram Height Mapper</LinkRow>
          <LinkRow href="https://impasto.dev/">Impasto CAS Viewer</LinkRow>
          <li>
            <div className="flex items-center justify-between">
              <p>
                Codetard threejs terrain: {" "}
                <a href="https://x.com/codetaur/status/1968896182744207599" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">ui</a>
                {", "}
                <a href="https://x.com/codetaur/status/1967783305866252557" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">modes</a>
                {", "}
                <a href="https://x.com/codetaur/status/1986614344957006075" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">globe</a>
                {", "}
                <a href="https://github.com/ngwnos/threegs" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">repo</a>
              </p>
              <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
            </div>
          </li>
          <li>
            <div className="flex items-center justify-between">
              <span>
                Mike Jenkin {": "} <a href="https://minimaps.mikejenkin.com/" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">minimap</a>
                {", 2026-06 ("}<a href="https://github.com/drjenkin/minimaps" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">repo)</a>
              </span>
              <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
            </div>
          </li>
        </ul>
      </div>
    </CollapsibleContent>
  </Collapsible>
)
