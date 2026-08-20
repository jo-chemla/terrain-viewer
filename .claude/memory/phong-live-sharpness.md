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

**Why:** avoids re-deriving this diagnosis and re-tripping the churn regression on the next sharpness attempt.
**How to apply:** if asked to "make live phong/matcap sharper," pick from the options above; keep the pruneTextures current-frame guard and never reintroduce an unconditional multi-level zoom bump. Related: [[camera-sync]].
