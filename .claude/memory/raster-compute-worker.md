---
name: raster-compute-worker
description: Viz-mode kernel rewrites (SVF, Openness, shadow, local dominance, 3x3 runner, padded-grid stitch) and the opt-in "Raster Compute in a Worker" pool (2026-11-16); timings, why MapLibre's own workers cannot host raster protocols
type: project
---

- `lib/horizon-kernel.ts` holds the SVF/Openness pixel loop, import-free so it
  runs on the main thread and in `lib/raster-compute-worker.ts`. Per tile it
  precomputes ray offsets and 1/distance, keeps the max elevation/distance ratio
  and takes one atan per direction. Pixel-identical to the old loop (max
  difference 0 on 4 configurations, Mapterhorn z12/2133/1442).
- `lib/raster-compute-pool.ts`: up to 4 dedicated workers (cores - 2), gated by
  `rasterComputeWorkerAtom` (Settings, Streaming, on by default since 2026-11-17), mirrored by
  TerrainViewer.tsx. DEM fetch and decode stay on the main thread; grids are
  copied in (they may be cached), pixels transferred back.
- MapLibre requests raster tiles from the main thread, so registering a raster
  protocol inside MapLibre's workers (the [[contour-worker]] route) does not work
  for viz modes.

Timings, 512 px tile, warm caches, agent preview browser (per tile, ms):

| Mode | Old | New main | New worker |
|---|---|---|---|
| SVF r8 precise | 3772 | 594 | 590 |
| SVF r32 precise | 10399 | 1259 | 1190 |
| SVF r32 fast | 5877 | 1978 | 1856 |
| Openness r8 negative | 3791 | 443 | 418 |
| LRM r16 / r64 | 77 | (unchanged) | not offloaded |

Four SVF r8 tiles at once: 2401 ms on the main thread, 714 ms in the pool;
longest main-thread stall 575 ms vs 262 ms.

- "fast" precision is now SLOWER than "precise" at r32 (far rings cost 24
  bilinear samples per ring per pixel). Worth revisiting before anyone tunes it.
- LRM is one bilinear pass over an ancestor tile, about 77 ms per tile: not worth a worker.
- Timing gotcha: the horizon loop yields with setTimeout(0); a hidden preview
  tab throttles those, so patch zero-delay setTimeout to a microtask when timing.

## Second pass (2026-11-17): every per-pixel loop

Same rule everywhere: build per-tile constants once, nothing allocated per
pixel, no string keys in hot loops. All pixel-identical (0 differing pixels).

| Mode (512 px, warm) | Before | After |
|---|---|---|
| Hard Shadows r64 / r16 | 1349 / 368 | 89 / 28 (tan(altitude) compare, early exit) |
| Local Dominance 8-32 | 1344 | ~600-770 (kernel in lib/local-dominance-kernel.ts, also in the pool) |
| Curvature / TPI / TRI / Roughness | 86-121 | 26-40 (one reused ElevationWindow) |
| Aspect | 120 | 45 (Horn inlined) |
| Slope (own stitch) | ~90 | ~70 |
| Blobness | 183 | 159 (closures in hornGradientAt left as is) |

- fetchPaddedElevationGrid stitching cost ~44 ms per tile for every mode (a
  template-string Map lookup per pixel); now resolves the 9 tiles once and copies
  row spans. writeTerrarium (elevation-encoding.ts) replaces elevationToTerrarium in loops.

**Why:** the user asked whether worker offload was worth it for LRM, SVF and openness.
**How to apply:** local-dominance-protocol.ts and other windowed modes share the
old per-pixel-closure pattern; the same rewrite would likely pay off there.
