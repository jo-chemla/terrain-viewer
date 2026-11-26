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

export interface Waterway {
  id: number; name: string; kind: string; coords: LngLat[]
  /** How many OpenStreetMap tags the way carries (see riverScore). */
  tagCount?: number
}
export interface River {
  name: string; kind: string; lines: LngLat[][]; lengthM: number
  /** The most tags any of its ways carries. */
  tagCount: number
}

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
    const tagCount = group.reduce((most, w) => Math.max(most, w.tagCount ?? 1), 1)
    rivers.push({ name: group[0].name, kind, lines, lengthM, tagCount })
  }
  return rivers.sort((a, b) => b.lengthM - a.lengthM)
}

/** How much of a "main river" a river is: its length in view times the
 *  number of OpenStreetMap tags on its best-described way.
 *
 *  Length alone picks the wrong river on a floodplain, where a small creek
 *  winds more than the trunk stream it runs beside: near Greenville (MS) Deer
 *  Creek has 113 km in view and the Mississippi 91 km. OpenStreetMap has no
 *  reliable size tag (`width` is on a small minority of ways, a discharge on
 *  none), but mappers describe a large river far more than a small one: names
 *  in many languages, a Wikidata and a Wikipedia link, navigation tags (boat,
 *  ship, motorboat, CEMT), a width. Measured 2026-11-26: Mississippi 60 tags
 *  against Deer Creek 4, the Rhône 28 against the Aygues 9, the Allier 6
 *  against the Sioule 3. The count needs no second request (a relation's
 *  members or a Wikidata lookup would), and both Overpass and QLever return
 *  it. It is a proxy: where it is wrong, "Named river" names the right one. */
export function riverScore(river: River): number {
  return river.lengthM * Math.max(1, river.tagCount)
}

/** "main": the highest riverScore (the default). "longest": RiverREM's own
 *  rule, the most length in view. "all": every waterway found, so tributaries
 *  shape the trend too. "named": one river by its OpenStreetMap name. */
export type RiverChoice = "main" | "longest" | "all" | "named"

/** The lines the trend is built from. Named rivers are preferred; with none
 *  in view the unnamed ones are ranked the same way rather than drawing
 *  nothing. */
export function chooseRiverLines(rivers: River[], choice: RiverChoice, name = ""): { lines: LngLat[][]; label: string } {
  if (!rivers.length) return { lines: [], label: "" }
  if (choice === "all") return { lines: rivers.flatMap((r) => r.lines), label: `${rivers.length} waterways` }
  const named = rivers.filter((r) => r.name)
  const pool = named.length ? named : rivers
  let picked = choice === "named" ? named.find((r) => r.name === name) : undefined
  if (!picked && choice === "longest") picked = pool[0]
  if (!picked) picked = pool.reduce((best, r) => (riverScore(r) > riverScore(best) ? r : best), pool[0])
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

/** A running median over `window` samples (odd; NaN samples are skipped and
 *  stay NaN). Used before the cleaning when the heights were read from the
 *  banks of a DEM with no water: such a profile has pits and spikes one or
 *  two samples wide, and a single pit is enough to drag a running minimum
 *  down for the rest of the river (GEM-15 on the Mississippi: one 13.4 m
 *  reading under a 30 m river). */
export function medianFilter(values: ArrayLike<number>, window = 7): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  const half = Math.max(1, Math.floor(window / 2))
  const buffer: number[] = []
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i])) { out[i] = NaN; continue }
    buffer.length = 0
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (Number.isFinite(values[j])) buffer.push(values[j])
    buffer.sort((a, b) => a - b)
    out[i] = buffer[buffer.length >> 1]
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
export interface TrendPoints {
  x: Float64Array; y: Float64Array; z: Float64Array
  /** 1 where a sample starts a new line (no segment joins it to the one
   *  before). Only read by the "nearest" interpolation; absent = one line. */
  starts?: Uint8Array
}

/** "idw": inverse-distance mean of the k nearest samples (RiverREM's).
 *  "nearest": the water level at the nearest place ON the centerline (the
 *  sample segments, level interpolated along the segment): what a Euclidean
 *  distance transform or a jump-flood pass computes, done exactly here. */
export type TrendMethod = "idw" | "nearest"

/** The trend on a regular Web Mercator grid; row 0 is the north edge. */
export interface TrendGrid { data: Float32Array; w: number; h: number; x0: number; y0: number; x1: number; y1: number }

export interface TrendOptions {
  /** IDW exponent: weights are 1 / d^power. RiverREM: 1. */
  power: number
  /** Nearest samples used per cell; at or above the sample count, all of them. */
  neighbors: number
  /** Cells on the longer side. */
  size?: number
  method?: TrendMethod
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
  if (options.method === "nearest") { fillNearestRows(grid, points, rowStart, rowEnd); return }
  const k = Math.max(1, Math.min(count, Math.floor(options.neighbors) || count))
  const power = options.power
  const halfPower = power / 2
  const minD2 = MIN_DISTANCE_M * MIN_DISTANCE_M
  const stepX = w > 1 ? (x1 - x0) / (w - 1) : 0
  const stepY = h > 1 ? (y1 - y0) / (h - 1) : 0
  const useAll = k >= count
  const heapD = new Float64Array(k), heapI = new Int32Array(k)
  // Distance to the k-th nearest sample of the cell above, per column, and
  // of the cell to the left: the k nearest of a cell all lie within that
  // distance plus one cell step, so every sample farther than that is
  // skipped before it reaches the heap. Without it the heap is at its worst
  // here: the samples come in river order, so walking toward the cell nearly
  // every one of them replaced the root (4.8 s for k = 100 over 1000 samples
  // on the 256 grid, 0.5 s with the bound; same neighbors).
  const kthAbove = new Float64Array(w).fill(Infinity)
  const absStepX = Math.abs(stepX), absStepY = Math.abs(stepY)

  for (let row = rowStart; row < rowEnd; row++) {
    const cy = y1 - row * stepY
    let kthLeft = Infinity
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
        let bound = kthLeft + absStepX
        if (kthAbove[col] + absStepY < bound) bound = kthAbove[col] + absStepY
        let size = 0
        if (bound < Infinity) {
          const bound2 = bound * bound * (1 + 1e-9) + 1e-6
          for (let i = 0; i < count; i++) {
            const dx = px[i] - cx, dy = py[i] - cy
            const d2 = dx * dx + dy * dy
            if (d2 > bound2) continue
            if (size < k) {
              let at = size++
              while (at > 0) {
                const parent = (at - 1) >> 1
                if (heapD[parent] >= d2) break
                heapD[at] = heapD[parent]; heapI[at] = heapI[parent]; at = parent
              }
              heapD[at] = d2; heapI[at] = i
            } else if (d2 < heapD[0]) {
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
          }
        }
        // No bound yet (the first cell of a chunk), or a rounding miss: the
        // plain pass over every sample.
        if (size < k) {
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
        }
        kthLeft = Math.sqrt(heapD[0])
        kthAbove[col] = kthLeft
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

/** The "nearest" interpolation: each cell takes the level of the closest
 *  point of the centerline. The closest sample is found by a plain scan (the
 *  grid is 65 000 cells and the samples at most 4000: see the docs for the
 *  timings), then the two segments that meet at it are tried, so the level is
 *  continuous along the river instead of stepping from one sample to the
 *  next. */
function fillNearestRows(grid: TrendGrid, points: TrendPoints, rowStart: number, rowEnd: number): void {
  const { data, w, h, x0, y0, x1, y1 } = grid
  const { x: px, y: py, z: pz, starts } = points
  const count = px.length
  const stepX = w > 1 ? (x1 - x0) / (w - 1) : 0
  const stepY = h > 1 ? (y1 - y0) / (h - 1) : 0
  for (let row = rowStart; row < rowEnd; row++) {
    const cy = y1 - row * stepY
    for (let col = 0; col < w; col++) {
      const cx = x0 + col * stepX
      let best = 0, bestD2 = Infinity
      for (let i = 0; i < count; i++) {
        const dx = px[i] - cx, dy = py[i] - cy
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) { bestD2 = d2; best = i }
      }
      let level = pz[best]
      // The segment before (best-1, best) and the one after (best, best+1),
      // unless a line starts there.
      for (let side = 0; side < 2; side++) {
        const a = side === 0 ? best - 1 : best, b = a + 1
        if (a < 0 || b >= count || (starts !== undefined && starts[b] === 1)) continue
        const sx = px[b] - px[a], sy = py[b] - py[a]
        const len2 = sx * sx + sy * sy
        if (!(len2 > 0)) continue
        let t = ((cx - px[a]) * sx + (cy - py[a]) * sy) / len2
        if (t < 0) t = 0; else if (t > 1) t = 1
        const qx = px[a] + sx * t - cx, qy = py[a] + sy * t - cy
        const d2 = qx * qx + qy * qy
        if (d2 < bestD2) { bestD2 = d2; level = pz[a] + (pz[b] - pz[a]) * t }
      }
      data[row * w + col] = level
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

// ─── A quantized DEM ────────────────────────────────────────────────────────

/** The vertical step of a DEM tile whose heights were rounded to a regular
 *  step (Mapterhorn rounds to 1 m up to z11, then halves the step per zoom;
 *  SRTM-derived tiles are whole metres), or 0 when the heights are finer
 *  than `minStep` or not on a regular ladder. Read from every `stride`-th
 *  pixel: a rounded tile has a few dozen distinct heights, a float one
 *  thousands, so the scan stops early on the latter. */
export function quantizationStep(dem: ArrayLike<number>, valid?: ArrayLike<number>, stride = 3, minStep = 0.05): number {
  const seen = new Set<number>()
  for (let i = 0; i < dem.length; i += stride) {
    if (valid !== undefined && valid[i] === 0) continue
    const v = dem[i]
    if (!(v === v) || v === Infinity || v === -Infinity) continue
    seen.add(Math.round(v * 1024))
    if (seen.size > 2048) return 0
  }
  if (seen.size < 2) return 0
  const levels = Float64Array.from(seen).sort()
  let step = Infinity
  for (let i = 1; i < levels.length; i++) step = Math.min(step, levels[i] - levels[i - 1])
  if (!(step >= minStep * 1024)) return 0
  for (let i = 1; i < levels.length; i++) {
    const steps = (levels[i] - levels[0]) / step
    if (Math.abs(steps - Math.round(steps)) > 1e-3) return 0
  }
  return step / 1024
}

/** Smooths the staircase of a rounded DEM without leaving what it says: a
 *  height rounded to `step` only tells that the ground is within half a step
 *  of it, so the grid is blurred (box blurs of the given radii, in turn) and
 *  pulled back into that interval after each pass. A flat tread becomes a
 *  ramp at its edges; nothing moves by more than half a step. In place, on a
 *  `width` x `height` grid. The reach of the passes adds up (the sum of the
 *  radii): give the grid that much halo and its middle is the same whichever
 *  tile it was computed for. */
export function dequantizeDem(dem: Float32Array, width: number, height: number, step: number, radii: readonly number[] = [24, 16, 8]): void {
  if (!(step > 0)) return
  const half = step / 2
  const original = dem.slice()
  const line = new Float64Array(Math.max(width, height) + 1)
  const tmp = new Float32Array(dem.length)
  for (const radius of radii) {
    const r = Math.max(1, Math.floor(radius))
    // Rows into tmp, columns back into dem: a running sum, edges repeated.
    for (let y = 0; y < height; y++) {
      const base = y * width
      line[0] = 0
      for (let x = 0; x < width; x++) line[x + 1] = line[x] + dem[base + x]
      for (let x = 0; x < width; x++) {
        const a = x - r < 0 ? 0 : x - r, b = x + r >= width ? width - 1 : x + r
        tmp[base + x] = (line[b + 1] - line[a]) / (b - a + 1)
      }
    }
    // Columns: one running sum per column, moved a row at a time, so the
    // grid is still walked along its rows (a column at a time was three
    // times slower on a 608 px grid).
    const sums = line.fill(0, 0, width)
    for (let y = 0; y <= r && y < height; y++) {
      const base = y * width
      for (let x = 0; x < width; x++) sums[x] += tmp[base + x]
    }
    for (let y = 0; y < height; y++) {
      const a = y - r < 0 ? 0 : y - r, b = y + r >= height ? height - 1 : y + r
      const inv = 1 / (b - a + 1), base = y * width
      for (let x = 0; x < width; x++) {
        const at = base + x
        let v = sums[x] * inv
        const lo = original[at] - half, hi = original[at] + half
        if (v < lo) v = lo; else if (v > hi) v = hi
        dem[at] = v
      }
      if (y + r + 1 < height) { const add = (y + r + 1) * width; for (let x = 0; x < width; x++) sums[x] += tmp[add + x] }
      if (y - r >= 0) { const drop = (y - r) * width; for (let x = 0; x < width; x++) sums[x] -= tmp[drop + x] }
    }
  }
}

// ─── The centerline as a file ───────────────────────────────────────────────

type GeoJsonLike = { type?: string; features?: unknown[]; geometry?: unknown; geometries?: unknown[]; coordinates?: unknown }
export interface LineFeatureCollection {
  type: "FeatureCollection"
  features: { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "LineString"; coordinates: LngLat[] } }[]
}

/** The centerline in use as a GeoJSON FeatureCollection of LineStrings. */
export function linesToGeoJson(lines: LngLat[][], properties: Record<string, unknown> = {}): LineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.filter((l) => l.length >= 2).map((coordinates, i) => ({
      type: "Feature" as const,
      properties: { ...properties, part: i + 1, lengthM: Math.round(lineLengthM(coordinates)) },
      geometry: { type: "LineString" as const, coordinates },
    })),
  }
}

/** Every line of a GeoJSON object (a FeatureCollection, a Feature, a
 *  geometry, a GeometryCollection): LineStrings and MultiLineStrings, heights
 *  dropped. Points and polygons are ignored. */
export function linesFromGeoJson(input: unknown): LngLat[][] {
  const out: LngLat[][] = []
  const line = (coords: unknown) => {
    if (!Array.isArray(coords)) return
    const pts: LngLat[] = []
    for (const c of coords) {
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) pts.push([Number(c[0]), Number(c[1])])
    }
    if (pts.length >= 2) out.push(pts)
  }
  const walk = (node: unknown) => {
    const g = node as GeoJsonLike | null
    if (!g || typeof g !== "object") return
    if (g.type === "FeatureCollection") (g.features ?? []).forEach(walk)
    else if (g.type === "Feature") walk(g.geometry)
    else if (g.type === "GeometryCollection") (g.geometries ?? []).forEach(walk)
    else if (g.type === "LineString") line(g.coordinates)
    else if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) g.coordinates.forEach(line)
  }
  walk(input)
  return out
}

/** Douglas-Peucker, tolerance in degrees. */
export function simplifyLine(line: LngLat[], tolerance: number): LngLat[] {
  if (line.length <= 2 || !(tolerance > 0)) return line.slice()
  const keep = new Uint8Array(line.length)
  keep[0] = 1; keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  const tol2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = line[a][0], ay = line[a][1], dx = line[b][0] - ax, dy = line[b][1] - ay
    const len2 = dx * dx + dy * dy
    let worst = -1, worstD2 = tol2
    for (let i = a + 1; i < b; i++) {
      let t = len2 > 0 ? ((line[i][0] - ax) * dx + (line[i][1] - ay) * dy) / len2 : 0
      if (t < 0) t = 0; else if (t > 1) t = 1
      const ex = line[i][0] - (ax + dx * t), ey = line[i][1] - (ay + dy * t)
      const d2 = ex * ex + ey * ey
      if (d2 > worstD2) { worstD2 = d2; worst = i }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]) }
  }
  return line.filter((_, i) => keep[i] === 1)
}

/** The lines as the link's `remLine`, simplified until the text is short
 *  enough for a URL (an imported survey line can have 50 000 vertices). The
 *  first tolerance is 1 m, the encoding's own precision. */
export function encodeLinesForUrl(lines: LngLat[][], maxChars = 6000): { text: string; simplified: boolean } {
  let text = encodeLines(lines)
  let tolerance = 1e-5, simplified = false
  while (text.length > maxChars && tolerance < 0.05) {
    text = encodeLines(lines.map((l) => simplifyLine(l, tolerance)))
    tolerance *= 2
    simplified = true
  }
  return { text, simplified }
}
