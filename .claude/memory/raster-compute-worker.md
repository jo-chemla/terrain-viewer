---
name: raster-compute-worker
description: Horizon kernel (SVF, Openness) rewrite and the opt-in "Raster Compute in a Worker" pool (2026-11-16); timings, why MapLibre's own workers cannot host raster protocols
type: project
---

- `lib/horizon-kernel.ts` holds the SVF/Openness pixel loop, import-free so it
  runs on the main thread and in `lib/raster-compute-worker.ts`. Per tile it
  precomputes ray offsets and 1/distance, keeps the max elevation/distance ratio
  and takes one atan per direction. Pixel-identical to the old loop (max
  difference 0 on 4 configurations, Mapterhorn z12/2133/1442).
- `lib/raster-compute-pool.ts`: up to 4 dedicated workers (cores - 2), gated by
  `rasterComputeWorkerAtom` (Settings, Streaming, default off), mirrored by
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

**Why:** the user asked whether worker offload was worth it for LRM, SVF and openness.
**How to apply:** local-dominance-protocol.ts and other windowed modes share the
old per-pixel-closure pattern; the same rewrite would likely pay off there.
