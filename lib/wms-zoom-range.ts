// The zooms a WMS layer actually draws at. A WMS answers any bbox, so a
// missing scale does not 404: it comes back as an empty image (BRGM's
// geological maps return a 116-byte transparent PNG outside each layer's
// scale range). The source's minzoom/maxzoom then decide whether MapLibre
// overzooms real pixels or shows nothing, and the capabilities' scale hints
// are often absent or off, so this asks the server: one 256 px tile at the
// given place per zoom, and keeps the zooms whose tile holds pixels.

const BBOX = "{bbox-epsg-3857}"
const R = 6378137
const HALF = Math.PI * R

function tileBbox(lng: number, lat: number, z: number): string {
  const x = (lng * Math.PI / 180) * R
  const y = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * R
  const size = (2 * HALF) / 2 ** z
  const x0 = Math.floor((x + HALF) / size) * size - HALF
  const y0 = Math.floor((y + HALF) / size) * size - HALF
  return [x0, y0, x0 + size, y0 + size].map((v) => v.toFixed(3)).join(",")
}

/** Whether an image response holds anything: not an error, not a tiny
 *  placeholder, and at least some non-transparent, non-uniform pixels. */
async function hasContent(res: Response): Promise<boolean> {
  if (!res.ok) return false
  const type = res.headers.get("content-type") ?? ""
  if (/xml|text|json/i.test(type)) return false // a ServiceException
  const blob = await res.blob()
  if (blob.size < 300) return false
  try {
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(32, 32)
    const g = c.getContext("2d")!
    g.drawImage(bmp, 0, 0, 32, 32)
    const d = g.getImageData(0, 0, 32, 32).data
    let opaque = 0, first = -1, varied = false
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      opaque++
      const v = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
      if (first === -1) first = v
      else if (v !== first) varied = true
    }
    return opaque > 4 && varied
  } catch {
    return blob.size > 1000
  }
}

/** The [minzoom, maxzoom] a WMS GetMap template draws at around (lng, lat),
 *  probing zooms `from`..`to` in parallel; null when no zoom drew anything
 *  (wrong place, or the server refuses the browser). */
export async function probeWmsZoomRange(template: string, lng: number, lat: number, from = 2, to = 20, signal?: AbortSignal): Promise<[number, number] | null> {
  if (!template.includes(BBOX)) return null
  const zooms = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const results = await Promise.all(zooms.map(async (z) => {
    try {
      const res = await fetch(template.split(BBOX).join(tileBbox(lng, lat, z)), { signal })
      return (await hasContent(res)) ? z : null
    } catch { return null }
  }))
  const ok = results.filter((z): z is number => z !== null)
  return ok.length ? [Math.min(...ok), Math.max(...ok)] : null
}
