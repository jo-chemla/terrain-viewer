import * as React from "react"
import { createPortal } from "react-dom"
import { useControl } from "react-map-gl/maplibre"
import { GeolocateControl as MaplibreGeolocateControl, type GeolocateControlOptions } from "maplibre-gl"
import { LocateFixed } from "lucide-react"
import type { ControlPosition } from "react-map-gl/maplibre"

interface GeolocateControlThemedProps extends GeolocateControlOptions {
  position?: ControlPosition
}

// Drop-in themed replacement for react-map-gl/maplibre's <GeolocateControl>.
// Same reasoning as NavigationControlThemed: the vendor icon is a
// background-image data URI with no `currentColor` hook, so a real
// lucide-react icon is portaled into the button's own `.maplibregl-ctrl-icon`
// span instead. The active/error tracking states are recolored via CSS
// (src/index.css) targeting the library's own state classes
// (.maplibregl-ctrl-geolocate-active etc.) — this component only supplies
// the icon shape, not per-state color.
export default function GeolocateControlThemed({ position, ...options }: GeolocateControlThemedProps) {
  const [iconEl, setIconEl] = React.useState<HTMLElement>()

  useControl<MaplibreGeolocateControl>(
    () => {
      const ctrl = new MaplibreGeolocateControl(options)
      const originalOnAdd = ctrl.onAdd.bind(ctrl)
      ;(ctrl as unknown as { onAdd: (map: unknown) => HTMLElement }).onAdd = (map: unknown) => {
        const container = originalOnAdd(map as Parameters<typeof originalOnAdd>[0])
        setIconEl(container.querySelector<HTMLElement>(".maplibregl-ctrl-geolocate .maplibregl-ctrl-icon") ?? undefined)
        return container
      }
      return ctrl
    },
    { position }
  )

  return iconEl ? createPortal(<LocateFixed size={16} />, iconEl) : null
}
