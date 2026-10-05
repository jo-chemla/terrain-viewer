// The footprints of the historical catalog items the timeline found for
// the view (lib/timeline-catalogs.ts, catalogFootprintsAtom), as faint
// outlines in each catalog's colour, when the picker's "Footprints on the
// map" is on. Drawn on every view. The fill layer stays for hit-testing
// (CoverageOverlayLayer lists and clicks these like the coverage overlays).
import type React from "react"
import { Source, Layer } from "react-map-gl/maplibre"
import { useAtomValue } from "jotai"
import { catalogFootprintsAtom } from "@/lib/timeline-catalogs"
import { LAYER_SLOTS } from "./MapLayers"
import { coverageVisibleAtom, coverageOutlineOnlyAtom } from "@/lib/settings-atoms"

export const CATALOG_FOOTPRINTS_FILL_ID = "catalog-footprints-fill"

export const CatalogFootprintsLayer: React.FC = () => {
  const fc = useAtomValue(catalogFootprintsAtom)
  const visible = useAtomValue(coverageVisibleAtom)
  const outlineOnly = useAtomValue(coverageOutlineOnlyAtom)
  if (!fc || !fc.features.length || !visible) return null
  return (
    <Source id="catalog-footprints" type="geojson" data={fc}>
      <Layer id={CATALOG_FOOTPRINTS_FILL_ID} type="fill" beforeId={LAYER_SLOTS.CONTOURS} paint={{ "fill-color": ["get", "color"], "fill-opacity": outlineOnly ? 0 : 0.02 }} />
      <Layer id="catalog-footprints-line" type="line" beforeId={LAYER_SLOTS.CONTOURS} paint={{ "line-color": ["get", "color"], "line-width": outlineOnly ? 2 : 1, "line-opacity": outlineOnly ? 0.6 : 0.35 }} />
    </Source>
  )
}
