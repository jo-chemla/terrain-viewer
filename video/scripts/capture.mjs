// Frame capture for agent-browser sessions, without a real-time encoder.
// agent-browser's `record` pipes screencast frames into ffmpeg live and drops
// the whole take when the encoder falls 500 ms behind, which dense map
// frames (a warped IIIF atlas over imagery) do on a laptop. This attaches to
// the same Chrome over the DevTools protocol (agent-browser get cdp-url),
// takes Page.startScreencast frames to disk with their timestamps, and on
// stop assembles them at their real timing into a 30 fps H.264 file.
//   node scripts/capture.mjs <ws-url> <out.mp4> [--seconds N]
// Stops after N seconds, or when <out.mp4>.stop appears.
import WebSocket from "ws"
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, basename } from "node:path"

const [wsUrl, out] = process.argv.slice(2)
const secondsArg = process.argv.indexOf("--seconds")
const seconds = secondsArg > 0 ? Number(process.argv[secondsArg + 1]) : 120
if (!wsUrl || !out) { console.error("usage: capture.mjs <ws-url> <out.mp4> [--seconds N]"); process.exit(2) }
const frameDir = join(dirname(out), `${basename(out, ".mp4")}-frames`)
rmSync(frameDir, { recursive: true, force: true }); mkdirSync(frameDir, { recursive: true })
const stopFile = `${out}.stop`
rmSync(stopFile, { force: true })

const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const msgId = ++id
  pending.set(msgId, { resolve, reject })
  ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }))
})
const frames = []
let session = null
let stopping = false

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    return
  }
  if (msg.method === "Page.screencastFrame" && msg.sessionId === session) {
    const { data, metadata, sessionId: ack } = msg.params
    const file = join(frameDir, `${String(frames.length).padStart(6, "0")}.jpg`)
    writeFileSync(file, Buffer.from(data, "base64"))
    frames.push({ file, t: metadata.timestamp })
    send("Page.screencastFrameAck", { sessionId: ack }, session).catch(() => {})
  }
})

async function finish() {
  if (stopping) return
  stopping = true
  try { await send("Page.stopScreencast", {}, session) } catch {}
  ws.close()
  if (frames.length < 2) { console.error("no frames"); process.exit(1) }
  // The concat demuxer with each frame's own duration: the real timing,
  // however irregular Chrome's frames came.
  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 0.5
    lines.push(`file '${frames[i].file.split(String.fromCharCode(92)).join("/")}'`, `duration ${dur.toFixed(4)}`)
  }
  lines.push(`file '${frames[frames.length - 1].file.split(String.fromCharCode(92)).join("/")}'`)
  const list = join(frameDir, "frames.txt")
  writeFileSync(list, lines.join("\n"))
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out])
  console.log(`${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s -> ${out}`)
  process.exit(0)
}

ws.on("open", async () => {
  const { targetInfos } = await send("Target.getTargets")
  const page = targetInfos.find((t) => t.type === "page" && /localhost:5204/.test(t.url)) ?? targetInfos.find((t) => t.type === "page")
  if (!page) { console.error("no page target"); process.exit(1) }
  ;({ sessionId: session } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }))
  await send("Page.enable", {}, session)
  await send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 }, session)
  console.log(`capturing ${page.url.slice(0, 80)}`)
  const started = Date.now()
  const timer = setInterval(() => {
    if (existsSync(stopFile) || Date.now() - started > seconds * 1000) { clearInterval(timer); rmSync(stopFile, { force: true }); finish() }
  }, 100)
})
ws.on("error", (e) => { console.error(String(e)); process.exit(1) })
