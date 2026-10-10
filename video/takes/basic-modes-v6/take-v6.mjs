// Choreography for the sixth take (take five plus the Data layers picker) (production site, 1920x1080), driven over
// CDP so the pointer moves in ~60 small timed steps a second. Node 22's global
// WebSocket. The cursor is the real Windows aero_arrow.cur (32 px frame, PNG,
// hotspot 0,0 read from the .cur header), see aero_arrow.png / .b64 here.
//   node take-v6.mjs <ws-url> prep   -> add the cursor, park the pointer, close other tabs
//   node take-v6.mjs <ws-url> run    -> the ~38 s of motion
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const CURSOR = "data:image/png;base64," + readFileSync(join(HERE, "aero_arrow.b64"), "utf8").trim()
// The hand over links and buttons: the Windows link cursor (aero_link.cur, 32 px
// frame, hotspot 6,0), swapped in from the computed cursor style under the pointer.
const HOVER = "data:image/png;base64," + readFileSync(join(HERE, "cursor-hover.b64"), "utf8").trim()
const HOVER_HOTSPOT = (readFileSync(join(HERE, "cursor-hover.hotspot"), "utf8").trim().split(",")).map(Number)
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
    // hotspot (0,0): the arrow's tip is the image's top-left pixel; the hand's
    // is at HOVER_HOTSPOT. The shape follows the computed cursor style of the
    // element under the pointer (pointer -> hand), read on every move.
    const ARROW = c.src, HAND = ${JSON.stringify(HOVER)}, HX = ${HOVER_HOTSPOT[0]}, HY = ${HOVER_HOTSPOT[1]}
    addEventListener("mousemove", (e) => {
      c.style.visibility = "hidden"
      const el = document.elementFromPoint(e.clientX, e.clientY)
      c.style.visibility = ""
      const hand = !!el && getComputedStyle(el).cursor === "pointer"
      if (hand && c.src !== HAND) c.src = HAND; else if (!hand && c.src !== ARROW) c.src = ARROW
      const dx = hand ? HX : 0, dy = hand ? HY : 0
      c.style.transform = "translate(" + (e.clientX - dx) + "px," + (e.clientY - dy) + "px)"
    }, true)
  }
  window.__takeMarker = true
  return TARGETS()
})()`
// checkbox squares (left of their labels) and the Terrain Analysis go-to arrow
const TARGETS_FN = `function TARGETS() {
  const box = (lab) => { const l = lab.getBoundingClientRect(); return [Math.round(l.x - 16), Math.round(l.y + l.height / 2)] }
  const ta = document.querySelector('label[for="terrain-analysis"]'), hy = document.querySelector('label[for="color-relief"]')
  const goOf = (lab) => { let row = lab; while (row && !row.querySelector('button[aria-label^="Go to"]')) row = row.parentElement
    const g = row.querySelector('button[aria-label^="Go to"]').getBoundingClientRect(); return [Math.round(g.x + g.width / 2), Math.round(g.y + g.height / 2)] }
  return { ta: box(ta), hypso: box(hy), go: goOf(ta), hgo: goOf(hy),
    scroll: (document.querySelector('#tour-terrain-analysis-section')?.closest('[class*=overflow-y]') || {}).scrollTop }
}`
const PREP_FULL = TARGETS_FN + ";" + PREP
const TARGETS = `(${TARGETS_FN})()`.replace("function TARGETS()", "function ()")

// the slope range slider's thumbs [min, max] and its track ends, read after the section has scrolled in
const THUMBS = `(() => {
  const sliders = [...document.querySelectorAll('#tour-terrain-analysis-section [data-slot=slider]')]
  const range = sliders.find((s) => s.querySelectorAll('[data-slot=slider-thumb]').length === 2)
  if (!range) return null
  const th = [...range.querySelectorAll('[data-slot=slider-thumb]')].map((t) => t.getBoundingClientRect()).sort((a, b) => a.x - b.x)
  const r = range.getBoundingClientRect()
  return { min: [Math.round(th[0].x + th[0].width / 2), Math.round(th[0].y + th[0].height / 2)],
    max: [Math.round(th[1].x + th[1].width / 2), Math.round(th[1].y + th[1].height / 2)], end: Math.round(r.right) }
})()`
// the hypso section (cached from the dry pass, 2026-10-10, both modes on, hypso go-to: scrollTop 666):
// ramp trigger (1671,490), the min/max slider at y 621 over x 1553..1871. Read live, in parallel with motion.
const HYPSO = `(() => {
  const sec = document.getElementById('tour-hypso-section'); if (!sec) return null
  const c = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] }
  const s = sec.querySelector('[data-slot=slider]'), r = s && s.getBoundingClientRect()
  return { trigger: c(sec.querySelector('[data-slot=select-trigger]')),
    thumbs: s ? [...s.querySelectorAll('[data-slot=slider-thumb]')].map(c).sort((a, b) => a[0] - b[0]) : null,
    track: r ? [Math.round(r.left), Math.round(r.right)] : null,
    vals: [...sec.querySelectorAll('input')].filter((i) => i.placeholder).map((i) => i.value).join(","),
    ramp: sec.querySelector('[data-slot=select-trigger]').textContent.trim() }
})()`
const OPTION = (name) => `(() => { const o = [...document.querySelectorAll('[role=option]')].find((x) => x.textContent.trim() === ${JSON.stringify(name)})
  if (!o) return null; const r = o.getBoundingClientRect(); return [Math.round(r.x + 70), Math.round(r.y + r.height / 2)] })()`
// the Slope Range maximum (the larger of the two thumbs' hidden inputs)
const SLOPE_MAX = `(() => { const s = [...document.querySelectorAll("#tour-terrain-analysis-section [data-slot=slider]")].find((s) => s.querySelectorAll("[data-slot=slider-thumb]").length === 2)
  return Math.max(...[...s.querySelectorAll("[data-slot=slider-thumb] input")].map((i) => Number(i.value))) })()`
const RANGE_VALUES = `[...document.querySelectorAll('#tour-terrain-analysis-section input')].filter(i => i.type !== 'checkbox' && /^\\d+$/.test(i.value)).map(i => i.value).join(",")`

// the Layers buttons (lucide icon); the heading one only when it sits inside the sidebar's visible band
const LAYERS_BTN = `(() => {
  const bs = [...document.querySelectorAll('button')].filter((b) => b.querySelector('svg.lucide-layers') && !b.closest('[role=dialog]'))
  const c = (b) => { const r = b.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] }
  const head = bs.find((b) => b.closest('#tour-viz-modes')), bar = bs.find((b) => !b.closest('#tour-viz-modes'))
  if (head) { const y = c(head)[1]; if (y > 130 && y < 1000) return { which: 'heading', xy: c(head) } }
  return { which: 'title bar', xy: c(bar) }
})()`
// the picker's scroll box: its centre, scroll range and position
const MODAL = `(() => { const d = document.getElementById('tour-data-layers'); if (!d) return null
  const sc = [...d.querySelectorAll('div')].find((e) => e.classList.contains('overflow-y-auto')); if (!sc) return null
  const r = sc.getBoundingClientRect()
  return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height * 0.45), range: sc.scrollHeight - sc.clientHeight, top: Math.round(sc.scrollTop) } })()`

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

ws.onopen = async () => {
  const { targetInfos } = await send("Target.getTargets")
  const page = targetInfos.find((t) => t.type === "page" && /terrain-viewer/.test(t.url))
  ;({ sessionId: S } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }))
  const at = await evaluate(PREP_FULL)
  console.log("targets", JSON.stringify(at))
  // capture.mjs attaches to the first page target when none is localhost:5204: close the others
  for (const t of targetInfos) if (t.type === "page" && t.targetId !== page.targetId) await send("Target.closeTarget", { targetId: t.targetId })
  if (mode === "prep") { await mouse("mouseMoved", pos[0], pos[1]); ws.close(); process.exit(0) }
  const t0 = Date.now(), mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(2)} s ${s}`)
  await mouse("mouseMoved", pos[0], pos[1])
  await moveTo(900, 420, 550, { bend: -0.2, curve: easeSoft })    // settle onto the map
  await press(); mark("(a) drag start")
  await moveTo(540, 515, 2600, { bend: 0.06, curve: easeSoft })   // slow pan, ~390 px
  await sleep(50); await release(); mark("(a) drag end")
  await moveTo(at.ta[0], at.ta[1], 1200, { bend: 0.14 })          // (b) to the Terrain Analysis box
  await sleep(120); await click(); mark("(b) terrain analysis on")
  await moveTo(at.go[0], at.go[1], 500, { bend: -0.25, curve: easeSoft })  // along the row to its arrow
  await sleep(100); await click(); mark("(c) go to options")
  let p = sleep(250).then(() => settled(THUMBS))                   // read once the scroll has landed
  await moveTo(1690, 470, 800, { bend: 0.15, curve: easeSoft })   // drift while the section scrolls in
  const th = await p
  console.log("thumbs", JSON.stringify(th))
  const sx = (v) => th.min[0] + ((th.end - 8 - th.min[0]) * v) / 90   // thumb centre at v degrees (min thumb sits at 0)
  await moveTo(th.max[0], th.max[1], 550, { bend: 0.2 })
  await sleep(80); await press(); mark("(d) max drag start (55)")
  await moveTo(sx(28), th.max[1] + 1, 1500, { bend: 0.04 })       // slowly down: the steep red gives way
  await moveTo(sx(60), th.max[1] - 1, 1900, { bend: -0.03 })      // and slowly up to 60
  for (let k = 0; k < 2; k++) {                                    // land on exactly 60 while still held
    const v = Number(await evaluate(SLOPE_MAX)); if (v === 60 || !v) break
    await moveTo(pos[0] + (60 - v) * ((th.end - 8 - th.min[0]) / 90), pos[1], 220, { bend: 0, curve: easeSoft })
  }
  await sleep(60); await release(); mark("(d) max drag end " + await evaluate(SLOPE_MAX))
  await moveTo(1690, 600, 500, { bend: -0.15, curve: easeSoft })  // (e) onto the sidebar body
  mark("(e) sidebar scroll up")
  await wheel(950, [-8, 30], -95)
  p = settled(TARGETS)
  await moveTo(pos[0] - 30, pos[1] - 40, 260, { bend: 0.2, curve: easeSoft })  // the smooth scroll lands
  let top = await p
    console.log("after scroll", JSON.stringify(top))
  await moveTo(top.hypso[0], top.hypso[1], 650, { bend: 0.18 })
  await sleep(110); await click(); mark("(e) hypso on")
  await moveTo(top.hgo[0], top.hgo[1], 480, { bend: -0.25, curve: easeSoft })  // along the row to its arrow
  await sleep(100); await click(); mark("(f) hypso go to options")
  p = sleep(250).then(() => settled(HYPSO))
  await moveTo(1610, 560, 850, { bend: 0.15, curve: easeSoft })   // drift while the section scrolls in
  let hy = await p
  console.log("hypso", JSON.stringify(hy))
  await moveTo(hy.trigger[0] - 20, hy.trigger[1], 520, { bend: 0.2 })
  await sleep(90); await click(); mark("(g) ramp select open " + hy.ramp)
  p = sleep(150).then(() => settled(OPTION("(C) GMT_globe"), 1200))
  await moveTo(pos[0] + 6, pos[1] + 70, 380, { bend: 0.2, curve: easeSoft })  // into the list
  let opt = await p
  for (const alt of ["(C) ETOPO1", "(C) GMT_topo", "(C) arctic"]) { if (opt && opt[1] > 20 && opt[1] < 1050) break; opt = await evaluate(OPTION(alt)) }
  console.log("option", JSON.stringify(opt))
  await moveTo(opt[0], opt[1], 900, { bend: 0.08 })                // down the list, items highlight under it
  await sleep(120); await click(); mark("(g) ramp picked")
  p = sleep(200).then(() => settled(HYPSO))
  await moveTo(pos[0] + 20, pos[1] + 40, 500, { bend: -0.2, curve: easeSoft })
  hy = await p
  console.log("hypso after ramp", JSON.stringify(hy))
  // value -> thumb x from the two thumbs and the Min/Max inputs (vals: min, max, bound min, bound max)
  const [vMin, vMax, bMin, bMax] = hy.vals.split(",").map(Number), [[x0, ty], [x1]] = hy.thumbs
  const eMin = Math.max(vMin, bMin), eMax = Math.min(vMax, bMax)   // a thumb sits clamped at its bound
  const hx = (v) => x0 + ((x1 - x0) * (v - eMin)) / (eMax - eMin)
  await moveTo(x0, ty, 700, { bend: 0.15 })
  await sleep(80); await press(); mark("(h) min bound drag " + hy.vals)
  await moveTo(hx(1400), ty + 1, 1300, { bend: 0.04, curve: easeSoft })
  await sleep(60); await release()
  await moveTo(x1, ty, 600, { bend: -0.3, curve: easeSoft })      // over to the max thumb
  await sleep(80); await press()
  await moveTo(hx(4300), ty - 1, 1400, { bend: 0.04, curve: easeSoft })
  await sleep(60); await release(); mark("(h) bounds " + (await evaluate(HYPSO)).vals)
  await moveTo(820, 520, 1100, { bend: 0.12 })                    // (i) back to the map
  mark("(i) zoom start")
  await wheel(2400, [-40, 26], -3)
  mark("(i) zoom end")
  // (j) the Data layers picker: the Layers button in the Visualization Modes heading
  // when it is on screen, else its copy in the panel's title bar
  const lb = await evaluate(LAYERS_BTN)
  console.log("layers button", JSON.stringify(lb))
  await moveTo(lb.xy[0], lb.xy[1], 1100, { bend: 0.14 })
  await sleep(120); await click(); mark("(j) data layers open (" + lb.which + ")")
  p = sleep(300).then(() => settled(MODAL, 1500))
  await moveTo(960, 470, 900, { bend: -0.18, curve: easeSoft })   // onto the first cards while the pictures load
  const md = await p
  console.log("modal", JSON.stringify(md))
  await moveTo(md.cx + 40, md.cy, 650, { bend: 0.2, curve: easeSoft })  // ~1.5 s after opening
  // (k) a slow wheel through every card: per-event deltas sized to cover the whole list in ~7 s
  mark("(k) modal scroll start " + md.range + " px")
  await wheel(7000, [-60, 30], (md.range * 1.15 * Math.PI / 2) / (7000 / 16.7))
  await sleep(150)
  mark("(k) modal scroll end, scrollTop " + (await evaluate(MODAL)).top)
  await moveTo(pos[0] + 120, pos[1] - 60, 450, { bend: 0.2, curve: easeSoft })
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S)
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S)
  // Escape hands focus back to the Layers button, whose tooltip then reopens: drop the focus
  for (let k = 0; k < 6; k++) { await sleep(30); await evaluate("document.activeElement && document.activeElement.blur(), 0") }
  mark("(l) modal closed")
  await moveTo(pos[0] - 120, pos[1] + 70, 900, { bend: 0.2, curve: easeSoft })  // end on the map
  mark("(l) end, dialog gone: " + (await evaluate("!document.getElementById('tour-data-layers')")))
  console.log("marker still set:", await evaluate("!!window.__takeMarker"))
  ws.close(); process.exit(0)
}
