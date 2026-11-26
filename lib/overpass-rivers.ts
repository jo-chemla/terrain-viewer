// Waterways of a box from OpenStreetMap. Used by the River REM mode for the
// river centerline (lib/river-rem.ts merges the ways into rivers). Data ©
// OpenStreetMap contributors, ODbL.
//
// Two services answer the same question:
//   - QLever's OpenStreetMap endpoint (University of Freiburg, a SPARQL
//     engine over the whole planet as osm2rdf triples), asked first. Measured
//     2026-11-26 on four boxes (Greenville, Moulins, Avignon, Manaus): 0.3 to
//     6 s, CORS open, every call answered. Its data is a periodic copy of the
//     planet, not live OpenStreetMap.
//   - the Overpass API and its public mirrors, the fallback. The same day
//     overpass-api.de refused (502, 406 to a non-browser), two mirrors hung
//     past 45 s and one answered in 10 to 21 s.
// Both are shared services run for free: one request per box, answers kept
// for the session, the next server asked only when the one before is slow or
// refuses, and a refusal (429 / 504, the usual "too busy") reported as such
// rather than retried in a loop.

import type { Bbox, Waterway } from "./river-rem"

export const QLEVER_OSM_ENDPOINT = "https://qlever.dev/api/osm-planet"

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

// ─── Overpass ───────────────────────────────────────────────────────────────

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
    const tagCount = el.tags ? Object.keys(el.tags).length : 1
    let run: [number, number][] = []
    const flush = () => { if (run.length >= 2) ways.push({ id: el.id, name, kind, coords: run, tagCount }); run = [] }
    for (const p of el.geometry) {
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) run.push([p.lon, p.lat])
      else flush()
    }
    flush()
  }
  return ways
}

// ─── QLever ─────────────────────────────────────────────────────────────────

/** SPARQL for the ways tagged as waterways whose geometry meets the box.
 *  `osm2rdf:facts` is the way's tag count (lib/river-rem.ts's riverScore).
 *  Relations carry the tag too (a whole river as one 600 kB geometry): only
 *  ways are asked for. */
export function qleverQuery(bbox: Bbox, kinds: WaterwayKinds): string {
  const [w, s, e, n] = bbox.map((v) => v.toFixed(5))
  const values = kinds === "all" ? `"river" "stream" "canal"` : `"river"`
  return [
    "PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>",
    "PREFIX osm: <https://www.openstreetmap.org/>",
    "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>",
    "PREFIX osm2rdf: <https://osm2rdf.cs.uni-freiburg.de/rdf#>",
    "PREFIX geo: <http://www.opengis.net/ont/geosparql#>",
    "PREFIX geof: <http://www.opengis.net/def/function/geosparql/>",
    "SELECT ?way ?kind ?name ?facts ?wkt WHERE {",
    `  VALUES ?kind { ${values} }`,
    "  ?way osmkey:waterway ?kind .",
    "  ?way rdf:type osm:way .",
    "  ?way geo:hasGeometry/geo:asWKT ?wkt .",
    "  OPTIONAL { ?way osmkey:name ?name }",
    "  OPTIONAL { ?way osm2rdf:facts ?facts }",
    `  FILTER(geof:sfIntersects(?wkt, "POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))"^^geo:wktLiteral))`,
    "}",
  ].join("\n")
}

/** The line(s) of a WKT LINESTRING or MULTILINESTRING ("lng lat" pairs). */
export function parseWktLines(wkt: string): [number, number][][] {
  const text = wkt.trim().toUpperCase()
  if (!text.startsWith("LINESTRING") && !text.startsWith("MULTILINESTRING")) return []
  const lines: [number, number][][] = []
  for (const part of wkt.match(/\([^()]+\)/g) ?? []) {
    const line: [number, number][] = []
    for (const pair of part.slice(1, -1).split(",")) {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number)
      if (Number.isFinite(lng) && Number.isFinite(lat)) line.push([lng, lat])
    }
    if (line.length >= 2) lines.push(line)
  }
  return lines
}

type SparqlBinding = Record<string, { value: string } | undefined>

/** Ways of a QLever answer (SPARQL JSON results). Whole ways come back, not
 *  cut at the box: mergeWaterways clips them. */
export function parseQleverWays(json: unknown): Waterway[] {
  const bindings = (json as { results?: { bindings?: SparqlBinding[] } } | null)?.results?.bindings
  if (!Array.isArray(bindings)) return []
  const ways: Waterway[] = []
  for (const row of bindings) {
    const id = Number((row.way?.value ?? "").split("/").pop())
    const name = row.name?.value ?? "", kind = row.kind?.value ?? "river"
    const tagCount = Math.max(1, Number(row.facts?.value) || 1)
    for (const coords of parseWktLines(row.wkt?.value ?? "")) ways.push({ id: Number.isFinite(id) ? id : 0, name, kind, coords, tagCount })
  }
  return ways
}

// ─── Asking ─────────────────────────────────────────────────────────────────

/** One server to ask: how to ask it and how to read its answer. */
export interface WaterwayServer { name: string; request: () => { url: string; init: RequestInit }; parse: (json: unknown) => Waterway[] }

/** QLever first, then the Overpass mirrors. */
export function waterwayServers(bbox: Bbox, kinds: WaterwayKinds): WaterwayServer[] {
  const form = { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }
  const overpass = overpassQuery(bbox, kinds)
  return [
    {
      name: "QLever",
      request: () => ({ url: QLEVER_OSM_ENDPOINT, init: { method: "POST", headers: { ...form, Accept: "application/sparql-results+json" }, body: `query=${encodeURIComponent(qleverQuery(bbox, kinds))}` } }),
      parse: parseQleverWays,
    },
    ...OVERPASS_ENDPOINTS.map((endpoint) => ({
      name: "Overpass",
      request: () => ({ url: endpoint, init: { method: "POST", headers: form, body: `data=${encodeURIComponent(overpass)}` } }),
      parse: parseOverpassWays,
    })),
  ]
}

const cache = new Map<string, Promise<Waterway[]>>()
const cacheKey = (bbox: Bbox, kinds: WaterwayKinds) => `${kinds}|${bbox.map((v) => v.toFixed(3)).join(",")}`

async function askOnce(server: WaterwayServer, signal: AbortSignal, timeoutMs: number): Promise<Waterway[]> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener("abort", onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const { url, init } = server.request()
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (response.status === 429 || (response.status >= 502 && response.status <= 504)) throw new OverpassError("busy", `${server.name} is busy (HTTP ${response.status})`)
    if (!response.ok) throw new OverpassError("network", `${server.name} answered HTTP ${response.status}`)
    const json = await response.json() as { remark?: string; exception?: string }
    // A server-side timeout comes back as HTTP 200 with a remark and no data
    // (Overpass), or as an exception text (QLever).
    if (typeof json.remark === "string" && /timed out|out of memory/i.test(json.remark)) throw new OverpassError("timeout", `${server.name} ran out of time on this area`)
    if (typeof json.exception === "string") throw new OverpassError(/time|memory|cancel/i.test(json.exception) ? "timeout" : "network", `${server.name} could not answer for this area`)
    return server.parse(json)
  } catch (error) {
    if (error instanceof OverpassError) throw error
    if (timedOut) throw new OverpassError("timeout", `${server.name} did not answer in time`)
    if (signal.aborted) throw error
    throw new OverpassError("network", `${server.name} could not be reached`)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

export interface FetchWaterwaysOptions {
  signal?: AbortSignal
  /** A server that has not answered after this long gets company: the next
   *  one is asked too, and the first answer wins. */
  hedgeMs?: number
  /** Each server's own limit. */
  timeoutMs?: number
  /** Called once, when the first server is slow or has refused. */
  onSlow?: () => void
  /** The servers to ask, in order (tests). */
  servers?: WaterwayServer[]
}

const worse = (a: unknown, b: unknown) => {
  const rank = (e: unknown) => (e instanceof OverpassError ? (e.kind === "busy" ? 3 : e.kind === "timeout" ? 2 : 1) : 0)
  return rank(b) >= rank(a) ? b : a
}

/** One request through the servers: the first is asked alone; when it is
 *  slow or refuses, the next joins, and so on. The first answer wins and the
 *  others are cancelled. Fails with the most telling error ("busy" over
 *  "timeout" over "unreachable") once every server has failed. */
function askServers(servers: WaterwayServer[], { signal, hedgeMs = 8000, timeoutMs = 40000, onSlow }: FetchWaterwaysOptions): Promise<Waterway[]> {
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
      if (settled || next >= servers.length) return
      const server = servers[next++]
      running++
      clearTimeout(timer)
      timer = setTimeout(() => { warn(); start() }, hedgeMs)
      askOnce(server, all.signal, timeoutMs).then(
        (ways) => finish(() => resolve(ways)),
        (error) => {
          running--
          if (settled) return
          failure = worse(failure, error)
          if (next < servers.length) { warn(); start() }
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
  const pending = askServers(options.servers ?? waterwayServers(bbox, kinds), options)
  cache.set(key, pending)
  pending.catch(() => { if (cache.get(key) === pending) cache.delete(key) })
  return pending
}
