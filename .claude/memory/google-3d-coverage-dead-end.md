---
name: google-3d-coverage-dead-end
description: Why Google 3D coverage cannot be derived from the Photorealistic 3D Tiles tree the way Bing's was, and what would actually unblock it
metadata:
  type: project
---

**Do not try to build a Google 3D coverage overlay from `tile.googleapis.com`
again.** It has been attempted twice and the tileset does not carry the answer.
Measured 2026-09-23 with `docs/scripts/probe-google-3d-detail.mjs`.

**Why the Bing trick does not transfer.** Bing's 3D tileset is implicit-tiled,
so a subtree binary's `contentAvailability` bitstream is literally a list of
which tiles have mesh — that is what `docs/scripts/build-bing-3d-coverage.mjs`
reads. Google's is explicit 3D Tiles 1.0: a node either exists or it does not,
and there is no availability structure. The natural substitute, "how deep does
the tree refine here", looked convincing on a first probe and is wrong:

| place | deepest node | geometric error |
|---|---|---|
| Paris (Eiffel) | depth 20 | 2 m |
| Kinshasa | depth 20 | 2 m |
| **rural Nepal** | **depth 20** | **2 m** |
| Sahara | depth 16 | 32 m |

Rural Nepal refines exactly as far as central Paris. Google's tileset is
satellite-derived 3D nearly everywhere, not "cities plus coarse terrain"; only
true desert stops early. The "2500 cities in 49 countries" figure describes
where the *aerial* mesh is, and the tree does not mark it.

**No dataset id to separate them either.** Every node at every depth and
location probed is `/v1/3dtiles/datasets/CgIYAQ/files/...`.

**Cost rules it out regardless.** Sub-tileset JSONs sit at depths 4, 8, 12, …,
so a global crawl pays one request per node at every fourth level: 88 at depth
4, 21 848 at depth 8 (113 s at ~190 req/s — the API is NOT rate-limited to
1/s, an earlier note said otherwise), and an extrapolated ~3 million at depth
12. Reaching depth 20 over one 400 m window costs 545 requests.

**What would actually work.** Google Earth's own "3D buildings where available"
toggle draws a vector coverage layer from
`www.google.com/maps/vt/proto/bpb=<protobuf>` — Jonathan counted ~142 small
requests for the whole world, which is the right order of magnitude for a
global coverage layer. Every payload shape guessed for that endpoint returns
HTTP 400 (the `?pb=` form of `/maps/vt` works and returns raster PNG, so the
host and the `!1m5!1m4!1i{z}!2i{x}!3i{y}` encoding are right; the `bpb` message
is a different one). **One real request captured from a browser network tab
unblocks this entirely** — ask for it rather than guessing again.

Related: [[national-terrain-sources]], and `lib/coverage-overlays.ts` for how
the Bing overlay that DID work is wired.
