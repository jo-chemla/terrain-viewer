// The ground resolution of a georeferenced IIIF map, from its control
// points: an Allmaps annotation carries no resolution, but each control
// point pairs an image pixel with a place, so the ground distance over the
// pixel distance between two points is the metres per pixel. The median over
// the pairs (the first dozen points) rides over a bad point.
import { distance } from "@turf/turf"

export function gsdFromGcps(gcps: { resource: [number, number]; geo: [number, number] }[]): number | undefined {
  const ratios: number[] = []
  const n = Math.min(gcps.length, 12)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = gcps[i], b = gcps[j]
      const px = Math.hypot(a.resource[0] - b.resource[0], a.resource[1] - b.resource[1])
      if (!(px > 50)) continue
      const m = distance(a.geo, b.geo, { units: "meters" })
      if (Number.isFinite(m) && m > 0) ratios.push(m / px)
    }
  }
  if (!ratios.length) return undefined
  ratios.sort((a, b) => a - b)
  return ratios[Math.floor(ratios.length / 2)]
}

/** Metres per pixel of the first map of an Allmaps Georeference Annotation
 *  (an annotation or an annotation page), from its control points. */
export async function allmapsAnnotationGsd(annotationUrl: string, signal?: AbortSignal): Promise<number | undefined> {
  const res = await fetch(annotationUrl, { signal })
  if (!res.ok) return undefined
  const d = await res.json()
  const a = d?.type === "AnnotationPage" ? d.items?.[0] : d
  const feats: any[] = a?.body?.features ?? []
  return gsdFromGcps(feats
    .map((f) => ({ resource: f?.properties?.resourceCoords as [number, number], geo: f?.geometry?.coordinates as [number, number] }))
    .filter((g) => Array.isArray(g.resource) && g.resource.length === 2 && Array.isArray(g.geo) && g.geo.length === 2))
}
