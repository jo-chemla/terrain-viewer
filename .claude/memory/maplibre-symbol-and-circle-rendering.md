---
name: maplibre-symbol-and-circle-rendering
description: How MapLibre places line symbols and anti-aliases circles, as the tile service's direct engine reproduces them (tile-server/symbols.mjs, tellsSvg)
type: project
---

Matching MapLibre's raster output in the tile service's direct engine (2026-11-22) turned on three facts:

- **Line symbols are placed per vector tile.** Each line is clipped to the tile (8192 units), a clipped line starts at half the spacing, any other at (label length / 2 + 2 em) x box scale; an icon's box scale uses the default text-size 16 even with no text. Text labels are dropped where the line turns more than text-max-angle within 3/5 em. Collisions go tile by tile, bottom row first, right to left. Ported in `tile-server/symbols.mjs`; walking the merged line across tiles put cliff teeth and contour labels in the wrong places (13 -> 5).
- **Circle strokes are anti-aliased inside the ring.** MapLibre's circle shader smooths both edges inward (its blur is negative), so an SVG ring must be centred half a pixel inside `radius + stroke/2` (r + 0.5 for a 2 px stroke). Mound detector difference 11 -> 2.
- **Semi-transparent lines of one layer**: drawing each contour as its own SVG path (overlaps add up) is slightly closer to MapLibre than one path for all (painted once as a union): 5.25 -> 5.0 on dense LRM contours.

**How to apply:** when a direct-engine overlay differs from the app, compare a crop of both before blaming placement; check AA geometry and per-tile placement first. Related: [[terrain-source-schema-unification]].
