---
name: building-shadows-terrain-drape
description: Building shadows drape on 3D terrain through MapLibre 6.13's experimental renderToTerrainTile hook (per-tile mask in the tile's clip space, terrainTileRevision bumped on geometry, light and colour changes); how it was verified headless and what is still flat
type: project
---

**What (2026-10-15).** `ShadowLayer` (components/LayersAndSources/BuildingShadowLayer.tsx)
implements `renderToTerrainTile(gl, {tileID, width, height})`: with terrain on
MapLibre calls it per terrain tile instead of `render()`, with the tile's
framebuffer bound and clip (-1,-1) at the tile's south-west corner. The sweep
geometry is Mercator relative to its origin, so the matrix is a scale and
offset from the tile's Mercator bounds (composed in float64, stored float32).
The mask still goes through an offscreen texture (a per-tile one, R8) so
overlapping sweeps never darken twice, then is composited into the tile with
the same blend as on screen. `terrainTileRevision` is bumped on rebuild, on
setLight and when the colour or opacity changes, before triggerRepaint.

**Why:** Jonathan asked for the shadows on terrain after the 8588 comment; the
hook is experimental in 6.13 so the API may move (a small rework, not a reason
to wait).

**How to apply / verify:** headless with agent-browser on the GPU (the T3
preview cannot render MapLibre): open the dev app with
`viewMode=3d&showLightingEffects=true&showBuildingShadows=true&buildingShadowOpacity=0.8&illuminationAlt=22`
over San Francisco (zoom 17.3, pitch 55), read
`map.getLayer('osm-building-shadows').implementation.renderToTerrainTile` and
`terrainTileRevision` through `window.__tv`, screenshot, and difference against
`buildingShadowOpacity=0`. Still flat: the sweep length (flat-ground geometry),
globe (not supported by the layer), and the Phong/Matcap layers, which drape
through their own copy of the terrain prelude and are view-dependent, so they
wait for the per-frame answer asked on 8588. See also [[agent-browser-recording]].
