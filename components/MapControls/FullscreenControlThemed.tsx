import * as React from "react"
import { createPortal } from "react-dom"
import { useControl } from "react-map-gl/maplibre"
import { FullscreenControl as MaplibreFullscreenControl, type FullscreenControlOptions } from "maplibre-gl"
import { Maximize, Minimize } from "lucide-react"
import type { ControlPosition } from "react-map-gl/maplibre"

interface FullscreenControlThemedProps extends FullscreenControlOptions {
  position?: ControlPosition
}

// Themed replacement for maplibre's FullscreenControl, same technique as
// GeolocateControlThemed: a lucide icon portaled into the button's own icon
// span. Fullscreens the whole app root (side panel and timeline included),
// not just the canvas - mainly for the embedded (iframe) case, where the
// map is small. Which icon shows follows the library's own
// .maplibregl-ctrl-shrink class toggle.
export default function FullscreenControlThemed({ position, ...options }: FullscreenControlThemedProps) {
  const [iconEl, setIconEl] = React.useState<HTMLElement>()
  const [isFull, setIsFull] = React.useState(false)

  useControl<MaplibreFullscreenControl>(
    () => {
      const ctrl = new MaplibreFullscreenControl({ container: document.getElementById("root") ?? undefined, ...options })
      const originalOnAdd = ctrl.onAdd.bind(ctrl)
      ;(ctrl as unknown as { onAdd: (map: unknown) => HTMLElement }).onAdd = (map: unknown) => {
        const container = originalOnAdd(map as Parameters<typeof originalOnAdd>[0])
        setIconEl(container.querySelector<HTMLElement>(".maplibregl-ctrl-fullscreen .maplibregl-ctrl-icon, .maplibregl-ctrl-shrink .maplibregl-ctrl-icon") ?? undefined)
        return container
      }
      return ctrl
    },
    { position }
  )

  React.useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  return iconEl ? createPortal(isFull ? <Minimize size={16} /> : <Maximize size={16} />, iconEl) : null
}
