---
name: handoff-maplibre-v6
description: State of the maplibre-v6 branch (MapLibre 6.11.2 port, 2026-09-24) — what is fixed and verified, what is open (live GL tile seams, pose animation, hypso/orbit re-checks), and the Playwright harness under .cache/pw
metadata:
  type: project
---

**Merged**: PR #11 into main and deployed to prod; see [[handoff-2026-09-25]] for current state.
Historical below: branch `maplibre-v6`, pushed to both remotes 2026-09-24, six commits ahead
of main at the time. See [[camera-sync-architecture]] for the 6 camera
findings and docs `dev/tech-stack`, `dev/camera-sync`, `dev/lighting-effects`.

## Verified (headless Playwright, 82-scenario matrix vs a MapLibre 5 baseline)

All viz modes, contours, graticules, COG/LERC/WMS/VRT/quantized-mesh/nDSM
sources, grids, overlay, historical timeline, coverage overlays, tells, tour.
Camera lands on the link's zoom and centre in every scenario. Production
build passes with the worker chunk. Hypso auto range (2D and 3D), per-view
pills in terrain-mode grids, globe switch with graticules, Wayback spinner.

## Open, needs a real browser or GPU work

- **Tile seams on the live GL layers (matcap, phong) on the globe**: white
  dashes along tile edges. Reproduced headless. NOT terrain skirts
  (`terrainSkirtLength: 0` changed nothing, reverted). It is the layers'
  own tile meshes in `lib/matcap-live-gl-layer.ts` / `phong-live-gl-layer.ts`
  meeting 6's DEM texture/border handling. Raster mode is seam-free.
- **Pose animation**: now `jumpTo` with a held `elevation` (upstream #8543,
  #8471 made every easeTo glide elevation). Headless Play never started a
  flight, so unverified. If it still bobs, check
  `map.getCenterClampedToGround()` during playback (should be false).
- Fog blend and faint SVF were user settings, not regressions.
- geogrid-maplibre-gl needs a v6 release; `ensureLegacyTransform` shims
  `map.transform` meanwhile (maintainers: `_camera` is the sanctioned route).

## Harness (gitignored, `.cache/pw/`)

`harness.mjs matrix.json <out> http://localhost:5204/ [--only=a,b]` captures
screenshot + console + probe per scenario; `diff.mjs baseline-v5 <out>
--threshold=0.3` pixel-diffs the map area and lists probe deltas.
`baseline-v5/` is the MapLibre 5 capture; keep it. Dev server for this
worktree: `DEVTOOLS_EVENT_BUS_PORT=42171 DOCS_PORT=3101 pnpm app --port 5204`.
Dev-only `RangeError` page errors come from react-refresh, not the app.
