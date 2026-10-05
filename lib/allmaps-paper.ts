// The paper colour of a georeferenced IIIF map, and how far from it a pixel
// can be and still count as paper: the settings Allmaps' "remove background
// colour" needs, found from the image instead of picked by hand.
//
// The map's smallest IIIF rendition (256 px, one request) is drawn inside
// its georeference mask, so the margins the mask already cuts do not count.
// The luminance histogram of a scanned map is bimodal, paper and ink; Otsu's
// split (the threshold maximising the between-class variance) separates the
// two bells. The paper is the brighter class, unless the darker one is more
// than twice as large (a dark scan, a blueprint). Its colour is the
// per-channel median of its pixels; the threshold is a distance in Allmaps'
// own space (RGB in 0..1, Euclidean, what its shader compares): far enough to
// take 90% of the paper pixels, never past halfway to the ink's nearest
// quarter, so lines and lettering stay.
const cache = new Map<string, Promise<PaperEstimate | null>>()

export interface PaperEstimate {
  /** "#rrggbb" */
  color: string
  /** Distance in RGB 0..1 (Allmaps' removeColorThreshold). */
  threshold: number
  /** Luminance (0..1) of each mode of the smoothed histogram, brightest last. */
  modes: number[]
  /** Otsu's split, luminance 0..1. */
  split: number
  /** Share of the masked pixels within the threshold of the paper colour. */
  paperShare: number
  /** Otsu's separability (between-class over total variance, 0..1): how
   *  cleanly the luminance splits in two (shown, not used: a paper bell
   *  with a long ink tail scores 0.6 to 0.7 whatever the map). */
  separability: number
  /** Whether the removal should apply. */
  confident: boolean
}

const MIN_PAPER_SHARE = 0.4

const BINS = 64
const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")

/** The annotation's first map: its IIIF image service and mask polygon. */
async function imageAndMask(annotationUrl: string, signal?: AbortSignal): Promise<{ service: string; width: number; height: number; mask: [number, number][] | null } | null> {
  const res = await fetch(annotationUrl, { signal })
  if (!res.ok) return null
  const d = await res.json()
  const a = d.type === "AnnotationPage" ? d.items?.[0] : d
  const source = a?.target?.source
  const service: string | undefined = source?.id ?? source?.["@id"]
  if (!service) return null
  const svg: string = a?.target?.selector?.value ?? ""
  const pts = /points="([^"]+)"/.exec(svg)?.[1]
  const mask = pts ? pts.trim().split(/\s+/).map((p) => p.split(",").map(Number) as [number, number]).filter((p) => p.length === 2 && p.every(Number.isFinite)) : null
  return { service: service.replace(/\/info\.json$/, "").replace(/\/+$/, ""), width: Number(source.width) || 0, height: Number(source.height) || 0, mask: mask && mask.length >= 3 ? mask : null }
}

/** Paper colour and threshold for one annotation, cached per URL. */
export function estimatePaper(annotationUrl: string, signal?: AbortSignal): Promise<PaperEstimate | null> {
  let p = cache.get(annotationUrl)
  if (!p) {
    p = run(annotationUrl, signal).catch(() => null)
    cache.set(annotationUrl, p)
  }
  return p
}

async function run(annotationUrl: string, signal?: AbortSignal): Promise<PaperEstimate | null> {
  const info = await imageAndMask(annotationUrl, signal)
  if (!info) return null
  // `!256,256` fits the whole image in 256 px: IIIF Image API 2 and 3 both take it.
  const res = await fetch(`${info.service}/full/!256,256/0/default.jpg`, { signal })
  if (!res.ok) return null
  const bmp = await createImageBitmap(await res.blob())
  const w = bmp.width, h = bmp.height
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  if (info.mask && info.width && info.height) {
    const sx = w / info.width, sy = h / info.height
    ctx.beginPath()
    info.mask.forEach(([x, y], i) => (i ? ctx.lineTo(x * sx, y * sy) : ctx.moveTo(x * sx, y * sy)))
    ctx.closePath()
    ctx.clip()
  }
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return estimateFromPixels(ctx.getImageData(0, 0, w, h).data)
}

/** The estimate from RGBA pixels (transparent ones, outside the mask, skipped). */
export function estimateFromPixels(data: Uint8ClampedArray): PaperEstimate | null {
  const lum: number[] = [], rs: number[] = [], gs: number[] = [], bs: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    rs.push(r); gs.push(g); bs.push(b)
    lum.push((0.299 * r + 0.587 * g + 0.114 * b) / 255)
  }
  const n = lum.length
  if (n < 100) return null
  const hist = new Array<number>(BINS).fill(0)
  for (const l of lum) hist[Math.min(BINS - 1, Math.floor(l * BINS))]++
  // Otsu on the histogram.
  let sumAll = 0
  for (let i = 0; i < BINS; i++) sumAll += i * hist[i]
  let total = 0
  for (let i = 0; i < BINS; i++) total += hist[i] * (i - sumAll / n) ** 2
  let wB = 0, sumB = 0, best = -1, split = BINS / 2
  for (let t = 0; t < BINS; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; split = t + 1 }
  }
  const splitLum = split / BINS
  const separability = total > 0 ? best / n / total : 0
  // The modes: local maxima of the histogram smoothed over 5 bins, at least
  // 1% of the highest, for the tooltip ("two bells").
  const smooth = hist.map((_, i) => { let s = 0, c = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < BINS) { s += hist[j]; c++ } } return s / c })
  const peak = Math.max(...smooth)
  const modes: number[] = []
  for (let i = 0; i < BINS; i++) {
    const v = smooth[i]
    if (v >= 0.01 * peak && (i === 0 || v >= smooth[i - 1]) && (i === BINS - 1 || v > smooth[i + 1])) modes.push((i + 0.5) / BINS)
  }
  const bright: number[] = [], dark: number[] = []
  for (let i = 0; i < n; i++) (lum[i] >= splitLum ? bright : dark).push(i)
  const paper = dark.length > 2 * bright.length ? dark : bright
  const ink = paper === bright ? dark : bright
  const median = (arr: number[], ch: number[]) => { const v = arr.map((i) => ch[i]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0 }
  const pr = median(paper, rs), pg = median(paper, gs), pb = median(paper, bs)
  const dist = (i: number) => Math.hypot(rs[i] - pr, gs[i] - pg, bs[i] - pb) / 255
  // The paper in Allmaps' own space: every pixel's distance to the paper
  // colour, histogrammed. The paper is the peak near zero (stains, shading
  // and the scan's vignette widen it), the ink a long tail beyond; the
  // threshold is where the peak has fallen to an eighth of its height, or
  // the valley before the tail rises again, whichever comes first.
  const D_BINS = 120, D_MAX = 0.6, binW = D_MAX / D_BINS
  const dh = new Array<number>(D_BINS).fill(0)
  const dists = new Float32Array(n)
  for (let i = 0; i < n; i++) { const d = dist(i); dists[i] = d; dh[Math.min(D_BINS - 1, Math.floor(d / binW))]++ }
  const ds = dh.map((_, i) => (dh[Math.max(0, i - 1)] + dh[i] + dh[Math.min(D_BINS - 1, i + 1)]) / 3)
  let pk = 0
  for (let i = 1; i < 40; i++) if (ds[i] > ds[pk]) pk = i
  let j = pk
  while (j < D_BINS - 3) {
    if (ds[j] < ds[pk] / 8) break
    if (ds[j] < ds[pk] / 2 && ds[j] <= ds[j + 1] && ds[j + 2] > ds[j] * 1.15) break
    j++
  }
  const threshold = Math.max(0.04, Math.min(0.6, (j + 0.5) * binW))
  let within = 0
  for (let i = 0; i < n; i++) if (dists[i] < threshold) within++
  const paperMass = within / n
  const paperLum = (0.299 * pr + 0.587 * pg + 0.114 * pb) / 255
  const paperShare = paper.length / n
  return {
    color: `#${hex(pr)}${hex(pg)}${hex(pb)}`, threshold: +threshold.toFixed(3), modes, split: +splitLum.toFixed(3),
    paperShare: +paperMass.toFixed(3), separability: +separability.toFixed(3),
    // A light paper holding a good part of the sheet; a drawing that fills
    // the sheet (an engraving, a grey bird's-eye view) has none to remove.
    confident: paperMass >= MIN_PAPER_SHARE && paperLum >= 0.78 && paperShare >= MIN_PAPER_SHARE,
  }
}
