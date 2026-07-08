// maplibre-contour generates contour geometry independently per vector tile (see
// ContoursLayer.tsx), so a contour line crossing a tile boundary comes back from
// queryRenderedFeatures as several disconnected LineString features that happen to
// share an endpoint, rather than one continuous line. This stitches those segments
// back together before export, so a downstream GIS tool sees one feature per contour
// line instead of one per tile it happened to cross.
export function mergeContourLines(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const lineFeatures = features.filter(
    (f): f is GeoJSON.Feature<GeoJSON.LineString> => f.geometry?.type === "LineString"
  )
  const otherFeatures = features.filter((f) => f.geometry?.type !== "LineString")

  // Only ever merge segments that belong to the same contour level — merging across
  // elevations would silently corrupt the data.
  const groups = new Map<string, GeoJSON.Feature<GeoJSON.LineString>[]>()
  for (const f of lineFeatures) {
    const key = String(f.properties?.ele ?? "")
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  const pointKey = (pt: number[]) => pt.map((v) => v.toFixed(6)).join(",")
  const merged: GeoJSON.Feature[] = [...otherFeatures]

  for (const [key, group] of groups) {
    const lines = group.map((f) => f.geometry.coordinates.slice())

    let mergedSomething = true
    while (mergedSomething) {
      mergedSomething = false
      outer: for (let i = 0; i < lines.length; i++) {
        for (let j = 0; j < lines.length; j++) {
          if (i === j) continue
          const a = lines[i]
          const b = lines[j]
          if (pointKey(a[a.length - 1]) === pointKey(b[0])) {
            lines[i] = a.concat(b.slice(1))
          } else if (pointKey(a[a.length - 1]) === pointKey(b[b.length - 1])) {
            lines[i] = a.concat(b.slice(0, -1).reverse())
          } else if (pointKey(a[0]) === pointKey(b[b.length - 1])) {
            lines[i] = b.concat(a.slice(1))
          } else {
            continue
          }
          lines.splice(j, 1)
          mergedSomething = true
          break outer
        }
      }
    }

    for (const coordinates of lines) {
      merged.push({
        type: "Feature",
        properties: key === "" ? {} : { ele: Number(key) },
        geometry: { type: "LineString", coordinates },
      })
    }
  }

  return merged
}
