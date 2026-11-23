// One worker of the direct engine's pool (direct-pool.mjs). It loads
// direct.mjs and dem.mjs once, then draws what it is sent: the view, the
// app parameters and the keys as plain data, planned again here (a plan
// holds functions, which do not cross threads), and the picture is sent
// back as a transferred buffer.
import { parentPort } from "node:worker_threads"
import { plan, draw, drawViewport, vectorTile } from "./direct.mjs"

parentPort.on("message", async ({ id, op, view, rest, keys, args }) => {
  try {
    const how = await plan(view, new URLSearchParams(rest), keys)
    if (how.engine !== "direct") throw Object.assign(new Error(`The direct engine cannot draw this: ${how.why}`), { status: 400 })
    const out = op === "tile" ? await draw(how, args)
      : op === "viewport" ? await drawViewport(how, args)
      : op === "vector" ? await vectorTile(how, args.modes, args.z, args.x, args.y, args.baseUrl)
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
