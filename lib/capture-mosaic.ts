// One satellite pass drawn as one basemap. Maxar and Vantor cut a capture
// (one catalog_id) into a grid of COGs about 5 km across, and NOAA a flight
// into frames, so the COG under the view centre alone stops at its own edge.
//
//   capture://<id>/{z}/{x}/{y}
//
// A map tile only asks titiler for the COGs that overlap it, 1 to 4 once zoomed
// in, and so only the map tiles in view cost anything. The COGs are the ones the
// timeline's STAC search found for the views so far: at most 25, the nearest to
// the latest view, so a low zoom over a long pass stays bounded.
import { getDefaultStore } from "jotai"
import { buildRasterTileSource } from "./source-builder"
import { titilerEndpointAtom } from "./settings-atoms"

type Bbox = [number, number, number, number]
const MAX_CAPTURE_COGS = 25
/** A tile outside what was searched waits this long for the search of the new view. */
const SEARCH_WAIT_MS = 3000

interface Capture {
  cogs: { href: string; bbox: Bbox }[]
  searched: Bbox[]
  /** Woken when a search reports, for the tiles waiting on one. */
  waiting: Set<() => void>
}
const captures = new Map<string, Capture>()

const overlaps = (a: Bbox, b: Bbox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
const inside = (a: Bbox, b: Bbox) => a[0] >= b[0] && a[2] <= b[2] && a[1] >= b[1] && a[3] <= b[3]

export const hasCapture = (id: string) => captures.has(id)
export const captureTileUrl = (id: string) => `capture://${encodeURIComponent(id)}/{z}/{x}/{y}`

/** Adds what a search over `searched` found to the capture. Returns its extent. */
export function updateCapture(id: string, found: { href: string; bbox: Bbox }[], searched: Bbox): Bbox {
  const capture = captures.get(id) ?? { cogs: [], searched: [], waiting: new Set<() => void>() }
  captures.set(id, capture)
  const cx = (searched[0] + searched[2]) / 2, cy = (searched[1] + searched[3]) / 2
  const distance = (b: Bbox) => Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy)
  const byHref = new Map([...capture.cogs, ...found].map((c) => [c.href, c]))
  capture.cogs = [...byHref.values()].sort((a, b) => distance(a.bbox) - distance(b.bbox)).slice(0, MAX_CAPTURE_COGS)
  capture.searched = [...capture.searched.slice(-19), searched]
  for (const wake of capture.waiting) wake()
  return capture.cogs.reduce<Bbox>((u, { bbox: b }) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [...capture.cogs[0].bbox])
}

function tileBbox(z: number, x: number, y: number): Bbox {
  const lng = (col: number) => (col / 2 ** z) * 360 - 180
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** z))) * 180) / Math.PI
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)]
}

/** The COGs on this tile, after the search that covers it when one is on its way. */
async function cogsFor(capture: Capture, tile: Bbox, signal: AbortSignal) {
  const on = () => capture.cogs.filter((c) => overlaps(c.bbox, tile))
  if (on().length || capture.searched.some((s) => inside(tile, s))) return on()
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); capture.waiting.delete(done); signal.removeEventListener("abort", done); resolve() }
    const timer = setTimeout(done, SEARCH_WAIT_MS)
    capture.waiting.add(done)
    signal.addEventListener("abort", done)
  })
  return on()
}

export async function captureProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: ArrayBuffer }> {
  const m = /^capture:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url)
  if (!m) throw new Error(`Invalid capture protocol URL: ${params.url}`)
  const [z, x, y] = [+m[2], +m[3], +m[4]]
  const capture = captures.get(decodeURIComponent(m[1]))
  if (!capture) throw new Error(`Unknown capture: ${params.url}`)
  const { signal } = abortController
  const cogs = await cogsFor(capture, tileBbox(z, x, y), signal)
  const titilerEndpoint = getDefaultStore().get(titilerEndpointAtom)
  const answers = await Promise.all(cogs.map(async ({ href }) => {
    const source = buildRasterTileSource({ url: href, type: "cog", useCogProtocol: false, titilerEndpoint }) as { tiles: string[] }
    const url = source.tiles[0].replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
    // A COG whose extent only touches the tile answers 404: nothing to draw.
    const res = await fetch(url, { signal })
    return res.ok ? res.arrayBuffer() : null
  }))
  const tiles = answers.filter((a): a is ArrayBuffer => !!a)
  if (!tiles.length) throw new Error(`No COG of the capture on ${params.url}`)
  if (tiles.length === 1) return { data: tiles[0] }
  const bitmaps = await Promise.all(tiles.map((t) => createImageBitmap(new Blob([t], { type: "image/png" }))))
  const canvas = new OffscreenCanvas(bitmaps[0].width, bitmaps[0].height)
  const context = canvas.getContext("2d")!
  for (const bitmap of bitmaps) { context.drawImage(bitmap, 0, 0); bitmap.close() }
  return { data: await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer() }
}
