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
