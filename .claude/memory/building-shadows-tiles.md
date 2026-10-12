---
name: building-shadows-tiles
description: Building shadows fetch their own z14 OpenFreeMap tiles around the viewport (lib/building-tiles.ts); querySourceFeatures only saw the loaded z17 slices, so a tall building just off screen cast nothing and shadows ended on a straight tile line
type: project
---

Since 2026-10-12 `BuildingShadowLayer.tsx` no longer reads footprints from a
MapLibre vector source with `querySourceFeatures`. It fetches the z14
OpenFreeMap tiles itself (`lib/building-tiles.ts`: TileJSON resolved once,
`@mapbox/vector-tile` + `pbf`, an LRU of 200 decoded tiles, one in-flight
request per tile, owner-aware aborts since split views each have a layer) for
the viewport widened by `min(3 km, 600 m / tan(altitude))` on every side,
capped at 64 tiles around the centre.

**Why:** MapLibre loads only the tiles touching the viewport, and OpenFreeMap
stops at z14, so at z17 `querySourceFeatures` returned the z14 data sliced per
z17 tile (`vector_tile_overzoomed.ts`, 128/4096 buffer). A building in an
unloaded column, 40 to 650 px off screen, cast nothing, and a building cut at
the edge of the loaded set swept a straight line parallel to the tile edge
(`.cache/shadow-edge/edge2-before-after.png`). The straight edge Jonathan saw
in the docs' 17:00 Bryant Park pictures is a different thing: with the sun at
azimuth 271° every shadow's north edge is horizontal, and that edge is the
true sweep of a 131 m building on 6th Avenue (way 2653127730).

**How to apply:** the raw z14 tiles clip at 64/4096 (coordinates span -64 to
4160), MapLibre's overzoom slices at 128/4096; `isClipEdge` checks the z14
lines with 64/4096. Do not reintroduce a map source for the footprints. A lower
sun that needs tiles beyond the last range triggers a rebuild through
`setLight()`; otherwise the light is two uniforms. Scripts:
`.cache/pw/shadow-edge-shot.mjs`, `shadow-edge-url.mjs`, `decode-tile.mjs`.
