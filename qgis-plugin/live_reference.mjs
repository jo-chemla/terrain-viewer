// The app's own kernels on a grid written by test_live.py, so the numpy port
// is compared with lib/shadow-kernel.ts and lib/horizon-kernel.ts themselves:
//   node --experimental-strip-types live_reference.mjs <job.json>
// job: { padded: <float32 .bin path>, stride, n, halo, kind: "shadow" | "svf",
//        dRow, dCol, groundResM, altitudeRad, out: <.bin path> }
// Writes shadow: n*n bytes, the tile's alpha (255 in shadow); svf: n*n float32,
// the value decoded from the kernel's Terrarium packing.
import { readFileSync, writeFileSync } from "node:fs"
import { computeShadowTile } from "../lib/shadow-kernel.ts"
import { computeHorizonRows } from "../lib/horizon-kernel.ts"

const job = JSON.parse(readFileSync(process.argv[2], "utf8"))
const buf = readFileSync(job.padded)
const padded = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
const { n, stride, halo } = job
let rgba
const times = []
// job.repeat runs (default 1); the time reported is the median of all but the
// first (JIT warm-up), as in a long-running tile service.
for (let i = 0; i < (job.repeat ?? 1); i++) {
  rgba = new Uint8ClampedArray(n * n * 4)
  const t0 = performance.now()
  if (job.kind === "shadow") {
    computeShadowTile({ padded, stride, n, radiusPx: halo, dRow: job.dRow, dCol: job.dCol, groundResM: job.groundResM, altitudeRad: job.altitudeRad }, rgba)
  } else {
    computeHorizonRows({ padded, stride, n, nearRadiusPx: halo, groundResolutionM: job.groundResM, sign: 1, fast: false, aggregate: "svf", farRings: [] }, 0, n, rgba)
  }
  times.push(performance.now() - t0)
}
const warm = times.length > 1 ? times.slice(1).sort((a, b) => a - b) : times
const ms = warm[Math.floor(warm.length / 2)]
const out = job.kind === "shadow" ? new Uint8Array(n * n) : new Float32Array(n * n)
for (let i = 0; i < n * n; i++) {
  out[i] = job.kind === "shadow" ? rgba[i * 4 + 3] : rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768
}
writeFileSync(job.out, new Uint8Array(out.buffer))
process.stdout.write(JSON.stringify({ ms }))
