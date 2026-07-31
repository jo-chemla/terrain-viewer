import { zipSync, strToU8 } from "fflate"

export function downloadGeoJSON(features: GeoJSON.Feature[], filenamePrefix: string) {
  const geojson = { type: "FeatureCollection" as const, features }
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filenamePrefix}-${Date.now()}.geojson`
  a.click()
  URL.revokeObjectURL(url)
}

/** Filesystem-safe-ish stem from a layer name — collapses anything outside
 *  word chars/dash/space into "-" so a layer named e.g. "Site A/B" doesn't
 *  produce a nested path inside the zip. */
function slugifyLayerName(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, "-").replace(/\s+/g, "_") || "layer"
}

/** One .geojson per drawing layer, bundled into a single .zip — the
 *  alternative to downloadGeoJSON's single flattened FeatureCollection.
 *  Features already carry their origin layer via `properties.layerId` (see
 *  resolveLayer in TerraDrawSystem.tsx) so no data is actually lost by the
 *  flattened export; this just also offers the split when someone wants each
 *  layer as its own re-importable file instead of hunting through one
 *  combined FeatureCollection by layerId. Layers with zero features are
 *  skipped — an empty .geojson isn't useful to anyone re-importing this. */
export function downloadGeoJSONByLayer(
  features: GeoJSON.Feature[],
  layers: Array<{ id: string; name: string }>,
  filenamePrefix: string,
) {
  const fallbackLayerId = layers[0]?.id
  const byLayerId = new Map<string, GeoJSON.Feature[]>()
  for (const f of features) {
    const layerId = (f.properties as any)?.layerId ?? fallbackLayerId
    const bucket = byLayerId.get(layerId) ?? []
    bucket.push(f)
    byLayerId.set(layerId, bucket)
  }

  const usedNames = new Set<string>()
  const entries: Record<string, Uint8Array> = {}
  for (const layer of layers) {
    const layerFeatures = byLayerId.get(layer.id)
    if (!layerFeatures?.length) continue
    let name = slugifyLayerName(layer.name)
    // Two layers with the same (slugified) name would otherwise silently
    // collide inside the zip — de-dupe with a numeric suffix.
    if (usedNames.has(name)) {
      let n = 2
      while (usedNames.has(`${name}-${n}`)) n++
      name = `${name}-${n}`
    }
    usedNames.add(name)
    const geojson = { type: "FeatureCollection" as const, features: layerFeatures }
    entries[`${name}.geojson`] = strToU8(JSON.stringify(geojson, null, 2))
  }

  const bytes = zipSync(entries, { level: 0 })
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filenamePrefix}-${Date.now()}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
