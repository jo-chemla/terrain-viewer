import type React from "react"

// Esri World Imagery (+ Wayback) and GE Historical are the two basemaps
// whose real attribution genuinely changes as you pan/zoom, switch which
// side is showing it, or (for GE Historical) scrub to a different historical
// date — every other source's attribution is a fixed string wired straight
// into its <Source> (see lib/basemap-attribution.ts's
// STATIC_BASEMAP_ATTRIBUTIONS and MapSources.tsx), which MapLibre's own
// AttributionControl already displays with no extra UI needed. This can't
// just be folded into that same control instead: react-map-gl's <Source>
// reconciler (node_modules/@vis.gl/react-maplibre/src/components/source.ts's
// updateSource) has no live-update path for `attribution` at all — post-
// mount, changing that prop alone just logs "Unable to update <Source>
// prop" and is dropped, so a value that changes after the source is created
// (like these) can never reach the map through it, and on a render where
// `tiles` also happens to change, adding a changing `attribution` risks the
// reconciler applying THAT change instead and silently dropping the real
// tile update. Rendered as its own small fixed badge, one row above the
// scale/attribution corner it's stacked next to — TerrainViewer.tsx picks
// which of the two dynamic hooks' text to pass down based on which side(s)
// are actually active.
export const DynamicAttributionBadge: React.FC<{
  text: string | null
  bottomOffsetPx: string
  rightOffsetPx: string
}> = ({ text, bottomOffsetPx, rightOffsetPx }) => {
  if (!text) return null
  return (
    <div
      className="fixed z-10 max-w-[70vw] truncate rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm transition-[bottom,right] duration-200"
      style={{ bottom: `calc(${bottomOffsetPx} + 28px)`, right: rightOffsetPx }}
      title={text}
    >
      {text}
    </div>
  )
}
