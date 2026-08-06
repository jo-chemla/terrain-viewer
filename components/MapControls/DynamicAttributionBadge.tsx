import type React from "react"
import { useEsriDynamicAttribution } from "@/lib/basemap-attribution"

// Esri World Imagery (and Wayback, its historical-release sibling) is the
// one basemap whose real attribution genuinely changes as you pan/zoom or
// switch which side is showing it — every other source's attribution is a
// fixed string wired straight into its <Source> (see lib/basemap-
// attribution.ts's STATIC_BASEMAP_ATTRIBUTIONS and MapSources.tsx), which
// MapLibre's own AttributionControl already displays with no extra UI
// needed. This can't just be folded into that same control instead: react-
// map-gl's <Source> reconciler only ever applies ONE changed prop per
// render (see the comment on the "wayback" branch in MapSources.tsx), so
// feeding it a value that updates independently of `tiles` risks silently
// dropping a real tile update. Rendered as its own small fixed badge, one
// row above the scale/attribution corner it's stacked next to.
export const DynamicAttributionBadge: React.FC<{
  active: boolean
  lat: number
  lng: number
  zoom: number
  bottomOffsetPx: string
  rightOffsetPx: string
}> = ({ active, lat, lng, zoom, bottomOffsetPx, rightOffsetPx }) => {
  const attribution = useEsriDynamicAttribution(lat, lng, zoom)
  if (!active) return null
  return (
    <div
      className="fixed z-10 max-w-[70vw] truncate rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm transition-[bottom,right] duration-200"
      style={{ bottom: `calc(${bottomOffsetPx} + 28px)`, right: rightOffsetPx }}
      title={attribution}
    >
      {attribution}
    </div>
  )
}
