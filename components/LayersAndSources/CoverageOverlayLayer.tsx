import type React from "react"
import { useEffect, useState, useMemo } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import type { MapLayerMouseEvent } from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import { useAtomValue } from "jotai"
import { coverageOverlaysAtom, loadCoverageFeatures } from "@/lib/coverage-overlays"
import { customBasemapSourcesAtom, customTerrainSourcesAtom } from "@/lib/settings-atoms"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

const SOURCE_ID = "coverage-overlays"
const FILL_ID = "coverage-overlays-fill"
const LINE_ID = "coverage-overlays-line"

type Hit = { label: string; detail: string; url?: string }

/**
 * Draws the coverage overlays picked in Source Info (see
 * lib/coverage-overlays.ts) on this map: translucent fills for real
 * footprints, hollow outlines for "fallback" areas. Hovering lists every
 * overlay under the cursor in a small floating box; clicking opens the same
 * list as a modal with the dataset links.
 */
export const CoverageOverlayLayer: React.FC = () => {
  const ids = useAtomValue(coverageOverlaysAtom)
  const terrains = useAtomValue(customTerrainSourcesAtom)
  const basemaps = useAtomValue(customBasemapSourcesAtom)
  const { current: map } = useMap()
  const [collections, setCollections] = useState<Record<string, FeatureCollection>>({})
  const [hover, setHover] = useState<{ x: number; y: number; hits: Hit[] } | null>(null)
  const [clicked, setClicked] = useState<Hit[] | null>(null)

  useEffect(() => {
    let cancelled = false
    for (const id of ids) {
      if (collections[id]) continue
      loadCoverageFeatures(id, terrains, basemaps).then((fc) => { if (!cancelled) setCollections((prev) => (prev[id] ? prev : { ...prev, [id]: fc })) }).catch(() => {})
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, terrains, basemaps])

  const data = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: ids.flatMap((id) => collections[id]?.features ?? []),
  }), [ids, collections])

  useEffect(() => {
    const m = map?.getMap()
    if (!m || ids.length === 0) return
    const hitsAt = (e: MapLayerMouseEvent): Hit[] => {
      if (!m.getLayer(FILL_ID)) return []
      const seen = new Set<string>()
      const out: Hit[] = []
      for (const f of m.queryRenderedFeatures(e.point, { layers: [FILL_ID] })) {
        const p = f.properties as Record<string, string>
        const k = `${p.overlay}|${p.label}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ label: p.label, detail: p.detail, url: p.url || undefined })
      }
      return out
    }
    const onMove = (e: MapLayerMouseEvent) => {
      const hits = hitsAt(e)
      m.getCanvas().style.cursor = hits.length ? "pointer" : ""
      setHover(hits.length ? { x: e.point.x, y: e.point.y, hits } : null)
    }
    const onLeave = () => { setHover(null); m.getCanvas().style.cursor = "" }
    const onClick = (e: MapLayerMouseEvent) => { const hits = hitsAt(e); if (hits.length) setClicked(hits) }
    m.on("mousemove", onMove)
    m.on("mouseout", onLeave)
    m.on("click", onClick)
    return () => { m.off("mousemove", onMove); m.off("mouseout", onLeave); m.off("click", onClick); m.getCanvas().style.cursor = "" }
  }, [map, ids.length])

  if (ids.length === 0) return null
  return (
    <>
      <Source id={SOURCE_ID} type="geojson" data={data}>
        <Layer id={FILL_ID} type="fill" paint={{
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["boolean", ["get", "hollow"], false], 0.04, 0.22],
        }} />
        <Layer id={LINE_ID} type="line" paint={{
          "line-color": ["get", "color"],
          "line-width": ["case", ["boolean", ["get", "hollow"], false], 0.6, 1.5],
          "line-opacity": ["case", ["boolean", ["get", "hollow"], false], 0.5, 0.9],
        }} />
      </Source>
      {hover && (
        <div className="pointer-events-none absolute z-20 max-w-xs rounded-md border bg-popover/95 px-2 py-1 text-xs shadow-md"
          style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hover.hits.slice(0, 8).map((h, i) => <div key={i} className="truncate"><span className="font-medium">{h.label}</span> <span className="text-muted-foreground">{h.detail}</span></div>)}
          {hover.hits.length > 8 && <div className="text-muted-foreground">+{hover.hits.length - 8} more (click)</div>}
        </div>
      )}
      <Dialog open={!!clicked} onOpenChange={(o) => { if (!o) setClicked(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coverage under the cursor</DialogTitle>
            <DialogDescription>{clicked?.length ?? 0} source{clicked?.length === 1 ? "" : "s"} declare data here.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 max-h-80 overflow-y-auto text-sm">
            {clicked?.map((h, i) => (
              <li key={i}>
                <div className="font-medium">{h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer" className="underline">{h.label}</a> : h.label}</div>
                <div className="text-xs text-muted-foreground">{h.detail}</div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
