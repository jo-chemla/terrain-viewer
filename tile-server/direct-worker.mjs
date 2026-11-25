// One worker of the direct engine's pool (direct-pool.mjs). It loads
// direct.mjs and dem.mjs once, then draws what it is sent: the view, the
// app parameters and the keys as plain data, planned again here (a plan
// holds functions, which do not cross threads), and the picture is sent
// back as a transferred buffer.
import { parentPort } from "node:worker_threads"
import { plan, draw, drawViewport, vectorTile, valueTile, quantizedMeshTile, warmUp } from "./direct.mjs"
import { setTileFetcher } from "./dem.mjs"

// The app's code is loaded as the worker starts, before its first tile.
warmUp().catch(() => {})

// HTTP source tiles are fetched by the server's thread, whose cache every
// worker shares (direct-pool.mjs); decoding stays here.
const fetches = new Map()
let nextFetch = 0
setTileFetcher((url) => new Promise((done) => {
  const fid = ++nextFetch
  fetches.set(fid, done)
  parentPort.postMessage({ fetch: url, fid })
}))

parentPort.on("message", async ({ id, op, view, rest, keys, args, fid, status, bytes: fetched }) => {
  if (fid !== undefined) { const done = fetches.get(fid); fetches.delete(fid); done?.({ status, bytes: fetched ?? null }); return }
  try {
    const how = await plan(view, new URLSearchParams(rest), keys)
    if (how.engine !== "direct") throw Object.assign(new Error(`The direct engine cannot draw this: ${how.why}`), { status: 400 })
    const out = op === "tile" ? await draw(how, args)
      : op === "viewport" ? await drawViewport(how, args)
      : op === "vector" ? await vectorTile(how, args.modes, args.z, args.x, args.y, args.baseUrl)
      : op === "values" ? await valueTile(how, args.mode, args)
      : op === "mesh" ? await quantizedMeshTile(how, args)
      : null
    if (!out) throw new Error(`unknown operation ${op}`)
    // A copy of its own: a Buffer can be a view on a shared pool, which
    // cannot be transferred.
    const bytes = new Uint8Array(out.byteLength)
    bytes.set(out)
    parentPort.postMessage({ id, bytes }, [bytes.buffer])
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.message ?? e), status: e?.status })
  }
})
