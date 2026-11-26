// River REM (Relative Elevation Model): the pure parts.
//
// A REM is the DEM minus a trend surface that follows the river's water
// level, so the floodplain reads as "metres above the river" and terraces,
// paleochannels and meander scars stand out. The reference is the
// OpenTopography RiverREM Python package (REMMaker.py), which
//   1. takes the river centerline from OpenStreetMap (the longest named
//      river in the DEM's extent), or a given line,
//   2. samples the DEM along it (interp_pts = 1000 points at most),
//   3. interpolates those water levels over the whole extent with inverse-
//      distance weighting over the k nearest points (weights 1/d, k guessed
//      from the river's sinuosity, between 5 and interp_pts/10),
//   4. subtracts.
// This file does the same in the browser, on a coarse grid (the app's
// approximate algorithms work that way: the trend is smooth, the DEM carries
// the detail): centerline merge and clipping, resampling, the downstream
// cleaning RiverREM does not do, the k estimate, and the IDW grid. Nothing
// here touches the DOM or the network, so `node scripts/test-lib.mjs
// lib/river-rem.test.ts` runs it.

export type LngLat = [number, number]
export type Bbox = [number, number, number, number] // west, south, east, north

export interface Waterway { id: number; name: string; kind: string; coords: LngLat[] }
export interface River { name: string; kind: string; lines: LngLat[][]; lengthM: number }

/** RiverREM's `interp_pts`: the most points sampled along the centerline. */
export const REM_INTERP_PTS = 1000
/** Hard ceiling on sampled points whatever the spacing asked for. */
export const REM_MAX_PTS = 4000
/** Cells on the longer side of the trend grid (RiverREM_UI's client engine: 256). */
export const REM_GRID_SIZE = 256
/** Distances are floored here (metres) so a cell on a sample has a finite weight. */
const MIN_DISTANCE_M = 1

const EARTH_R = 6378137
export const MERCATOR_HALF = Math.PI * EARTH_R
const DEG = Math.PI / 180

export const lngToMercX = (lng: number) => lng * DEG * EARTH_R
export const latToMercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, lat)) * DEG) / 2)) * EARTH_R
export const mercXToLng = (x: number) => x / EARTH_R / DEG
export const mercYToLat = (y: number) => (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) / DEG

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG, dLng = (b[0] - a[0]) * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function lineLengthM(line: LngLat[]): number {
  let total = 0
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1], line[i])
  return total
}

// ─── Centerlines ────────────────────────────────────────────────────────────

const nodeKey = (c: LngLat) => `${c[0].toFixed(7)},${c[1].toFixed(7)}`

/** Joins ways that share an end node into lines, following the ways'
 *  direction (an OSM waterway is drawn the way the water flows): a way is
 *  appended to the one whose last node is its first. A way no chain reaches
 *  starts its own line, so a braided reach gives several lines. */
export function joinWays(ways: LngLat[][]): LngLat[][] {
  const usable = ways.filter((w) => w.length >= 2)
  const byStart = new Map<string, number[]>()
  const endKeys = new Set<string>()
  usable.forEach((w, i) => {
    const k = nodeKey(w[0])
    const list = byStart.get(k)
    if (list) list.push(i); else byStart.set(k, [i])
    endKeys.add(nodeKey(w[w.length - 1]))
  })
  const used = new Uint8Array(usable.length)
  const lines: LngLat[][] = []
  const follow = (first: number) => {
    const line: LngLat[] = usable[first].slice()
    used[first] = 1
    for (;;) {
      const next = (byStart.get(nodeKey(line[line.length - 1])) ?? []).find((i) => !used[i])
      if (next === undefined) break
      used[next] = 1
      for (let j = 1; j < usable[next].length; j++) line.push(usable[next][j])
    }
    lines.push(line)
  }
  // Heads first (no way ends where they start), so a chain is followed from
  // its upstream end; what is left is a loop, started anywhere.
  usable.forEach((w, i) => { if (!used[i] && !endKeys.has(nodeKey(w[0]))) follow(i) })
  usable.forEach((_, i) => { if (!used[i]) follow(i) })
  return lines
}

/** The parts of a line inside a box, cut at its edges (Liang-Barsky per
 *  segment). Overpass returns whole ways, and one can run far out of view. */
export function clipLineToBbox(line: LngLat[], bbox: Bbox): LngLat[][] {
  const [w, s, e, n] = bbox
  const out: LngLat[][] = []
  let current: LngLat[] | null = null
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    let t0 = 0, t1 = 1, inside = true
    const edges = [[-dx, a[0] - w], [dx, e - a[0]], [-dy, a[1] - s], [dy, n - a[1]]]
    for (const [p, q] of edges) {
      if (p === 0) { if (q < 0) { inside = false; break } continue }
      const r = q / p
      if (p < 0) { if (r > t1) { inside = false; break } if (r > t0) t0 = r }
      else { if (r < t0) { inside = false; break } if (r < t1) t1 = r }
    }
    if (!inside) { current = null; continue }
    const p0: LngLat = t0 === 0 ? a : [a[0] + dx * t0, a[1] + dy * t0]
    const p1: LngLat = t1 === 1 ? b : [a[0] + dx * t1, a[1] + dy * t1]
    if (!current || t0 > 0) { current = [p0]; out.push(current) }
    current.push(p1)
    if (t1 < 1) current = null
  }
  return out.filter((l) => l.length >= 2 && lineLengthM(l) > 0)
}

/** Ways grouped by name and joined into lines, longest river first. Unnamed
 *  ways are one river each (name ""), so "all waterways" can still draw them
 *  and the longest NAMED river is never an anonymous side channel. */
export function mergeWaterways(ways: Waterway[], clip?: Bbox): River[] {
  const groups = new Map<string, Waterway[]>()
  for (const way of ways) {
    const key = way.name ? `n:${way.name}` : `u:${way.id}`
    const list = groups.get(key)
    if (list) list.push(way); else groups.set(key, [way])
  }
  const rivers: River[] = []
  for (const group of groups.values()) {
    let lines = joinWays(group.map((w) => w.coords))
    if (clip) lines = lines.flatMap((l) => clipLineToBbox(l, clip))
    const lengthM = lines.reduce((sum, l) => sum + lineLengthM(l), 0)
    if (lengthM <= 0) continue
    // The kind of the group is its most "river" member: a river whose last
    // way is tagged canal still lists as a river.
    const kind = group.some((w) => w.kind === "river") ? "river" : group[0].kind
    rivers.push({ name: group[0].name, kind, lines, lengthM })
  }
  return rivers.sort((a, b) => b.lengthM - a.lengthM)
}

export type RiverChoice = "longest" | "all" | "named"

/** The lines the trend is built from. "longest" is RiverREM's own rule (the
 *  longest named river in the extent); with no named river in view it falls
 *  back to the longest unnamed one rather than drawing nothing. */
export function chooseRiverLines(rivers: River[], choice: RiverChoice, name = ""): { lines: LngLat[][]; label: string } {
  if (!rivers.length) return { lines: [], label: "" }
  if (choice === "all") return { lines: rivers.flatMap((r) => r.lines), label: `${rivers.length} waterways` }
  const named = rivers.filter((r) => r.name)
  const picked = (choice === "named" ? named.find((r) => r.name === name) : undefined) ?? named[0] ?? rivers[0]
  return { lines: picked.lines, label: picked.name || "Unnamed waterway" }
}

// ─── Sampling ───────────────────────────────────────────────────────────────

/** The spacing actually used: 0 (auto) spreads RiverREM's 1000 points over
 *  the whole length; any value is raised so the count stays under the ceiling. */
export function resolveSpacingM(totalLengthM: number, spacingM: number): number {
  const auto = totalLengthM / (REM_INTERP_PTS - 1)
  const wanted = spacingM > 0 ? spacingM : auto
  return Math.max(wanted, totalLengthM / (REM_MAX_PTS - 1), 0.5)
}

/** Points every `spacingM` along a line, both ends included. */
export function resampleLine(line: LngLat[], spacingM: number): LngLat[] {
  if (line.length < 2) return line.slice()
  const out: LngLat[] = [line[0]]
  let carried = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    const seg = haversineM(a, b)
    if (seg <= 0) continue
    let at = spacingM - carried
    while (at <= seg) {
      const t = at / seg
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      at += spacingM
    }
    carried = seg - (at - spacingM)
  }
  const last = line[line.length - 1]
  const tail = out[out.length - 1]
  if (haversineM(tail, last) > spacingM * 0.25) out.push(last)
  else if (out.length > 1) out[out.length - 1] = last
  else out.push(last)
  return out
}

// ─── Cleaning ───────────────────────────────────────────────────────────────

export type MonotoneMode = "min" | "fit" | "none"

/** True when the heights rise from the first third of the line to the last:
 *  the line was drawn upstream and must be read backwards. */
export function runsUphill(elevations: ArrayLike<number>): boolean {
  const finite: number[] = []
  for (let i = 0; i < elevations.length; i++) if (Number.isFinite(elevations[i])) finite.push(elevations[i])
  if (finite.length < 2) return false
  const third = Math.max(1, Math.floor(finite.length / 3))
  let head = 0, tail = 0
  for (let i = 0; i < third; i++) { head += finite[i]; tail += finite[finite.length - 1 - i] }
  return tail > head
}

/** A water surface does not rise downstream; what the DEM reads along the
 *  centerline does (bridges, banks where the line leaves the channel, trees
 *  over a narrow stream, noise). `elevations` runs downstream; NaN (nodata)
 *  stays NaN.
 *  - "min": running minimum. Every error listed above reads too HIGH, so the
 *    lowest height met so far is the best guess of the water level.
 *  - "fit": the non-increasing profile closest to the samples in the least
 *    squares sense (pool adjacent violators). Better when the DEM has pits
 *    (a running minimum latches onto one), worse under bridges.
 *  - "none": what RiverREM does, the samples as read. */
export function cleanProfile(elevations: ArrayLike<number>, mode: MonotoneMode): Float64Array {
  const n = elevations.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = elevations[i]
  if (mode === "none") return out
  if (mode === "min") {
    let lowest = Infinity
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(out[i])) continue
      if (out[i] < lowest) lowest = out[i]
      out[i] = lowest
    }
    return out
  }
  // Pool adjacent violators, for a non-increasing fit: blocks of (mean,
  // weight); a block higher than the one before it is merged into it.
  const mean = new Float64Array(n), weight = new Float64Array(n), start = new Int32Array(n)
  let blocks = 0
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(out[i])) continue
    mean[blocks] = out[i]; weight[blocks] = 1; start[blocks] = i; blocks++
    while (blocks > 1 && mean[blocks - 1] > mean[blocks - 2]) {
      const w = weight[blocks - 1] + weight[blocks - 2]
      mean[blocks - 2] = (mean[blocks - 1] * weight[blocks - 1] + mean[blocks - 2] * weight[blocks - 2]) / w
      weight[blocks - 2] = w
      blocks--
    }
  }
  for (let b = 0; b < blocks; b++) {
    const end = b + 1 < blocks ? start[b + 1] : n
    for (let i = start[b]; i < end; i++) if (Number.isFinite(out[i])) out[i] = mean[b]
  }
  return out
}

// ─── k, as RiverREM guesses it ──────────────────────────────────────────────

/** River length over the largest distance between two line ends, at least 1
 *  (REMMaker.get_sinuosity). */
export function sinuosity(lines: LngLat[][]): number {
  const ends: LngLat[] = []
  let length = 0
  for (const line of lines) {
    if (line.length < 2) continue
    ends.push(line[0], line[line.length - 1])
    length += lineLengthM(line)
  }
  let straight = 0
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) straight = Math.max(straight, haversineM(ends[i], ends[j]))
  return straight > 0 ? Math.max(1, length / straight) : 1
}

/** REMMaker.estimate_k: 2 % of the river samples, times a factor that goes
 *  from 1 (straight) to 5 (very sinuous), kept between 5 and interp_pts / 10. */
export function estimateNeighbors(pointCount: number, riverSinuosity: number): number {
  const factor = 1 + 4 * Math.tanh(riverSinuosity - 1)
  const k = Math.floor(((2 * pointCount) / 100) * factor)
  return Math.max(1, Math.min(pointCount, Math.min(Math.floor(REM_INTERP_PTS / 10), Math.max(5, k))))
}

// ─── Trend surface ──────────────────────────────────────────────────────────

/** River samples in Web Mercator metres with their (cleaned) water level. */
export interface TrendPoints { x: Float64Array; y: Float64Array; z: Float64Array }

/** The trend on a regular Web Mercator grid; row 0 is the north edge. */
export interface TrendGrid { data: Float32Array; w: number; h: number; x0: number; y0: number; x1: number; y1: number }

export interface TrendOptions {
  /** IDW exponent: weights are 1 / d^power. RiverREM: 1. */
  power: number
  /** Nearest samples used per cell; at or above the sample count, all of them. */
  neighbors: number
  /** Cells on the longer side. */
  size?: number
}

/** A grid sized to an extent (mercator metres), `size` cells on its longer
 *  side and square cells as far as rounding allows. */
export function createTrendGrid(extent: { x0: number; y0: number; x1: number; y1: number }, size = REM_GRID_SIZE): TrendGrid {
  const spanX = Math.max(1, extent.x1 - extent.x0), spanY = Math.max(1, extent.y1 - extent.y0)
  const w = spanX >= spanY ? size : Math.max(16, Math.round((size * spanX) / spanY))
  const h = spanY >= spanX ? size : Math.max(16, Math.round((size * spanY) / spanX))
  return { data: new Float32Array(w * h), w, h, x0: extent.x0, y0: extent.y0, x1: extent.x0 + spanX, y1: extent.y0 + spanY }
}

/** Fills rows [rowStart, rowEnd) of the grid: at each cell centre, the
 *  inverse-distance mean of the `neighbors` nearest samples. Split by rows so
 *  the caller can yield to the page between chunks. The k nearest are kept in
 *  a max-heap over typed arrays: nothing is allocated per cell. */
export function fillTrendRows(grid: TrendGrid, points: TrendPoints, options: TrendOptions, rowStart = 0, rowEnd = grid.h): void {
  const { data, w, h, x0, y0, x1, y1 } = grid
  const { x: px, y: py, z: pz } = points
  const count = px.length
  if (!count) { data.fill(NaN, rowStart * w, rowEnd * w); return }
  const k = Math.max(1, Math.min(count, Math.floor(options.neighbors) || count))
  const power = options.power
  const halfPower = power / 2
  const minD2 = MIN_DISTANCE_M * MIN_DISTANCE_M
  const stepX = w > 1 ? (x1 - x0) / (w - 1) : 0
  const stepY = h > 1 ? (y1 - y0) / (h - 1) : 0
  const useAll = k >= count
  const heapD = new Float64Array(k), heapI = new Int32Array(k)

  for (let row = rowStart; row < rowEnd; row++) {
    const cy = y1 - row * stepY
    for (let col = 0; col < w; col++) {
      const cx = x0 + col * stepX
      let sumW = 0, sumWz = 0
      if (useAll) {
        for (let i = 0; i < count; i++) {
          const dx = px[i] - cx, dy = py[i] - cy
          let d2 = dx * dx + dy * dy
          if (d2 < minD2) d2 = minD2
          const weight = power === 2 ? 1 / d2 : power === 1 ? 1 / Math.sqrt(d2) : Math.pow(d2, -halfPower)
          sumW += weight; sumWz += weight * pz[i]
        }
      } else {
        // The first k samples fill the heap (largest distance at the root)...
        for (let i = 0; i < k; i++) {
          const dx = px[i] - cx, dy = py[i] - cy
          const d2 = dx * dx + dy * dy
          let at = i
          while (at > 0) {
            const parent = (at - 1) >> 1
            if (heapD[parent] >= d2) break
            heapD[at] = heapD[parent]; heapI[at] = heapI[parent]; at = parent
          }
          heapD[at] = d2; heapI[at] = i
        }
        // ...then a nearer sample replaces the root and sinks to its place.
        for (let i = k; i < count; i++) {
          const dx = px[i] - cx, dy = py[i] - cy
          const d2 = dx * dx + dy * dy
          if (d2 >= heapD[0]) continue
          let at = 0
          for (;;) {
            let child = 2 * at + 1
            if (child >= k) break
            if (child + 1 < k && heapD[child + 1] > heapD[child]) child++
            if (heapD[child] <= d2) break
            heapD[at] = heapD[child]; heapI[at] = heapI[child]; at = child
          }
          heapD[at] = d2; heapI[at] = i
        }
        for (let j = 0; j < k; j++) {
          let d2 = heapD[j]
          if (d2 < minD2) d2 = minD2
          const weight = power === 2 ? 1 / d2 : power === 1 ? 1 / Math.sqrt(d2) : Math.pow(d2, -halfPower)
          sumW += weight; sumWz += weight * pz[heapI[j]]
        }
      }
      data[row * w + col] = sumWz / sumW
    }
  }
}

/** The whole grid in one go (tests, and small grids). */
export function buildTrendGrid(points: TrendPoints, extent: { x0: number; y0: number; x1: number; y1: number }, options: TrendOptions): TrendGrid {
  const grid = createTrendGrid(extent, options.size)
  fillTrendRows(grid, points, options)
  return grid
}

/** Bilinear read of the trend at a point; outside the grid, its edge. */
export function sampleTrend(grid: TrendGrid, mx: number, my: number): number {
  const { data, w, h, x0, y0, x1, y1 } = grid
  const gx = Math.min(w - 1, Math.max(0, ((mx - x0) / (x1 - x0)) * (w - 1)))
  const gy = Math.min(h - 1, Math.max(0, ((y1 - my) / (y1 - y0)) * (h - 1)))
  const cx0 = Math.floor(gx), cy0 = Math.floor(gy)
  const cx1 = Math.min(w - 1, cx0 + 1), cy1 = Math.min(h - 1, cy0 + 1)
  const fx = gx - cx0, fy = gy - cy0
  const top = data[cy0 * w + cx0] * (1 - fx) + data[cy0 * w + cx1] * fx
  const bottom = data[cy1 * w + cx0] * (1 - fx) + data[cy1 * w + cx1] * fx
  return top * (1 - fy) + bottom * fy
}

// ─── The drawn line in a link ───────────────────────────────────────────────

/** Lines as Google encoded polylines (5 decimals, about 1 m), joined by ";"
 *  (never produced by the encoding itself: its characters start at "?"). */
export function encodeLines(lines: LngLat[][]): string {
  return lines.filter((l) => l.length >= 2).map((line) => {
    let out = "", prevLat = 0, prevLng = 0
    const put = (value: number) => {
      let v = value < 0 ? ~(value << 1) : value << 1
      while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 }
      out += String.fromCharCode(v + 63)
    }
    for (const [lng, lat] of line) {
      const iLat = Math.round(lat * 1e5), iLng = Math.round(lng * 1e5)
      put(iLat - prevLat); put(iLng - prevLng)
      prevLat = iLat; prevLng = iLng
    }
    return out
  }).join(";")
}

export function decodeLines(text: string): LngLat[][] {
  if (!text) return []
  const lines: LngLat[][] = []
  for (const part of text.split(";")) {
    const line: LngLat[] = []
    let index = 0, lat = 0, lng = 0
    const take = (): number | null => {
      let result = 0, shift = 0, byte: number
      do {
        if (index >= part.length) return null
        byte = part.charCodeAt(index++) - 63
        if (byte < 0 || byte > 63) return null
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      return result & 1 ? ~(result >> 1) : result >> 1
    }
    while (index < part.length) {
      const dLat = take(); if (dLat === null) break
      const dLng = take(); if (dLng === null) break
      lat += dLat; lng += dLng
      line.push([lng / 1e5, lat / 1e5])
    }
    if (line.length >= 2) lines.push(line)
  }
  return lines
}
