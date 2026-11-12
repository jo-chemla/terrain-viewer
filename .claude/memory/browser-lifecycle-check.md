---
name: browser-lifecycle-check
description: How an agent verifies MapLibre behaviour in a real Chrome on this laptop (agent-browser + system Chrome, window.__tv), the scripts/browser-lifecycle-check.mjs scenarios, and the traps met while writing it
type: project
---

# Real-browser checks of the map lifecycle (2026-11-08)

The agent preview browser cannot run MapLibre (no requestAnimationFrame), but
agent-browser (root devDependency, same 0.38.2 as `video/`) driving the
**system Chrome** can, with real GPU WebGL (ANGLE D3D11 on the Intel Arc):

```bash
pnpm app --port 5175
node scripts/browser-lifecycle-check.mjs http://localhost:5175
```

`scripts/browser-lifecycle-check.mjs` reads `window.__tv` (dev builds only)
and checks, in order: map load with terrain in 3d; 2d/3d, hillshade and
exaggeration round-trips keep the same Map instance; `phong-live` and
`matcap-live` custom layers appear, disappear and come back on toggles; a
2x2 side-by-side split loads four maps, a **held-pointer drag** on view A
moves B/C/D (also mid-drag), a wheel zoom on B reaches A, a layout switch
keeps the instances and split-off reloads A; historical mode with the
timeline, a date change and a timeline collapse. Console errors are read
back after each scenario (Vite/devtools/tile noise filtered). Written to
sign off the React 19 upgrade (`core-react-19`): 31/31 passed, zero console
errors, so the StrictMode double-invocation changes did not disturb the
MapLibre lifecycle.

**Why:** the camera-sync rules in [[camera-sync]] cannot be verified by a
type check; this is the cheapest way to exercise them under a real pointer.

**How to apply / traps:**
- Run the exe directly: `node_modules/agent-browser/bin/agent-browser-win32-x64.exe`.
  `pnpm exec agent-browser` with `MSYS_NO_PATHCONV=1` breaks pnpm's own shim.
- `agent-browser install` (its own Chromium, 200 MB) times out on this
  network; `AGENT_BROWSER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"`
  skips it. The GPU launch args from [[agent-browser-recording]] still apply.
- `eval <js> --json` returns `{success, data: {result}}`; `console --json`
  returns `data.messages[{type, text}]`. Verified a `console.error` probe
  comes back before trusting a "0 errors" result.
- Expected canvases: one full-size `canvas.maplibregl-canvas` per view plus
  the 38 px minimap canvas, so count canvases wider than 100 px, not all.
- After `splitStyle: off`, `areTilesLoaded()` is false for a while (pane A
  grows to full width); wait for it, do not assert after a fixed sleep.
- In the 2x2 layout the first column is narrow (181 px of 762 at this window
  size) on main and on the branch alike: the app's layout, not a regression.
- `jo-chemla.github.io/terrain-viewer` 301-redirects to
  `historical-satellite.iconem.com`, so a terrain URL opened there lands in
  the historical overlay defaults by design; the terrain production site is
  `terrain-viewer.iconem.com`. Compare production behaviour against that, or
  against `pnpm preview` of a local build.

## Handoff checks of 2026-11-12 (ELI 0.5.2, theme-editor package, G-LiHT, historical prod)

Driven the same way from a scratchpad script: ELI 0.5.2's API through
`/node_modules/.vite/deps/@osm-editor-kit_maplibre-editor-layer-index.js`
(1726 layers, 29 in view over Paris, a hydrated tile URL, coverage
features, 22 dated layers), the ELI search panel adding BD Ortho as the
basemap, the Source Info ELI group, the Settings -> Advanced Theme Editor
panel (`.tec-panel`) changing `--primary`, both G-LiHT VRTs drawing a
hillshade at zoom 14, and historical-satellite.iconem.com booting with two
canvases and the timeline. Two more traps:
- When the first agent-browser command of a Bash-spawned script times out
  (`spawnSync ... ETIMEDOUT` after 180 s, nothing else wrong), the daemon
  did not come up from that shell. Kill `agent-browser-win32-x64` and
  launch it once from PowerShell (`Start-Process` of the exe with `open
  <url>`, stdout redirected to a file, the same env vars); every later
  command from Bash then reuses that daemon. Do not `close` at the end of
  a script that another run will follow.
- A bare first visit to historical-satellite.iconem.com (no `hasSeenTour`,
  no params at the tour's first render) auto-starts the product tour after
  1.5 s, and its first step switches to terrain, split off, Esri: one
  canvas, no timeline, `appMode=terrain` stored. Skip restores historical.
  Seed `hasSeenTour` on that origin, or wait for a cold load (then the
  app's own historical URL write lands first and the tour stays off).

