import type React from "react"
import { useEffect, useState, useMemo } from "react"
import { Source, Layer, useMap } from "react-map-gl/maplibre"
import type { MapLayerMouseEvent, ExpressionSpecification } from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import { useAtomValue, useSetAtom } from "jotai"
import { coverageOverlaysAtom, loadCoverageFeatures, getMapterhornSourceMeta, coverageGsd, coverageGsdMeters, MAPTERHORN_COVERAGE_TILES, MAPTERHORN_COVERAGE_LAYER, OVERLAY_COLORS, type MapterhornSourceMeta } from "@/lib/coverage-overlays"
import { customBasemapSourcesAtom, customTerrainSourcesAtom } from "@/lib/settings-atoms"
import { coverageUseRequestAtom, coverageUseKind } from "@/lib/use-coverage-use-request"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

const SOURCE_ID = "coverage-overlays"
const FILL_ID = "coverage-overlays-fill"
const LINE_ID = "coverage-overlays-line"
const MH_SOURCE_ID = "mapterhorn-coverage"
const MH_FILL_ID = "mapterhorn-coverage-fill"
const MH_LINE_ID = "mapterhorn-coverage-line"

type Hit = { gsdM: number; label: string; detail: string; url?: string; overlay?: string; useAs?: "terrain" | "basemap" | "overlay"; needsKey?: boolean }
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
  const gsd = (156543.03392 * Math.cos(lat * rad)) / Math.pow(2, zoom)
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
        const mhRes = p.source === "glo30" ? 30 : Number(meta?.resolution)
        const hit: Hit = f.layer.id === MH_FILL_ID
          ? { gsdM: Number.isFinite(mhRes) ? mhRes : Infinity, useAs: "terrain", label: "Mapterhorn",
              detail: p.source === "glo30" ? "Copernicus GLO-30 fallback (30 m)"
                : meta ? `${meta.resolution} m · ${meta.name} (${meta.producer}) · "${p.source}"`
                : `national source "${p.source}"`,
              url: `https://mapterhorn.com/attribution/#${p.source}`, overlay: "mapterhorn" }
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
        out.push(hit)
      }
      // Finest first; sources with no known resolution last (stable sort
      // keeps their render order).
      return out.sort((a, b) => (a.gsdM === b.gsdM ? 0 : a.gsdM - b.gsdM))
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
