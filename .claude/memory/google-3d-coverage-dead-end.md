---
name: google-3d-coverage-dead-end
description: Google 3D coverage - why the 3D Tiles tree cannot answer it, and the Google Earth bpb layer that can
metadata:
  type: project
---

**Solved, but not the way it looks like it should be.** The overlay is built by
`docs/scripts/build-google-3d-coverage.mjs`; this note is why the obvious route
fails, so nobody tries it a third time.

## The 3D Tiles tree cannot answer it

Bing's tileset is implicit-tiled, so a subtree's `contentAvailability` bitstream
literally lists which tiles have mesh — that is what
`build-bing-3d-coverage.mjs` reads. Google's is explicit 3D Tiles 1.0: a node
exists or it does not, with no availability structure. The natural substitute,
"how deep does the tree refine", is wrong (measured with
`docs/scripts/probe-google-3d-detail.mjs`):

| place | deepest node | geometric error |
|---|---|---|
| Paris (Eiffel) | depth 20 | 2 m |
| **rural Nepal** | **depth 20** | **2 m** |
| Sahara | depth 16 | 32 m |

Depth tracks imagery resolution, not photogrammetry. Everything is one dataset
id (`/v1/3dtiles/datasets/CgIYAQ/files/...`), and a global crawl costs millions
of requests (21 848 sub-tileset JSONs just to reach depth 8; the API is *not*
rate-limited to 1/s as an earlier note claimed — 190 req/s measured).

Jonathan separately confirmed glb *size* works as a signal (level-18 leaves:
Paris 193 KB, NYC 217 KB against 12–18 KB for draped terrain) but the server
ignores `Range` on glbs, so probing means downloading them: a global level-12
scan would be tens of GB.

## What does work: Google Earth's own coverage layer

`www.google.com/maps/vt/proto/bpb=<protobuf>`, the layer Earth draws for "3D
buildings where available". Decoding one captured request gave the message
shape (tile coords in field 1, two layer entries in field 2 — `"m"` and
`"ml:xsr:c:<149-char token>"`). Three things make it usable:

- **`&token=` is not validated.** It looks like the anti-abuse checksum; the
  endpoint answers identically with a wrong token, no token, or `token=0`.
- Only field 1 changes per tile; everything else replays byte for byte.
- **The response SIZE is the answer** — no need to decode the payload, which is
  7.97 bits/byte entropy and defeats every standard decompressor. An empty tile
  collapses to a fixed stub (132 bytes at z10); a covered one is thousands.
  Counter-intuitively the stub is *smaller* than a base-map-only response for
  the same tile, so the coverage layer suppresses the base map rather than
  adding to it, which is what makes the size test clean.

Hierarchical crawl z4→z10: **19 060 requests, 42 s, 6 548 covered cells, 472
polygons**. Verified 19/19 against known places, including the five Normandy
cities Jonathan saw on Google's official layer, and negatives at Moscow,
Nairobi, Timbuktu and Uluru.

**Limits.** z10 is the floor: at z12 central Paris is 261 bytes against 187 for
farmland 60 km away. At ~39 km cells adjacent cities merge, so western Europe
is one polygon. The `ml:xsr:c:` token is from a captured request and may rotate;
re-capture from earth.google.com's network tab if the script stops working.

## The official dataset layer, and why it is not used here

Google's coverage page embeds `maps-docs-team.web.app/samples/3d-coverage-map/`,
which is a Maps JS `getDatasetFeatureLayer('bcf6598c-…')` on map id
`ccfdf8d031b6b83cc90ddc70`, updated daily. It renders with any key and gives a
point-in-coverage oracle, but the geometry arrives over gRPC-web
`MapsJsInternalService/GetViewportInfo` as Google's internal proto — so
extracting polygons needs the Maps JS library plus screen-scraping, which a
build script cannot do. Useful as ground truth, not as a source.

Related: [[national-terrain-sources]]; `lib/coverage-overlays.ts` wires all
three 3D overlays.
