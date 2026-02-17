import type React from "react"
import { ExternalLink } from "lucide-react"

export const FooterSection: React.FC = () => (
  <div className="text-xs text-muted-foreground space-y-1">
    <p>Made by <a href="https://github.com/jo-chemla/" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">jo-chemla</a>, <a href="https://iconem.com" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">Iconem</a></p>

    <p>Also see: <a href="https://terrain-viewer.iconem.com/maplibre-raster-dem-wms-float32-generic.html" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">
      French IGN LidarHD DTM/DSM raw WMS Float32
    </a></p>

    <p>Inspired by:</p>
    <ul className="space-y-0.5">
      <li className="flex items-center justify-between">
        <a href="https://tangrams.github.io/heightmapper/" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">
          Tangram Height Mapper
        </a>
        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
      </li>
      <li className="flex items-center justify-between">
        <a href="https://impasto.dev/" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">
          Impasto CAS Viewer
        </a>
        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
      </li>
      <li className="flex items-center justify-between">
        <p>
          Codetard threejs terrain demos: {" "}
          <a href="https://x.com/codetaur/status/1968896182744207599" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">ui</a>
          {", "}
          <a href="https://x.com/codetaur/status/1967783305866252557" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">modes</a>
          {", "}
          <a href="https://x.com/codetaur/status/1986614344957006075" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">globe</a>
          {", "}
          <a href="https://github.com/ngwnos/threegs" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">repo</a>
        </p>
        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
      </li>
    </ul>
  </div>
)
