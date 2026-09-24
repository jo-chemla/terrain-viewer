---
name: google-3d-coverage-dead-end
description: Google 3D coverage — the one endpoint that answers it (Maps vector tiles of Google's own coverage layer), the non-zigzag delta rule that cost two days, the shipped pipeline, and every route tried and rejected
metadata:
  type: project
---

**Shipped (2026-09-24):** `public/coverage/google-3d.geojson`, z8 of Google's
own coverage layer, decoded and dissolved — 1 601 polygons, 0.99 MB, ~1 min
to reproduce (`GOOGLE_KEY=… pnpm google-3d-fetch && pnpm google-3d-dissolve`).
Central Paris 97 % of its tile, the Paris window one polygon of 2 894 km²,
20/20 on a city checklist. Full write-up with timings and paths:
`/docs/features/coverage-overlays`.

## The source that works

Google's Photorealistic 3D Tiles coverage page embeds a Maps JS *dataset
layer*; the same layer is served as ordinary Maps vector tiles from
`maps.googleapis.com/maps/vt?pb=…` under a layer id `ml:xs:c:…` that
`mapConfigs:batchGet` mints from a plain API key (map id
`ccfdf8d031b6b83cc90ddc70`). Tile body = XOR 0x9b, then a protobuf of a
pre‑triangulated mesh on an 8 192 grid. Empty tile = 36‑byte stub.
Google Earth's own "3D buildings where available" layer (`ml:xsr:c:…`, from
any captured Earth `bpb=` request) rides the same endpoint with **no key**
(`fetch --layer-id`) and gives blockier per‑region blobs.

## The bug that cost two days: the delta rule is NOT protobuf zigzag

Vertex stream = absolute `x0,y0`, then deltas. The deltas are **`v` for even,
`−(v+1)` for odd** (equivalently `2·zigzag(v)`). Using standard zigzag
(`v/2`, `−(v+1)/2`) deflates every polygon 2× about its first vertex, and
that produced every symptom that was then misread as a data property:
each zoom covering (½)² ≈ 25 % of central Paris ("generalised per zoom"),
unions of zooms growing and never converging ("per‑tile budget", then
"sharded across zooms"), London and San Francisco testing outside ("gaps in
Google's layer" — retracted). Jonathan spotted the 2× from the polygon
shapes in kepler.gl; a second agent found the same rule independently.

**Oracle that settles it in one run:** decode a tile and its four children
and take the Jaccard of the two renderings. Correct rule: 1.00 at 96 % of
the tile; zigzag: 0.32 at 23 %; every other variant (coords ×½, y‑flip, x/y
swap, zigzag‑first, no‑zigzag) 0.04–0.31. `.cache/` scratch scripts are
gone, but the test is five lines around `meshToRings`. Lesson: when a
per‑zoom measurement lands on a suspiciously round fraction, test the
decoder against itself across zooms before theorising about the data.

Decoded correctly the layer is ordinary: z5…z12 each give ~2.05 Mkm²
worldwide and 91–96 % of that tile. **One zoom is enough.** z8 = z9 = z10
within 0.2 %.

## Pipeline (docs/scripts)

`google3d-coverage.ts fetch` (hierarchical crawl z5→z8, 4 120 requests,
32 MB, ~10 s; `--zoom N` on decode picks any level a crawl left on disk) →
`decode --zoom 8` (XOR, protobuf, triangles → rings by cancelling shared
edges; zero‑area triangles count; keep the ~0.7 % overshoot, never clamp to
the tile box) → `dissolve-google-3d-coverage.mjs` (snap to 3 decimals and
clean, drop <1 000 m², 5° buckets, chunked union then pairwise tree‑merge
until nothing merges, drop holes <1 km², simplify 500 m, truncate, re‑node
by self‑union, drop rings <1 km²). Two union bugs fixed along the way and
documented in that script's header: polygon‑clipping throws on raw
coordinates and a fallback once returned unmerged halves; and the merge
loop's rotated pairing must not stop after a fruitless odd pass.

## Routes tried and rejected — do not re‑derive

- **3D Tiles API depth** (`probe-google-3d-detail.mjs`): refines to 2 m over
  rural Nepal exactly as over Paris. Depth tracks imagery, not photogrammetry.
  One dataset id, millions of requests for a world walk.
- **glb size** works as a signal (Paris 193 KB vs 12–18 KB draped terrain)
  but the server ignores Range on glbs: tens of GB for a level‑12 scan.
- **Response‑size probe of Earth's bpb layer** (`build-google-3d-coverage.mjs`):
  keyless, ~39 km cells, interior tiles encode little so no byte threshold
  separates London from countryside. Kept only as the fallback if the layer
  id minting stops.
- **Rasterising** the Maps raster endpoint with the layer appended, or
  screenshotting the Maps JS dataset layer: both work, both ruled out by
  Jonathan; recorded in git history of this file if ever wanted.
- **Unioning many zoom levels** as a workaround: unnecessary once the delta
  rule is right; it was compensating for the deflation.

Related: [[esri-3d-coverage]], [[national-terrain-sources]];
`lib/coverage-overlays.ts` wires all four 3D overlays.
