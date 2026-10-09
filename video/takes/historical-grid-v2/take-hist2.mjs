// Choreography for the historical take v2 (historical-satellite.iconem.com, 1920x1080), driven over
// CDP so the pointer moves in ~60 small timed steps a second. Node 22's global
// WebSocket. The cursor is the real Windows aero_arrow.cur (32 px frame, PNG,
// hotspot 0,0 read from the .cur header), see aero_arrow.png / .b64 here.
//   node take-hist2.mjs <ws-url> prep   -> add the cursor, park the pointer, close other tabs
//   node take-hist2.mjs <ws-url> run    -> the ~55 s of motion
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const CURSOR = "data:image/png;base64," + readFileSync(join(HERE, "aero_arrow.b64"), "utf8").trim()
const [wsUrl, mode] = process.argv.slice(2)
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const msgId = ++id
  pending.set(msgId, { resolve, reject })
  ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }))
})
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let S
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }, S)).result.value

const PREP = `(() => {
  if (!document.getElementById("tv-cursor")) {
    const c = document.createElement("img"); c.id = "tv-cursor"; c.src = ${JSON.stringify(CURSOR)}
    c.style.cssText = "position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);image-rendering:pixelated;"
    document.documentElement.appendChild(c)
    // hotspot (0,0): the arrow's tip is the image's top-left pixel
    addEventListener("mousemove", (e) => { c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)" }, true)
  }
  window.__takeMarker = true
  return location.search
})()`
const centre = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null; return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })()`
// the overlay divider (a w-8 col-resize strip over the map)
const DIVIDER = centre("div.cursor-col-resize")
// a view's handle on the timeline (a leaf holding its letter, below the maps)
const HANDLE = (v) => `(() => { const e = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(v)} && e.getBoundingClientRect().y > 880 && e.getBoundingClientRect().x < 1500)
  if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })()`
// the timeline ticks of one source (by its pill colour), [x, y] each
const COLORS = { wayback: "rgb(203, 228, 189)", ge: "rgb(174, 203, 250)", bing: "rgb(196, 181, 253)" }
const TICKS = (col) => `[...document.querySelectorAll('div')].filter((e) => { const r = e.getBoundingClientRect(); return r.y > 900 && r.width < 10 && r.height > 10 && getComputedStyle(e).backgroundColor === ${JSON.stringify(col)} })
  .map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })`
const nearest = (list, x) => list.reduce((b, t) => (Math.abs(t[0] - x) < Math.abs(b[0] - x) ? t : b))
const SIDE = `(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Side'); const r = b.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })()`
const VIEWS = `(() => { const q = new URLSearchParams(location.search); return "ABCDEF".split("").map((v) => v + ":" + (q.get("historicalActiveSource" + v) || "wayback") + "@" + (q.get("date" + v) ? new Date(Number(q.get("date" + v))).toISOString().slice(0, 10) : "-")).join(" ") + " | " + (q.get("splitStyle") || "") + " " + (q.get("gridLayout") || "") + " z" + q.get("zoom") })()`

// Poll an expression until two reads ~90 ms apart agree (the sidebar's smooth scroll has landed).
// Started without awaiting, so the pointer keeps drifting meanwhile.
async function settled(expr, maxMs = 1600) {
  const t0 = Date.now(); let prev = JSON.stringify(await evaluate(expr))
  while (Date.now() - t0 < maxMs) { await sleep(90); const cur = JSON.stringify(await evaluate(expr)); if (cur === prev && cur !== "null") return JSON.parse(cur); prev = cur }
  return JSON.parse(prev)
}

let pos = [760, 470]
let buttons = 0
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, buttons, ...extra }, S)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)        // cubic in-out
const easeSoft = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)         // quad in-out
// Move along a quadratic Bezier whose control point sits off the chord by
// `bend` (a fraction of its length, signed: + bulges to the left of travel).
async function moveTo(x, y, ms, { bend = 0.12, curve = ease } = {}) {
  const [x0, y0] = pos, dx = x - x0, dy = y - y0, len = Math.hypot(dx, dy) || 1
  const cx = x0 + dx / 2 + (dy / len) * bend * len, cy = y0 + dy / 2 - (dx / len) * bend * len
  const steps = Math.max(2, Math.round(ms / 16.7)), t0 = Date.now()
  for (let i = 1; i <= steps; i++) {
    const k = curve(i / steps), u = 1 - k
    const px = u * u * x0 + 2 * u * k * cx + k * k * x, py = u * u * y0 + 2 * u * k * cy + k * k * y
    await mouse("mouseMoved", px, py, buttons ? { button: "left" } : {})
    const wait = t0 + (ms * i) / steps - Date.now(); if (wait > 0) await sleep(wait)
  }
  pos = [x, y]
}
async function press() { await mouse("mousePressed", pos[0], pos[1], { button: "left", clickCount: 1 }); buttons = 1 }
async function release() { buttons = 0; await mouse("mouseReleased", pos[0], pos[1], { button: "left", clickCount: 1 }) }
async function click() { await press(); await sleep(85); await release() }
// Wheel while the pointer drifts; deltas follow a sine bell. Not awaited: the
// wheel ack waits on the busy renderer and stretched a 2 s zoom to 6.6 s (take 3).
async function wheel(totalMs, drift, peak) {
  const [x0, y0] = pos, steps = Math.round(totalMs / 16.7), t0 = Date.now()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, k = easeSoft(t)
    const px = x0 + drift[0] * k, py = y0 + drift[1] * k
    await mouse("mouseMoved", px, py)
    send("Input.dispatchMouseEvent", { type: "mouseWheel", x: px, y: py, deltaX: 0, deltaY: peak * Math.sin(Math.PI * t) }, S)
    const wait = t0 + (totalMs * i) / steps - Date.now(); if (wait > 0) await sleep(wait)
  }
  pos = [x0 + drift[0], y0 + drift[1]]
}

// a button of a segmented toggle by its exact text (Split Mode: Off / Overlay / Side)
const BUTTON = (text) => `(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })()`
// the switch next to a label (Match Colors, Blend Mode)
const SWITCH = (forId) => `(() => { const l = document.querySelector('label[for=${forId}]'); const s = l && l.closest('.justify-between').querySelector('[data-slot=switch]'); if (!s) return null; const r = s.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })()`
const STATE = `(() => { const q = new URLSearchParams(location.search); return "match=" + q.get("matchColorsToA") + " blend=" + q.get("splitBlendModeEnabled") + "/" + q.get("splitBlendMode") })()`

ws.onopen = async () => {
  const { targetInfos } = await send("Target.getTargets")
  const page = targetInfos.find((t) => t.type === "page" && /historical-satellite/.test(t.url))
  ;({ sessionId: S } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }))
  console.log("prep", await evaluate(PREP))
  // capture.mjs attaches to the first page target when none is localhost:5204: close the others
  for (const t of targetInfos) if (t.type === "page" && t.targetId !== page.targetId) await send("Target.closeTarget", { targetId: t.targetId })
  if (mode === "prep") { await mouse("mouseMoved", pos[0], pos[1]); ws.close(); process.exit(0) }
  const t0 = Date.now(), mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(2)} s ${s}`)
  console.log("start", await evaluate(VIEWS), await evaluate(STATE))
  // (0) split off, Wayback 2024-10-05: a slow pan onto the Champ de Mars (the URL start is offset by the pan)
  await mouse("mouseMoved", pos[0], pos[1])
  await moveTo(700, 430, 450, { bend: 0.2, curve: easeSoft })
  await press(); mark("(0) pan")
  await moveTo(840, 490, 3000, { bend: 0.06, curve: easeSoft })
  await sleep(60); await release(); mark("(0) pan end")
  // (1) Overlay from the Split Mode toggle, then the swipe divider across the map
  const ov = await evaluate(BUTTON("Overlay"))
  await moveTo(ov[0], ov[1], 1000, { bend: -0.14 })
  await sleep(110); await click(); mark("(1) overlay " + JSON.stringify(ov))
  const dvp = sleep(150).then(() => settled(DIVIDER))
  await moveTo(pos[0] + 120, pos[1] + 160, 450, { bend: 0.2, curve: easeSoft })
  const dv = await dvp
  await moveTo(dv[0], 470, 700, { bend: -0.2, curve: easeSoft })
  await sleep(80); await press(); mark("(1) divider drag " + JSON.stringify(dv))
  await moveTo(330, 480, 2000, { bend: 0.03, curve: easeSoft })    // slowly left: B (Bing) sweeps over A (Wayback)
  await moveTo(1180, 470, 2600, { bend: -0.02, curve: easeSoft })  // and right across the whole map
  await moveTo(800, 474, 1100, { bend: 0.02, curve: easeSoft })
  await sleep(50); await release(); mark("(1) divider released")
  // three Wayback ticks clicked for A (2025-04, 2013-08, 2017-04), all preloaded through the URL
  const hA = await evaluate(HANDLE("A")), wb = await evaluate(TICKS(COLORS.wayback))
  console.log("handle A", JSON.stringify(hA), "wayback ticks", JSON.stringify(wb.map((t) => t[0])))
  const [w25, w13, w17] = [nearest(wb, 1320), nearest(wb, 345), nearest(wb, 650)]
  await moveTo(w25[0], w25[1] - 6, 1300, { bend: 0.15 })
  await sleep(140); await click(); mark("(1) wayback 2025 tick " + await evaluate(VIEWS))
  await moveTo(w13[0], w13[1] - 5, 2300, { bend: -0.04 })
  await sleep(140); await click(); mark("(1) wayback 2013 tick " + await evaluate(VIEWS))
  await moveTo(w17[0], w17[1] - 6, 1300, { bend: 0.1 })
  await sleep(140); await click(); mark("(1) wayback 2017 tick " + await evaluate(VIEWS))
  // (2) Side, then 3x1 from the grid picker
  const side = await evaluate(BUTTON("Side"))
  await moveTo(side[0], side[1], 1300, { bend: -0.12 })
  await sleep(110); await click(); mark("(2) side by side")
  let p = sleep(150).then(() => settled(centre('[aria-label="Grid layout 3 by 1"]')))
  await moveTo(pos[0] - 40, pos[1] + 40, 420, { bend: 0.25, curve: easeSoft })
  const g31 = await p
  console.log("3x1", JSON.stringify(g31))
  await moveTo(g31[0], g31[1], 450, { bend: 0.2, curve: easeSoft })
  await sleep(140); await click(); mark("(2) grid 3x1 " + await evaluate(VIEWS))
  // Match Colors on, off, on, off, on, ~1.7 s a state (the match re-samples at most once a second)
  p = sleep(150).then(() => settled(SWITCH("match-colors-to-a")))
  await moveTo(1000, 560, 800, { bend: 0.12, curve: easeSoft })   // over the three views while they lay out
  const mc = await p
  console.log("match switch", JSON.stringify(mc))
  await moveTo(mc[0], mc[1], 1100, { bend: -0.15 })
  for (let k = 0; k < 5; k++) {
    await sleep(120); await click(); mark("(2) match colors " + await evaluate(STATE))
    // drift a few pixels around the switch while the views change
    await moveTo(mc[0] + 14 + (k % 2) * 6, mc[1] + 10, 700, { bend: 0.3, curve: easeSoft })
    await moveTo(mc[0], mc[1], 700, { bend: 0.3, curve: easeSoft })
  }
  // (3) the 3x2 grid
  const g32 = await settled(centre('[aria-label="Grid layout 3 by 2"]'))
  await moveTo(g32[0], g32[1], 900, { bend: 0.2 })
  await sleep(140); await click(); mark("(3) grid 3x2 " + await evaluate(VIEWS))
  // view E: its handle (Wayback 2013) dragged onto a Google Earth tick (2016-08-07)
  p = sleep(200).then(() => settled(HANDLE("E")))
  await moveTo(1000, 640, 900, { bend: 0.1, curve: easeSoft })
  const hE = await p, ge = await evaluate(TICKS(COLORS.ge))
  console.log("handle E", JSON.stringify(hE))
  await moveTo(hE[0], hE[1], 1200, { bend: 0.12 })
  await sleep(90); await press(); mark("(3) E drag")
  await moveTo(nearest(ge, 594)[0], hE[1] + 1, 1400, { bend: 0.02, curve: easeSoft })
  await sleep(60); await release(); mark("(3) E set " + await evaluate(VIEWS))
  // view F: its handle (Google Earth 2022) dragged onto the Wayback 2024-10 tick
  const hF = await evaluate(HANDLE("F")), wb2 = await evaluate(TICKS(COLORS.wayback))
  console.log("handle F", JSON.stringify(hF))
  await moveTo(hF[0], hF[1], 1300, { bend: -0.14 })
  await sleep(90); await press(); mark("(3) F drag")
  await moveTo(nearest(wb2, 1277)[0], hF[1] - 1, 1300, { bend: 0.02, curve: easeSoft })
  await sleep(60); await release(); mark("(3) F set " + await evaluate(VIEWS))
  const fDone = (async () => { for (let k = 0; k < 20; k++) { const v = await evaluate(VIEWS); if (/F:wayback@2024-10-05/.test(v)) return v; await sleep(100) } return await evaluate(VIEWS) })()
  await moveTo(pos[0] + 30, pos[1] - 60, 500, { bend: 0.25, curve: easeSoft })
  mark("(3) F landed " + await fDone)
  // Sort views by date
  const so = await evaluate(centre('[aria-label="Sort views by date"]'))
  await moveTo(so[0], so[1], 1000, { bend: 0.18 })
  await sleep(450)
  const before = await evaluate(VIEWS)
  await click()
  let after = before
  for (let k = 0; k < 8 && after === before; k++) { await sleep(100); after = await evaluate(VIEWS) }
  if (after === before) { mark("(3) sort retry"); await click(); await sleep(400); after = await evaluate(VIEWS) }
  mark("(3) sorted " + after)
  await moveTo(1250, 300, 1300, { bend: -0.15 })                   // across the reordered panes
  // (4) back to the overlay, Blend Mode on (Difference, the default mode)
  const ov2 = await evaluate(BUTTON("Overlay"))
  await moveTo(ov2[0], ov2[1], 1200, { bend: 0.12 })
  await sleep(110); await click(); mark("(4) overlay " + await evaluate(VIEWS))
  p = sleep(150).then(() => settled(SWITCH("split-blend-mode-enabled")))
  await moveTo(pos[0] + 30, pos[1] + 50, 450, { bend: 0.25, curve: easeSoft })
  const bm = await p
  console.log("blend switch", JSON.stringify(bm))
  await moveTo(bm[0], bm[1], 700, { bend: -0.15 })
  await sleep(160); await click(); mark("(4) blend " + await evaluate(STATE))
  await moveTo(820, 520, 1300, { bend: 0.14 })
  await press()                                                     // a small pan over the difference
  await moveTo(pos[0] + 120, pos[1] + 40, 2600, { bend: 0.06, curve: easeSoft })
  await sleep(40); await release(); mark("(4) pan end")
  await moveTo(pos[0] - 40, pos[1] + 20, 900, { bend: 0.2, curve: easeSoft })
  console.log("end", await evaluate(VIEWS), await evaluate(STATE), "marker still set:", await evaluate("!!window.__takeMarker"))
  ws.close(); process.exit(0)
}
