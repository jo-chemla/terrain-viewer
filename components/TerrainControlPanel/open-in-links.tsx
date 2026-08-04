import type React from "react"
import { useCallback } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { SquareArrowOutUpRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
// LinksSection reference component. Two destinations from that reference
// (Histogram Matching JS, NextGIS QMS, Google Timelapse, GitHub/credit links)
// are deliberately left out — only the ones the user explicitly asked for.
// "Iconem Search-EO" isn't included: no confirmed URL for it, so rather than
// guess one and ship a broken/wrong link, it's left out until that URL is
// known.
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
    buildUrl: ({ bounds, latestWaybackRelease }) => {
      if (!bounds || !latestWaybackRelease) return null
      return `https://livingatlas.arcgis.com/wayback/#active=${latestWaybackRelease}&ext=${bounds.west},${bounds.south},${bounds.east},${bounds.north}&localChangesOnly=true`
    },
  },
  {
    id: "bbbike-mapcompare",
    label: "BBBike MapCompare",
    buildUrl: ({ lat, lng, zoom }) =>
      `https://mc.bbbike.org/mc/?lon=${lng}&lat=${lat}&zoom=${Math.round(zoom)}&num=4&mt0=mapnik-german&mt1=cyclemap&mt2=bing-hybrid`,
  },
  {
    id: "qiusheng-timelapse",
    label: "Qiusheng Wu Landsat/Sentinel Timelapse",
    // Not viewport-parameterized in the reference implementation either —
    // this tool doesn't accept lat/lng/zoom query params.
    buildUrl: () => "https://giswqs-streamlit.hf.space/Timelapse",
  },
  {
    id: "iconem-historical",
    label: "Iconem Historical (GE Time Machine)",
    buildUrl: () => "https://ge-timemachine.prod.heritagewatch.ai/",
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

  const handleOpen = useCallback(() => {
    const bounds = mapRef.current?.getMap()?.getBounds()
    const ctx: OpenInContext = {
      lat: state.lat,
      lng: state.lng,
      zoom: state.zoom,
      bounds: bounds ? { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() } : null,
      latestWaybackRelease: waybackLatestRelease,
    }
    for (const dest of OPEN_IN_DESTINATIONS) {
      if (!selectedIds.includes(dest.id)) continue
      const url = dest.buildUrl(ctx)
      if (url) window.open(url, "_blank", "noopener,noreferrer")
    }
  }, [mapRef, state.lat, state.lng, state.zoom, waybackLatestRelease, selectedIds])

  const buttonLabel = selectedIds.length === 1
    ? (OPEN_IN_DESTINATIONS.find((d) => d.id === selectedIds[0])?.label ?? "Multiple")
    : "Multiple"

  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0">
      <button
        type="button"
        onClick={handleOpen}
        className="cursor-pointer flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground max-w-[130px]"
        title={`Open in ${buttonLabel}`}
      >
        <SquareArrowOutUpRight className="h-3 w-3 shrink-0" />
        <span className="truncate">Open in {buttonLabel}</span>
      </button>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "cursor-pointer px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground border-l border-border",
              )}
              aria-label="Choose destination(s)"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          }
        />
        <PopoverContent className="w-72 p-2 space-y-1">
          {OPEN_IN_DESTINATIONS.map((dest) => (
            <label key={dest.id} className="flex items-center gap-2 text-xs cursor-pointer py-1 px-1 rounded hover:bg-accent">
              <Checkbox
                checked={selectedIds.includes(dest.id)}
                onCheckedChange={(checked) => toggle(dest.id, !!checked)}
                className="cursor-pointer"
              />
              {dest.label}
            </label>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
