import { useEffect, useRef, useState, type RefObject } from "react"
import type * as maplibregl from "maplibre-gl"
import type { MapRef } from "react-map-gl/maplibre"

type Refs = RefObject<MapRef | null>[] | undefined

function liveMaps(primary: RefObject<MapRef | null> | undefined, views: Refs): maplibregl.Map[] {
  const out: maplibregl.Map[] = []
  const add = (ref: RefObject<MapRef | null> | undefined) => {
    const m = ref?.current?.getMap() as maplibregl.Map | undefined
    // `style._loaded`, not isStyleLoaded(): the latter is false whenever a
    // source is still loading tiles, which is most of the time.
    if (m && (m as any).style?._loaded && !out.includes(m)) out.push(m)
  }
  add(primary)
  for (const ref of views ?? []) add(ref)
  return out
}

/**
 * The MapLibre maps of every view on screen, view A first. A tool that
 * listens for clicks or draws markers and layers does it on each of them, so
 * it works on whichever view the pointer is over.
 *
 * Views mount and unmount with the layout (split off, 2x1, 4x2, overlay) and
 * a ref gives no signal when its map appears, so the refs are polled twice a
 * second. The returned array keeps its identity until the set changes: it is
 * safe as an effect dependency.
 */
export function useViewMaps(primary: RefObject<MapRef | null> | undefined, views?: Refs): maplibregl.Map[] {
  const [maps, setMaps] = useState<maplibregl.Map[]>(() => liveMaps(primary, views))
  const viewsRef = useRef(views)
  viewsRef.current = views
  useEffect(() => {
    const sync = () => {
      const next = liveMaps(primary, viewsRef.current)
      setMaps((prev) => (prev.length === next.length && prev.every((m, i) => m === next[i]) ? prev : next))
    }
    sync()
    const timer = setInterval(sync, 500)
    return () => clearInterval(timer)
  }, [primary])
  return maps
}
