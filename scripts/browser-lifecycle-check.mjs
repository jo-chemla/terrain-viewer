// Drives the app in the system Chrome through agent-browser (the root devDependency;
// no agent-browser browser download needed) and checks the MapLibre lifecycle:
// map load, terrain toggles, phong/matcap live layers,
// split-view camera sync under a real pointer drag, historical timeline.
// Usage: pnpm app --port 5175, then node scripts/browser-lifecycle-check.mjs http://localhost:5175
// (a dev build: window.__tv is required). Written for the React 19 upgrade (2026-11-08);
// a full-size canvas per view plus the 38 px minimap canvas is the expected count.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AB = process.env.AB_BIN || join(root, "node_modules/agent-browser/bin", process.platform === "win32" ? "agent-browser-win32-x64.exe" : `agent-browser-${process.platform}-${process.arch}`);
const base = process.argv[2] || "http://localhost:5175";
const env = {
  ...process.env,
  AGENT_BROWSER_SESSION: "r19",
  AGENT_BROWSER_EXECUTABLE_PATH: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  AGENT_BROWSER_ARGS: "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization,--window-size=1600,1000",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args) => execFileSync(AB, args, { encoding: "utf8", env, timeout: 180000, stdio: ["ignore", "pipe", "pipe"] });
const ev = (js) => {
  const out = run(["eval", js, "--json"]);
  let j;
  try { j = JSON.parse(out); } catch { return out.trim(); }
  return j?.data?.result ?? j?.result ?? j?.data ?? j;
};
const consoleLogs = () => {
  try {
    const j = JSON.parse(run(["console", "--json"]));
    const arr = j?.data?.logs ?? j?.data?.messages ?? j?.data ?? j?.logs ?? j;
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return [{ type: "meta", text: "console read failed: " + e.message }]; }
};
const until = async (js, label, ms = 60000, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let v; try { v = ev(js); } catch {}
    if (v === true) return true;
    await sleep(step);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };
const open = async (qs) => { try { run(["console", "--clear"]); } catch {} run(["open", base + "/" + qs]); await until("!!window.__tv && !!window.__tv.mapRefs", "__tv", 60000); };
const mapJs = (v) => `(window.__tv.mapRefs.${v}.current && window.__tv.mapRefs.${v}.current.getMap())`;
const loaded = (v) => `(() => { const m = ${mapJs(v)}; return !!m && m.isStyleLoaded() && m.areTilesLoaded(); })()`;
const NOISE = /\[vite\]|React DevTools|Download the React|favicon|net::ERR|404|Failed to load resource|tile/i;
const errorsSince = () => consoleLogs()
  .filter((l) => /error|warn/i.test(String(l.type || l.level || "")))
  .map((l) => String(l.text || l.message || JSON.stringify(l)).slice(0, 300))
  .filter((t) => !NOISE.test(t));
const report = (label) => {
  const errs = errorsSince();
  console.log(`  console errors/warnings after ${label}: ${errs.length}`);
  for (const e of errs.slice(0, 12)) console.log("    - " + e.replace(/\n/g, " "));
  return errs;
};
const isReactOrRuntimeError = (e) => /error|uncaught|invariant|hook|unmounted|Maximum update|act\(|Cannot read|is not a function|WebGL/i.test(e);

// S1: default 3D terrain view
await open("?lat=45.9763&lng=7.6586&zoom=12.6&pitch=45&viewMode=3d&exaggeration=1");
await until(loaded("A"), "map A loaded");
check("S1 map A loads (style + tiles)", true);
check("S1 terrain is set in 3d", ev(`!!${mapJs("A")}.getTerrain()`) === true);
check("S1 one full-size map canvas (plus the minimap)", ev(`[...document.querySelectorAll("canvas.maplibregl-canvas")].filter(c => c.width > 200).length`) === 1, "a StrictMode double mount would leave extra canvases");
const idA = ev(`(() => { const m = ${mapJs("A")}; m.__r19id = m.__r19id || Math.random(); return m.__r19id })()`);
const s1 = report("S1");
check("S1 no console errors", s1.filter(isReactOrRuntimeError).length === 0, s1.length ? s1[0].slice(0, 120) : "");

// S2: terrain toggle 3d -> 2d -> 3d via state (setTerrain path), same map instance
ev(`window.__tv.setState({ viewMode: '2d' })`); await sleep(1500);
check("S2 2d view drops terrain", ev(`!${mapJs("A")}.getTerrain()`) === true);
ev(`window.__tv.setState({ viewMode: '3d' })`); await sleep(1500);
check("S2 back to 3d restores terrain", ev(`!!${mapJs("A")}.getTerrain()`) === true);
check("S2 map instance not recreated", ev(`${mapJs("A")}.__r19id`) === idA);
ev(`window.__tv.setState({ showHillshade: false })`); await sleep(800);
ev(`window.__tv.setState({ showHillshade: true })`); await sleep(800);
ev(`window.__tv.setState({ exaggeration: 2 })`); await sleep(800);
ev(`window.__tv.setState({ exaggeration: 1 })`); await sleep(800);
check("S2 hillshade + exaggeration round-trips keep terrain", ev(`!!${mapJs("A")}.getTerrain()`) === true);
const s2 = report("S2");
check("S2 no console errors", s2.filter(isReactOrRuntimeError).length === 0);

// S3: phong live layer
await open("?lat=45.9763&lng=7.6586&zoom=12.6&pitch=0&bearing=0&viewMode=3d&showHillshade=true&showRasterBasemap=true&showLightingEffects=true&showPhong=true&hillshadeOpacity=0.2&phongSpecularStrength=0.6&phongDiffuseStrength=0.5&exaggeration=1");
await until(loaded("A"), "map A loaded (phong)");
await until(`!!${mapJs("A")}.getLayer('phong-live')`, "phong-live layer", 30000);
check("S3 phong-live custom layer present", true);
ev(`window.__tv.setState({ showPhong: false })`); await sleep(1200);
check("S3 phong-live removed on toggle off", ev(`!${mapJs("A")}.getLayer('phong-live')`) === true);
ev(`window.__tv.setState({ showPhong: true })`); await until(`!!${mapJs("A")}.getLayer('phong-live')`, "phong-live back", 20000);
check("S3 phong-live re-added on toggle on", true);
const s3 = report("S3");
check("S3 no console errors", s3.filter(isReactOrRuntimeError).length === 0);

// S4: matcap live layer
await open("?lat=45.9744&lng=7.6511&zoom=13.1&pitch=0&viewMode=3d&showHillshade=true&showLightingEffects=true&showPhong=false&showMatcap=true&hillshadeOpacity=0.2&matcapTextureId=clay_brown&matcapRenderer=live&exaggeration=1");
await until(loaded("A"), "map A loaded (matcap)");
await until(`!!${mapJs("A")}.getLayer('matcap-live')`, "matcap-live layer", 30000);
check("S4 matcap-live custom layer present", true);
ev(`window.__tv.setState({ matcapRenderer: 'raster' })`); await sleep(1500);
check("S4 switching to raster renderer removes live layer", ev(`!${mapJs("A")}.getLayer('matcap-live')`) === true);
const s4 = report("S4");
check("S4 no console errors", s4.filter(isReactOrRuntimeError).length === 0);

// S5: split 2x2 side-by-side, camera sync under a held pointer drag on view A
await open("?lat=45.9763&lng=7.6586&zoom=12&pitch=30&bearing=20&viewMode=3d&splitStyle=side-by-side&gridLayout=2x2&exaggeration=1");
for (const v of ["A", "B", "C", "D"]) await until(loaded(v), `map ${v} loaded`);
check("S5 four maps load", true);
const bigCanvases = ev(`[...document.querySelectorAll("canvas.maplibregl-canvas")].map(c => c.width)`);
check("S5 four full-size map canvases", bigCanvases.filter((w) => w > 100).length === 4, `widths: ${JSON.stringify(bigCanvases)}`);
const cam = (v) => ev(`(() => { const m = ${mapJs(v)}; const c = m.getCenter(); return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() } })()`);
const before = cam("A");
const rect = ev(`(() => { const r = ${mapJs("A")}.getCanvas().getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`);
const cx = Math.round(rect.x + rect.w / 2), cy = Math.round(rect.y + rect.h / 2);
run(["mouse", "move", String(cx), String(cy)]);
run(["mouse", "down"]);
run(["mouse", "move", String(cx + 180), String(cy + 90), "--steps", "30", "--duration", "600"]);
await sleep(200);
const midA = cam("A"), midB = cam("B");
run(["mouse", "move", String(cx + 260), String(cy + 40), "--steps", "20", "--duration", "400"]);
run(["mouse", "up"]);
await sleep(1200);
const after = { A: cam("A"), B: cam("B"), C: cam("C"), D: cam("D") };
const moved = Math.abs(after.A.lng - before.lng) > 1e-4 || Math.abs(after.A.lat - before.lat) > 1e-4;
check("S5 drag moved view A", moved, `dlng=${(after.A.lng - before.lng).toFixed(5)} dlat=${(after.A.lat - before.lat).toFixed(5)}`);
const same = (a, b) => Math.abs(a.lng - b.lng) < 1e-5 && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(a.bearing - b.bearing) < 1e-2 && Math.abs(a.pitch - b.pitch) < 1e-2;
check("S5 B/C/D follow A after drag", same(after.A, after.B) && same(after.A, after.C) && same(after.A, after.D), JSON.stringify({ A: after.A, B: after.B }).slice(0, 220));
check("S5 B followed A mid-drag (pointer held)", same(midA, midB), `A=${midA.lng.toFixed(5)},${midA.lat.toFixed(5)} B=${midB.lng.toFixed(5)},${midB.lat.toFixed(5)}`);
const rb = ev(`(() => { const r = ${mapJs("B")}.getCanvas().getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`);
run(["mouse", "move", String(Math.round(rb.x + rb.w / 2)), String(Math.round(rb.y + rb.h / 2))]);
run(["mouse", "wheel", "-300"]);
await sleep(1500);
const z = { A: cam("A"), B: cam("B") };
check("S5 wheel zoom on B propagates to A", Math.abs(z.A.zoom - z.B.zoom) < 1e-3 && Math.abs(z.B.zoom - after.B.zoom) > 0.01, `A=${z.A.zoom.toFixed(3)} B=${z.B.zoom.toFixed(3)} (was ${after.B.zoom.toFixed(3)})`);
const idB = ev(`(() => { const m = ${mapJs("B")}; m.__r19id = m.__r19id || Math.random(); return m.__r19id })()`);
ev(`window.__tv.setState({ gridLayout: '2x1' })`); await sleep(1500);
check("S5 layout switch keeps map B instance", ev(`${mapJs("B")}.__r19id`) === idB);
ev(`window.__tv.setState({ splitStyle: 'off' })`); await sleep(500);
let aReloaded = true; try { await until(loaded("A"), "map A after split off", 30000); } catch { aReloaded = false; }
check("S5 split off, A reloads at full size", aReloaded);
const s5 = report("S5");
check("S5 no console errors", s5.filter(isReactOrRuntimeError).length === 0);

// S6: historical mode with the timeline, two views, date change
await open("?appMode=historical&viewMode=2d&zoom=15&lat=48.8566&lng=2.3488&pitch=0&splitStyle=side-by-side&gridLayout=2x1&basemapSourceA=historical&historicalActiveSourceA=wayback&dateA=1609459200000&basemapSourceB=historical&historicalActiveSourceB=wayback&dateB=1420070400000&exaggeration=1");
await until(`!!${mapJs("A")} && ${mapJs("A")}.isStyleLoaded()`, "map A style (historical)");
await until(`!!${mapJs("B")} && ${mapJs("B")}.isStyleLoaded()`, "map B style (historical)");
check("S6 historical maps load", true);
check("S6 timeline rendered", ev(`!!document.querySelector('[aria-label="Collapse timeline"]')`) === true);
const srcA0 = ev(`JSON.stringify(Object.keys(${mapJs("A")}.getStyle().sources).filter(k => /hist|wayback|basemap/i.test(k)))`);
ev(`window.__tv.setState({ dateA: 1420070400000 })`); await sleep(2500);
check("S6 dateA change applied to state", ev(`window.__tv.state.dateA`) === 1420070400000);
check("S6 map A still has a basemap source after date change", ev(`Object.keys(${mapJs("A")}.getStyle().sources).some(k => /hist|wayback|basemap/i.test(k))`) === true, `before: ${srcA0}`);
ev(`window.__tv.setState({ historicalTimelineCollapsed: true })`); await sleep(800);
ev(`window.__tv.setState({ historicalTimelineCollapsed: false })`); await sleep(800);
check("S6 timeline collapse/expand round-trip", ev(`!!document.querySelector('[aria-label="Collapse timeline"]')`) === true);
const s6 = report("S6");
check("S6 no console errors", s6.filter(isReactOrRuntimeError).length === 0);

try { run(["screenshot", process.env.TEMP + "\\r19-final.png"]); } catch {}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
if (fails.length) { console.log("FAILED:"); for (const f of fails) console.log("  - " + f.name + (f.detail ? " -- " + f.detail : "")); }
