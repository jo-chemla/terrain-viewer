---
name: ge-historical-as-of-snap
description: Google Earth Historical date lists are per level (yearly Landsat mosaics to L13, sharp captures from L14); the tiles draw the exact date or an ancestor's, the timeline snaps the date to the drawn capture on zoom-in and keeps it on zoom-out
metadata:
  type: project
---

Google Earth Time Machine lists dates per Keyhole node and level. Probe over Al Hamriyah (2026-10-19): L6 to L13 list 37 yearly Landsat / Copernicus mosaics dated 31 December; L14 lists 47 dates, 46 of them Maxar, Airbus, CNES / Airbus captures plus one lingering 1985 mosaic; L15 and finer list captures only.

Two rules, kept deliberately apart:
- `_pickTileForPath` (lib/ge-timemachine/ge-historical.js): exact date at this node, else the exact date on an ancestor (upscaled), else newest on or before (else oldest). Never draw newer than the slider; the old "nearest date" pick made the view drift onto other years.
- `historical-timeline-panel.tsx`, the snap effect after `useGeHistoricalDates`: when the settled camera's node does not list the view's date, move it to this level's newest on or before only if an ancestor lists it (zoomed in past a mosaic). A date listed nowhere up the chain (a sharp capture seen from low zoom) is kept, so zoom cycles do not drift backward; the handle then sits on the newest tick on or before the date (the mosaic the tiles draw), not the nearest.

The level the lists are read at is `geKeyholeLevelForZoom` (lib/ge-historical.ts): round(zoom) + 1 (MapLibre's raster tile zoom for 256 px tiles) plus one with the HiDPI build. Read at the viewport zoom, the ticks lagged the tiles by two levels.

**Why:** the pill must say what is drawn and a sharp pick must survive zooming out and back; no provider classification of Google ticks in the UI (the one provider-free signal is "listed by an ancestor"). `useGeHistoricalDates` returns `coarserDates` for this; the ancestors' packets are already cached by the walk.

**How to apply:** do not add a provider check or a "nearest" rule to either side. If soft neighbouring tiles at capture-strip seams bother, bend `_pickTileForPath` to same-level as-of when the exact date is only found more than two or three levels up. Docs: /dev/ge-historical, "Which date is drawn as you zoom".
