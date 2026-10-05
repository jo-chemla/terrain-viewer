// The extent of a georeferenced IIIF map, from its Georeference Annotation:
// the box of the control points' geographic coordinates (the warped image
// reaches a little past them, enough for zoom-to-fit). One annotation, or
// an annotation page holding several.
export async function allmapsAnnotationBounds(url: string, signal?: AbortSignal): Promise<[number, number, number, number] | undefined> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return undefined
    const d = await res.json()
    const items: any[] = d.type === "AnnotationPage" ? d.items ?? [] : [d]
    const pts: [number, number][] = []
    for (const a of items) for (const f of a.body?.features ?? []) {
      const c = f.geometry?.coordinates
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) pts.push([c[0], c[1]])
    }
    if (pts.length < 2) return undefined
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
  } catch { return undefined }
}
