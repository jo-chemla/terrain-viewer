---
name: composite-blend-stale-backdrop
description: Two-date composites - why overlay pane B has will-change, how the boxes and the edges filter are checked against a snapshot
type: project
---

The two-date composites of the overlay split (`lib/grid-layouts.ts`: `compositeSteps`, `edgeFilterPrimitives`) are blended boxes inside each pane, then pane B blended over pane A.

**Stale backdrop in Chrome (found 2026-11-26, Chrome 158).** With blending off and the map idle, switching a composite on mounted the boxes and set B's `mix-blend-mode` in one frame, and Chrome kept blending B against A as it was before the boxes: the picture came out colored (or with A missing) until something else invalidated B. A map repaint did not clear it; any compositing change on B did. Fix: pane B always has `will-change: opacity` in the overlay split (`TerrainViewer.tsx`, the pane style). Do not remove it. `isolation: isolate` on pane A does not fix it.

**How to apply:** when touching the pane styles or the boxes, test from a fresh load with `splitBlendModeEnabled=false`, then switch the mode on through the UI or `window.__tv.setState`, not only with the mode already in the URL (that path always worked).

**Snapshot parity.** `compositeViews` (`lib/controls-utils.tsx`) repeats the fills from `data-composite-steps` and, for the edges, mounts the same filter with radii times the pixel ratio. Checked by comparing a Chrome screenshot with `captureMapScreenshot(..., { chrome: false })` inside a rectangle free of controls: identical for the three box composites at pixel ratios 1 and 2, within 1/255 on average for the edges.

**Edges filter.** On the pane's `.maplibregl-canvas-container` (rule in `src/index.css`), not on the pane, whose controls it would redraw. View A's filter merges the edges right of the wipe over the untouched picture, with the wipe position in pixels (a `height="100%"` on that primitive made Chrome drop it). Three Gaussian blurs per pane: about 50 fps while panning at 1400 x 900 on an Intel Iris Xe, 37 fps at pixel ratio 2.
