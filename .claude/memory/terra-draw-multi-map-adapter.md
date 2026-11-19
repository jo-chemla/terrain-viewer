---
name: terra-draw-multi-map-adapter
description: Drawing works on every view through one Terra Draw instance and a custom adapter spanning all maps (lib/terra-draw-multi-map-adapter.ts); what it relies on, the two perf traps measured with 32,751 points, and how it was tested
type: project
---

# Drawing on every view (2026-11-19)

One Terra Draw instance, one store, one adapter over all mounted views:
`TerraDrawMultiMapAdapter` in `lib/terra-draw-multi-map-adapter.ts`. It
replaced the stock `terra-draw-maplibre-gl-adapter` (dependency removed) and
the read-only `DrawingMirrorLayer` (file removed; `IteratorHighlightLayer`
moved to its own file).

- **Input**: Terra Draw's own listeners (`getAdapterListeners()`, protected,
  and each listener's `callback`) are added to every map's canvas. The map an
  event comes from becomes `_current`; project, unproject and the event
  element all read it. `setDraggability` and `setDoubleClickToZoom` apply to
  every map, because a drag can start on one view and end on another.
- **Output**: td-polygon, td-polygon-outline, td-linestring, td-point and
  td-guide on every map, styled once per render, `setData` per map.
- **Views come and go**: `useTerraDraw(mapRef, viewMapRefs)` polls the eight
  refs every 500 ms (`syncViews`) and calls `attach` / `detach`. Gate is
  `map.style._loaded`, not `isStyleLoaded()` ([[maplibre-style-loaded-gate]]).
  On `styledata` the adapter re-adds its layers if the style lost them and
  moves them back on top (`getLayersOrder()`, not `getStyle()`).
- **Show checkbox and opacity slider**: `adapter.setVisible` / `setOpacity`
  through the module-level `drawAdapter` in TerraDrawSystem.tsx. Opacity is a
  factor on each feature's own opacity (the old code overwrote it with a
  constant, which lost a layer's alpha and showed hidden layers' fills).
- Pinned to terra-draw 1.37 internals: check `getAdapterListeners`,
  `_listeners` and `_currentModeCallbacks` when upgrading terra-draw.

## Perf traps, measured with 32,751 points on four views

| What | Before | After |
|---|---|---|
| 'change' listener per pointer move (two `getSnapshot()` copies) | 25 ms avg, 150 max | under 0.1 ms |
| Adapter render per move while drawing a line | 64 ms | 1 to 2 ms |
| Full restyle of all points, four views | 117 ms | 60 to 100 ms |
| Adding one point to the 32,751 | n/a | 70 to 90 ms (all points share one source) |

1. Terra Draw's helper points (closing point, selection and mid-points) are
   Point features. In the same source as the drawn points every move restyled
   and resent all points. They now have their own source, `td-guide`
   (`kindOf`: a Point whose `mode` is not `point`). Deletions mark only the
   source of the deleted id (`_kindById`).
2. `getSnapshot()` clones the store (60 to 100 ms at this size). The copy into
   `drawingFeaturesAtom` is throttled, and waits for a 250 ms pause once a
   copy costs over 30 ms. `flushSync` copies a pending change before the
   instance stops. The layer tag reads only the created ids.

So `drawingFeaturesAtom` lags the store by up to 250 ms on a large drawing:
read the store (`draw.getSnapshot()`) when the value must be current.

## Tested (agent-browser, real mouse, Crater candidates bookmark)

Line with two clicks on B and one on D; select and vertex drag on C (dragPan
off on all four during the drag, back on after); Delete; points on each side
of the overlay wipe (left goes to A, right to B); 4x2 (8 maps attached),
split off (1), overlay (2, a new map for B). Dev handles: `window.__draw`,
`window.__drawAdapter`, `window.__drawPerf`.

Not tested: touch input, globe projection, a shape continued across views
whose cameras differ. Elevation Picker, Sun Shadow Calculator, Tells and the
timeline are still view A only (Jonathan: later work).
