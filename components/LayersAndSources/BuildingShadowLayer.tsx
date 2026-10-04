// Cast shadows of OSM buildings, the fast flat-ground way: each building's
// footprint is swept away from the sun by height / tan(sun altitude), on a
// level ground at the building's foot, and the result is rasterised into one
// canvas, then shown as an image (so overlapping shadows never darken twice,
// and with 3D terrain on the image drapes over it). Heights come from
// OpenFreeMap's OpenMapTiles "building" layer (render_height, from OSM height
// or building:levels, else a default), available from z13.
//
// Recomputed when the map settles and when the light moves; nothing per frame.
// The terrain-aware version (shadows falling on slopes, cast by terrain AND
// buildings) is the Shadows mode with a surface model; this is the cheap one.
import { memo, useEffect, useRef, useState } from "react"
import { Layer, Source, useMap } from "react-map-gl/maplibre"
import * as maplibregl from "maplibre-gl"
import { LAYER_SLOTS } from "./MapLayers"

const SRC = "osm-buildings-for-shadows"
const PROBE_LAYER = "osm-buildings-for-shadows-probe"
const IMG_SRC = "osm-building-shadows"
// OpenFreeMap's TileJSON: a versioned tile URL behind a stable name.
const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet"
const MIN_ZOOM = 13
const MAX_CANVAS = 4096
// Past this, a low sun's shadow is longer than anything useful to draw.
const MAX_SHADOW_M = 600

// Vector tiles cut buildings at tile edges plus a buffer, and MapLibre cuts
// the z14 data again for each overzoomed tile: those cut edges are not walls.
// They run exactly along a tile line (z14 and up) offset by the buffer, 1/128
// of a z14 tile, which a real wall practically never does.
function isClipEdge(x0: number, y0: number, x1: number, y1: number): boolean {
  const onCut = (v: number) => {
    for (let z = 14; z <= 22; z++) {
      const u = v * 2 ** z, d = Math.abs(u - Math.round(u)), buffer = 2 ** (z - 14) / 128
      if (buffer >= 0.5) break
      if (d < 1e-3 || Math.abs(d - buffer) < 1e-3) return true
    }
    return false
  }
  return (x0 === x1 && onCut(x0)) || (y0 === y1 && onCut(y0))
}

type Img = { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] }

export const BuildingShadowLayer = memo(({ enabled, opacity, sunAzimuth, sunAltitude, color = "#000000" }: {
  enabled: boolean
  opacity: number
  /** Compass bearing toward the sun, degrees. */
  sunAzimuth: number
  /** Sun height above the horizon, degrees. */
  sunAltitude: number
  color?: string
}) => {
  const { current: mapRef } = useMap()
  const [img, setImg] = useState<Img | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!enabled || !map) { setImg(null); return }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const draw = () => {
      if (cancelled) return
      if (!map.getSource(SRC) || map.getZoom() < MIN_ZOOM - 0.5 || sunAltitude <= 0.5) { setImg(null); return }
      const features = map.querySourceFeatures(SRC, { sourceLayer: "building" })
      if (!features.length) { setImg(null); return }
      const tan = Math.tan((sunAltitude * Math.PI) / 180)
      // Away from the sun, as a unit vector in mercator x (east) / y (south).
      const away = ((sunAzimuth + 180) * Math.PI) / 180
      const ux = Math.sin(away), uy = -Math.cos(away)
      // Footprints in mercator units plus each one's shadow offset.
      type Shape = { rings: [number, number][][]; dx: number; dy: number }
      const shapes: Shape[] = []
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const f of features) {
        const g = f.geometry
        if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue
        const h = Number(f.properties?.render_height ?? 0)
        if (!(h > 0)) continue
        const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
        for (const poly of polys) {
          const outer = poly[0]
          if (!outer?.length) continue
          const lat = outer[0][1]
          const lenM = Math.min(MAX_SHADOW_M, h / tan)
          // Mercator units per metre at this latitude.
          const perM = 1 / (40075016.686 * Math.cos((lat * Math.PI) / 180))
          const dx = ux * lenM * perM, dy = uy * lenM * perM
          const rings = poly.map((ring) => ring.map(([lng, la]) => {
            const m = maplibregl.MercatorCoordinate.fromLngLat([lng, la])
            return [m.x, m.y] as [number, number]
          }))
          for (const [x, y] of rings[0]) {
            minX = Math.min(minX, x, x + dx); maxX = Math.max(maxX, x, x + dx)
            minY = Math.min(minY, y, y + dy); maxY = Math.max(maxY, y, y + dy)
          }
          shapes.push({ rings, dx, dy })
        }
      }
      if (!shapes.length || !(maxX > minX) || !(maxY > minY)) { setImg(null); return }
      // About one canvas pixel per screen pixel at the current zoom, capped.
      const worldPx = 512 * 2 ** map.getZoom()
      const scale = Math.min(worldPx, MAX_CANVAS / Math.max(maxX - minX, maxY - minY))
      const W = Math.max(1, Math.ceil((maxX - minX) * scale)), H = Math.max(1, Math.ceil((maxY - minY) * scale))
      const canvas = document.createElement("canvas")
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext("2d")!
      const px = (x: number) => (x - minX) * scale, py = (y: number) => (y - minY) * scale
      ctx.fillStyle = color
      // One path, every piece wound the same way, filled once with nonzero:
      // the union of all shadows, with no anti-aliased seams between pieces.
      const piece = (pts: [number, number][]) => {
        let area = 0
        for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; area += x0 * y1 - x1 * y0 }
        const ordered = area < 0 ? [...pts].reverse() : pts
        ordered.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
        ctx.closePath()
      }
      // Walls: every edge of every ring swept from foot to tip (courtyard
      // walls cast into their courtyard), except the edges the tiling cut.
      ctx.beginPath()
      for (const { rings, dx, dy } of shapes) {
        for (const ring of rings) {
          for (let i = 0; i < ring.length - 1; i++) {
            const [x0, y0] = ring[i], [x1, y1] = ring[i + 1]
            if ((x0 === x1 && y0 === y1) || isClipEdge(x0, y0, x1, y1)) continue
            piece([[x0, y0], [x1, y1], [x1 + dx, y1 + dy], [x0 + dx, y0 + dy]])
          }
        }
      }
      ctx.fill("nonzero")
      // Roof outline at the tip: the footprint moved by the offset, holes kept.
      for (const { rings, dx, dy } of shapes) {
        ctx.beginPath()
        for (const ring of rings) ring.forEach(([x, y], i) => (i ? ctx.lineTo(px(x + dx), py(y + dy)) : ctx.moveTo(px(x + dx), py(y + dy))))
        ctx.fill("evenodd")
      }
      // Roofs are lit: cut the footprints back out (courtyards stay holes).
      ctx.globalCompositeOperation = "destination-out"
      for (const { rings } of shapes) {
        ctx.beginPath()
        for (const ring of rings) ring.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
        ctx.fill("evenodd")
      }
      const nw = new maplibregl.MercatorCoordinate(minX, minY).toLngLat()
      const se = new maplibregl.MercatorCoordinate(maxX, maxY).toLngLat()
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return
        const url = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setImg({ url, coordinates: [[nw.lng, nw.lat], [se.lng, nw.lat], [se.lng, se.lat], [nw.lng, se.lat]] })
      })
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 150) }
    // Building tiles arrive after the move ends: redraw when they do.
    const onData = (e: any) => { if (e.sourceId === SRC && e.isSourceLoaded) schedule() }
    map.on("moveend", schedule)
    map.on("sourcedata", onData)
    schedule()
    return () => { cancelled = true; clearTimeout(timer); map.off("moveend", schedule); map.off("sourcedata", onData) }
  }, [enabled, mapRef, sunAzimuth, sunAltitude, color])

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  if (!enabled) return null
  return (
    <>
      {/* The buildings themselves, drawn invisibly so their tiles load and
          querySourceFeatures can read them. */}
      <Source id={SRC} type="vector" url={OPENFREEMAP_TILEJSON}>
        <Layer id={PROBE_LAYER} type="fill" source-layer="building" minzoom={MIN_ZOOM} beforeId={LAYER_SLOTS.SHADOWS} paint={{ "fill-opacity": 0 }} />
      </Source>
      {img && (
        <Source id={IMG_SRC} type="image" url={img.url} coordinates={img.coordinates}>
          <Layer id="osm-building-shadows" type="raster" beforeId={LAYER_SLOTS.SHADOWS} paint={{ "raster-opacity": opacity, "raster-fade-duration": 0, "raster-resampling": "linear" }} />
        </Source>
      )}
    </>
  )
})
BuildingShadowLayer.displayName = "BuildingShadowLayer"
