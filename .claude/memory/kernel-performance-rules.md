---
name: kernel-performance-rules
description: Rules for per-pixel loops (lib/*-protocol.ts, lib/*kernel*.ts, tile-server/direct.mjs) — no allocation per pixel, taps made once per tile, bit-identical checks with bench-direct.mjs
metadata:
  type: project
---

Per-pixel kernels run 65 000 (256 px) to 262 000 (512 px) times a tile, on the
main thread in the app and in the tile service's workers. Two audits
(b7c3996 for the hillshade, 2026-11-25 for the rest) found the same mistakes
costing 2x to 4x. The rules:

1. **Nothing allocated per pixel.** No `{dx, dy}` returned from a helper, no
   window object literal, no `[r, g, b]` from an encoder, no destructuring of
   a fresh array (`const [u, v] = c ? [..] : [..]`), no `.map` / `.forEach`
   over lights or channels, no closure made inside the loop. V8's escape
   analysis does not reliably remove them: inlining `hornGradient` and the
   window literal made the normals loop 2x faster (21 → 9 ms a 512 px tile).
   If a helper must hand back several numbers, refill one module-level record
   (`curvature-protocol.ts`'s `D` and `K`) or write into a scratch typed array.
2. **Whatever depends only on the column or the row is made once a tile.**
   Bilinear reads: per output column the two clamped indices and the weight,
   per row the same (`taps()` / `resampleTaps()` in direct.mjs); latitude,
   ground resolution and cos(lat) per row. A closure sampler `G(i, j)` with a
   floor and two clamps per read was most of a resample's time.
3. **Neighbouring reads share work.** The nine bilinear reads of a Horn window
   share their weights (fx ± 1 has fx's fraction): lerp across the 4x4 source
   block once per row (12 lerps, not 18), then down (direct.mjs
   `liveLighting`). Blobness computes each gradient once into a grid.
4. **Constants out of the loop**, e.g. the hillshade's `pow(base, π/2) − 1`.
5. **Keep the arithmetic, in its order, so outputs stay bit-identical.**
   `Math.hypot` is not `Math.sqrt(x² + y²)` (they differ in ~35 % of random
   cases): keep hypot where the reference (MapLibre's shader port) has it.
   `writeTerrariumPx` is byte-identical to `elevationToTerrarium` and is the
   encoder to use in loops.
6. **Measure, then compare bytes.** `tile-server/bench-direct.mjs` draws every
   mode on 16 Mont Blanc tiles; `TV_PROTOCOL_CACHE_MB=0` makes each tile run
   its kernel (otherwise most tiles are cache hits). Write `out-a/` before and
   `out-b/` after, then `--compare`: every file must be identical. For an A/B
   on a loaded machine run old and new alternately: `BENCH_DIRECT=./direct-old.mjs`
   times another copy of direct.mjs (point its `./generated/` imports at a
   copy built from the old lib). Medians move ±30 % between runs here.

Already clean (checked 2026-11-25): slope, aspect, tri, tpi, roughness,
blobness, lrm, horizon kernel (svf/openness), local dominance, shadow kernel,
phong/matcap CPU shading. Their remaining cost is the maths itself (atan per
ray, pow), not allocation. The live GL layers' CPU side has no per-pixel loop.

Vectors and per-vertex work (second audit, 2026-11-25):

7. **Bytes into a typed array, not a JS array.** `tile-server/mvt.mjs`'s
   writer pushed every byte onto a number[] and copied each sub-message
   into its parent byte by byte (four levels for a vertex): a growing
   Uint8Array with `set()` made contours 3.1 -> 1.1-1.4 ms and an interval
   iso-line 2.4-3.1 -> 0.9 ms a tile, same bytes.
8. **Large float buffers straight into a Float32Array** that doubles when
   full, not a number[] converted at the end: the building shadow sweep
   (BuildingShadowLayer.tsx `buildGeometry`, 16 central-Paris tiles, 15 M
   floats) 1250 -> 600 ms, same bytes (each double rounds to float32 the
   same either way).
9. **Where a library does the work, leave it.** The iso-line / plane slicer
   tile (`lib/isoband-protocol.ts`) is d3-contour's isorings and stitch;
   dropping the [x, y] per vertex and feeding a Float64Array made no
   measurable difference, so it was not kept. maplibre-contour and earcut
   likewise.
