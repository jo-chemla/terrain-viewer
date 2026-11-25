// The direct engine's cost per tile, in this thread (no worker, no HTTP,
// no tile cache): the elevation read once first, then each case drawn on
// a fixed set of tiles, median ms per tile. With an output folder, every
// tile is also written there (PNG, TIF), to compare two versions byte for
// byte: `node bench-direct.mjs out-a/` before, `out-b/` after, then
// `node bench-direct.mjs --compare out-a/ out-b/`.
//
//   node bench-direct.mjs [out-dir] [--cases svf8,hillshade] [--tiles 4]
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { viewOf } from "./server.mjs"
// BENCH_DIRECT: another copy of direct.mjs to time (in this folder).
const { plan, draw, valueTile } = await import(process.env.BENCH_DIRECT ?? "./direct.mjs")

/** The cases: a mode's query, as the tile service gets it. */
export const CASES = {
  hillshade: "modes=hillshade&hillshadeMethod=standard",
  slope: "modes=slope",
  svf8: "modes=svf&svfPrecision=precise&svfRadius=8",
  svf32: "modes=svf&svfPrecision=precise&svfRadius=32",
  shadows: "modes=shadows&shadowRenderer=raster&shadowRadiusPx=256&illuminationDir=315&illuminationAlt=15",
  colorRelief: "modes=colorRelief",
  aspect: "modes=aspect",
  tri: "modes=tri",
  curvature: "modes=curvature",
  curvaturePlan: "modes=curvature&curvatureMode=plan",
  shapeIndex: "modes=shapeIndex",
  tpi: "modes=tpi",
  roughness: "modes=roughness",
  blobness: "modes=blobness",
  lrm: "modes=lrm",
  openness: "modes=openness",
  localDominance: "modes=localDominance",
  matcap: "modes=matcap&matcapRenderer=raster",
  phong: "modes=phong&phongRenderer=raster",
  matcapLive: "modes=matcap&matcapRenderer=live",
  phongLive: "modes=phong&phongRenderer=live",
  "svf8.tif": "modes=svf&svfPrecision=precise&svfRadius=8",
  "slope.tif": "modes=slope",
}
const Z = 12, CX = 2126, CY = 1460 // Mont Blanc's z12 tile, as qgis-plugin/bench_live.py
export const TILES = [...Array(16)].map((_, n) => [Z, CX - 2 + (n % 4), CY - 2 + Math.floor(n / 4)])

/** One tile of a case, as server.mjs draws it for /terrain-tiles. */
export async function drawCase(name, [z, x, y], size = 256) {
  const tif = name.endsWith(".tif")
  const { view, rest } = viewOf(CASES[name])
  const how = await plan(view, rest, {})
  if (how.engine !== "direct") throw new Error(`${name}: ${how.why}`)
  const args = { world: size * 2 ** z, x0: x * size, y0: y * size, width: size, height: size }
  if (tif) return valueTile(how, how.layers[0], { ...args, format: "tif" })
  return draw(how, { ...args, format: "png" })
}

async function compare(a, b) {
  let same = 0, samePixels = 0, differ = 0
  for (const f of (await fs.readdir(a)).sort()) {
    const [x, y] = await Promise.all([fs.readFile(path.join(a, f)), fs.readFile(path.join(b, f)).catch(() => null)])
    if (!y) { console.log(`${f}: missing in ${b}`); differ++; continue }
    if (x.equals(y)) { same++; continue }
    let detail = ""
    if (f.endsWith(".png")) {
      const [p, q] = await Promise.all([x, y].map((d) => sharp(d).raw().toBuffer()))
      let n = 0, max = 0
      for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) { n++; max = Math.max(max, Math.abs(p[i] - q[i])) }
      if (!n) { samePixels++; continue }
      detail = `: ${n} channel values differ, by ${max} at most`
    }
    console.log(`${f} differs${detail}`)
    differ++
  }
  console.log(`${same} identical, ${samePixels} with the same pixels (another PNG encoding), ${differ} different`)
  return differ
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  const argv = process.argv.slice(2)
  if (argv[0] === "--compare") process.exit((await compare(argv[1], argv[2])) ? 1 : 0)
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null }
  const cases = opt("--cases")?.split(",") ?? Object.keys(CASES)
  const tiles = TILES.slice(0, Number(opt("--tiles") ?? TILES.length))
  const out = argv[0]
  if (out) await fs.mkdir(out, { recursive: true })
  // Elevation into the cache (the ring around included), the code warmed up.
  for (const t of tiles) await drawCase("hillshade", t)
  await drawCase("svf32", tiles[0])
  const rows = []
  for (const name of cases) {
    const ms = []
    for (const t of tiles) {
      const t0 = performance.now()
      const bytes = await drawCase(name, t)
      ms.push(performance.now() - t0)
      if (out) await fs.writeFile(path.join(out, `${name.replace(".tif", "")}-${t.join("-")}.${name.endsWith(".tif") ? "tif" : "png"}`), bytes)
    }
    ms.sort((a, b) => a - b)
    rows.push({ case: name, median: Math.round(ms[ms.length >> 1]), min: Math.round(ms[0]), max: Math.round(ms[ms.length - 1]) })
    console.log(rows.at(-1))
  }
  // The elevation readers keep sockets and timers open.
  process.exit(0)
}
