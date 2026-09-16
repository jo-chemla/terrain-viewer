import type React from "react"
import { useEffect, useState, useMemo } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import type { MapLayerMouseEvent, ExpressionSpecification } from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import { useAtomValue } from "jotai"
import { coverageOverlaysAtom, loadCoverageFeatures, getMapterhornSourceMeta, coverageGsd, MAPTERHORN_COVERAGE_TILES, MAPTERHORN_COVERAGE_LAYER, OVERLAY_COLORS, type MapterhornSourceMeta } from "@/lib/coverage-overlays"
import { customBasemapSourcesAtom, customTerrainSourcesAtom } from "@/lib/settings-atoms"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

const SOURCE_ID = "coverage-overlays"
const FILL_ID = "coverage-overlays-fill"
const LINE_ID = "coverage-overlays-line"
const MH_SOURCE_ID = "mapterhorn-coverage"
const MH_FILL_ID = "mapterhorn-coverage-fill"
const MH_LINE_ID = "mapterhorn-coverage-line"

type Hit = { label: string; detail: string; url?: string }

/**
 * Draws the coverage overlays picked in Source Info (see
 * lib/coverage-overlays.ts) on this map: Mapterhorn's coverage vector tiles
 * plus GeoJSON footprints for everything else. Hovering lists every overlay
 * under the cursor in a small floating box; clicking opens the same list as
 * a modal with the dataset links.
 */
export const CoverageOverlayLayer: React.FC = () => {
  const ids = useAtomValue(coverageOverlaysAtom)
  const terrains = useAtomValue(customTerrainSourcesAtom)
  const basemaps = useAtomValue(customBasemapSourcesAtom)
  const { current: map } = useMap()
  const [collections, setCollections] = useState<Record<string, FeatureCollection>>({})
  const [hover, setHover] = useState<{ x: number; y: number; hits: Hit[] } | null>(null)
  const [clicked, setClicked] = useState<Hit[] | null>(null)
  const showMapterhorn = ids.includes("mapterhorn")
  const [mhMeta, setMhMeta] = useState<Record<string, MapterhornSourceMeta> | null>(null)
  useEffect(() => {
    if (!showMapterhorn || mhMeta) return
    let cancelled = false
    getMapterhornSourceMeta().then((m) => { if (!cancelled) setMhMeta(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [showMapterhorn, mhMeta])
  const geoIds = useMemo(() => ids.filter((id) => id !== "mapterhorn"), [ids])

  useEffect(() => {
    let cancelled = false
    for (const id of geoIds) {
      if (collections[id]) continue
      loadCoverageFeatures(id, { terrains, basemaps }).then((fc) => { if (!cancelled) setCollections((prev) => (prev[id] ? prev : { ...prev, [id]: fc })) }).catch(() => {})
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoIds, terrains, basemaps])

  const data = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: geoIds.flatMap((id) => collections[id]?.features ?? []),
  }), [geoIds, collections])

  useEffect(() => {
    const m = map?.getMap()
    if (!m || ids.length === 0) return
    const hitsAt = (e: MapLayerMouseEvent): Hit[] => {
      const layers = [FILL_ID, MH_FILL_ID].filter((l) => m.getLayer(l))
      if (!layers.length) return []
      const seen = new Set<string>()
      const out: Hit[] = []
      for (const f of m.queryRenderedFeatures(e.point, { layers })) {
        const p = f.properties as Record<string, any>
        const meta = mhMeta?.[p.source]
        const gsd = coverageGsd(p, e.lngLat.lat)
        const hit: Hit = f.layer.id === MH_FILL_ID
          ? { label: "Mapterhorn",
              detail: p.source === "glo30" ? "Copernicus GLO-30 fallback (30 m)"
                : meta ? `${meta.resolution} m · ${meta.name} (${meta.producer}) · "${p.source}"`
                : `national source "${p.source}"`,
              url: `https://mapterhorn.com/attribution/#${p.source}` }
          : { label: p.label, detail: gsd ? `${gsd} · ${p.detail}` : p.detail, url: p.url || undefined }
        const k = `${hit.label}|${hit.detail}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(hit)
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
  }, [map, ids.length, mhMeta])

  if (ids.length === 0) return null
  const isGlo30: ExpressionSpecification = ["==", ["get", "source"], "glo30"]
  return (
    <>
      {showMapterhorn && (
        <Source id={MH_SOURCE_ID} type="vector" tiles={[MAPTERHORN_COVERAGE_TILES]} minzoom={0} maxzoom={14}>
          <Layer id={MH_FILL_ID} type="fill" source-layer={MAPTERHORN_COVERAGE_LAYER} paint={{
            "fill-color": OVERLAY_COLORS.mapterhorn,
            "fill-opacity": ["case", isGlo30, 0.03, 0.22],
          }} />
          <Layer id={MH_LINE_ID} type="line" source-layer={MAPTERHORN_COVERAGE_LAYER} paint={{
            "line-color": OVERLAY_COLORS.mapterhorn,
            "line-width": ["case", isGlo30, 0.4, 1.2],
            "line-opacity": ["case", isGlo30, 0.4, 0.9],
          }} />
        </Source>
      )}
      {geoIds.length > 0 && (
        <Source id={SOURCE_ID} type="geojson" data={data}>
          <Layer id={FILL_ID} type="fill" paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": ["case", ["boolean", ["get", "hollow"], false], 0.04, ["coalesce", ["get", "opacity"], 0.2]],
          }} />
          <Layer id={LINE_ID} type="line" paint={{
            "line-color": ["get", "color"],
            "line-width": 1.5,
            "line-opacity": 0.9,
          }} />
        </Source>
      )}
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
