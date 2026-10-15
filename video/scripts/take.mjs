// Declarative take runner: the choreography of a take written as JSON steps (the format of Jonathan's
// tv_take.py, 2026-10-15), played over the DevTools websocket of the Chrome that agent-browser launched
// (scripts/take.sh does the launch, the storage, the warm-up page loads and the capture). The pointer is the
// real Windows cursor (aero_arrow / aero_link PNGs from a take folder) driven in ~60 timed steps a second
// along eased Bezier arcs, exactly as video/takes/historical-grid-v5/take-hist5.mjs does by hand.
//   node scripts/take.mjs plan <take.json>              -> the setup JS and the warm-up and start URLs, one per line
//   node scripts/take.mjs prep <take.json> <ws-url>     -> inject the cursor and the map helpers, park the pointer
//   node scripts/take.mjs run  <take.json> <ws-url> [--captions <out.json>] [--offset 0.4]
//                                                      -> play the steps; the captions timestamped into out.json
// The take JSON: { name, site, storage {k: v}, start {url keys}, warmup [{overrides}], warm_s, settle_s, spot,
// steps [...] }. Date keys ("dateA") accept "YYYY-MM-DD". Steps (one key each, plus timing options):
//   {"caption": "text"}                       a caption timestamped for the cut, no text in the frame
//   {"move": [x, y] | {"rel": [dx, dy]} | target, "ms": 800, "soft": true, "bend": 0.12}
//   {"click": target, "ms": 1100, "bend": 0.12, "hover": 150}
//   {"drag": target | "here", "path": [{"to": [x, y] | {"rel"} | target, "ms": 2000, "bend": 0.03, "pause": 400}]}
//   {"ensure": "Line"}                        click a toggle button only when it is not already active
//   {"draw": [[lng, lat], ...], "first_ms": 1100, "ms": 550}   one click per vertex, the last one twice (terra-draw)
//   {"wheel": {"ms": 2200, "peak": -3.5, "drift": [-30, 20]}}  deltas on a sine bell, sent without awaiting
//   {"hold": 2500, "r": 35}                   a hold that keeps the pointer drifting
//   {"wait": 500}                             a still wait
//   {"camera": {zoom, center, bearing, pitch}, "ms": 4000, "linear": true}   map.easeTo, not awaited
//   {"key": "Escape"}
// A target is one of {label}, {go}, {button}, {aria}, {switch}, {combobox}, {option}, {section}, {divider: true},
// {tick: {date, source}}, {lnglat: [lng, lat]}, {swap: "B"}, {pill: "B"}, {handle: "B"}, {css}, {text}, each with
// optional dx, dy, x, y. Targets are read on the page by window.__tvFind; a target scrolled out of the sidebar
// is scrolled into view and read again until two reads agree, while the pointer keeps moving.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const [mode, takePath, wsUrl, ...rest] = process.argv.slice(2)
if (!mode || !takePath) { console.error("usage: take.mjs plan|prep|run <take.json> [<ws-url>] [--captions out.json] [--offset s] [--cursors dir]"); process.exit(2) }
const opt = (name, dflt) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : dflt }
const spec = JSON.parse(readFileSync(takePath, "utf8"))
const W = 1920, H = 1080

// ── URLs (the plan mode, read by take.sh) ──
const qv = (k, v) => {
  if (typeof v === "boolean") return v ? "true" : "false"
  if (k.startsWith("date") && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return String(Date.parse(v + "T00:00:00Z"))
  return String(v)
}
const urlOf = (site, params) => site.replace(/\/$/, "") + "/?" + Object.entries(params).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(qv(k, v))).join("&")
if (mode === "plan") {
  const storage = { hasSeenTour: "true", isSidebarOpen: "true", ...(spec.storage || {}) }
  // the storage is cleared first: a rehearsal leaves its drawings and folded sections behind otherwise
  console.log("SETUP " + "localStorage.clear();" + Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(String(v))});`).join("") + '"ok"')
  console.log("NAME " + spec.name)
  console.log("WARM_S " + (spec.warm_s ?? 8))
  console.log("SETTLE_S " + (spec.settle_s ?? 4))
  for (const w of spec.warmup || []) console.log("WARM " + urlOf(spec.site, { ...spec.start, ...w }))
  console.log("START " + urlOf(spec.site, spec.start))
  process.exit(0)
}

// ── the cursor images (a take folder holding aero_arrow.b64, cursor-hover.b64, cursor-hover.hotspot) ──
const CURSORS = resolve(opt("--cursors", join(HERE, "..", "takes", "historical-grid-v5")))
const ARROW = "data:image/png;base64," + readFileSync(join(CURSORS, "aero_arrow.b64"), "utf8").trim()
const HAND = "data:image/png;base64," + readFileSync(join(CURSORS, "cursor-hover.b64"), "utf8").trim()
const [HX, HY] = readFileSync(join(CURSORS, "cursor-hover.hotspot"), "utf8").trim().split(",").map(Number)

// ── page helpers: the MapLibre map of view A through the React fiber, and the control finder ──
const INIT_JS = String.raw`(() => {
window.__tvRefs = () => {
  const out = []; const seen = new Set();
  for (const c of document.querySelectorAll('.maplibregl-map')) {
    let el = c;
    for (let up = 0; up < 8 && el; up++, el = el.parentElement) {
      const fk = Object.keys(el).find(k => k.startsWith('__reactFiber')); if (!fk) continue;
      let f = el[fk];
      for (let i = 0; i < 80 && f; i++, f = f.return) {
        let s = f.memoizedState;
        for (let j = 0; j < 60 && s; j++, s = s.next) {
          const v = s.memoizedState;
          for (const x of [v, v && v.current]) {
            if (x && typeof x === 'object' && typeof x.getMap === 'function' && !seen.has(x)) {
              seen.add(x);
              try { const m = x.getMap(); if (m && m.getCanvas().clientWidth > 200) out.push(x); } catch (e) {}
            }
          }
        }
      }
    }
  }
  return out;
};
window.__tv = () => window.__tvRefs()[0];
window.__tvFind = (s) => {
  const vis = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null;
    if (r.bottom < 0 || r.top > innerHeight) { e.scrollIntoView({ block: 'center', behavior: 'smooth' }); return null; }
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; };
  const txt = (sel, t) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === t);
  let p = null;
  if (s.label) p = vis(document.querySelector('label[for="' + s.label + '"]'));
  else if (s.go) { let row = document.querySelector('label[for="' + s.go + '"]');
    while (row && !row.querySelector('button[aria-label^="Go to"]')) row = row.parentElement;
    p = row ? vis(row.querySelector('button[aria-label^="Go to"]')) : null; }
  else if (s.button) p = vis(txt('button', s.button));
  else if (s.aria) p = vis(document.querySelector('[aria-label="' + s.aria + '"]'));
  else if (s.switch) { const l = document.querySelector('label[for="' + s.switch + '"]'); const row = l && l.closest('.justify-between');
    p = vis(row && row.querySelector('[data-slot=switch]')); }
  else if (s.combobox) { const re = new RegExp(s.combobox); p = vis([...document.querySelectorAll('[role=combobox]')].find(e => re.test(e.textContent.trim()))); }
  else if (s.option) p = vis(txt('[role=option]', s.option));
  else if (s.section) p = vis(txt('button[data-slot="collapsible-trigger"]', s.section));
  else if (s.divider) p = vis(document.querySelector('div.cursor-col-resize'));
  else if (s.tick) {
    const COL = { ge: 'rgb(174, 203, 250)', wayback: 'rgb(203, 228, 189)', bing: 'rgb(196, 181, 253)' };
    const color = s.tick.color || COL[s.tick.source || 'ge'];
    const yrs = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^(19|20)\d\d$/.test(e.textContent.trim()) && e.getBoundingClientRect().y > innerHeight - 200)
      .map(e => { const r = e.getBoundingClientRect(); return [Number(e.textContent.trim()), r.x + r.width / 2]; }).sort((a, b) => a[0] - b[0]);
    const ticks = [...document.querySelectorAll('div')].filter(e => { const r = e.getBoundingClientRect(); return r.y > innerHeight - 200 && r.width < 10 && r.height > 10 && getComputedStyle(e).backgroundColor === color; })
      .map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; });
    if (yrs.length >= 2 && ticks.length) {
      const d = new Date(s.tick.date + 'T00:00:00Z'), fy = d.getUTCFullYear() + (d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (365.25 * 864e5);
      const [y0, x0] = yrs[0], [y1, x1] = yrs[yrs.length - 1], x = x0 + (fy - y0) * (x1 - x0) / (y1 - y0);
      p = ticks.reduce((b, q) => Math.abs(q[0] - x) < Math.abs(b[0] - x) ? q : b);
    }
  }
  else if (s.lnglat) {
    const m = window.__tv().getMap(), q = m.project(s.lnglat), r = m.getCanvas().getBoundingClientRect();
    p = [Math.round(r.left + q.x), Math.round(r.top + q.y)];
  }
  else if (s.swap) {
    const lab = [...document.querySelectorAll('span.cursor-pointer')].find(e => e.textContent.trim().startsWith(s.swap + ':'));
    const svg = lab && lab.parentElement.querySelector('svg.lucide-arrow-left-right');
    p = vis(svg && svg.closest('button'));
  }
  else if (s.pill) p = vis([...document.querySelectorAll('span.cursor-pointer')].find(e => e.textContent.trim().startsWith(s.pill + ':')));
  else if (s.handle) {
    const e = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === s.handle && e.getBoundingClientRect().y > innerHeight - 200);
    p = vis(e);
  }
  else if (s.css) p = vis(document.querySelector(s.css));
  else if (s.text) p = vis(txt('button,label,span,a,div', s.text));
  if (p) { if (s.x !== undefined) p[0] = s.x; if (s.y !== undefined) p[1] = s.y; p[0] += s.dx || 0; p[1] += s.dy || 0; }
  return p;
};
window.__tvActive = (t) => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
  return !!b && (b.className.includes('bg-primary') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('data-state') === 'on'); };
return window.__tvRefs().length;
})()`
const PREP_JS = `(() => {
  if (document.getElementById('tv-cursor')) return true;
  const ARROW = ${JSON.stringify(ARROW)}, HAND = ${JSON.stringify(HAND)}, HX = ${HX}, HY = ${HY};
  const c = document.createElement('img'); c.id = 'tv-cursor'; c.src = ARROW;
  c.style.cssText = 'position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);image-rendering:pixelated;';
  document.documentElement.appendChild(c);
  addEventListener('mousemove', (e) => {
    c.style.visibility = 'hidden';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    c.style.visibility = '';
    const hand = !!el && getComputedStyle(el).cursor === 'pointer';
    if (hand && c.src !== HAND) c.src = HAND; else if (!hand && c.src !== ARROW) c.src = ARROW;
    const dx = hand ? HX : 0, dy = hand ? HY : 0;
    c.style.transform = 'translate(' + (e.clientX - dx) + 'px,' + (e.clientY - dy) + 'px)';
  }, true);
  window.__takeMarker = true;
  return true;
})()`

// ── CDP ──
if (!wsUrl) { console.error("a ws-url is needed for prep and run"); process.exit(2) }
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const msgId = ++id
  pending.set(msgId, { res, rej })
  ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }))
})
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let S
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, S)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}

// ── the pointer ──
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeSoft = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
let pos = [760, 470]
let buttons = 0
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, buttons, ...extra }, S)
async function moveTo(x, y, ms, bend = 0.12, curve = ease) {
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
async function wheel(ms, drift, peak) {
  const [x0, y0] = pos, steps = Math.max(1, Math.round(ms / 16.7)), t0 = Date.now()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, k = easeSoft(t), px = x0 + drift[0] * k, py = y0 + drift[1] * k
    await mouse("mouseMoved", px, py)
    send("Input.dispatchMouseEvent", { type: "mouseWheel", x: px, y: py, deltaX: 0, deltaY: peak * Math.sin(Math.PI * t) }, S).catch(() => {})
    const wait = t0 + (ms * i) / steps - Date.now(); if (wait > 0) await sleep(wait)
  }
  pos = [x0 + drift[0], y0 + drift[1]]
}
async function drift(ms, r = 35) {
  const t0 = Date.now(), [x0, y0] = pos; let k = 0
  while (Date.now() - t0 < ms - 200) {
    const left = ms - (Date.now() - t0), seg = Math.min(1400, Math.max(300, left)), a = (k++ * 2.1) % (2 * Math.PI)
    await moveTo(x0 + Math.cos(a) * r, y0 + Math.sin(a) * r * 0.6, seg, 0.3, easeSoft)
  }
}
const find = (s) => evaluate(`window.__tvFind(${JSON.stringify(s)})`)
async function settled(s, maxMs = 1800) {
  const t0 = Date.now(); let prev = JSON.stringify(await find(s))
  while (Date.now() - t0 < maxMs) { await sleep(90); const cur = JSON.stringify(await find(s)); if (cur !== "null" && cur === prev) return JSON.parse(cur); prev = cur }
  return JSON.parse(prev)
}
const dest = (to) => (to && typeof to === "object" && !Array.isArray(to) && "rel" in to ? [pos[0] + to.rel[0], pos[1] + to.rel[1]] : to)
// [x, y] as given, or a control looked up while the pointer keeps moving
async function resolveTarget(target) {
  if (Array.isArray(target)) return target.slice()
  const task = settled(target)
  await moveTo(pos[0] + 18, pos[1] - 12, 320, 0.3, easeSoft)
  const p = await task
  if (!p) throw new Error("control not found: " + JSON.stringify(target))
  return p
}
const cur = () => evaluate(`(() => { const c = document.getElementById("tv-cursor"); c.style.visibility = "hidden"; const el = document.elementFromPoint(${pos[0]}, ${pos[1]}); c.style.visibility = ""; return (c.src === ${JSON.stringify(HAND)} ? "hand" : "arrow") + "/" + (el ? getComputedStyle(el).cursor : "-") })()`)

const marks = []
let t0 = Date.now()
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(2)} s ${s}`)

async function step(s) {
  if ("caption" in s) { marks.push([Date.now(), s.caption]); log("caption " + JSON.stringify(s.caption)) }
  else if ("move" in s) { const p = await resolveTarget(dest(s.move)); await moveTo(p[0], p[1], s.ms ?? 1000, s.bend ?? 0.12, s.soft ? easeSoft : ease) }
  else if ("click" in s) {
    const p = await resolveTarget(dest(s.click))
    await moveTo(p[0], p[1], s.ms ?? 1100, s.bend ?? 0.12)
    await sleep(s.hover ?? 150); const c = await cur(); await click()
    log("click " + JSON.stringify(s.click) + " at " + JSON.stringify(p) + " " + c)
  }
  else if ("drag" in s) {
    if (s.drag !== "here") { const p = await resolveTarget(dest(s.drag)); await moveTo(p[0], p[1], s.ms ?? 900, s.bend ?? -0.15, easeSoft) }
    await sleep(120); await press()
    for (const seg of s.path) {
      let to = seg.to
      if (to && typeof to === "object" && !Array.isArray(to)) { to = "rel" in to ? dest(to) : await find(to); if (!to) throw new Error("target not found: " + JSON.stringify(seg.to)) }
      await moveTo(to[0], to[1], seg.ms ?? 2000, seg.bend ?? 0.03, easeSoft)
      if (seg.pause) await sleep(seg.pause)
    }
    await sleep(60); await release()
    log("drag " + JSON.stringify(s.drag) + " -> " + JSON.stringify(pos))
  }
  else if ("ensure" in s) {
    if (await evaluate(`window.__tvActive(${JSON.stringify(s.ensure)})`)) { log(s.ensure + " already active"); const p = await resolveTarget({ button: s.ensure }); await moveTo(p[0], p[1], s.ms ?? 900, 0.12) }
    else await step({ click: { button: s.ensure }, ms: s.ms ?? 900 })
  }
  else if ("draw" in s) {
    const pts = s.draw
    for (let i = 0; i < pts.length; i++) {
      const p = await find({ lnglat: pts[i] })
      await moveTo(p[0], p[1], i === 0 ? (s.first_ms ?? 1100) : (s.ms ?? 550), s.bend ?? 0.06, i === 0 ? ease : easeSoft)
      await sleep(70); await click()
    }
    await sleep(250); await click()
    await sleep(300)
    log(`drew ${pts.length} vertices, ` + await evaluate(`(document.body.innerText.match(/Features: \\d+/) || ['?'])[0]`))
  }
  else if ("wheel" in s) { const w = s.wheel; await wheel(w.ms ?? 2000, w.drift ?? [-30, 20], w.peak ?? -3.5) }
  else if ("hold" in s) await drift(s.hold, s.r ?? 35)
  else if ("wait" in s) await sleep(s.wait)
  else if ("camera" in s) {
    // easeTo returns the Map itself, which cannot come back by value: the expression ends on a boolean
    await evaluate(`(window.__tv().easeTo(Object.assign({}, ${JSON.stringify(s.camera)}, {duration: ${s.ms ?? 4000}}, ${s.linear ?? true} ? {easing: t => t} : {})), true)`)
    log("camera " + JSON.stringify(s.camera) + " in " + (s.ms ?? 4000) + " ms")
  }
  else if ("key" in s) { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: s.key, code: s.key }, S) }
  else throw new Error("unknown step: " + JSON.stringify(s))
}

ws.onopen = async () => {
  const { targetInfos } = await send("Target.getTargets")
  const host = new URL(spec.site).host
  const page = targetInfos.find((t) => t.type === "page" && t.url.includes(host))
  if (!page) { console.error("no page on " + host); process.exit(1) }
  ;({ sessionId: S } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }))
  const refs = await evaluate(INIT_JS)
  console.log("prep: maps", refs, "cursor", await evaluate(PREP_JS), await evaluate("location.search"))
  // capture.mjs attaches to the first page target when none is localhost:5204: close the others
  for (const t of targetInfos) if (t.type === "page" && t.targetId !== page.targetId) await send("Target.closeTarget", { targetId: t.targetId })
  if (mode === "prep") { await mouse("mouseMoved", pos[0], pos[1]); ws.close(); process.exit(0) }
  t0 = Date.now()
  await mouse("mouseMoved", pos[0], pos[1])
  for (const s of spec.steps) {
    try { await step(s) } catch (e) { log("FAILED step " + JSON.stringify(s) + ": " + e.message) }
  }
  await sleep(600)
  log("end")
  const captions = opt("--captions")
  if (captions) {
    // beats in video seconds: the capture starts `offset` s before the run (take.sh: 0.4)
    const off = Number(opt("--offset", 0.4)), end = (Date.now() - t0) / 1000 + off
    const beats = marks.map(([t, text], i) => {
      const at = Math.max(0, (t - t0) / 1000 + off), to = (i + 1 < marks.length ? (marks[i + 1][0] - t0) / 1000 + off - 0.3 : end - 0.2)
      return { at: Math.round(at * 100) / 100, to: Math.round(to * 100) / 100, text }
    }).filter((b) => b.to - b.at > 0.8)
    writeFileSync(captions, JSON.stringify({ name: spec.name, spot: spec.spot || { x: 760, bottom: 90 }, duration: Math.round(end * 100) / 100, beats }, null, 2) + "\n")
    console.log("captions -> " + captions)
  }
  console.log("end", await evaluate("location.search"), "marker still set:", await evaluate("!!window.__takeMarker"))
  ws.close(); process.exit(0)
}
ws.onerror = (e) => { console.error(String(e.message || e)); process.exit(1) }
