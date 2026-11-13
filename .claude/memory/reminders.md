---
name: reminders
description: Things the user asked to be reminded of at the start of a session - check the dates and bring them up
type: feedback
---

# Reminders (bring up at the start of a session, then prune)

- **Upstream requests**, checked against GitHub on 2026-11-13: everything on
  the docs page (docs/content/docs/dev/upstream-requests.mdx) is posted
  except two: the follow-up comment on maplibre-contour issue 434 (no
  comment there yet) and the Allmaps "plain images as a resource" request (no
  issue on allmaps/allmaps). The Planet OAuth post was dropped 2026-11-13. Mapterhorn
  issue 27 was commented 2026-10-29. The impasto CORS request is "not to be
  sent yet" by his choice. Check with `gh search issues --author jo-chemla
  --repo <repo>` before reminding again.
- **Later, wanted by Jonathan (order set 2026-11-13)**: 1. WMTS sources
  ("soon"; also unlocks NASA VEDA/GIBS items and helps the next one),
  2. Copernicus Data Space in the catalogue search, 3. Library "Browse" per
  dataset (an entry with a `stac: { preset, collection }` opens the Add
  dialog's catalogue tab on that collection over the view; the catalog-level
  Browse button already exists in sample-sources-modal.tsx, and the handoff
  in terrain-source-section.tsx). "Another time": drawing on secondary views
  (B..H) and the MCP app (.claude/memory/mcp-apps-plan.md). Canopy height
  (GEDI-derived, Meta CHMv2 quadkey COGs): no CORS anywhere yet, nothing to
  do until a browser-readable endpoint exists.
- **MapLibre 6.18 layer blend modes** (maplibre-gl-js #48, closed by #8073
  and #8986, 2026-11): native per-layer blending (multiply, screen, ...).
  We are on 6.13; candidate uses: hillshade multiplied over the basemap
  instead of opacity, viz modes combined in one map, the split blend
  without the CSS mix-blend-mode across canvases. Plan written: docs/content/docs/dev/layer-blend-modes.mdx. Not started; raised by
  Jonathan as exciting, ask before upgrading.
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
