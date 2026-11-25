// Benchmark of the two Hard Shadows renderers, on real Terrarium tiles:
//  - the tile kernel (lib/shadow-kernel.ts, the shadow:// tiles): the
//    shadow-height sweep the tiles use since 2026-11-25 against the per-pixel
//    ray march it replaced, timed in Node, against a long-radius reference;
//  - the live GPU layer (lib/shadow-live-gl-layer.ts): its march, with and
//    without the far-field mosaic and the Earth's curvature, through the CPU
//    twin (sunVisibilityCpu) against a reference reaching tens of km toward
//    the sun, and the very shader string (shadowFragmentShader) run in Chrome
//    on the real GPU (driven over the DevTools protocol, no Playwright) for
//    its draw time and a pixel check against the twin.
// Findings: docs/content/docs/dev/shadow-renderers.mdx.
//
//   node scripts/bench-shadow.mjs               # both, Chrome for the shader
//   node scripts/bench-shadow.mjs --no-chrome   # Node only
//   node scripts/bench-shadow.mjs --tiles-only  # the tile kernel only
//   node scripts/bench-shadow.mjs --live-only   # the live renderer only
//   node scripts/bench-shadow.mjs --headed      # Chrome in a window
//
// Tiles are cached in .cache/shadow-bench/. Needs Node 22.18+ (imports the
// .ts modules directly).
import { inflateSync } from "node:zlib"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { tmpdir } from "node:os"
import { buildShadowRay, computeShadowRowsMarch, computeShadowTile } from "../lib/shadow-kernel.ts"
import {
  chooseFarLayout, chooseMosaicLayout, farTransform, shadowFragmentShader, sunStepVector, sunVisibilityCpu, texelGroundMeters,
  CURVATURE_PER_M2, SHADOW_STEP_GROWTH, SUN_RADIUS_DEG,
} from "../lib/shadow-live-math.ts"

const args = new Set(process.argv.slice(2))
const TERRARIUM = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
const CACHE = ".cache/shadow-bench"
const VIEW = { width: 1280, height: 800 } // CSS px, DPR 1, pitch 0, bearing 0
const SUN = { azimuthDeg: 135, altitudeDeg: 15 } // south-east, low morning sun
const PLACES = [
  { name: "Chamonix valley", lon: 6.8694, lat: 45.9237, zoom: 13 },
  { name: "Seine cliffs and plateau, Les Andelys", lon: 1.4170, lat: 49.2400, zoom: 15 },
]
const OLD_RADII = [32, 64] // the march's default and slider maximum until 2026-11-25
const SWEEP_RADII = [32, 64, 128, 256, 384, 512] // 256 the new default, 512 the new maximum
const REF_RADIUS = Number(process.env.REF_RADIUS ?? 768) // reference: long enough for every shadow in these views
// Best of REPS runs per tile: on a loaded machine the minimum is the stable
// figure (the median of 5 moved 2 to 4x between runs on 2026-11-25).
const REPS = Number(process.env.REPS ?? 9)

// ---------- tiles ----------
function decodePng(buf) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len)
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; if (data[12]) throw new Error("interlaced PNG") }
    else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") break
    p += 12 + len
  }
  const bpp = { 2: 3, 6: 4 }[ct]
  if (bd !== 8 || !bpp) throw new Error(`unsupported PNG (bit depth ${bd}, colour type ${ct})`)
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y ? px[dst - stride + i] : 0, c = y && i >= bpp ? px[dst - stride + i - bpp] : 0
      let v = raw[src + i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      px[dst + i] = v
    }
  }
  const m = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) m[i] = px[i * bpp] * 256 + px[i * bpp + 1] + px[i * bpp + 2] / 256 - 32768
  return m
}

const tiles = new Map()
async function tile(z, x, y) {
  const key = `${z}/${x}/${y}`
  if (tiles.has(key)) return tiles.get(key)
  const file = `${CACHE}/tiles/${key}.png`
  if (!existsSync(file)) {
    let r
    for (let attempt = 0; ; attempt++) {
      try { r = await fetch(TERRARIUM.replace("{z}", z).replace("{x}", x).replace("{y}", y)); break }
      catch (e) { if (attempt === 4) throw e; await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1))) }
    }
    if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  }
  const m = decodePng(readFileSync(file))
  tiles.set(key, m)
  return m
}
async function loadRange(z, x0, y0, x1, y1) {
  const jobs = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y])
  for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16).map(([x, y]) => tile(z, x, y)))
}

// The tile padded by `halo` pixels from its neighbours (any halo; the app's
// fetch takes one ring of neighbours up to a 256 px halo, two up to 512).
function padded(z, x, y, n, halo) {
  const stride = n + 2 * halo, out = new Float32Array(stride * stride), max = (1 << z) * n - 1
  for (let pr = 0; pr < stride; pr++) {
    const gy = Math.min(Math.max(y * n - halo + pr, 0), max)
    for (let pc = 0; pc < stride; pc++) {
      const gx = Math.min(Math.max(x * n - halo + pc, 0), max)
      out[pr * stride + pc] = tiles.get(`${z}/${gx >> 8}/${gy >> 8}`)[(gy & 255) * n + (gx & 255)]
    }
  }
  return { padded: out, stride }
}

// ---------- view geometry ----------
const mercX = (lon) => (lon + 180) / 360
const mercY = (lat) => (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2
function viewBounds(p) {
  const world = 512 * 2 ** p.zoom, cx = mercX(p.lon), cy = mercY(p.lat)
  return { x0: cx - VIEW.width / 2 / world, x1: cx + VIEW.width / 2 / world, y0: cy - VIEW.height / 2 / world, y1: cy + VIEW.height / 2 / world }
}
// What MapLibre requests for a 256 px raster source: zoom + 1, the tiles the view touches.
function ourTiles(p) {
  const b = viewBounds(p), z = Math.min(Math.floor(p.zoom) + 1, 15), s = 2 ** z
  return { z, x0: Math.floor(b.x0 * s), y0: Math.floor(b.y0 * s), x1: Math.floor(b.x1 * s), y1: Math.floor(b.y1 * s) }
}
const groundRes = (lat, z, n) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (n * 2 ** z)
const tileLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

// ---------- kernels ----------
function kernelInput(z, x, y, radiusPx) {
  const n = 256, { padded: grid, stride } = padded(z, x, y, n, radiusPx), az = (SUN.azimuthDeg * Math.PI) / 180
  return { padded: grid, stride, n, radiusPx, dRow: -Math.cos(az), dCol: Math.sin(az), groundResM: groundRes(tileLat(y + 0.5, z), z, n), altitudeRad: (SUN.altitudeDeg * Math.PI) / 180 }
}
// The march as it shipped until 2026-11-25 (no early exit).
function runOldMarch(input) {
  const { padded: g, stride, n, radiusPx } = input
  const { offsets, invDist, tanAltitude } = buildShadowRay(input), out = new Uint8ClampedArray(n * n * 4)
  const steps = offsets.length
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const base = (row + radiusPx) * stride + col + radiusPx, c = g[base]
      for (let j = 0; j < steps; j++) if ((g[base + offsets[j]] - c) * invDist[j] > tanAltitude) { out[(row * n + col) * 4 + 3] = 255; break }
    }
  }
  return out
}
// The march kept in the kernel as the reference: same pixels, plus the exact
// early exit above the padded grid's highest point.
function runMarch(input) {
  const out = new Uint8ClampedArray(input.n * input.n * 4)
  computeShadowRowsMarch(input, buildShadowRay(input), 0, input.n, out)
  return out
}
// What the tiles run.
function runSweep(input) {
  const out = new Uint8ClampedArray(input.n * input.n * 4)
  computeShadowTile(input, out)
  return out
}

// A whole-view variant of the sweep (bench only): walk the view's grid from
// the sun's side, each pixel taking the shadow height of its neighbour one
// step toward the sun (linear between two pixels) minus step * tan(alt); the
// reach is the whole grid toward the sun, so not the same for every pixel
// (fine for one pass over a view, seams if used per tile).
/** The sweep over any W x H grid; returns a 0/1 shadow mask of the same size. */
function sweepGrid(g, W, H, { dRow, dCol, groundResM, altitudeRad }) {
  const S = new Float32Array(g.length), mask = new Uint8Array(g.length)
  const rowMajor = Math.abs(dRow) >= Math.abs(dCol) // dominant axis: rows
  const a = rowMajor ? dRow : dCol, b = (rowMajor ? dCol : dRow) / Math.abs(a) // minor-axis offset per step
  const sa = Math.sign(a), drop = Math.hypot(1, b) * groundResM * Math.tan(altitudeRad)
  const fb = Math.floor(b), t = b - fb
  const major = rowMajor ? H : W, minor = rowMajor ? W : H
  // Major index i runs from the sun's side (where the previous step is i + sa).
  for (let k = 0; k < major; k++) {
    const i = sa > 0 ? major - 1 - k : k, prev = i + sa
    for (let m = 0; m < minor; m++) {
      const at = rowMajor ? i * W + m : m * W + i, h = g[at]
      const m0 = m + fb, m1 = m0 + 1
      if (prev < 0 || prev >= major || m0 < 0 || m1 >= minor) { S[at] = h; continue }
      const s0 = S[rowMajor ? prev * W + m0 : m0 * W + prev], s1 = S[rowMajor ? prev * W + m1 : m1 * W + prev]
      const cast = s0 + (s1 - s0) * t - drop
      if (cast > h) { S[at] = cast; mask[at] = 1 } else S[at] = h
    }
  }
  return mask
}

function time(fn, reps = REPS) {
  let result, best = Infinity
  const all = []
  for (let r = 0; r < reps; r++) { const t = performance.now(); result = fn(); const d = performance.now() - t; all.push(d); best = Math.min(best, d) }
  all.sort((p, q) => p - q)
  return { result, median: all[all.length >> 1], best }
}
const shadowCount = (o) => { let s = 0; for (let i = 3; i < o.length; i += 4) if (o[i]) s++; return s }
function compare(o, ref) { let both = 0, either = 0; for (let i = 3; i < o.length; i += 4) { if (o[i] && ref[i]) both++; if (o[i] || ref[i]) either++ } return either ? both / either : 1 }

// ---------- run: the tile kernel ----------
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))
const report = []
for (const p of args.has("--live-only") ? [] : PLACES) {
  const T = ourTiles(p), k = Math.ceil(REF_RADIUS / 256)
  const tileList = []
  for (let y = T.y0; y <= T.y1; y++) for (let x = T.x0; x <= T.x1; x++) tileList.push([x, y])
  await loadRange(T.z, T.x0 - k, T.y0 - k, T.x1 + k, T.y1 + k)
  console.log(`\n${p.name}, zoom ${p.zoom}: ${tileList.length} tiles at z${T.z}`)
  const row = { place: p.name, zoom: p.zoom, z: T.z, tiles: tileList.length, ours: {} }
  // Reference: long rays over a halo of REF_RADIUS.
  const refs = new Map(), refInputs = new Map()
  for (const [x, y] of tileList) { const inp = kernelInput(T.z, x, y, REF_RADIUS); refInputs.set(`${x}/${y}`, inp); refs.set(`${x}/${y}`, runMarch(inp)) }
  const pixels = tileList.length * 65536
  const refShadow = [...refs.values()].reduce((s, o) => s + shadowCount(o), 0)
  const variants = [
    ...OLD_RADII.map((r) => ({ label: `old march r=${r}`, radius: r, fn: runOldMarch })),
    ...SWEEP_RADII.map((r) => ({ label: `sweep r=${r}`, radius: r, fn: runSweep })),
    { label: `march r=${REF_RADIUS} (ref)`, radius: REF_RADIUS, fn: runMarch },
    { label: `sweep r=${REF_RADIUS}`, radius: REF_RADIUS, fn: runSweep },
  ]
  for (const v of variants) {
    let total = 0, max = 0, shadow = 0, iouSum = 0
    for (const [x, y] of tileList) {
      const inp = v.radius === REF_RADIUS ? refInputs.get(`${x}/${y}`) : kernelInput(T.z, x, y, v.radius)
      const { result, best } = time(() => v.fn(inp))
      total += best; max = Math.max(max, best); shadow += shadowCount(result); iouSum += compare(result, refs.get(`${x}/${y}`))
    }
    row.ours[v.label] = { perTile: total / tileList.length, maxTile: max, total, pool4: total / 4, shadowPct: (100 * shadow) / pixels, iou: iouSum / tileList.length }
    console.log(`  ${v.label.padEnd(22)} ${fmt(total / tileList.length).padStart(6)} ms/tile (max ${fmt(max)})  total ${fmt(total).padStart(6)} ms  shadow ${((100 * shadow) / pixels).toFixed(1)} %  IoU vs ref ${(iouSum / tileList.length).toFixed(3)}`)
  }
  // The textbook sweep at view scale: one pass over the view's tiles plus the
  // reference halo, shared by every tile (what a per-view pass costs).
  {
    const halo = REF_RADIUS, W = (T.x1 - T.x0 + 1) * 256 + 2 * halo, H = (T.y1 - T.y0 + 1) * 256 + 2 * halo
    const g = new Float32Array(W * H), max = (1 << T.z) * 256 - 1
    for (let r = 0; r < H; r++) {
      const gy = Math.min(Math.max(T.y0 * 256 - halo + r, 0), max)
      for (let c = 0; c < W; c++) { const gx = Math.min(Math.max(T.x0 * 256 - halo + c, 0), max); g[r * W + c] = tiles.get(`${T.z}/${gx >> 8}/${gy >> 8}`)[(gy & 255) * 256 + (gx & 255)] }
    }
    const inp = refInputs.values().next().value
    const { result: mask, best: median } = time(() => sweepGrid(g, W, H, inp))
    let shadow = 0, both = 0, either = 0
    for (const [x, y] of tileList) {
      const ref = refs.get(`${x}/${y}`)
      for (let i = 0; i < 65536; i++) {
        const s = mask[((y - T.y0) * 256 + (i >> 8) + halo) * W + (x - T.x0) * 256 + (i & 255) + halo], q = ref[i * 4 + 3] ? 1 : 0
        shadow += s; if (s && q) both++; if (s || q) either++
      }
    }
    const label = `sweep, whole view + ${halo}`
    row.ours[label] = { perTile: median / tileList.length, maxTile: NaN, total: median, pool4: median, shadowPct: (100 * shadow) / pixels, iou: both / either }
    console.log(`  ${label.padEnd(22)} ${fmt(median / tileList.length).padStart(6)} ms/tile (one pass)  total ${fmt(median).padStart(6)} ms  shadow ${((100 * shadow) / pixels).toFixed(1)} %  IoU vs ref ${(both / either).toFixed(3)}`)
  }
  row.refShadowPct = (100 * refShadow) / pixels
  report.push(row)
}

// ---------- the live renderer (lib/shadow-live-math.ts) ----------
// The view mosaic and the far-field mosaic as the layer lays them out for a
// 1280 x 800 view, filled from the same Terrarium tiles (256 px, so map zoom
// + 1). Accuracy from the CPU twin (sunVisibilityCpu, line for line the
// shader) on a lattice of view pixels (every LATTICE-th texel), against a
// reference: the same march at the view mosaic's resolution over a grid
// reaching far enough toward the sun for every shadow, with steps five times
// denser and the Earth's curvature. Timing and a pixel check from the shader
// itself, in Chrome (--no-chrome skips it).
const LATTICE = 4
const LIVE_CASES = [
  { name: "Chamonix valley, sun 15°", lon: 6.8694, lat: 45.9237, zoom: 13, azimuthDeg: 135, altitudeDeg: 15, reachKm: 25 },
  { name: "Mont Blanc at sunrise, sun 4°", lon: 6.8650, lat: 45.8326, zoom: 13, azimuthDeg: 110, altitudeDeg: 4, reachKm: 80 },
  { name: "Mont Blanc at sunrise, sun 2°", lon: 6.8650, lat: 45.8326, zoom: 13, azimuthDeg: 110, altitudeDeg: 2, reachKm: 120 },
  // The Po plain 60 to 100 km east of the Alps' main ridge under a setting
  // sun: the Alps' shadow is 107 km long on a flat Earth, 87 km with the
  // curvature (and refraction).
  { name: "Po plain east of Turin at sunset, sun 1.5°", lon: 8.05, lat: 45.1, zoom: 11, azimuthDeg: 255, altitudeDeg: 1.5, reachKm: 170 },
]
// Far-field levels compared (the layer uses FAR_LEVELS, 3).
const FAR_LEVEL_CHOICES = [3, 4]
// The reference's far part: this many zooms below the view mosaic.
const REF_LEVELS = 2

/** A Float32 grid of a tile rectangle at zoom z (256 px Terrarium), as the layer's mosaic. */
async function mosaicGrid(layout) {
  await loadRange(layout.z, layout.x0, layout.y0, layout.x0 + layout.nx - 1, layout.y0 + layout.ny - 1)
  const w = layout.nx * 256, h = layout.ny * 256, data = new Float32Array(w * h)
  let maxElev = -Infinity
  for (let j = 0; j < layout.ny; j++) for (let i = 0; i < layout.nx; i++) {
    const t = tiles.get(`${layout.z}/${layout.x0 + i}/${layout.y0 + j}`)
    for (let r = 0; r < 256; r++) data.set(t.subarray(r * 256, r * 256 + 256), (j * 256 + r) * w + i * 256)
  }
  for (let i = 0; i < data.length; i++) if (data[i] > maxElev) maxElev = data[i]
  return { data, w, h, mercY0: layout.y0 / 2 ** layout.z, mercPerTexel: 1 / (256 * 2 ** layout.z), maxElev }
}

const liveReport = []
for (const c of args.has("--tiles-only") ? [] : LIVE_CASES) {
  const b = viewBounds(c)
  // As the layer: one tile of margin, two when that keeps the zoom.
  const needed = chooseMosaicLayout(b, c.zoom, 256, { maxzoom: 15, margin: 1 })
  const roomy = chooseMosaicLayout(b, c.zoom, 256, { maxzoom: 15, margin: 2, preferZ: needed.z })
  const fine = roomy && roomy.z === needed.z ? roomy : needed
  const fineGrid = await mosaicGrid(fine)
  const fars = {}
  for (const levels of FAR_LEVEL_CHOICES) {
    const far = chooseFarLayout(fine, 256, { levels })
    if (far) fars[levels] = { far, grid: await mosaicGrid(far), xf: farTransform(fine, far, 256) }
  }
  // The reference: the view mosaic, then REF_LEVELS zooms coarser (not
  // FAR_LEVELS) over a grid reaching reachKm toward the sun, steps five times
  // denser, curvature on.
  const [sx, sy] = sunStepVector(c.azimuthDeg)
  const rz = fine.z - REF_LEVELS, k = 2 ** REF_LEVELS
  const tileM = texelGroundMeters(fine.y0 / 2 ** fine.z, 1 / (256 * 2 ** rz)) * 256
  const ext = Math.ceil((c.reachKm * 1000) / tileM)
  const fx0 = Math.floor(fine.x0 / k), fy0 = Math.floor(fine.y0 / k), fx1 = Math.floor((fine.x0 + fine.nx - 1) / k), fy1 = Math.floor((fine.y0 + fine.ny - 1) / k)
  const ref = { z: rz, x0: fx0 - 1 + Math.min(0, Math.floor(sx * ext)), y0: Math.max(0, fy0 - 1 + Math.min(0, Math.floor(sy * ext))) }
  ref.nx = fx1 + 1 + Math.max(0, Math.ceil(sx * ext)) - ref.x0 + 1
  ref.ny = Math.min(2 ** rz - 1, fy1 + 1 + Math.max(0, Math.ceil(sy * ext))) - ref.y0 + 1
  const far = fars[3]?.far ?? null
  console.error(`${c.name}: view mosaic ${fine.nx}x${fine.ny} z${fine.z}; reference ${ref.nx}x${ref.ny} z${ref.z} (${ref.nx * ref.ny} tiles)`)
  const refGrid = await mosaicGrid(ref)
  const refXf = farTransform(fine, ref, 256)
  // The lattice: view pixels only (the mosaic's margin is off screen).
  const world = 256 * 2 ** fine.z
  const vx0 = Math.ceil(b.x0 * world - fine.x0 * 256), vx1 = Math.floor(b.x1 * world - fine.x0 * 256)
  const vy0 = Math.ceil(b.y0 * world - fine.y0 * 256), vy1 = Math.floor(b.y1 * world - fine.y0 * 256)
  const lattice = []
  for (let y = vy0; y < vy1; y += LATTICE) for (let x = vx0; x < vx1; x += LATTICE) lattice.push([x + 0.5, y + 0.5])
  const base = { azimuthDeg: c.azimuthDeg, altitudeDeg: c.altitudeDeg }
  const t0 = performance.now()
  const refMask = lattice.map(([x, y]) => sunVisibilityCpu(fineGrid, x, y, { ...base, curvature: CURVATURE_PER_M2, growth: SHADOW_STEP_GROWTH / 5, maxSteps: 8000, far: { grid: refGrid, ...refXf } }) < 0.5)
  const tRef = performance.now() - t0
  const farOf = (levels) => (fars[levels] ? { grid: fars[levels].grid, ...fars[levels].xf } : undefined)
  const variants = [
    { label: "view mosaic only, flat Earth (ba63ca9)", o: {} },
    { label: "view mosaic only, curvature", o: { curvature: CURVATURE_PER_M2 } },
    { label: "view + far 3 levels, flat Earth", o: { far: farOf(3) } },
    { label: "view + far 3 levels, curvature (shipped)", o: { curvature: CURVATURE_PER_M2, far: farOf(3) } },
    { label: "view + far 4 levels, curvature", o: { curvature: CURVATURE_PER_M2, far: farOf(4) } },
  ]
  const row = { case: c.name, fine, far, far4: fars[4]?.far ?? null, ref, lattice: lattice.length, refShadowPct: (100 * refMask.filter(Boolean).length) / lattice.length, cpu: {}, gpu: null }
  const km = (l) => (l ? `${(l.nx * texelGroundMeters(l.y0 / 2 ** l.z, 1 / 2 ** l.z) / 1000).toFixed(0)} x ${(l.ny * texelGroundMeters(l.y0 / 2 ** l.z, 1 / 2 ** l.z) / 1000).toFixed(0)} km` : "none")
  console.log(`
${c.name} (zoom ${c.zoom}, azimuth ${c.azimuthDeg}°): view mosaic ${fine.nx}x${fine.ny} tiles z${fine.z} (${km(fine)}); far field ${far ? `${far.nx}x${far.ny} z${far.z} (${km(far)})` : "none"}, with 4 levels ${fars[4] ? `${fars[4].far.nx}x${fars[4].far.ny} z${fars[4].far.z} (${km(fars[4].far)})` : "none"}; reference ${c.reachKm} km toward the sun at z${ref.z} (${(tRef / 1000).toFixed(1)} s); ${lattice.length} lattice pixels, ${row.refShadowPct.toFixed(1)} % in shadow`)
  for (const v of variants) {
    const t1 = performance.now()
    const mask = lattice.map(([x, y]) => sunVisibilityCpu(fineGrid, x, y, { ...base, ...v.o }) < 0.5)
    const dt = performance.now() - t1
    let both = 0, either = 0, s = 0
    for (let i = 0; i < mask.length; i++) { if (mask[i]) s++; if (mask[i] && refMask[i]) both++; if (mask[i] || refMask[i]) either++ }
    row.cpu[v.label] = { shadowPct: (100 * s) / mask.length, iou: either ? both / either : 1, cpuMsPerKpx: dt / (mask.length / 1000), mask }
    console.log(`  ${v.label.padEnd(42)} shadow ${((100 * s) / mask.length).toFixed(1).padStart(5)} %  IoU vs ref ${(either ? both / either : 1).toFixed(3)}  (CPU twin ${(dt / (mask.length / 1000)).toFixed(1)} ms per 1000 px)`)
  }
  const fineFar = fars[3]
  liveReport.push({ row, c, fine, far, fineGrid, farGrid: fineFar?.grid, xf: fineFar?.xf, lattice, refMask })
}

// ---------- Chrome: the shader itself ----------
async function withChrome(fn) {
  const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)
  if (!exe) throw new Error("Chrome not found")
  const port = 9333 + Math.floor(Math.random() * 500)
  const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${resolve(tmpdir(), `shadow-bench-${port}`)}`, "--no-first-run", "--ignore-gpu-blocklist", "--enable-gpu", "--window-size=400,300"]
  if (!args.has("--headed")) flags.push("--headless=new")
  const proc = spawn(exe, [...flags, "about:blank"], { stdio: "ignore" })
  try {
    let page
    for (let i = 0; i < 50 && !page; i++) {
      await new Promise((r) => setTimeout(r, 200))
      page = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null)
    }
    if (!page) throw new Error("Chrome's DevTools endpoint did not answer")
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    let id = 0
    const waiting = new Map()
    ws.onmessage = (e) => { const msg = JSON.parse(e.data); waiting.get(msg.id)?.(msg); waiting.delete(msg.id) }
    const evaluate = (expression) => new Promise((res, rej) => {
      const mid = ++id
      setTimeout(() => rej(new Error("page evaluation timed out (120 s)")), 120000).unref()
      waiting.set(mid, (msg) => msg.error || msg.result.exceptionDetails ? rej(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails).slice(0, 800))) : res(msg.result.result.value))
      ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    return await fn(evaluate)
  } finally { proc.kill() }
}

// Runs in the page: both mosaics uploaded as R32F, the layer's shader drawn
// over the whole view mosaic (one fragment per texel), timed to completion
// with a 1-pixel readPixels (its own round trip subtracted), median of `reps`;
// then the shadow mask at the lattice points.
async function pageBench(cfg) {
  const f64 = (key) => new Float32Array(Uint8Array.from(atob(window.__data[key].join("")), (ch) => ch.charCodeAt(0)).buffer)
  const canvas = document.createElement("canvas")
  canvas.width = cfg.fine.w; canvas.height = cfg.fine.h
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: true })
  const dbg = gl.getExtension("WEBGL_debug_renderer_info")
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  const vert = `#version 300 es
out vec2 v_uv;
void main() { vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0; v_uv = vec2(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5); gl_Position = vec4(c, 0.0, 1.0); }`
  const prog = gl.createProgram()
  for (const [type, s] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, cfg.fragment]]) {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, s)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
    gl.attachShader(prog, sh)
  }
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  const texture = (unit, w, h, data) => {
    const t = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, data)
  }
  const px = new Uint8Array(4)
  const fineData = f64(cfg.fine.data), farData = f64(cfg.far.data)
  const t0 = performance.now()
  texture(0, cfg.fine.w, cfg.fine.h, fineData)
  texture(1, cfg.far.w, cfg.far.h, farData)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const tUpload = performance.now() - t0
  const u = (n) => gl.getUniformLocation(prog, n)
  gl.viewport(0, 0, cfg.fine.w, cfg.fine.h)
  gl.uniform1i(u("u_mosaic"), 0)
  gl.uniform1i(u("u_far"), 1)
  gl.uniform2f(u("u_size"), cfg.fine.w, cfg.fine.h)
  gl.uniform1f(u("u_mercY0"), cfg.fine.mercY0)
  gl.uniform1f(u("u_mercPerTexel"), cfg.fine.mercPerTexel)
  gl.uniform1f(u("u_fineMax"), cfg.fine.maxElev)
  gl.uniform2f(u("u_farSize"), cfg.far.w, cfg.far.h)
  gl.uniform1f(u("u_farScale"), cfg.xf.scale)
  gl.uniform2f(u("u_farOffset"), cfg.xf.offsetX, cfg.xf.offsetY)
  gl.uniform1f(u("u_farMercY0"), cfg.far.mercY0)
  gl.uniform1f(u("u_farMercPerTexel"), cfg.far.mercPerTexel)
  gl.uniform2f(u("u_sunStep"), cfg.sunStep[0], cfg.sunStep[1])
  gl.uniform1f(u("u_alt"), cfg.alt)
  gl.uniform1f(u("u_opacity"), 1)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  const sync = []
  for (let r = 0; r < 10; r++) { const t = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); sync.push(performance.now() - t) }
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1]
  const out = { renderer, tUpload, sync: med(sync), runs: {} }
  for (const run of cfg.runs) {
    gl.uniform1i(u("u_hasFar"), run.far ? 1 : 0)
    gl.uniform1f(u("u_allMax"), run.far ? Math.max(cfg.fine.maxElev, cfg.far.maxElev) : cfg.fine.maxElev)
    gl.uniform1f(u("u_curv"), run.curv)
    gl.uniform1f(u("u_sunRadius"), run.sunRadius)
    const draws = []
    for (let r = 0; r < cfg.reps + 1; r++) {
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const t = performance.now()
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      draws.push(performance.now() - t)
    }
    const all = new Uint8Array(cfg.fine.w * cfg.fine.h * 4)
    gl.readPixels(0, 0, cfg.fine.w, cfg.fine.h, gl.RGBA, gl.UNSIGNED_BYTE, all)
    // Rows come back bottom-up; v_uv.y = 0 is the mosaic's north edge, at the top.
    const mask = cfg.lattice.map(([x, y]) => all[((cfg.fine.h - 1 - Math.floor(y)) * cfg.fine.w + Math.floor(x)) * 4 + 3] > 127 ? 1 : 0)
    out.runs[run.label] = { draw: med(draws.slice(1)), mask }
  }
  return out
}

const b64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString("base64")
if (liveReport.length && !args.has("--no-chrome")) {
  await withChrome(async (evaluate) => {
    for (const r of liveReport) {
      if (!r.far) { console.log(`\n${r.c.name}: no far field at this zoom, Chrome run skipped`); continue }
      // The grids go over in 1 MB pieces: one multi-megabyte CDP message never arrives.
      await evaluate("window.__data = { fine: [], far: [] }; true")
      for (const [key, g] of [["fine", r.fineGrid], ["far", r.farGrid]]) {
        const s = b64(g.data)
        for (let i = 0; i < s.length; i += 1 << 20) await evaluate(`window.__data.${key}.push(${JSON.stringify(s.slice(i, i + (1 << 20)))}); true`)
      }
      const grid = (g, key) => ({ w: g.w, h: g.h, mercY0: g.mercY0, mercPerTexel: g.mercPerTexel, maxElev: g.maxElev, data: key })
      const runs = [
        { label: "view only, flat, hard (ba63ca9)", far: false, curv: 0, sunRadius: 0, cpu: "view mosaic only, flat Earth (ba63ca9)" },
        { label: "view + far, curvature, hard", far: true, curv: CURVATURE_PER_M2, sunRadius: 0, cpu: "view + far 3 levels, curvature (shipped)" },
        { label: "view + far, curvature, soft", far: true, curv: CURVATURE_PER_M2, sunRadius: (SUN_RADIUS_DEG * Math.PI) / 180 },
      ]
      const cfg = { fragment: shadowFragmentShader(-1e7), fine: grid(r.fineGrid, "fine"), far: grid(r.farGrid, "far"), xf: r.xf, sunStep: sunStepVector(r.c.azimuthDeg), alt: (r.c.altitudeDeg * Math.PI) / 180, lattice: r.lattice, runs, reps: 20 }
      await evaluate(`window.__cfg = ${JSON.stringify(cfg)}; true`)
      await evaluate(`(${pageBench.toString()})(window.__cfg).then(() => true)`) // warm-up (compile, upload)
      const out = await evaluate(`(${pageBench.toString()})(window.__cfg)`)
      const mp = (r.fine.nx * r.fine.ny * 65536) / 1e6
      console.log(`\n${r.c.name}: the shader on ${out.renderer}, ${r.fineGrid.w}x${r.fineGrid.h} fragments (${mp.toFixed(1)} Mpx); R32F upload of both mosaics ${fmt(out.tUpload)} ms`)
      r.row.gpu = { renderer: out.renderer, fragments: r.fineGrid.w * r.fineGrid.h, upload: out.tUpload, runs: {} }
      for (const run of runs) {
        const g = out.runs[run.label], draw = Math.max(0, g.draw - out.sync)
        let both = 0, either = 0, agree = 0
        const cpu = run.cpu ? r.row.cpu[run.cpu].mask : null
        for (let i = 0; i < g.mask.length; i++) {
          if (g.mask[i] && r.refMask[i]) both++
          if (g.mask[i] || r.refMask[i]) either++
          if (cpu && !!g.mask[i] === cpu[i]) agree++
        }
        r.row.gpu.runs[run.label] = { draw, perMpx: draw / mp, iou: either ? both / either : 1, cpuAgreement: cpu ? agree / g.mask.length : null }
        console.log(`  ${run.label.padEnd(34)} draw ${fmt(draw).padStart(5)} ms (${(draw / mp).toFixed(2)} ms/Mpx)  IoU vs ref ${(either ? both / either : 1).toFixed(3)}${cpu ? `  same pixels as the CPU twin ${((100 * agree) / g.mask.length).toFixed(2)} %` : ""}`)
      }
    }
  })
}

mkdirSync(CACHE, { recursive: true })
const strip = (row) => ({ ...row, cpu: Object.fromEntries(Object.entries(row.cpu).map(([k, v]) => [k, { shadowPct: v.shadowPct, iou: v.iou }])) })
writeFileSync(`${CACHE}/results.json`, JSON.stringify({ date: new Date().toISOString(), sun: SUN, view: VIEW, tiles: report, live: liveReport.map((r) => strip(r.row)) }, null, 2))
console.log(`\nWrote ${CACHE}/results.json`)
