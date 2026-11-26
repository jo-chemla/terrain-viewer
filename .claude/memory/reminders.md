---
name: reminders
description: Things the user asked to be reminded of at the start of a session - check the dates and bring them up
type: feedback
---

# Reminders (bring up at the start of a session, then prune)

- **Upstream blend modes: merged 2026-11-26.** maplibre-style-spec 2017
  (released in 26.11.0) and maplibre-gl-js 9143 (merged as 7a6c543, with
  the spec bump) add ten W3C modes to fill-, line- and raster-layer-blend.
  They reach the app with the gl-js release after 6.19 and an upgrade from
  6.13 (ask Jonathan before upgrading). Known defect to send upstream when
  he says so: `color` mode over a fully transparent backdrop with a grey
  source gives black (a 0/0 in clipColor of layer_composite.fragment.glsl;
  guard the two divisions). The impasto CORS request: draft it, he posts.
- **Next, Jonathan's order of 2026-11-19**: drawing on secondary views
  (B..H) is done ([[terra-draw-multi-map-adapter]]); then the MCP app
  (.claude/memory/mcp-apps-plan.md), the Umami website swap, the impasto
  request; later, evaluate Moon LOLA and feat-stac-maxar (Maxar, Nearmap,
  Vexcel). The view-A-only tools (Elevation Picker, Sun Shadow Calculator,
  Tells, timeline) are on every view since 2026-11-19; what still reads
  view A: the minimap, the Tells freeze, export and statistics. WMTS, Copernicus Data Space and Library Browse
  are done (2026-11-14). Dropped by Jonathan 2026-11-15, do not raise
  again: canopy height (GEDI, no browser-readable endpoint) and the slight
  Sentinel-2 shift.
- **MapLibre 6.18 layer blend modes** (maplibre-gl-js #48, closed by #8073
  and #8986, 2026-11): native per-layer blending (multiply, screen, ...).
  We are on 6.13; candidate uses: hillshade multiplied over the basemap
  instead of opacity, viz modes combined in one map, the split blend
  without the CSS mix-blend-mode across canvases. Plan written: docs/content/docs/dev/layer-blend-modes.mdx. Not started; raised by
  Jonathan as exciting, ask before upgrading. The #48 answer came 2026-11-15
  (clipping is a separate style-spec proposal, which Jonathan may write);
  still not started.
- **Moon LOLA**: branch `moon-lola` on both remotes (the only one kept; the old-history t3code branch was deleted 2026-11-15), set aside by Jonathan
  2026-11-14; do not merge until he asks.
- **Git history purge**: done on both remotes 2026-11-13 (see
  [[history-rewrite-2026-11-13]]). Jonathan will clean up his local branches
  left on the old history; never push from them.
- Open since 2026-10-09: **backlinks** have no API; ask Jonathan for a
  manual export of the Search Console Links report when they matter.
- **Umami website swap**, when Jonathan decides: a NEW Umami website id, because
  someone's old clone on localhost still sends events with the current id
  and eats the 100k monthly quota (see [[umami-analytics]]). The id goes
  into `VITE_UMAMI_WEBSITE_ID` (.env and the ENV_FILE_CONTENT secret, which
  only he edits), then the old website is deleted. Not about dropping the historical
  host.
- Done, do not raise again: the historical host is a Search Console property
  (both hosts answer scripts/search-console.mjs, 2026-11-13); the demo
  re-cut (video/src/Demo3.tsx, takes up to basic-modes-v8 on the
  `demo-takes` release).

**Why:** the user asked "remind me about this next time and tomorrow".
**How to apply:** mention open reminders in the first reply of a session;
remove them once done.
