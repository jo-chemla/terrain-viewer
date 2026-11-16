---
name: live-gl-render-to-terrain-tile
description: Live Phong/Matcap GL layers drape on 3D terrain through MapLibre 6.13's renderToTerrainTile (shared base lib/live-dem-gl-layer.ts); the revision getter, LOD per terrain tile, Phong's stack-split fallback, what was deleted
type: project
---

**What (2026-11-16, branch feat/live-gl-render-to-terrain-tile).** `PhongLiveLayer`
and `MatcapLiveLayer` extend `LiveDemGlLayer` (lib/live-dem-gl-layer.ts), which owns
the Float32 DEM texture cache, the 2D path and the terrain path; the two files keep
only shading (fragment shader, uniforms, blend passes).

- Terrain off: `render()` draws covering tiles flat through `shaderData` prelude
  `projectTile` (mercator + globe), 64-cell mesh, straight onto the map, no FBO.
- Terrain on: `renderToTerrainTile` draws attribute-less quads per terrain tile.
  DEM zoom = terrain z + round(log2(rttSize/qualityFactor * dpr / tileSize)), capped
  at 3 levels (64 tiles) and at the DEM maxzoom (then an ancestor sub-rectangle); a
  loaded ancestor stands in while a tile loads. `prerender` marks the tiles every
  renderable terrain tile wants (`terrain.tileManager.getRenderableTiles()`, internal)
  so the LRU prune never drops a texture a cached drape was built from.
- `terrainTileRevision` is a GETTER: MapLibre reads it in `prepareForRender`, before
  `prerender`, so bumping it in prerender would lag a frame. It moves on
  `updateOptions`, texture/matcap-image arrival, and (view-dependent: camera-anchored
  light/matcap, Fresnel > 0) any bearing/pitch change. A revision change re-renders
  every terrain tile that frame (all stacks), so turning the camera in those modes
  redraws the whole drape per frame.
- Phong blend: pass 0 `blendFuncSeparate(ZERO, ONE_MINUS_SRC_COLOR, ONE,
  ONE_MINUS_SRC_ALPHA)` with rgb = 1 − shade, alpha = mean darkening; pass 1 add.
  Same rgb as the old DST_COLOR multiply, but it still darkens (in grey) when the
  layer starts its own terrain stack: Liberty's symbol layers sit under the BASEMAP
  slot and split the stack, so the albedo is in an earlier stack there.

**Deleted:** the 128-cell drape mesh with border skirts, the copied TERRAIN_PRELUDE /
getTerrainData plumbing, the flat-terrain fallback texture, the offscreen shade
FBO + depth renderbuffer + fullscreen composite (depth was only needed for the
drape), terrain-aware coveringTiles. Texture keys are canonical z/x/y now.

**Why:** the user asked for the port; MapLibre's own drape replaces the replica.
**How to apply:** unverified in a real browser at commit time (the agent preview
does not run rAF); checklist in the handoff. API is experimental: pin MapLibre.
See [[maplibre-613-drape]], [[building-shadows-terrain-drape]], [[phong-live-sharpness]].
