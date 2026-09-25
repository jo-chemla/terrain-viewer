---
name: maplibre-load-and-terradraw-cursor-gotchas
description: MapLibre "load" never fires when tiles wedge (install watchdogs at map creation); terra-draw resets mode cursors on any updateOptions call and clears the cursor on every pointer move
type: project
---

Two traps found on 2026-09-25, both of which made a feature silently do nothing.

1. **MapLibre's `load` event waits for the first complete render.** With a wedged tile queue (a hung DEM host under 3D terrain) it never fires, so anything installed in react-map-gl's `onLoad` is missing in exactly the stuck case. The stalled-tiles watchdog is now installed from an effect as soon as `mapRefs[side].current.getMap()` exists (TerrainViewer.tsx). Same family as [[maplibre-style-loaded-gate]].

2. **terra-draw cursors.** Select mode's `updateOptions` does `this.cursors = options.cursors ? {...} : DEFAULTS`, so any later `updateModeOptions` without `cursors` (the app calls it for styles) silently resets custom cursors. And select mode sets a hover cursor only over the *selected* feature, clearing it on every other pointer move. The hover pointer for unselected features is a maplibre `mousemove` handler in TerraDrawSystem.tsx that runs after terra-draw's `pointermove` and re-applies `pointer` whenever the cursor is empty.

**How to apply:** do not put must-run setup in `onLoad`; do not rely on terra-draw `cursors` options surviving; other canvas-cursor writers must write only on change (see MapLayers.tsx tells handler, CoverageOverlayLayer.tsx).
