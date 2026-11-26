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
// This file does the same in the browser, on a grid the tiles read
// bilinearly (the trend is smooth, the DEM carries the detail): centerline
// merge and clipping, resampling, the downstream cleaning and the ramps
// RiverREM does not do, the k estimate, the IDW grid, and the two methods of
// Iconem's RiverREM_UI client engine (github.com/Iconem/RiverREM_UI): nearest
// centerline by a scan, and by a labeled Euclidean distance transform, with
// the blending of the creases that such a trend has. Nothing
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
/** Cells on the longer side of the IDW and scanned-nearest trend grids
 *  (RiverREM_UI's client engine: 256). The distance-transform and jump-flood
 *  methods are O(cells) and run at the screen's resolution instead. */
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
 *  The three others give the water level at the nearest place ON the
 *  centerline (level interpolated along the segment), and differ in how the
 *  nearest place is found:
 *  "nearest": a scan of every sample per cell, exact, O(cells x samples);
 *  "edt": the centerline burned into the grid, then a Euclidean distance
 *  transform that carries the seed's label (Felzenszwalb and Huttenlocher's
 *  two passes), O(cells);
 *  "jfa": the same seeds flooded on the GPU (jump flooding, WebGL2, see
 *  lib/river-rem-gpu.ts).
 *  EDT and JFA only find WHICH segment is nearest; the level and the distance
 *  are then worked out on that segment and its neighbors (refineNearest), so
 *  neither shows the grid's rasterization. */
export type TrendMethod = "idw" | "nearest" | "edt" | "jfa"

/** The trend on a regular Web Mercator grid; row 0 is the north edge. */
export interface TrendGrid {
  data: Float32Array; w: number; h: number; x0: number; y0: number; x1: number; y1: number
  /** Distance to the centerline in metres, per cell: written by the three
   *  nearest-centerline methods, read by blendTrendByDistance. */
  dist?: Float32Array
}

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
  const { data, dist, w, h, x0, y0, x1, y1 } = grid
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
      if (dist !== undefined) dist[row * w + col] = Math.sqrt(bestD2)
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

// ─── Steps into ramps ───────────────────────────────────────────────────────

/** A staircase read as the slope it stands for. The water level read along a
 *  river comes out in steps: heights rounded by the DEM (Mapterhorn: 1 m up
 *  to z11, half of it per level after), water flattened survey by survey with
 *  a jump where two surveys meet (1.25 m on the Mississippi near Greenville),
 *  and the running minimum's own treads. Every interpolation then prints each
 *  step across the whole floodplain as a straight line at right angles to
 *  the river. Here each run of equal levels gives one knot at its middle (a
 *  height rounded to L is L in the middle of its tread, half a step higher
 *  where the tread starts and half a step lower where it ends) and the level
 *  is linear between knots: continuous, never rising where the input never
 *  rose, and unchanged where no two neighbors are equal.
 *
 *  `maxHalfRamp` (samples) bounds how far a ramp reaches into a long tread: a
 *  reservoir stays flat except near its two ends, where a dam's step becomes
 *  a ramp of that length. NaN stays NaN. */
export function rampProfile(levels: ArrayLike<number>, maxHalfRamp = Infinity): Float64Array {
  const n = levels.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = levels[i]
  const at: number[] = []
  for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) at.push(i)
  const m = at.length
  if (m < 3) return out
  // Knots in "finite sample" positions (a gap of NaN does not stretch a ramp).
  const knotPos: number[] = [], knotVal: number[] = []
  const reach = Math.max(0, maxHalfRamp)
  const push = (pos: number, value: number) => {
    if (knotPos.length && pos <= knotPos[knotPos.length - 1]) return
    knotPos.push(pos); knotVal.push(value)
  }
  let a = 0
  while (a < m) {
    let b = a
    const v = out[at[a]]
    while (b + 1 < m && Math.abs(out[at[b + 1]] - v) < 1e-4) b++
    const half = (b - a) / 2
    if (a === 0) push(0, v)
    if (half <= reach) push(a + half, v)
    else { push(a + reach, v); push(b - reach, v) }
    if (b === m - 1) push(m - 1, v)
    a = b + 1
  }
  let k = 0
  for (let i = 0; i < m; i++) {
    while (k + 2 < knotPos.length && knotPos[k + 1] < i) k++
    const p0 = knotPos[k], p1 = knotPos[k + 1]
    const t = p1 > p0 ? Math.min(1, Math.max(0, (i - p0) / (p1 - p0))) : 0
    out[at[i]] = knotVal[k] + (knotVal[k + 1] - knotVal[k]) * t
  }
  return out
}

/** A moving average along the profile: two box passes of `radius` samples
 *  (a triangle `4 * radius + 1` samples wide), the ends repeated. For the one
 *  step rampProfile leaves alone: a drop between two heights that are each
 *  the only one at their level (a seam in a water surface that falls
 *  steadily on both sides). An average with positive weights of a profile
 *  that never rises never rises either. NaN stays NaN and is stepped over. */
export function smoothProfile(levels: ArrayLike<number>, radius: number): Float64Array {
  const n = levels.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = levels[i]
  const r = Math.floor(radius)
  const at: number[] = []
  for (let i = 0; i < n; i++) if (Number.isFinite(out[i])) at.push(i)
  const m = at.length
  if (r < 1 || m < 3) return out
  let from = new Float64Array(m), to = new Float64Array(m)
  for (let i = 0; i < m; i++) from[i] = out[at[i]]
  const sums = new Float64Array(m + 1)
  for (let pass = 0; pass < 2; pass++) {
    sums[0] = 0
    for (let i = 0; i < m; i++) sums[i + 1] = sums[i] + from[i]
    for (let i = 0; i < m; i++) {
      const a = i - r < 0 ? 0 : i - r, b = i + r >= m ? m - 1 : i + r
      to[i] = (sums[b + 1] - sums[a] + (a - (i - r)) * from[0] + (i + r - b) * from[m - 1]) / (2 * r + 1)
    }
    const swap = from; from = to; to = swap
  }
  for (let i = 0; i < m; i++) out[at[i]] = from[i]
  return out
}

// ─── Several readings per height ────────────────────────────────────────────

/** `perStation` points for each point of a line, spread over the half
 *  spacing before and after it, so that the DEM is read about once a pixel
 *  along the river instead of once per spacing. Point i's readings are at
 *  [i * perStation, (i + 1) * perStation). */
export function subSamplePoints(line: LngLat[], perStation: number): LngLat[] {
  const k = Math.max(1, Math.floor(perStation))
  if (k === 1) return line.slice()
  const out: LngLat[] = []
  for (let i = 0; i < line.length; i++) {
    const here = line[i]
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k - 0.5
      const other = t < 0 ? line[i - 1] : line[i + 1]
      const share = Math.abs(t)
      out.push(other ? [here[0] + (other[0] - here[0]) * share, here[1] + (other[1] - here[1]) * share] : here)
    }
  }
  return out
}

/** One height per station from its `perStation` readings: the given quantile
 *  of the finite ones (0.25 by default). Low, because what is not water along
 *  a centerline reads too high (a bar the line cuts across, a bridge, trees);
 *  not the minimum, so that one pit does not decide. NaN when none is finite. */
export function reduceStations(values: ArrayLike<number>, perStation: number, quantile = 0.25): Float64Array {
  const k = Math.max(1, Math.floor(perStation))
  const count = Math.floor(values.length / k)
  const out = new Float64Array(count)
  const buffer: number[] = []
  for (let i = 0; i < count; i++) {
    buffer.length = 0
    for (let j = 0; j < k; j++) { const v = values[i * k + j]; if (Number.isFinite(v)) buffer.push(v) }
    if (!buffer.length) { out[i] = NaN; continue }
    buffer.sort((p, q) => p - q)
    const pos = quantile * (buffer.length - 1)
    const lo = Math.floor(pos), hi = Math.min(buffer.length - 1, lo + 1)
    out[i] = buffer[lo] + (buffer[hi] - buffer[lo]) * (pos - lo)
  }
  return out
}

// ─── Nearest centerline by a distance transform ─────────────────────────────

/** The centerline burned into the grid: for each cell a segment passes
 *  through, the index of that segment's first sample; -1 elsewhere. A line of
 *  one sample burns its cell. These are the seeds of the distance transform
 *  and of the jump flood. */
export function burnCenterline(grid: TrendGrid, points: TrendPoints): Int32Array {
  const { w, h, x0, y0, x1, y1 } = grid
  const { x: px, y: py, starts } = points
  const count = px.length
  const seeds = new Int32Array(w * h).fill(-1)
  const scaleX = (w - 1) / (x1 - x0), scaleY = (h - 1) / (y1 - y0)
  const mark = (gx: number, gy: number, label: number) => {
    const col = Math.round(gx), row = Math.round(gy)
    if (col >= 0 && col < w && row >= 0 && row < h) seeds[row * w + col] = label
  }
  for (let a = 0; a < count; a++) {
    const b = a + 1
    const ax = (px[a] - x0) * scaleX, ay = (y1 - py[a]) * scaleY
    if (b >= count || (starts !== undefined && starts[b] === 1)) { mark(ax, ay, a); continue }
    const bx = (px[b] - x0) * scaleX, by = (y1 - py[b]) * scaleY
    const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) + 1
    for (let s = 0; s <= steps; s++) { const t = s / steps; mark(ax + (bx - ax) * t, ay + (by - ay) * t, a) }
  }
  return seeds
}

/** For every cell, the label of the nearest seed cell (Euclidean, in cells):
 *  Felzenszwalb and Huttenlocher's distance transform of sampled functions,
 *  carrying the label instead of the distance. First down each column (the
 *  nearest seed of that column), then along each row (the lower envelope of
 *  one parabola per column). Exact for the burned cells, O(cells), nothing
 *  allocated per cell. -1 everywhere when there is no seed. */
export function labelNearestSeed(seeds: Int32Array, w: number, h: number): Int32Array {
  const INF = 1e20
  // Phase 1: per cell, the row of the nearest seed in its own column.
  const seedRow = new Int32Array(w * h)
  for (let col = 0; col < w; col++) {
    let last = -1
    for (let row = 0; row < h; row++) {
      if (seeds[row * w + col] >= 0) last = row
      seedRow[row * w + col] = last
    }
    last = -1
    for (let row = h - 1; row >= 0; row--) {
      const at = row * w + col
      if (seeds[at] >= 0) last = row
      const above = seedRow[at]
      if (last >= 0 && (above < 0 || last - row < row - above)) seedRow[at] = last
    }
  }
  // Phase 2: per row, the lower envelope of the parabolas (q - col)^2 + f(col).
  const labels = new Int32Array(w * h).fill(-1)
  const f = new Float64Array(w)
  const v = new Int32Array(w)
  const z = new Float64Array(w + 1)
  for (let row = 0; row < h; row++) {
    const base = row * w
    let k = -1
    for (let col = 0; col < w; col++) {
      const sr = seedRow[base + col]
      if (sr < 0) { f[col] = INF; continue }
      const dy = row - sr
      const fc = dy * dy
      f[col] = fc
      while (k >= 0) {
        const p = v[k]
        const s = ((fc + col * col) - (f[p] + p * p)) / (2 * (col - p))
        if (s <= z[k]) k--
        else { k++; v[k] = col; z[k] = s; z[k + 1] = INF; break }
      }
      if (k < 0) { k = 0; v[0] = col; z[0] = -INF; z[1] = INF }
    }
    if (k < 0) continue
    let j = 0
    for (let col = 0; col < w; col++) {
      while (z[j + 1] < col) j++
      const from = v[j]
      labels[base + col] = seeds[seedRow[base + from] * w + from]
    }
  }
  return labels
}

/** How many segments on each side of the labeled one refineNearest tries:
 *  the nearest place is within about two cells of the labeled seed, so two
 *  cells' worth of segments (two at least: samples wider apart than a cell). */
export function refineReach(grid: TrendGrid, points: TrendPoints): number {
  const { x: px, y: py, starts } = points
  let length = 0, segments = 0
  for (let b = 1; b < px.length; b++) {
    if (starts !== undefined && starts[b] === 1) continue
    length += Math.hypot(px[b] - px[b - 1], py[b] - py[b - 1]); segments++
  }
  if (!segments || !(length > 0)) return 2
  const cell = Math.max((grid.x1 - grid.x0) / Math.max(1, grid.w - 1), (grid.y1 - grid.y0) / Math.max(1, grid.h - 1))
  return Math.max(2, Math.min(64, Math.ceil((2 * cell * segments) / length) + 1))
}

/** The level and the distance at the nearest place of the centerline, for
 *  rows [rowStart, rowEnd), given for each cell a segment that is nearest or
 *  next to it (`labels`, from labelNearestSeed or the jump flood). The
 *  labeled segment and `reach` on each side are tried: a cell holds the last
 *  segment burned into it, and with samples closer than a cell the truly
 *  nearest one is a neighbor of that. A cell with no label (no seed at all)
 *  takes the first sample. Fills `grid.data` and `grid.dist`.
 *
 *  What is left of the rasterization: a seed is a cell, up to half a cell off
 *  the line, so a crease between two reaches can lie a cell away from where
 *  an exact scan puts it (1.2 % of the cells of a 256 grid differ; the level
 *  beside the river and along it does not depend on the grid). */
export function refineNearest(grid: TrendGrid, points: TrendPoints, labels: Int32Array, rowStart = 0, rowEnd = grid.h, reach = refineReach(grid, points)): void {
  const { data, w, h, x0, y0, x1, y1 } = grid
  const dist = (grid.dist ??= new Float32Array(w * h))
  const { x: px, y: py, z: pz, starts } = points
  const count = px.length
  const stepX = w > 1 ? (x1 - x0) / (w - 1) : 0
  const stepY = h > 1 ? (y1 - y0) / (h - 1) : 0
  for (let row = rowStart; row < rowEnd; row++) {
    const cy = y1 - row * stepY
    for (let col = 0; col < w; col++) {
      const cell = row * w + col
      const label = labels[cell]
      if (label < 0) { data[cell] = count ? pz[0] : NaN; dist[cell] = Infinity; continue }
      const cx = x0 + col * stepX
      let dx = px[label] - cx, dy = py[label] - cy
      let bestD2 = dx * dx + dy * dy, level = pz[label]
      const first = label - reach < 0 ? 0 : label - reach
      const last = label + reach >= count - 1 ? count - 2 : label + reach
      for (let a = first; a <= last; a++) {
        const b = a + 1
        if (starts !== undefined && starts[b] === 1) continue
        const sx = px[b] - px[a], sy = py[b] - py[a]
        const len2 = sx * sx + sy * sy
        if (!(len2 > 0)) continue
        let t = ((cx - px[a]) * sx + (cy - py[a]) * sy) / len2
        if (t < 0) t = 0; else if (t > 1) t = 1
        dx = px[a] + sx * t - cx; dy = py[a] + sy * t - cy
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) { bestD2 = d2; level = pz[a] + (pz[b] - pz[a]) * t }
      }
      data[cell] = level
      dist[cell] = Math.sqrt(bestD2)
    }
  }
}

/** The "edt" method in one go (tests; the engine runs the three steps itself
 *  to yield between them). */
export function fillTrendEdt(grid: TrendGrid, points: TrendPoints): void {
  refineNearest(grid, points, labelNearestSeed(burnCenterline(grid, points), grid.w, grid.h))
}

// ─── Blending the creases ───────────────────────────────────────────────────

/** Two box blurs of radius `r` (edges repeated), from `src` into `dst`,
 *  through `tmp`: running sums, so the cost does not depend on the radius. */
function boxBlurTwice(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, r: number, line: Float64Array): void {
  let from = src
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const base = y * w
      line[0] = 0
      for (let x = 0; x < w; x++) line[x + 1] = line[x] + from[base + x]
      for (let x = 0; x < w; x++) {
        const a = x - r < 0 ? 0 : x - r, b = x + r >= w ? w - 1 : x + r
        // Edges repeated: the cells missing on one side count as the edge's.
        tmp[base + x] = (line[b + 1] - line[a] + (a - (x - r)) * from[base] + (x + r - b) * from[base + w - 1]) / (2 * r + 1)
      }
    }
    const sums = line.fill(0, 0, w)
    for (let x = 0; x < w; x++) sums[x] = (r + 1) * tmp[x]
    for (let y = 1; y <= r; y++) { const row = (y < h ? y : h - 1) * w; for (let x = 0; x < w; x++) sums[x] += tmp[row + x] }
    const inv = 1 / (2 * r + 1)
    for (let y = 0; y < h; y++) {
      const base = y * w
      for (let x = 0; x < w; x++) dst[base + x] = sums[x] * inv
      const add = (y + r + 1 < h ? y + r + 1 : h - 1) * w, drop = (y - r > 0 ? y - r : 0) * w
      for (let x = 0; x < w; x++) sums[x] += tmp[add + x] - tmp[drop + x]
    }
    from = dst
  }
}

/** Smooths a nearest-centerline trend in proportion to the distance from the
 *  river. Such a trend is exact beside the channel and has a crease wherever
 *  two reaches are equally near (the axis of a meander neck, the line between
 *  two channels): there the level jumps from one reach's to the other's, and
 *  the REM shows an edge that is not in the ground. A crease is never close
 *  to the river (it is as far from it as the two reaches are apart), so each
 *  cell is averaged over a neighborhood whose size is `amount` times its own
 *  distance to the centerline: nothing at the water's edge, a wide blend far
 *  out, and a jump becomes a ramp about that wide.
 *
 *  Done with a stack of blurs of doubling radius (each two box blurs of the
 *  one before), each cell taking the two levels that bracket its own radius:
 *  O(cells x log(size)). A grid larger than `maxSize` is blended on every
 *  f-th cell (measured: 1.8 s for 2048 x 2048 in full, 67 ms for 512): the
 *  blended trend is smooth, so the coarse copy read bilinearly is the same
 *  surface, and the full grid keeps its own values within a coarse cell or
 *  so of the blur's reach (beside the river, where nothing is blended).
 *  In place; `dist` in metres, `cellM` the cell size. */
export function blendTrendByDistance(data: Float32Array, dist: Float32Array, w: number, h: number, cellM: number, amount: number, maxSize = 512): void {
  if (!(amount > 0) || !(cellM > 0) || w < 3 || h < 3) return
  const f = Math.ceil(Math.max(w, h) / maxSize)
  if (f <= 1) { blendFull(data, dist, w, h, cellM, amount); return }
  const cw = Math.ceil((w - 1) / f) + 1, ch = Math.ceil((h - 1) / f) + 1
  const coarse = new Float32Array(cw * ch), coarseDist = new Float32Array(cw * ch)
  for (let j = 0; j < ch; j++) {
    const row = Math.min(h - 1, j * f) * w
    for (let i = 0; i < cw; i++) { const at = row + Math.min(w - 1, i * f); coarse[j * cw + i] = data[at]; coarseDist[j * cw + i] = dist[at] }
  }
  blendFull(coarse, coarseDist, cw, ch, cellM * f, amount)
  // Blur radius in coarse cells: under half a cell the full grid's own value,
  // over one and a half the coarse blend, a smooth step between.
  const scale = amount / (cellM * f)
  const inv = 1 / f
  for (let row = 0; row < h; row++) {
    const gy = row * inv, j0 = Math.min(ch - 1, Math.floor(gy)), j1 = Math.min(ch - 1, j0 + 1), fy = gy - j0
    const top = j0 * cw, bottom = j1 * cw
    for (let col = 0; col < w; col++) {
      const at = row * w + col
      let t = dist[at] * scale - 0.5
      if (!(t > 0)) continue
      const gx = col * inv, i0 = Math.min(cw - 1, Math.floor(gx)), i1 = Math.min(cw - 1, i0 + 1), fx = gx - i0
      const blended = (coarse[top + i0] * (1 - fx) + coarse[top + i1] * fx) * (1 - fy) + (coarse[bottom + i0] * (1 - fx) + coarse[bottom + i1] * fx) * fy
      if (t >= 1) { data[at] = blended; continue }
      t = t * t * (3 - 2 * t)
      data[at] += (blended - data[at]) * t
    }
  }
}

function blendFull(data: Float32Array, dist: Float32Array, w: number, h: number, cellM: number, amount: number): void {
  let farthest = 0
  for (let i = 0; i < dist.length; i++) { const d = dist[i]; if (d > farthest && d < Infinity) farthest = d }
  const wanted = (amount * farthest) / cellM // the largest sigma asked for, in cells
  if (!(wanted > 0.25)) return
  let current: Float32Array = data.slice(), next: Float32Array = new Float32Array(data.length)
  const tmp = new Float32Array(data.length)
  const line = new Float64Array(Math.max(w, h) + 1)
  const scale = amount / cellM
  const largest = Math.max(w, h) / 2
  let sigma = 0, variance = 0
  for (let r = 1; ; r *= 2) {
    boxBlurTwice(current, next, tmp, w, h, r, line)
    // Each box of radius r adds ((2r + 1)^2 - 1) / 12 to the variance.
    variance += (2 * ((2 * r + 1) ** 2 - 1)) / 12
    const nextSigma = Math.sqrt(variance)
    const last = nextSigma >= wanted || r * 2 > largest
    const span = nextSigma - sigma
    for (let i = 0; i < data.length; i++) {
      const s = dist[i] * scale
      if (s < sigma) continue
      if (s < nextSigma) data[i] = current[i] + (next[i] - current[i]) * ((s - sigma) / span)
      else if (last) data[i] = next[i]
    }
    if (last) break
    const swap = current; current = next; next = swap
    sigma = nextSigma
  }
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
