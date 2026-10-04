import type React from "react"
import { useEffect, useState, useMemo } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import type { MapLayerMouseEvent, ExpressionSpecification } from "maplibre-gl"
import type * as maplibregl from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import { useAtomValue, useSetAtom } from "jotai"
import { coverageOverlaysAtom, loadCoverageFeatures, VIEW_COVERAGE_LEAVES, getMapterhornSourceMeta, coverageGsd, coverageGsdMeters, MAPTERHORN_COVERAGE_TILES, MAPTERHORN_COVERAGE_LAYER, OVERLAY_COLORS, type MapterhornSourceMeta } from "@/lib/coverage-overlays"
import { customBasemapSourcesAtom, customTerrainSourcesAtom } from "@/lib/settings-atoms"
import { coverageUseRequestAtom, coverageUseKind } from "@/lib/use-coverage-use-request"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { coverageInViewAtom, overlapStats, overlapLabel, byOverlap, type OverlapStats, type CoverageInViewItem, type ViewBbox } from "@/lib/coverage-in-view"

const SOURCE_ID = "coverage-overlays"
const FILL_ID = "coverage-overlays-fill"
const LINE_ID = "coverage-overlays-line"
const MH_SOURCE_ID = "mapterhorn-coverage"
const MH_FILL_ID = "mapterhorn-coverage-fill"
const MH_LINE_ID = "mapterhorn-coverage-line"

type Hit = { gsdM: number; label: string; detail: string; url?: string; overlay?: string; useAs?: "terrain" | "basemap" | "overlay"; needsKey?: boolean; stats?: OverlapStats | null }

const viewOf = (m: maplibregl.Map): { bbox: ViewBbox; centre: [number, number] } => {
  const b = m.getBounds(), c = m.getCenter()
  return { bbox: [Math.max(-180, b.getWest()), Math.max(-85, b.getSouth()), Math.min(180, b.getEast()), Math.min(85, b.getNorth())], centre: [c.lng, c.lat] }
}
/** A feature may carry `urlTemplate` instead of a fixed `url`: {lat}/{lng}/{zoom}
 *  are filled from the click, so "open this elsewhere" lands on the place you
 *  clicked rather than on a provider home page. Used by the Bing Maps 3D
 *  overlay, whose whole point is "go and look at the mesh here". */
/**
 * Substitutes a destination's viewport placeholders. Two different camera
 * heights, because the two hosts mean different things by the number:
 * `{eh}` is Bing's, calibrated against its own 3D view (a z16 view over
 * Amiens sits near 150 m), and `{gealt}` is Google Earth's `…d` distance,
 * which runs about ten times larger for the same framing - the same formula
 * open-in-links.tsx uses for its Google Earth destinations.
 */
type CamCtx = { viewportW: number; viewportH: number; groundM: number }
/**
 * Esri's Scene Viewer `viewpoint=cam:x,y,z;heading,tilt` is the CAMERA, not
 * the point being looked at - and z is metres above sea level, not above
 * ground. Passing the clicked point with the Google Earth altitude put the
 * camera on the target with a made-up height: fine for a nadir view over
 * lowlands, badly off once tilted or in the Alps. So back the camera off:
 *
 *   D  distance camera -> target, sized so the target's screen extent
 *      matches this map's: half the visible diagonal over tan(fov/2), with
 *      Esri's fov being DIAGONAL and 55 by default
 *   h  height above target = D cos(tilt);  s = D sin(tilt) back along the
 *      reverse heading, so the camera sits behind the target looking at it
 *   z  h + ground elevation at the target
 */
const esriCamera = (lng: number, lat: number, zoom: number, bearing: number, pitch: number, cam: CamCtx) => {
  const rad = Math.PI / 180
  // 2^(zoom+1): maplibre zooms are on 512 px tiles, so a screen pixel is HALF
  // the classic 256-tile 156543/2^z figure. Using 2^zoom here put the camera
  // twice too far out and Scene Viewer framed four times the area.
  const gsd = (156543.03392 * Math.cos(lat * rad)) / Math.pow(2, zoom + 1)
  const D = (gsd * Math.hypot(cam.viewportW, cam.viewportH)) / 2 / Math.tan((55 / 2) * rad)
  const h = D * Math.cos(pitch * rad), sBack = D * Math.sin(pitch * rad)
  const camLat = lat - (sBack * Math.cos(bearing * rad)) / 111320
  const camLng = lng - (sBack * Math.sin(bearing * rad)) / (111320 * Math.cos(lat * rad))
  return { x: camLng.toFixed(6), y: camLat.toFixed(6), z: String(Math.round(h + cam.groundM)) }
}

const fillViewport = (tpl: string, lng: number, lat: number, zoom: number, bearing: number, pitch: number, cam?: CamCtx) =>
  tpl.replace(/\{esri(X|Y|Z)\}/g, (_, k: string) => {
      const c = esriCamera(lng, lat, zoom, bearing, pitch, cam ?? { viewportW: 1280, viewportH: 800, groundM: 0 })
      return k === "X" ? c.x : k === "Y" ? c.y : c.z
    })
    .replace(/\{lat\}/g, lat.toFixed(6)).replace(/\{lng\}/g, lng.toFixed(6))
    .replace(/\{zoom\}/g, zoom.toFixed(1))
    .replace(/\{bearing\}/g, (((bearing % 360) + 360) % 360).toFixed(2))
    .replace(/\{pitch\}/g, pitch.toFixed(2))
    .replace(/\{eh\}/g, String(Math.round((156543.034 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, zoom)) * 100)))
    .replace(/\{gealt\}/g, String(Math.round(((38000 * 4096) / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180))))
    // Web Mercator metres - what hub.flai.ai's ?c=x,y is in.
    .replace(/\{mercX\}/g, String(Math.round((lng / 180) * 20037508.34)))
    .replace(/\{mercY\}/g, String(Math.round((Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) * 20037508.34)))

/**
 * Draws the coverage overlays picked in Source Info (see
 * lib/coverage-overlays.ts) on this map: Mapterhorn's coverage vector tiles
 * plus GeoJSON footprints for everything else. Hovering lists every overlay
 * under the cursor in a small floating box; clicking opens the same list as
 * a modal with the dataset links.
 */
export const CoverageOverlayLayer: React.FC<{ publishInView?: boolean }> = ({ publishInView = false }) => {
  const ids = useAtomValue(coverageOverlaysAtom)
  const terrains = useAtomValue(customTerrainSourcesAtom)
  const basemaps = useAtomValue(customBasemapSourcesAtom)
  const { current: map } = useMap()
  const [collections, setCollections] = useState<Record<string, FeatureCollection>>({})
  const [hover, setHover] = useState<{ x: number; y: number; hits: Hit[] } | null>(null)
  const [clicked, setClicked] = useState<Hit[] | null>(null)
  // A filter over the clicked list: a city point can sit under hundreds of
  // Allmaps maps and dozens of QMS services. Every word must match the
  // name or the detail line; cleared with each new click.
  const [filter, setFilter] = useState("")
  useEffect(() => { setFilter("") }, [clicked])
  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    if (!clicked || !words.length) return clicked
    return clicked.filter((h) => { const text = `${h.label} ${h.detail}`.toLowerCase(); return words.every((w) => text.includes(w)) })
  }, [clicked, filter])
  const showMapterhorn = ids.includes("mapterhorn")
  const [mhMeta, setMhMeta] = useState<Record<string, MapterhornSourceMeta> | null>(null)
  useEffect(() => {
    if (!showMapterhorn || mhMeta) return
    let cancelled = false
    getMapterhornSourceMeta().then((m) => { if (!cancelled) setMhMeta(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [showMapterhorn, mhMeta])
  const geoIds = useMemo(() => ids.filter((id) => id !== "mapterhorn"), [ids])
  // Leaves drawn from a per-view query (Allmaps, QMS): refetched on moveend.
  const viewIds = useMemo(() => geoIds.filter((id) => id in VIEW_COVERAGE_LEAVES), [geoIds])
  const viewKey = viewIds.join(",")
  useEffect(() => {
    const m = map?.getMap()
    if (!m || !viewIds.length) return
    let ctrl: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      ctrl?.abort()
      ctrl = new AbortController()
      const signal = ctrl.signal
      const bounds = m.getBounds()
      for (const id of viewIds) {
        VIEW_COVERAGE_LEAVES[id](bounds, signal)
          .then((fc) => { if (!signal.aborted) setCollections((prev) => ({ ...prev, [id]: fc })) })
          .catch(() => {})
      }
    }
    const onMoveEnd = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 400) }
    refresh()
    m.on("moveend", onMoveEnd)
    return () => { m.off("moveend", onMoveEnd); if (timer) clearTimeout(timer); ctrl?.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, viewKey])
  // A deleted custom source takes its overlay with it.
  const setIds = useSetAtom(coverageOverlaysAtom)
  const requestUse = useSetAtom(coverageUseRequestAtom)
  useEffect(() => {
    const live = new Set([...terrains.map((t) => `terrain:${t.id}`), ...basemaps.map((b) => `basemap:${b.id}`)])
    const stale = ids.filter((id) => (id.startsWith("terrain:") || id.startsWith("basemap:")) && !live.has(id))
    if (stale.length) setIds((prev) => prev.filter((id) => !stale.includes(id)))
  }, [ids, terrains, basemaps, setIds])

  useEffect(() => {
    let cancelled = false
    for (const id of geoIds) {
      if (collections[id] || id in VIEW_COVERAGE_LEAVES) continue
      loadCoverageFeatures(id, { terrains, basemaps }).then((fc) => { if (!cancelled) setCollections((prev) => (prev[id] ? prev : { ...prev, [id]: fc })) }).catch(() => {})
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoIds, terrains, basemaps])

  const data = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: geoIds.flatMap((id) => collections[id]?.features ?? []),
  }), [geoIds, collections])

  // The whole footprint behind a rendered (tile-cut) feature, for the overlap.
  const geometryByKey = useMemo(() => {
    const index = new Map<string, any>()
    for (const f of data.features) { const p = f.properties as any; index.set(`${p?.label}|${p?.detail}`, f.geometry) }
    return index
  }, [data])
  // Mapterhorn's coverage is vector tiles: its pieces in the loaded tiles,
  // per national source, stand in for the footprint.
  const mapterhornPieces = (m: maplibregl.Map) => {
    const bySource = new Map<string, any[]>()
    if (!m.getSource(MH_SOURCE_ID)) return bySource
    for (const f of m.querySourceFeatures(MH_SOURCE_ID, { sourceLayer: MAPTERHORN_COVERAGE_LAYER })) {
      const src = String((f.properties as any)?.source ?? "")
      if (!src) continue
      if (!bySource.has(src)) bySource.set(src, [])
      const g = f.geometry as any
      if (g.type === "Polygon") bySource.get(src)!.push(g.coordinates)
      else if (g.type === "MultiPolygon") bySource.get(src)!.push(...g.coordinates)
    }
    return bySource
  }
  const mapterhornHit = (src: string, lat: number): Hit => {
    const meta = mhMeta?.[src]
    const mhRes = src === "glo30" ? 30 : Number(meta?.resolution)
    return { gsdM: Number.isFinite(mhRes) ? mhRes : Infinity, useAs: "terrain", label: "Mapterhorn",
      detail: src === "glo30" ? "Copernicus GLO-30 fallback (30 m)"
        : meta ? `${meta.resolution} m · ${meta.name} (${meta.producer}) · "${src}"`
        : `national source "${src}"`,
      url: `https://mapterhorn.com/attribution/#${src}`, overlay: "mapterhorn" }
  }

  useEffect(() => {
    const m = map?.getMap()
    if (!m || ids.length === 0) return
    const hitsAt = (e: MapLayerMouseEvent, withStats = false): Hit[] => {
      const layers = [FILL_ID, MH_FILL_ID].filter((l) => m.getLayer(l))
      if (!layers.length) return []
      const seen = new Set<string>()
      const out: Hit[] = []
      for (const f of m.queryRenderedFeatures(e.point, { layers })) {
        const p = f.properties as Record<string, any>
        const gsd = coverageGsd(p, e.lngLat.lat)
        const hit: Hit = f.layer.id === MH_FILL_ID
          ? mapterhornHit(String(p.source), e.lngLat.lat)
          : { gsdM: coverageGsdMeters(p, e.lngLat.lat) ?? Infinity, label: p.label, detail: gsd ? `${gsd} · ${p.detail}` : p.detail,
              url: p.urlTemplate
                ? fillViewport(p.urlTemplate, e.lngLat.lng, e.lngLat.lat, m.getZoom(), m.getBearing(), m.getPitch(), {
                    viewportW: m.getContainer().clientWidth, viewportH: m.getContainer().clientHeight,
                    // queryTerrainElevation reports the EXAGGERATED height; Esri wants the real one.
                    groundM: (m.queryTerrainElevation(e.lngLat) ?? 0) / (m.getTerrain()?.exaggeration || 1),
                  })
                : p.url || undefined, overlay: p.overlay,
              useAs: p.role === "overlay" ? "overlay" : coverageUseKind(p.overlay) ?? undefined, needsKey: p.needsKey === true || p.needsKey === "true" }
        const k = `${hit.label}|${hit.detail}`
        if (seen.has(k)) continue
        seen.add(k)
        if (withStats) {
          const { bbox, centre } = viewOf(m)
          if (f.layer.id === MH_FILL_ID) {
            const pieces = mapterhornPieces(m).get(String(p.source))
            hit.stats = pieces?.length ? overlapStats({ type: "MultiPolygon", coordinates: pieces }, bbox, centre) : null
          } else hit.stats = overlapStats(geometryByKey.get(`${p.label}|${p.detail}`), bbox, centre)
          if (hit.stats) hit.detail = `${hit.detail} · ${overlapLabel(hit.stats)}`
        }
        out.push(hit)
      }
      // The click list: the footprint matching the view best first (a
      // city plan over a world map when zoomed on the city), then the finest.
      // The hover box: finest first, no geometry work per mouse move.
      return withStats ? out.sort(byOverlap) : out.sort((a, b) => (a.gsdM === b.gsdM ? 0 : a.gsdM - b.gsdM))
    }
    let wasHit = false
    const onMove = (e: MapLayerMouseEvent) => {
      const hits = hitsAt(e)
      const hit = hits.length > 0
      // Write only on change so terra-draw's own cursor survives a move.
      if (hit !== wasHit) { wasHit = hit; m.getCanvas().style.cursor = hit ? "pointer" : "" }
      setHover(hits.length ? { x: e.point.x, y: e.point.y, hits } : null)
    }
    const onLeave = () => { setHover(null); if (wasHit) { wasHit = false; m.getCanvas().style.cursor = "" } }
    const onClick = (e: MapLayerMouseEvent) => { const hits = hitsAt(e, true); if (hits.length) setClicked(hits) }
    m.on("mousemove", onMove)
    m.on("mouseout", onLeave)
    m.on("click", onClick)
    return () => { m.off("mousemove", onMove); m.off("mouseout", onLeave); m.off("click", onClick); if (wasHit) m.getCanvas().style.cursor = "" }
  }, [map, ids.length, mhMeta, geometryByKey])

  // View A lists everything the drawn overlays hold for the view, for the
  // Sources Coverage section; refreshed as the map settles.
  const setInView = useSetAtom(coverageInViewAtom)
  useEffect(() => {
    const m = map?.getMap()
    if (!publishInView || !m) return
    if (!ids.length) { setInView(null); return }
    let timer: ReturnType<typeof setTimeout> | null = null
    const publish = () => {
      const { bbox, centre } = viewOf(m)
      const lat = centre[1]
      const items: CoverageInViewItem[] = []
      const seen = new Set<string>()
      for (const id of geoIds) {
        for (const f of collections[id]?.features ?? []) {
          const p = (f.properties ?? {}) as Record<string, any>
          const stats = overlapStats(f.geometry, bbox, centre)
          if (!stats || stats.cover <= 0) continue
          const key = `${p.label}|${p.detail}`
          if (seen.has(key)) continue
          seen.add(key)
          const gsd = coverageGsd(p, lat)
          items.push({ leaf: id, label: p.label, detail: gsd ? `${gsd} · ${p.detail}` : p.detail, url: p.urlTemplate ? undefined : p.url || undefined,
            overlay: p.overlay, useAs: p.role === "overlay" ? "overlay" : coverageUseKind(p.overlay) ?? undefined,
            needsKey: p.needsKey === true || p.needsKey === "true", gsdM: coverageGsdMeters(p, lat) ?? Infinity, stats })
        }
      }
      if (showMapterhorn) {
        for (const [src, pieces] of mapterhornPieces(m)) {
          const stats = overlapStats({ type: "MultiPolygon", coordinates: pieces }, bbox, centre)
          if (!stats || stats.cover <= 0) continue
          items.push({ leaf: "mapterhorn", ...mapterhornHit(src, lat), stats })
        }
      }
      setInView({ items: items.sort(byOverlap), at: Date.now() })
    }
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(publish, 300) }
    const onData = (e: any) => { if (e.sourceId === MH_SOURCE_ID && e.isSourceLoaded) schedule() }
    schedule()
    m.on("moveend", schedule)
    m.on("sourcedata", onData)
    return () => { m.off("moveend", schedule); m.off("sourcedata", onData); if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, publishInView, ids.length, geoIds, collections, showMapterhorn, mhMeta])
  useEffect(() => () => { if (publishInView) setInView(null) }, [publishInView, setInView])

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
            // noFill: outline-only sets (Allmaps: hundreds of overlapping maps
            // per city). The fill stays for hit-testing, at zero opacity.
            "fill-opacity": ["case", ["boolean", ["get", "noFill"], false], 0, ["boolean", ["get", "hollow"], false], 0.04, ["coalesce", ["get", "opacity"], 0.2]],
          }} />
          <Layer id={LINE_ID} type="line" paint={{
            "line-color": ["get", "color"],
            "line-width": ["coalesce", ["get", "lineWidth"], 1.5],
            "line-opacity": ["coalesce", ["get", "lineOpacity"], 0.9],
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
            <DialogDescription>{clicked?.length ?? 0} source{clicked?.length === 1 ? "" : "s"} declare data here{filter && shown ? `; ${shown.length} match` : ""}.</DialogDescription>
          </DialogHeader>
          {(clicked?.length ?? 0) > 5 && (
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, collection, type, year…" className="h-8 text-sm" />
          )}
          <ul className="space-y-2 max-h-80 overflow-y-auto text-sm">
            {shown?.length === 0 && <li className="text-xs text-muted-foreground">Nothing matches.</li>}
            {shown?.map((h, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer" className="underline">{h.label}</a> : h.label}</div>
                  <div className="text-xs text-muted-foreground">{h.detail}</div>
                </div>
                {h.overlay && h.useAs && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="shrink-0">
                          <Button size="sm" variant="outline" className="h-7 cursor-pointer text-xs" disabled={h.needsKey}
                            onClick={() => { requestUse({ overlay: h.overlay!, nonce: Date.now() }); setClicked(null) }}>
                            Use as {h.useAs}
                          </Button>
                        </span>
                      }
                    />
                    <TooltipContent><p>{h.needsKey ? "This layer needs an API key; add it from the Editor Layer Index search instead" : h.useAs === "overlay" ? "Add this overlay on top of the basemap" : `Select this ${h.useAs} for view A`}</p></TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
