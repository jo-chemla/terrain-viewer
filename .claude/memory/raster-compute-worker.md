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

## Third pass (2026-11-17, later): encode, yields, remaining loops

Median ms per 512 px tile, warm caches, native timers (agent preview), all
byte-identical to the old output (FNV hash of the pixels):

| Mode | Before | After |
|---|---|---|
| Blobness / eigen-ratio | 325 | 50 |
| DEM difference (512 / 256 px) | 142 / 33 | 30 / 6.5 |
| LRM r16 / r64 | 58 / 55 | 15 / 14 |
| Slope | 75 | 40 |
| Hard Shadows r64 | 280 | 122 |
| Curvature combined / TPI | 42 / 42 | 23 / 20 |
| Curvature profile / shape index | 73 / 83 | 59 / 66 |
| Aspect, threshold, iso-band | about the same (within noise) |

- **Pixel encode**: four clamped byte stores (plus an fmod for Terrarium green)
  cost 13.5 ms per tile; `writeTerrariumPx` / `writeTerrainrgbPx` / `terrariumTile`
  in elevation-encoding.ts write one Uint32 for in-range values (3.9 ms) and
  fall back to the clamped path for out-of-range or NaN, so saturation is unchanged.
- **Yields**: `setTimeout(0)` is clamped to 4 ms once nested, so 32 yields per
  tile were about 130-150 ms of waiting (Blobness, Shadows, and the main-thread
  SVF / Openness / Local Dominance paths). `yieldToMainThread` now uses
  `scheduler.yield()`, else a MessageChannel. The earlier tables here were
  timed with timers patched to microtasks, so they never showed this.
- Blobness: Horn gradient once per cell into two Float64 grids, then nine
  products per pixel (was 72 closure reads). runWindowedProtocol is gone.
- LRM and demdiff: per-column and per-row bilinear tables (`sampleOperandTile`).
  Slope uses the shared `fetchPaddedElevationGrid` (so a WMS gets one GetMap).
- Decode: `willReadFrequently` on the decode canvas (4 to 2 ms per tile).
- COG colour function writes bytes in place (5.4 to 3.6 ms per 256 px tile;
  the rest is the library making two subarrays per pixel).
- Timing at the 10-20 ms scale is noisy here (run to run ±30%, JIT state
  depends on which modes ran before); trust only large ratios.
- Not done: iso-band box blur (number[] arrays, ~90 ms at smooth 4), VRT read
  path (already an approximating transformer; network bound), LERC and
  quantized-mesh encodes (256 px, about 1 ms).

## demdiff and iso-band (2026-11-17, evening)

- demdiff is NOT in the worker pool and does not need it: its compute is 6 ms
  per 256 px tile. Its real cost was fetchOperand walking down from z to the
  coarse operand's deepest tile one failed request at a time (misses are not
  cached, so every tile paid it every time): 103 / 196 / 284 ms warm at 1 / 2 / 3
  levels past the coarse maxzoom. buildDemDiffUrl now writes each operand's
  maxzoom in the size segment ("256~1~0~16~15") and the protocol starts at
  max(tile-size depth, z - maxzoom): 6-10 ms. region-readers.ts's regex
  tolerates the suffix (it rejected "256~2~0" before).
- Iso-band box blur: running sum on Float64Array, 84 to 38 ms (r4), 202 to 45
  (r16). Not bit-identical (25 of 50 tiles identical, the rest a few vertices by
  one tile unit; exact ties at the threshold can flip).
- VRT (COP30, direct handler call): first tile 3.9 s (XML index), a fresh tile
  about 280 ms, the same tile again 80-140 ms with the handler's own caches
  warm. That 80 ms of local work per tile is unprofiled.
