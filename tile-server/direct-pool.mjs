// The direct engine in worker threads. A tile of sky view factor or
// openness keeps a thread busy for seconds: on the server's one thread it
// blocked every other request, /health included, and a timed-out render
// carried on to the end. Here each render runs in a worker
// (direct-worker.mjs); the server's thread only plans, caches and answers.
// A render whose request is cancelled or times out has its worker ended,
// which really stops the work, and a fresh worker takes its place.
//
// TV_DIRECT_WORKERS: the number of workers (default: the cores minus one,
// at least one, at most 8); 0 draws in the server's thread, as before the pool.
// Each worker keeps its own cache of decoded elevation tiles, so memory
// grows with the count; the HTTP tiles' bytes are fetched here, in one
// cache for all of them (a source tile asked by two workers at once is
// fetched once).
import os from "node:os"
import { Worker } from "node:worker_threads"
import { plan, draw, drawViewport, vectorTile, valueTile, quantizedMeshTile } from "./direct.mjs"
import { fetchTileBytes } from "./dem.mjs"

// Fetched tile bytes (compressed PNG or WebP, 50 to 500 kB), most recent
// last, at most 96 MB; a failed fetch is not kept.
const fetched = new Map()
let fetchedBytes = 0
const FETCHED_MAX = 96 * 1024 * 1024
function sharedFetch(url) {
  const have = fetched.get(url)
  if (have) { fetched.delete(url); fetched.set(url, have); return have.promise }
  const entry = { size: 0, promise: null }
  entry.promise = fetchTileBytes(url).then((r) => {
    if (!r.bytes) { fetched.delete(url); return r }
    entry.size = r.bytes.byteLength; fetchedBytes += entry.size
    while (fetchedBytes > FETCHED_MAX && fetched.size > 1) { const [k, v] = fetched.entries().next().value; fetched.delete(k); fetchedBytes -= v.size }
    return r
  }, () => { fetched.delete(url); return { status: 0, bytes: null } })
  fetched.set(url, entry)
  return entry.promise
}

const asked = process.env.TV_DIRECT_WORKERS ?? process.env.TV_DIRECT_CONCURRENCY
export const POOL_SIZE = asked !== undefined && asked !== ""
  ? Math.max(0, Math.floor(Number(asked)) || 0)
  : Math.max(1, Math.min(8, (os.availableParallelism?.() ?? os.cpus().length) - 1))

const idle = []
const all = new Set()
const waiting = []
let nextId = 0
let replaced = 0
let closing = false

function spawn() {
  // workerData {}: the Worker polyfill geotiff brings (web-worker) reads
  // workerData.mod in any thread but the main one, and with no mod behaves
  // as in the main thread; with no workerData at all it throws.
  const w = new Worker(new URL("./direct-worker.mjs", import.meta.url), { workerData: {} })
  w.job = null
  w.on("message", ({ id, bytes, error, status, fetch, fid }) => {
    if (fetch) {
      // A copy each: the cached bytes stay here.
      sharedFetch(fetch).then((r) => { if (all.has(w)) w.postMessage({ fid, status: r.status, bytes: r.bytes }) })
      return
    }
    const job = w.job
    if (!job || job.id !== id) return
    w.job = null
    release(w)
    if (error) job.fail(Object.assign(new Error(error), status ? { status } : {}))
    else job.done(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  })
  // Ended (a stopped render) or crashed: its job fails, a fresh worker
  // takes its place.
  const lost = (why) => {
    if (!all.has(w)) return
    all.delete(w)
    const i = idle.indexOf(w)
    if (i >= 0) idle.splice(i, 1)
    w.job?.fail(new Error(`direct engine worker stopped: ${why}`))
    w.job = null
    if (closing) return
    replaced++
    release(spawn())
  }
  w.on("error", (e) => lost(e?.message ?? e))
  w.on("exit", (code) => lost(`exit ${code}`))
  all.add(w)
  return w
}

function release(w) {
  if (!all.has(w)) return
  const next = waiting.shift()
  if (next) next(w)
  else idle.push(w)
}

let started = false
/** Starts the workers (each loads the app's code as it starts). The server
 *  calls it as it starts listening, so the first tile does not wait for
 *  them; otherwise the first render does. */
export const startPool = () => {
  if (started || POOL_SIZE === 0) return
  started = true
  for (let i = 0; i < POOL_SIZE; i++) idle.push(spawn())
}
const start = startPool

const inThread = async (op, { view, rest, keys }, args) => {
  const how = await plan(view, rest, keys)
  if (op === "tile") return draw(how, args)
  if (op === "viewport") return drawViewport(how, args)
  if (op === "values") return valueTile(how, args.mode, args)
  if (op === "mesh") return quantizedMeshTile(how, args)
  return vectorTile(how, args.modes, args.z, args.x, args.y, args.baseUrl)
}

/** Draws in a worker: `op` is tile (draw), viewport (drawViewport),
 *  vector (vectorTile), values (valueTile: a mode's values, encoded) or mesh (quantizedMeshTile); `view`, `rest` (URLSearchParams) and `keys` as
 *  given to plan(), `args` the drawing's. When `signal` aborts, the worker
 *  is ended and the promise fails with status 499. */
export async function runDirect(op, input, args, signal) {
  if (POOL_SIZE === 0) return inThread(op, input, args)
  start()
  const gone = () => Object.assign(new Error("render stopped"), { status: 499 })
  if (signal?.aborted) throw gone()
  const w = idle.pop() ?? (await new Promise((go) => waiting.push(go)))
  if (signal?.aborted) { release(w); throw gone() }
  return new Promise((done, fail) => {
    const id = ++nextId
    const onAbort = () => {
      const job = w.job
      if (!job || job.id !== id) return
      w.job = null
      w.terminate() // its "exit" spawns the successor
      job.fail(gone())
    }
    const finish = (f) => (v) => { signal?.removeEventListener("abort", onAbort); f(v) }
    w.job = { id, done: finish(done), fail: finish(fail) }
    signal?.addEventListener("abort", onAbort, { once: true })
    w.postMessage({ id, op, view: input.view, rest: [...input.rest], keys: input.keys ?? {}, args })
  })
}

/** For /health: the workers, how many draw now, how many were replaced
 *  (stopped renders and crashes) since the start. */
export const poolStats = () => ({
  workers: POOL_SIZE === 0 ? 0 : started ? all.size : POOL_SIZE,
  busy: [...all].filter((w) => w.job).length,
  replaced,
})

export function closePool() {
  closing = true
  return Promise.all([...all].map((w) => w.terminate()))
}
