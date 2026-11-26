// Waterways of a box from OpenStreetMap, through the Overpass API. Used by
// the River REM mode for the river centerline (lib/river-rem.ts merges the
// ways into rivers). Data © OpenStreetMap contributors, ODbL.
//
// Overpass is a shared, volunteer-run service: one request per box, answers
// kept for the session, the public mirrors tried in turn, and a refusal
// (429 / 504, the usual "too busy") reported as such rather than retried in
// a loop.

import type { Bbox, Waterway } from "./river-rem"

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const

/** "river": waterway=river only. "all": rivers, streams and canals. */
export type WaterwayKinds = "river" | "all"

/** Largest box asked for, in square degrees: beyond it the answer is slow,
 *  large, and a REM of that extent means little. */
export const OVERPASS_MAX_AREA_DEG2 = 4

export class OverpassError extends Error {
  constructor(public kind: "busy" | "timeout" | "network" | "too-large", message: string) { super(message) }
}

export function overpassQuery(bbox: Bbox, kinds: WaterwayKinds): string {
  const [w, s, e, n] = bbox
  const filter = kinds === "all" ? `["waterway"~"^(river|stream|canal)$"]` : `["waterway"="river"]`
  const box = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`
  // geom(box): only the nodes in the box (plus one on each side of it) come
  // back. A long river's ways run far out of view, and the whole geometry of
  // the Mississippi's was 600 kB for a 60 km box.
  return `[out:json][timeout:25];way${filter}(${box});out tags geom(${box});`
}

type OverpassElement = { type: string; id: number; tags?: Record<string, string>; geometry?: ({ lat: number; lon: number } | null)[] }

/** Ways of an answer. With `out geom(box)` the nodes outside the box come
 *  back as null: a way that leaves the box and returns is cut there into
 *  several pieces (same id and name), never bridged across the gap. */
export function parseOverpassWays(json: unknown): Waterway[] {
  const elements = (json as { elements?: OverpassElement[] } | null)?.elements
  if (!Array.isArray(elements)) return []
  const ways: Waterway[] = []
  for (const el of elements) {
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue
    const name = el.tags?.name ?? "", kind = el.tags?.waterway ?? "river"
    let run: [number, number][] = []
    const flush = () => { if (run.length >= 2) ways.push({ id: el.id, name, kind, coords: run }); run = [] }
    for (const p of el.geometry) {
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) run.push([p.lon, p.lat])
      else flush()
    }
    flush()
  }
  return ways
}

const cache = new Map<string, Promise<Waterway[]>>()
const cacheKey = (bbox: Bbox, kinds: WaterwayKinds) => `${kinds}|${bbox.map((v) => v.toFixed(3)).join(",")}`

async function askOnce(endpoint: string, query: string, signal: AbortSignal, timeoutMs: number): Promise<Waterway[]> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener("abort", onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })
    if (response.status === 429 || (response.status >= 502 && response.status <= 504)) throw new OverpassError("busy", `Overpass is busy (HTTP ${response.status})`)
    if (!response.ok) throw new OverpassError("network", `Overpass answered HTTP ${response.status}`)
    const json = await response.json() as { remark?: string }
    // A server-side timeout comes back as HTTP 200 with a remark and no data.
    if (typeof json.remark === "string" && /timed out|out of memory/i.test(json.remark)) throw new OverpassError("timeout", "Overpass ran out of time on this area")
    return parseOverpassWays(json)
  } catch (error) {
    if (error instanceof OverpassError) throw error
    if (timedOut) throw new OverpassError("timeout", "Overpass did not answer in time")
    if (signal.aborted) throw error
    throw new OverpassError("network", "Overpass could not be reached")
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

export interface FetchWaterwaysOptions {
  signal?: AbortSignal
  /** A mirror that has not answered after this long gets company: the next
   *  one is asked too, and the first answer wins. */
  hedgeMs?: number
  /** Each mirror's own limit. */
  timeoutMs?: number
  /** Called once, when the first mirror is slow or has refused. */
  onSlow?: () => void
}

const worse = (a: unknown, b: unknown) => {
  const rank = (e: unknown) => (e instanceof OverpassError ? (e.kind === "busy" ? 3 : e.kind === "timeout" ? 2 : 1) : 0)
  return rank(b) >= rank(a) ? b : a
}

/** One request through the mirrors: the first is asked alone; when it is
 *  slow or refuses, the next joins, and so on. The first answer wins and the
 *  others are cancelled. Fails with the most telling error ("busy" over
 *  "timeout" over "unreachable") once every mirror has failed. */
function askMirrors(query: string, { signal, hedgeMs = 8000, timeoutMs = 40000, onSlow }: FetchWaterwaysOptions): Promise<Waterway[]> {
  return new Promise((resolve, reject) => {
    const all = new AbortController()
    let settled = false, running = 0, next = 0, failure: unknown = null, warned = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (act: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      all.abort()
      signal?.removeEventListener("abort", onAbort)
      act()
    }
    const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")))
    const warn = () => { if (!warned && !settled) { warned = true; onSlow?.() } }
    const start = () => {
      if (settled || next >= OVERPASS_ENDPOINTS.length) return
      const endpoint = OVERPASS_ENDPOINTS[next++]
      running++
      clearTimeout(timer)
      timer = setTimeout(() => { warn(); start() }, hedgeMs)
      askOnce(endpoint, query, all.signal, timeoutMs).then(
        (ways) => finish(() => resolve(ways)),
        (error) => {
          running--
          if (settled) return
          failure = worse(failure, error)
          if (next < OVERPASS_ENDPOINTS.length) { warn(); start() }
          else if (running === 0) finish(() => reject(failure))
        },
      )
    }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener("abort", onAbort, { once: true })
    start()
  })
}

/** The waterways crossing a box. Answers are kept per box and kinds; a
 *  failure (or a cancelled request) is not kept, so Retry asks again. */
export function fetchWaterways(bbox: Bbox, kinds: WaterwayKinds, options: FetchWaterwaysOptions = {}): Promise<Waterway[]> {
  const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
  if (area > OVERPASS_MAX_AREA_DEG2) return Promise.reject(new OverpassError("too-large", "Zoom in to look for rivers"))
  const key = cacheKey(bbox, kinds)
  const hit = cache.get(key)
  if (hit) return hit
  const pending = askMirrors(overpassQuery(bbox, kinds), options)
  cache.set(key, pending)
  pending.catch(() => { if (cache.get(key) === pending) cache.delete(key) })
  return pending
}
