---
name: agent-browser-testing
description: agent-browser (CLI, real Chrome) renders MapLibre, unlike the built-in agent preview; how to drive the app with it to test map behaviour without asking the user
type: reference
---

`agent-browser` (npm global, 0.43.0, its own Chrome under `~/.agent-browser`,
installed 2026-11-17 at the user's request; docs https://agent-browser.dev,
`agent-browser skills get core`) runs a real headless Chrome where
`requestAnimationFrame` fires: MapLibre loads styles, terrain and 3D draw, the
workers run. Use it for map checks instead of the agent preview.

- `pnpm exec vite --port 5190 --strictPort`, then `agent-browser set viewport
  1500 950`, `agent-browser open http://localhost:5190/`. The first load after
  a server start takes 30-40 s (the `open` reports a load timeout; wait and
  check `window.__tv`). Click "Skip" on the tour.
- Drive state with `agent-browser eval "(()=>{window.__tv.setState({...}); return 1})()"`,
  the map with `(window.__tv.mapRefs.A.current ?? window.__tv.mapRefs.A).getMap()`.
  SVF, Openness, Local Dominance and LRM need `showReliefVisualization`; slope,
  aspect, curvature, blobness `showTerrainAnalysis`; shadows, Matcap, Phong
  `showLightingEffects`; contours and iso-lines `showContoursAndGraticules`.
- `agent-browser screenshot <abs path>`; several pictures at once: an HTML grid
  of `<img>` opened with `--session sheet` and screenshotted.
- `agent-browser snapshot -i` gives refs (`@e12`) for click and fill. Kill the
  dev server afterwards (the vite node process survives its shell).
- Its profile is separate from the user's browser: sources added there are not
  in theirs.
