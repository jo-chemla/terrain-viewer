import { useControl } from "react-map-gl/maplibre"
import MaplibreGeocoder from "@maplibre/maplibre-gl-geocoder"
import type { IControl } from "maplibre-gl"
import maplibregl from "maplibre-gl"

interface GeocoderControlProps {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right"
  placeholder?: string
}

export function GeocoderControl({
  position = "top-left",
  placeholder = "Search and press Enter",
}: GeocoderControlProps) {
  useControl<IControl>(
    () =>
      new MaplibreGeocoder(
        {
          forwardGeocode: async (config) => {
            const features: any[] = []
            try {
              const request = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
                config.query,
              )}&format=geojson&polygon_geojson=1&addressdetails=1`
              const response = await fetch(request)
              const geojson = await response.json()
              for (const feature of geojson.features) {
                const center = [
                  feature.bbox[0] + (feature.bbox[2] - feature.bbox[0]) / 2,
                  feature.bbox[1] + (feature.bbox[3] - feature.bbox[1]) / 2,
                ]
                features.push({
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: center,
                  },
                  place_name: feature.properties.display_name,
                  properties: feature.properties,
                  text: feature.properties.display_name,
                  place_type: ["place"],
                  center,
                })
              }
            } catch (err) {
              console.error("Geocoder error:", err)
            }
            return { features }
          },
          placeholder,
          language: "en",
        },
        { maplibregl },
      ),
    { position },
  )

  return null
}
