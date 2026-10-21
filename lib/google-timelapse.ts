// Google Earth Timelapse: the annual global mosaics behind the Timelapse
// viewer (https://earthengine.google.com/timelapse/), 1984 to 2022, 30 m
// (Landsat 4 to 8) then about 19 m (Sentinel-2 fused with Landsat 8 and 9),
// as Web Mercator raster tiles, registered as `gtimelapse://`.
//
//   gtimelapse://{z}/{x}/{y}?year=YYYY
//
// The dataset itself is published in the Earth Engine Data Catalog
// (projects/ee-earth-timelapse/assets/annual, CC BY 4.0), which only serves
// tiles to an authenticated Earth Engine project. The viewer, though, reads
// its tiles from a public Cloud Storage bucket with an open CORS header, one
// VP9 WebM video per tile for zooms 0 to 12: 512 px square, 5 frames a
// second, one frame per year, 1984 first. So a year is a frame: the video of
// the tile is fetched once (cached here, it carries every year), a video
// element is seeked to the frame, and the frame is handed to MapLibre as a
// bitmap. Switching years re-seeks the cached videos and fetches nothing.
//
// The source is declared with 256 px tiles, as every other raster basemap
// here: a 256 px tile at zoom z is one quadrant of the 512 px frame at zoom
// z - 1, so the source's maxzoom is 13 with the finest video at 12, and the
// zoom-0 tile is the zoom-0 frame halved. Deeper zooms read the zoom-12
// frame's sub-square, which MapLibre would overzoom anyway.
//
// The bucket layout (a dated build folder) is the viewer's own, not a
// documented endpoint, and may move; the dataset's attribution applies:
// "Google Earth Timelapse (Google, Landsat, Copernicus)". Methodology and
// limitations: https://developers.google.com/earth-engine/timelapse/about
// (pre-1999 gaps are interpolated between the neighbouring years, so a
// sudden change in a data gap appears as a gradual one).

export const TIMELAPSE_FIRST_YEAR = 1984
export const TIMELAPSE_LAST_YEAR = 2022
export const TIMELAPSE_YEARS: number[] = Array.from({ length: TIMELAPSE_LAST_YEAR - TIMELAPSE_FIRST_YEAR + 1 }, (_, i) => TIMELAPSE_FIRST_YEAR + i)
/** The source's maxzoom for 256 px tiles: the finest video level plus one. */
export const TIMELAPSE_MAXZOOM = 13
export const TIMELAPSE_ATTRIBUTION = "Google Earth Timelapse (Google, Landsat, Copernicus)"

const ROOT = "https://storage.googleapis.com/earthengine-timelapse/2023/earth/20230206"
const VIDEO_MAXZOOM = 12
const FPS = 5
const FRAME = 512
const TILE = 256

export function timelapseTileUrl(year: number): string {
  return `gtimelapse://{z}/{x}/{y}?year=${year}`
}

const URL_RE = /^gtimelapse:\/\/(\d+)\/(\d+)\/(\d+)\?year=(\d{4})$/

// ── Video cache ───────────────────────────────────────────────────────────
// One entry per video tile, every year inside. Bounded by bytes: a coastal
// zoom-5 tile is near a megabyte, inland tiles at high zoom a few hundred
// kilobytes, so the budget holds a few hundred tiles, a couple of screens
// at any zoom with their years already decoded.
interface CachedVideo { blob: Blob; url: string }
const videos = new Map<string, Promise<CachedVideo | null>>()
const sizes = new Map<string, number>()
let bytes = 0
const BUDGET_BYTES = 192 * 1024 * 1024

function fetchVideo(z: number, x: number, y: number, signal: AbortSignal): Promise<CachedVideo | null> {
  const key = `${z}/${x}/${y}`
  const hit = videos.get(key)
  if (hit) { videos.delete(key); videos.set(key, hit); return hit }
  const p = (async () => {
    const res = await fetch(`${ROOT}/${key}.webm`, { signal })
    if (!res.ok) return null
    const blob = await res.blob()
    sizes.set(key, blob.size)
    bytes += blob.size
    return { blob, url: URL.createObjectURL(blob) }
  })()
  // A failed or aborted fetch must not poison the cache.
  p.then((v) => { if (!v) videos.delete(key) }, () => videos.delete(key))
  videos.set(key, p)
  p.then(() => {
    for (const [k, old] of videos) {
      if (bytes <= BUDGET_BYTES || k === key) break
      videos.delete(k)
      bytes -= sizes.get(k) ?? 0
      sizes.delete(k)
      old.then((v) => { if (v) URL.revokeObjectURL(v.url) }, () => {})
    }
  }, () => {})
  return p
}

// ── Frame decoders ────────────────────────────────────────────────────────
// A few video elements, each seeking one video at a time; requests queue
// for the first free one. Seeking a paused element and reading its frame is
// the one decode path open to a page without a WebM demuxer, and three in
// flight is enough: a seek within a loaded video takes a few milliseconds.
function once(el: HTMLVideoElement, ok: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve() }
    const fail = () => { cleanup(); reject(new Error(`Timelapse video ${ok} failed`)) }
    const abort = () => { cleanup(); reject(new DOMException("aborted", "AbortError")) }
    const cleanup = () => { el.removeEventListener(ok, done); el.removeEventListener("error", fail); signal.removeEventListener("abort", abort) }
    el.addEventListener(ok, done, { once: true })
    el.addEventListener("error", fail, { once: true })
    signal.addEventListener("abort", abort, { once: true })
  })
}

class Decoder {
  readonly el: HTMLVideoElement
  private loaded: string | null = null
  constructor() {
    this.el = document.createElement("video")
    this.el.muted = true
    this.el.playsInline = true
    this.el.preload = "auto"
  }
  /** Leaves the element on the frame of `year`, ready to be drawn. */
  async seek(video: CachedVideo, year: number, signal: AbortSignal): Promise<void> {
    if (this.loaded !== video.url) {
      this.loaded = null
      this.el.src = video.url
      await once(this.el, "loadedmetadata", signal)
      this.loaded = video.url
    }
    // Frame i spans [i, i + 1) / FPS: aim at its middle.
    const t = (year - TIMELAPSE_FIRST_YEAR + 0.5) / FPS
    if (Math.abs(this.el.currentTime - t) < 1e-3) return
    this.el.currentTime = t
    await once(this.el, "seeked", signal)
  }
}

const POOL = 3
const idle: Decoder[] = []
let made = 0
const waiting: ((d: Decoder) => void)[] = []

function acquire(): Promise<Decoder> {
  const d = idle.pop()
  if (d) return Promise.resolve(d)
  if (made < POOL) { made++; return Promise.resolve(new Decoder()) }
  return new Promise((resolve) => waiting.push(resolve))
}
function release(d: Decoder) {
  const next = waiting.shift()
  if (next) next(d)
  else idle.push(d)
}

export async function googleTimelapseProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: ImageBitmap }> {
  const m = params.url.match(URL_RE)
  if (!m) throw new Error(`Invalid gtimelapse protocol URL: ${params.url}`)
  const z = +m[1], x = +m[2], y = +m[3], year = +m[4]
  if (year < TIMELAPSE_FIRST_YEAR || year > TIMELAPSE_LAST_YEAR) throw new Error(`Google Earth Timelapse covers ${TIMELAPSE_FIRST_YEAR}-${TIMELAPSE_LAST_YEAR}, not ${year}`)
  const signal = abortController.signal

  // The video tile holding this tile, and the square of its frame to read.
  const vz = z === 0 ? 0 : Math.min(z - 1, VIDEO_MAXZOOM)
  const shift = z - vz
  const vx = x >> shift, vy = y >> shift
  const span = FRAME >> shift // frame pixels per output tile
  const sx = (x - (vx << shift)) * span, sy = (y - (vy << shift)) * span

  const video = await fetchVideo(vz, vx, vy, signal)
  if (!video) throw new Error(`Google Earth Timelapse has no tile at ${vz}/${vx}/${vy}`)
  if (signal.aborted) throw new DOMException("aborted", "AbortError")

  const d = await acquire()
  try {
    await d.seek(video, year, signal)
    const bitmap = await createImageBitmap(d.el, sx, sy, span, span, { resizeWidth: TILE, resizeHeight: TILE, resizeQuality: shift === 1 ? "pixelated" : "high" })
    return { data: bitmap }
  } finally {
    release(d)
  }
}
