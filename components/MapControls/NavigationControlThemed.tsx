import * as React from "react"
import { createPortal } from "react-dom"
import { useControl } from "react-map-gl/maplibre"
import { NavigationControl as MaplibreNavigationControl } from "maplibre-gl"
import { Plus, Minus, Navigation2 } from "lucide-react"
import type { ControlPosition } from "react-map-gl/maplibre"

interface NavigationControlThemedProps {
  position?: ControlPosition
  showCompass?: boolean
  showZoom?: boolean
  visualizePitch?: boolean
}

// Drop-in themed replacement for react-map-gl/maplibre's <NavigationControl>.
// The vendor zoom-in/zoom-out/compass icons are background-image data URIs
// baked with a fixed #333 fill — no `fill`/`currentColor` hook, so the only
// prior way to recolor them for dark mode was a blanket CSS `invert()`
// filter (see src/index.css history). Portaling a real lucide-react icon
// into each button's own `.maplibregl-ctrl-icon` span (rather than replacing
// the span itself) instead lets the icon inherit `color` like every other
// icon in the app, while leaving the span as the exact node the library
// already targets for compass rotation (`_compassIcon.style.transform`,
// set directly by maplibre-gl on pitch/rotate) untouched and still working.
export default function NavigationControlThemed({
  position,
  showCompass = true,
  showZoom = true,
  visualizePitch,
}: NavigationControlThemedProps) {
  const [icons, setIcons] = React.useState<{
    zoomIn?: HTMLElement
    zoomOut?: HTMLElement
    compass?: HTMLElement
  }>({})

  useControl<MaplibreNavigationControl>(
    () => {
      const ctrl = new MaplibreNavigationControl({ showCompass, showZoom, visualizePitch })
      // `_zoomInButton`/`_zoomOutButton`/`_compassIcon` only exist once onAdd
      // runs (react-map-gl's useControl calls it after this factory returns),
      // so the icon spans are grabbed from the real container it returns.
      const originalOnAdd = ctrl.onAdd.bind(ctrl)
      ;(ctrl as unknown as { onAdd: (map: unknown) => HTMLElement }).onAdd = (map: unknown) => {
        const container = originalOnAdd(map as Parameters<typeof originalOnAdd>[0])
        setIcons({
          zoomIn: container.querySelector<HTMLElement>(".maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon") ?? undefined,
          zoomOut: container.querySelector<HTMLElement>(".maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon") ?? undefined,
          compass: container.querySelector<HTMLElement>(".maplibregl-ctrl-compass .maplibregl-ctrl-icon") ?? undefined,
        })
        return container
      }
      return ctrl
    },
    { position }
  )

  return (
    <>
      {icons.zoomIn && createPortal(<Plus size={16} />, icons.zoomIn)}
      {icons.zoomOut && createPortal(<Minus size={16} />, icons.zoomOut)}
      {icons.compass && createPortal(<Navigation2 size={16} />, icons.compass)}
    </>
  )
}
