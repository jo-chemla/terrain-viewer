// Benchmark of the Hard Shadows tile kernel (lib/shadow-kernel.ts): the
// shadow-height sweep the tiles use since 2026-11-25 against the per-pixel ray
// march it replaced, and both against Mapricot's GPU terrain-shadow shader, on
// the same Terrarium tiles, view and sun. Findings:
// docs/content/docs/dev/shadow-benchmark.mdx.
//
//   node scripts/bench-shadow.mjs              # ours (Node) + Mapricot (Chrome)
//   node scripts/bench-shadow.mjs --no-chrome  # ours only
//   node scripts/bench-shadow.mjs --headed     # Chrome in a window (real GPU)
//   node scripts/bench-shadow.mjs --chrome-only  # Mapricot (and the reference) only
//
// Mapricot's page script has no licence, so none of it is in this repo: the
// script downloads https://mapricot.com/scripts/gallery/shadows.js at run time,
// takes the source of its terrain shader out of it, and runs that shader in
// Chrome (driven over the DevTools protocol, no Playwright needed) on the
// mosaic its page would build for the same view. Tiles are cached in
// .cache/shadow-bench/. Needs Node 22.18+ (imports the .ts kernel directly).
import { inflateSync } from "node:zlib"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { tmpdir } from "node:os"
import { buildShadowRay, computeShadowRowsMarch, computeShadowTile } from "../lib/shadow-kernel.ts"

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
// Mapricot's grid() as its page describes it: zoom + 1 (at most 15), one more
// tile on every side, coarser while that exceeds 48 tiles.
function mapricotGrid(p) {
  const b = viewBounds(p)
  for (let z = Math.min(Math.floor(p.zoom) + 1, 15); ; z--) {
    const s = 2 ** z
    const g = { z, x0: Math.floor(b.x0 * s) - 1, y0: Math.floor(b.y0 * s) - 1, x1: Math.floor(b.x1 * s) + 1, y1: Math.floor(b.y1 * s) + 1 }
    if ((g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1) <= 48 || z === 1) return g
  }
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

// ---------- Chrome (Mapricot's shader) ----------
async function mapricotShader() {
  const src = await (await fetch("https://mapricot.com/scripts/gallery/shadows.js")).text()
  // The first program(`vertex`, `fragment`) call is the terrain shadow pass.
  const m = src.match(/program\(\s*`([\s\S]*?)`\s*,\s*`([\s\S]*?)`\s*,?\s*\)/)
  if (!m) throw new Error("terrain shader not found in Mapricot's shadows.js (page changed?)")
  return { vertex: m[1], fragment: m[2], bytes: src.length }
}

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
    console.error(`chrome: ${page.webSocketDebuggerUrl}`)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    let id = 0
    const waiting = new Map()
    ws.onmessage = (e) => { if (process.env.DEBUG) console.error("cdp <-", String(e.data).slice(0, 300)); const msg = JSON.parse(e.data); waiting.get(msg.id)?.(msg); waiting.delete(msg.id) }
    const evaluate = (expression) => new Promise((res, rej) => {
      const mid = ++id
      setTimeout(() => rej(new Error("page evaluation timed out (120 s)")), 120000).unref()
      waiting.set(mid, (msg) => msg.error || msg.result.exceptionDetails ? rej(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails).slice(0, 800))) : res(msg.result.result.value))
      ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    try { return await fn(evaluate) } catch (e) {
      ws.send(JSON.stringify({ id: 99999, method: "Runtime.evaluate", params: { expression: "String(window.__stage)", returnByValue: true } }))
      await new Promise((r) => { waiting.set(99999, (m) => { console.error("page stage:", m.result?.result?.value); r() }); setTimeout(r, 3000) })
      throw e
    }
  } finally { proc.kill() }
}

// Runs in the page: Mapricot's own decode path (createImageBitmap, 2D canvas
// readback, Terrarium to metres), its mosaic and R16F upload, then the
// shader's draw, timed to completion with a 1-pixel readPixels.
async function pageBench(cfg) {
  const t0 = performance.now()
  const blobs = await Promise.all(cfg.urls.map((u) => fetch(u).then((r) => r.blob())))
  const tFetch = performance.now() - t0
  window.__stage = "fetched"
  const t1 = performance.now()
  const metres = await Promise.all(blobs.map(async (b) => {
    const bitmap = await createImageBitmap(b), c = new OffscreenCanvas(256, 256), ctx = c.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, 256, 256), m = new Float32Array(65536)
    for (let i = 0; i < m.length; i++) m[i] = Math.max(0, data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768)
    return m
  }))
  const tDecode = performance.now() - t1
  window.__stage = "decoded"
  const { columns, width, height } = cfg
  const t2 = performance.now()
  const grid = new Float32Array(width * height)
  metres.forEach((m, i) => { const left = (i % columns) * 256, top = Math.floor(i / columns) * 256; for (let r = 0; r < 256; r++) grid.set(m.subarray(r * 256, r * 256 + 256), (top + r) * width + left) })
  const highest = grid.reduce((a, v) => Math.max(a, v), 0)
  const tAssemble = performance.now() - t2
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })
  const dbg = gl.getExtension("WEBGL_debug_renderer_info")
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  const prog = gl.createProgram()
  for (const [type, s] of [[gl.VERTEX_SHADER, cfg.vertex], [gl.FRAGMENT_SHADER, cfg.fragment]]) {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, `#version 300 es\nprecision highp float;\n${s}`)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
    gl.attachShader(prog, sh)
  }
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const px = new Uint8Array(4)
  const t3 = performance.now()
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.FLOAT, grid)
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const tUpload = performance.now() - t3
  window.__stage = "uploaded"
  const u = (n) => gl.getUniformLocation(prog, n)
  gl.viewport(0, 0, width, height)
  gl.uniform2f(u("size"), width, height)
  gl.uniform2f(u("origin"), cfg.x0 * 256, cfg.y0 * 256)
  gl.uniform1f(u("world"), 256 * 2 ** cfg.z)
  gl.uniform2f(u("toSun"), Math.sin(cfg.az), -Math.cos(cfg.az))
  gl.uniform1f(u("slope"), Math.tan(cfg.alt))
  gl.uniform1f(u("highest"), highest)
  // Sun overhead-ish at the centre for the day/night test only, so every pixel is in daylight.
  gl.uniform1f(u("declination"), cfg.lat)
  gl.uniform1f(u("hour"), -cfg.lon)
  gl.uniform3f(u("shade"), 28 / 255, 37 / 255, 65 / 255)
  const draws = []
  for (let r = 0; r < cfg.reps + 1; r++) {
    const t = performance.now()
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    draws.push(performance.now() - t)
  }
  // The 1-pixel readback's own round trip, to subtract.
  const sync = []
  for (let r = 0; r < 10; r++) { const t = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); sync.push(performance.now() - t) }
  window.__stage = "drawn"
  const all = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, all)
  // Alpha > 0 is shadow; readPixels rows go bottom-up, the shader drew row 0 at the top.
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y * width + x] = all[((height - 1 - y) * width + x) * 4 + 3] ? 1 : 0
  let bin = ""
  for (let i = 0; i < mask.length; i += 8192) bin += String.fromCharCode(...mask.subarray(i, i + 8192))
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1]
  return { renderer, tFetch, tDecode, tAssemble, tUpload, firstDraw: draws[0], draw: med(draws.slice(1)), sync: med(sync), highest, mask: btoa(bin) }
}

// ---------- run ----------
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))
const report = []
for (const p of PLACES) {
  const T = ourTiles(p), G = mapricotGrid(p), k = Math.ceil(REF_RADIUS / 256)
  const tileList = []
  for (let y = T.y0; y <= T.y1; y++) for (let x = T.x0; x <= T.x1; x++) tileList.push([x, y])
  await loadRange(T.z, T.x0 - k, T.y0 - k, T.x1 + k, T.y1 + k)
  await loadRange(G.z, G.x0, G.y0, G.x1, G.y1)
  console.log(`\n${p.name}, zoom ${p.zoom}: ours ${tileList.length} tiles at z${T.z}; Mapricot ${(G.x1 - G.x0 + 1) * (G.y1 - G.y0 + 1)} tiles at z${G.z}`)
  const row = { place: p.name, zoom: p.zoom, z: T.z, tiles: tileList.length, ours: {}, mapricot: null }
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
  for (const v of args.has("--chrome-only") ? [] : variants) {
    let total = 0, max = 0, shadow = 0, iouSum = 0
    for (const [x, y] of tileList) {
      const inp = v.radius === REF_RADIUS ? refInputs.get(`${x}/${y}`) : kernelInput(T.z, x, y, v.radius)
      const { result, best } = time(() => v.fn(inp))
      total += best; max = Math.max(max, best); shadow += shadowCount(result); iouSum += compare(result, refs.get(`${x}/${y}`))
    }
    row.ours[v.label] = { perTile: total / tileList.length, maxTile: max, total, pool4: total / 4, shadowPct: (100 * shadow) / pixels, iou: iouSum / tileList.length }
    console.log(`  ${v.label.padEnd(22)} ${fmt(total / tileList.length).padStart(6)} ms/tile (max ${fmt(max)})  total ${fmt(total).padStart(6)} ms  shadow ${((100 * shadow) / pixels).toFixed(1)} %  IoU vs ref ${(iouSum / tileList.length).toFixed(3)}`)
  }
  // Idea 2 at view scale: one sweep over the view's tiles plus the reference
  // halo, shared by every tile (what a per-view or per-metatile pass costs).
  if (!args.has("--chrome-only")) {
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
  report.push({ row, T, G, refs, p })
}

if (!args.has("--no-chrome")) {
  const shader = await mapricotShader()
  console.log(`\nMapricot shadows.js: ${shader.bytes} bytes, terrain shader found`)
  await withChrome(async (evaluate) => {
    for (const { row, T, G, refs, p } of report) {
      const columns = G.x1 - G.x0 + 1, rows = G.y1 - G.y0 + 1
      const urls = []
      for (let y = G.y0; y <= G.y1; y++) for (let x = G.x0; x <= G.x1; x++) urls.push(TERRARIUM.replace("{z}", G.z).replace("{x}", x).replace("{y}", y))
      const cfg = { ...shader, urls, columns, width: columns * 256, height: rows * 256, z: G.z, x0: G.x0, y0: G.y0, az: (SUN.azimuthDeg * Math.PI) / 180, alt: (SUN.altitudeDeg * Math.PI) / 180, lat: (p.lat * Math.PI) / 180, lon: (p.lon * Math.PI) / 180, reps: 20 }
      await evaluate(`(${pageBench.toString()})(${JSON.stringify(cfg)}).then(r => (window.__r = r, true))`) // warm-up (shader compile, HTTP cache)
      // The mask comes back in pieces: one multi-megabyte CDP message never arrives.
      const r = await evaluate(`(${pageBench.toString()})(${JSON.stringify(cfg)}).then(r => (window.__r = r, { ...r, mask: r.mask.length }))`)
      let b64 = ""
      for (let i = 0; i < r.mask; i += 500000) b64 += await evaluate(`window.__r.mask.slice(${i}, ${i + 500000})`)
      const mask = Buffer.from(b64, "base64")
      // Compare over our view tiles when both work at the same zoom.
      let shadow = 0, both = 0, either = 0, n = 0
      if (G.z === T.z) {
        for (const [key, ref] of refs) {
          const [x, y] = key.split("/").map(Number)
          for (let i = 0; i < 65536; i++) {
            const gx = (x - G.x0) * 256 + (i & 255), gy = (y - G.y0) * 256 + (i >> 8), s = mask[gy * cfg.width + gx], q = ref[i * 4 + 3] ? 1 : 0
            shadow += s; n++; if (s && q) both++; if (s || q) either++
          }
        }
      }
      const gpu = Math.max(0, r.draw - r.sync)
      row.mapricot = { renderer: r.renderer, tiles: columns * rows, z: G.z, decode: r.tDecode, assemble: r.tAssemble, upload: r.tUpload, firstDraw: r.firstDraw, draw: gpu, perTile: gpu / (columns * rows), shadowPct: n ? (100 * shadow) / n : NaN, iou: either ? both / either : NaN }
      console.log(`\n${p.name}: Mapricot on ${r.renderer}`)
      console.log(`  ${columns * rows} tiles z${G.z} (${cfg.width}x${cfg.height}); decode ${fmt(r.tDecode)} ms, mosaic ${fmt(r.tAssemble)} ms, R16F upload ${fmt(r.tUpload)} ms, first draw ${fmt(r.firstDraw)} ms, warm draw ${fmt(gpu)} ms (${(gpu / (columns * rows)).toFixed(3)} ms/tile)`)
      console.log(`  shadow ${row.mapricot.shadowPct.toFixed(1)} % of our view tiles; IoU vs our r=${REF_RADIUS} reference ${row.mapricot.iou.toFixed(3)}`)
    }
  })
}

mkdirSync(CACHE, { recursive: true })
writeFileSync(`${CACHE}/results.json`, JSON.stringify({ date: new Date().toISOString(), sun: SUN, view: VIEW, results: report.map((r) => r.row) }, null, 2))
console.log(`\nWrote ${CACHE}/results.json`)
