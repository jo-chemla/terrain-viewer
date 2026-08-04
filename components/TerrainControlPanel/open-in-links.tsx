import type React from "react"
import { useCallback } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { SquareArrowOutUpRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import type { MapRef } from "react-map-gl/maplibre"

type OpenInContext = {
  lat: number
  lng: number
  zoom: number
  bounds: { west: number; south: number; east: number; north: number } | null
  latestWaybackRelease: number | null
}

type OpenInDestination = {
  id: string
  label: string
  buildUrl: (ctx: OpenInContext) => string | null
}

// Viewport-aware "open the same spot in another historical-imagery viewer"
// launcher — URL templates adapted from Iconem's own historical-satellite
// LinksSection reference component (Google Earth Web, ESRI Wayback, BBBike
// MapCompare) plus two more Iconem tools (historical-satellite.iconem.com,
// search-eo-imagery.iconem.com), both using a #zoom/lat/lng fragment.
// Qiusheng Wu's Timelapse tool was dropped per request.
export const OPEN_IN_DESTINATIONS: OpenInDestination[] = [
  {
    id: "google-earth-web",
    label: "Google Earth Web",
    buildUrl: ({ lat, lng, zoom }) => {
      const altitude = ((38000 * 4096) / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180)
      return `https://earth.google.com/web/@${lat},${lng},0a,${altitude}d,35y,0h,0t,0r/data=CgwqBggBEgAYAUICCAE6AwoBMEoNCP___________wEQAA`
    },
  },
  {
    id: "esri-wayback",
    label: "ESRI Wayback Machine",
    buildUrl: ({ lat, lng, zoom, latestWaybackRelease }) => {
      if (!latestWaybackRelease) return null
      return `https://livingatlas.arcgis.com/wayback/#mapCenter=${lng}%2C${lat}%2C${Math.round(zoom)}&mode=explore&active=${latestWaybackRelease}`
    },
  },
  {
    id: "bbbike-mapcompare",
    label: "BBBike MapCompare",
    buildUrl: ({ lat, lng, zoom }) =>
      `https://mc.bbbike.org/mc/?lon=${lng}&lat=${lat}&zoom=${Math.round(zoom)}&num=4&mt0=mapnik-german&mt1=cyclemap&mt2=bing-hybrid`,
  },
  {
    id: "iconem-historical",
    label: "Iconem Historical Satellite",
    buildUrl: ({ lat, lng, zoom }) => `https://historical-satellite.iconem.com/#${Math.round(zoom)}/${lat}/${lng}`,
  },
  {
    id: "iconem-search-eo",
    label: "Iconem Search-EO",
    buildUrl: ({ lat, lng, zoom }) => `https://search-eo-imagery.iconem.com/#${Math.round(zoom)}/${lat}/${lng}`,
  },
]

const DEFAULT_SELECTED = ["google-earth-web"]
export const openInSelectedAtom = atomWithStorage<string[]>("openInSelectedDestinations", DEFAULT_SELECTED)

export const OpenInLinksButton: React.FC<{
  state: any
  mapRef: React.RefObject<MapRef>
  waybackLatestRelease: number | null
}> = ({ state, mapRef, waybackLatestRelease }) => {
  const [selectedIds, setSelectedIds] = useAtom(openInSelectedAtom)

  const buildContext = useCallback((): OpenInContext => {
    const bounds = mapRef.current?.getMap()?.getBounds()
    return {
      lat: state.lat,
      lng: state.lng,
      zoom: state.zoom,
      bounds: bounds ? { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() } : null,
      latestWaybackRelease: waybackLatestRelease,
    }
  }, [mapRef, state.lat, state.lng, state.zoom, waybackLatestRelease])

  // Opens each of the given destination ids in its own new tab. Multiple
  // window.open() calls made synchronously within one click handler (as
  // this always is) aren't treated as popups by Chrome/Firefox — only calls
  // made outside a direct user gesture get blocked — so opening several at
  // once works fine.
  const openDestinations = useCallback((ids: string[]) => {
    const ctx = buildContext()
    for (const id of ids) {
      const dest = OPEN_IN_DESTINATIONS.find((d) => d.id === id)
      const url = dest?.buildUrl(ctx)
      if (url) window.open(url, "_blank", "noopener,noreferrer")
    }
  }, [buildContext])

  const toggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const set = new Set(prev)
      if (checked) set.add(id)
      else set.delete(id)
      // Never allow zero selected — same "always at least one" rule as the
      // source/resolution pills elsewhere in this panel.
      return set.size ? Array.from(set) : [id]
    })
  }, [setSelectedIds])

  // Clicking a destination's own trailing "open" icon opens THAT ONE right
  // away and remembers it as the sole selection — so next time the user
  // just clicks the main button instead of reopening the dropdown.
  const openAndRemember = useCallback((id: string) => {
    openDestinations([id])
    setSelectedIds([id])
  }, [openDestinations, setSelectedIds])

  const handleOpen = useCallback(() => openDestinations(selectedIds), [openDestinations, selectedIds])

  const buttonLabel = selectedIds.length === 1
    ? (OPEN_IN_DESTINATIONS.find((d) => d.id === selectedIds[0])?.label ?? "Multiple")
    : "Multiple"

  return (
    <div className="flex items-center rounded-md border border-border bg-background overflow-hidden shrink-0">
      <button
        type="button"
        onClick={handleOpen}
        className="cursor-pointer flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title={`Open in ${buttonLabel}`}
      >
        <SquareArrowOutUpRight className="h-3 w-3 shrink-0" />
        <span>Open in {buttonLabel}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                "cursor-pointer h-full px-1 py-0.5 rounded-r-md text-muted-foreground border-l border-border",
                "hover:bg-accent hover:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground",
              )}
              aria-label="Choose destination(s)"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-80">
          <p className="text-[10px] text-muted-foreground px-2 py-1.5">Check to include in "Open in Multiple" — use the open icon to open now and use it next time.</p>
          {OPEN_IN_DESTINATIONS.map((dest) => (
            <DropdownMenuCheckboxItem
              key={dest.id}
              checked={selectedIds.includes(dest.id)}
              onCheckedChange={(checked) => toggle(dest.id, !!checked)}
              className="pr-1"
            >
              <span className="flex-1">{dest.label}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openAndRemember(dest.id) }}
                className="cursor-pointer p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground shrink-0"
                title={`Open ${dest.label} now`}
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
