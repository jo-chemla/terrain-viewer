---
name: maplibre-613-drape
description: MapLibre 6.13 lets custom layers draw into terrain tiles (renderToTerrainTile, terrainTileRevision, renderTerrainHeightMap) - the planned route for Allmaps on 3D terrain at any pitch, and for draping live Phong/Matcap and building shadows
type: project
---

# MapLibre 6.13 custom-layer draping (noted 2026-10-07)

The app runs maplibre-gl 6.13.0 since 2026-10-07. PR #8588 (experimental)
adds `CustomLayerInterface.renderToTerrainTile(gl, { tileID, width, height })`
(called instead of `render` while terrain is on; clip space is the tile),
`terrainTileRevision` (bump + triggerRepaint to redraw the drape), and
`renderTerrainHeightMap(target)` in prerender's args. Nothing uses it yet.

Planned order (docs/content/docs/dev/draping.mdx has the detail):
1. Allmaps: wrap WarpedMapLayer, render a flat Viewport per terrain tile.
   Gotchas in @allmaps/render WebGL2Renderer: `#renderInternal` calls
   `gl.viewport(0,0,canvas.width,canvas.height)` (pin to the tile size during
   the call) and visible-tile fetching follows the last viewport rendered
   (keep it driven by the main view in prerender). Removes the allmaps.xyz
   fallback in 3D; 2D (no terrain) keeps it. See [[allmaps-overlays]].
2. PhongLiveGlLayer / MatcapLiveGlLayer: draw per terrain tile instead of own
   meshes with skirts; bump terrainTileRevision on camera moves for the
   view-dependent terms.
3. BuildingShadowLayer: same.

**Why:** the user pointed at 6.13 for the Phong/Matcap renders; the Allmaps
pitch problem is the most visible win.
**How to apply:** start with Allmaps behind a flag; the API is experimental,
so pin the MapLibre version while it is used.
