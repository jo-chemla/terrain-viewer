---
name: phong-live-sharpness
description: Why the live Phong/Matcap GL layers read softer than native hillshade, ruled-out causes, and the rework options if sharpness parity is ever pursued
metadata:
  type: project
---

Analysis from 2026-08-20 (fixes-historical branch), after the user asked why live Phong looks less detailed than MapLibre's native hillshade at the same viewport. The user may want to rework this at some point — start here, not from scratch.

## Ruled out (don't re-investigate)

- **The lighting equation.** The specular term's constant view vector (V = (0,0,1)) and any ray-divergence-from-optical-axis reasoning affect *where highlights sit*, not sharpness — a screen-constant term cannot blur anything spatially. (The matcap's old per-fragment `reflect(viewRay, N)` construction was a real bug, but that was a screen-locked *color* artifact, not a resolution one — see matcap-live-gl-layer.ts's header.)
- **Tile zoom selection**, mostly. History: the layers originally used `coveringTiles(tileSize / dpr / 2)` (two extra zoom levels on retina) for sharpness; the fixed `/2` inflated the visible tile set 4–16×, overflowed the 96-texture LRU, and caused an endless tile unload/reload churn. Current state (user-approved): `tileSize / dpr` — one extra level on hi-dpi only — plus a pruneTextures guard that never evicts tiles drawn in the current frame. Don't re-add the fixed `/2` globally; if ever needed, make it an opt-in.

## The three real softness sources (all architectural)

1. **Baked normal grid vs per-pixel derivatives.** Native hillshade computes derivatives per device pixel in the fragment shader straight from the DEM texture; the live layers bake normals into a fixed tileSize×tileSize texel grid per tile (`computeNormalPixels` → RGBA texture) — Nyquist-limited at that grid.
2. **8-bit normal quantization.** Normals are encoded `(n+1)/2` into 8-bit RGB (~1/127 steps) — flattens subtle low-slope detail.
3. **LINEAR filtering** of the normal texture adds its own smoothing on top.

## Rework options, in ascending effort

- **Opt-in sharpness zoom level** — restore an extra covering-tiles zoom level behind a setting; cheapest, revives tile-count pressure (the prune guard caps the damage).
- **Higher-precision normal encoding** — e.g. RG16/RGBA16F or split hi/lo bytes; kills source 2 only.
- **Per-fragment normals from the DEM texture in-shader** — the real native-parity fix; eliminates all three at once. Note the terrain-drape prelude already samples a DEM texture (`get_elevation` in TERRAIN_PRELUDE, from `map.terrain.getTerrainData`) — but that's MapLibre's *terrain* DEM, which may differ from the layer's own upstream source; deriving normals per fragment would need the layer's upstream DEM as a texture (upload the decoded elevation tile instead of, or alongside, the baked normal tile) plus latitude-corrected ground resolution per tile (see normals-protocol.ts's groundResolutionM usage).

## 2026-08-20 follow-up: the per-fragment fix IS implemented

Same day, the user asked for an exploration and the full native-parity option
was implemented in both live layers (initially left uncommitted for testing):

- `DEM_NORMAL_GLSL` (exported from phong-live-gl-layer.ts, spliced into both
  fragment shaders): manual-bilinear elevation reconstruction + per-fragment
  Horn gradient + `demNormal(uv, exaggeration)`.
- Data path: `computeNormalPixels` was ALREADY returning `grid` (the
  `fetchPaddedElevationGrid` product — Float32, 1-texel halo stitched from
  real neighbors), so the layers just upload `grid.padded` as an R32F
  `(n+2)²` texture (NEAREST + texelFetch — no OES_texture_float_linear
  dependency) instead of the baked RGBA8 normals. Same 4 B/texel GPU budget.
  The baked normals still ride along unused (the raster protocols need them;
  the refcounted cache/abort machinery is shared).
- Per-tile `u_invGroundRes` uniform = `1/groundResolutionM(tileCenterLat, z, n)`
  — mirrors computeNormalPixelsUncached exactly.
- CRITICAL parity detail: hornGradient has NO textbook /8 factor and its dx
  is (west−east)-signed — deliberate, every downstream consumer is
  calibrated to it. The GLSL replicates it verbatim; do not "fix" it.

This kills all three softness sources at once. Cost: 8 bilinear taps
(32 texelFetches) per fragment — fine on GPU. Halo=1 means the outermost
half-pixel of a tile clamps its outer stencil tap, same as the CPU path.

Follow-ups landed the same session (2026-08-20/21), all user-verified or
user-requested:
- **generateBorders removed** after first being added with the 128 mesh:
  the flat EXTENT/128 apron at edge-clamped elevation slices through the
  neighbor's displaced surface and double-composites → dark streaks along
  every tile seam. Same-zoom neighbors coincide exactly without it.
- **Phong live = TRUE albedo via an offscreen shade buffer + blend
  composite** (final form after two failed intermediates): tiles render
  OPAQUELY into the layer's own FBO (RGBA8 color: RGB = diffuse multiplier
  clear-colored to 1, A = specular; DEPTH_COMPONENT24 renderbuffer =
  front-most wins in-house), then two fullscreen attribute-less triangles
  composite it onto the map: blendFunc(DST_COLOR, ZERO) multiply, then
  blendFunc(ONE, ONE) specular add. Failed intermediates, do NOT retry:
  (1) blending tile meshes directly against the main framebuffer — hidden
  back-side geometry multiplies its shadow through the surface in front;
  (2) renderingMode "3d" + depth prepass against the SHARED depth buffer —
  z-fights MapLibre's own terrain mesh (different mesh/matrix precision)
  into blocky speckle. MUST restore blendFunc(ONE, ONE_MINUS_SRC_ALPHA),
  the bound FBO (save FRAMEBUFFER_BINDING — maplibre may not render into
  null), and BLEND/DEPTH_TEST enable-state. Matcap stays opaque
  premultiplied (user explicitly likes it).
- **hornGradient axis asymmetry (important!)**: dx is (west − east) —
  NEGATED vs the standard derivative — while dy is (south − north) —
  standard. So the derived normal's y is geometrically correct but its x
  points UPHILL. Every consumer is calibrated to this (phong light signs,
  Absolute matcap, slope/aspect), so never "fix" the kernel; the one place
  needing geometric truth (matcap Camera mode projecting onto real camera
  axes) negates n.x locally (nGeo). Symptom that revealed it: matcap
  under-sphere shadow on up-screen slopes when facing east/west only
  (screen-up is n.x-dominated there, n.y-dominated facing north/south).
  The matcap camera basis itself is analytic from bearing/pitch now.
- **Terrain-aware coveringTiles**: pass `terrain` (the live map.terrain,
  via spread to dodge the excess-property check — it's on
  CoveringTilesOptionsInternal, not the public type) or high-pitch views
  cull tiles whose ELEVATED relief is right in front of the camera while
  their flat footprint is outside the frustum ("tiles vanish near the
  camera" dropout).

User verdict on first test: shading sharpness ✓, but it EXPOSED the drape
mesh — the custom layers tessellated each tile at
`createTileMesh({ granularity: 8 })` (8×8 quads), which the old soft
shading had masked; under crisp per-fragment normals it read as "blocky
terrain". Follow-up fix (same session): mesh granularity now matches
MapLibre's own terrain drape mesh — `Terrain.meshSize` is a public
property, constant 128 in maplibre-gl (read live off `map.terrain` with
128 as fallback) — plus `generateBorders: true` (a thin EXTENT/128 apron,
~half a mesh cell, hiding cracks between adjacent tiles). Since the vertex
shader displaces through the SAME get_elevation()/getTerrainData DEM
texture MapLibre's terrain.vertex.glsl samples, equal mesh density ⇒ the
same surface MapLibre natively draws — this IS the "reuse MapLibre's
terrain geometry mechanism" answer; the geometry buffers themselves aren't
publicly reachable, but replicating (samplers + meshSize) is exact.
Indices auto-size (129²+borders ≈ 17k verts still fits 16-bit; both layers
branch on mesh.uses32bitIndices either way).

**Why:** avoids re-deriving this diagnosis and re-tripping the churn regression on the next sharpness attempt.
**How to apply:** if asked to "make live phong/matcap sharper" beyond this, the remaining lever is the opt-in extra zoom level; keep the pruneTextures current-frame guard and never reintroduce an unconditional multi-level zoom bump. Related: [[camera-sync]].
