---
name: handoff-catalogue-search
description: Handoff after the 2026-09-14..16 sprint (library, coverage overlays, STAC search, ELI/QMS search, OpenFreeMap Liberty) — what shipped, what is unverified in a real browser, what was deliberately deferred
metadata:
  type: project
---

Written 2026-09-16 for the next agent. Everything below is on `main` of both
remotes (jo-chemla and Iconem, see [[git-remotes]]), last commit `f8648a8`.
Tree clean, no temp files, `tsc` and `vite build` green for app and docs.

## What shipped (see CHANGELOG.md, two top entries)

- Library (was "Sample"): `components/TerrainControlPanel/sample-sources-modal.tsx`,
  graded vs Mapterhorn via `lib/mapterhorn-compare.ts` with `resolutionM` /
  `bulkResolutionM` per entry in `lib/custom-sources.json`.
- Coverage overlays: `lib/coverage-overlays.ts` (tree model + feature loaders),
  `components/LayersAndSources/CoverageOverlayLayer.tsx` (per-view render,
  hover, click modal with "Use as terrain/basemap"), picker in
  `SourceInfoSection.tsx`, "use" request applied by
  `lib/use-coverage-use-request.ts` from `TerrainControlPanel`.
- STAC search (beta flag `stacSearch` in `betaEnabledAtom`):
  `components/TerrainControlPanel/stac-search-panel.tsx` — presets, API /
  static crawl / federated discovery, titiler pin for declared non-3857
  assets, cloud cover, xyz web-map-links at collection level.
- Basemap catalogue search: `nextgis-qms-search-modal.tsx`, `eli-search-panel.tsx`
  (`@osm-editor-kit/maplibre-editor-layer-index`, bumped weekly by
  `.github/dependabot.yml` — merge those PRs).
- OSM basemap = OpenFreeMap Liberty: `components/LayersAndSources/VectorBasemapLayer.tsx`
  (installs glyphs/sprite, layers at `LAYER_SLOTS.BASEMAP`, 3D toggle
  `osmBuildings3dAtom`, follows basemap visibility/opacity).
- Docs: `docs/content/docs/features/coverage-overlays.mdx`, catalogue section
  in `byod.mdx`, changelog page ToC built from CHANGELOG.md
  (`changelogToc()` in `docs/src/components/changelog-list.tsx`).

## Unverified in a real browser (agent preview only, or not at all)

1. STAC collection listing after the last guard rewrite (`skipFirstListing`
   ref) under React StrictMode dev double-invocation — the previous two
   guards each stranded the "Listing collections…" spinner. Verified once in
   the agent preview (OAM listed, search returned 50). Re-check the MAAP
   federation (6 pages, ~8 s first page) in dev AND prod build.
2. Docs changelog ToC: `DocsPage toc={changelogToc()}` with runtime `h3 id`s
   — fumadocs' active-heading highlight should work off the ids; not seen
   rendered.
3. OpenFreeMap Liberty: did not render in the agent preview (blank canvas,
   1 FPS). User's own screenshot shows it working with 3D buildings.
4. Coverage click modal "Use as …" for ELI leaves (creates a basemap via
   `getLayerHydrated`) — code path untested.

## Deliberately deferred

- WMTS web-map-links (NASA VEDA → GIBS): needs a WMTS capabilities parser
  (tile matrix set + resource URL template); only xyz links are consumed.
- Planetary Computer (SAS signing) and Copernicus Data Space (auth) STAC.
- Basemap COGs through titiler get no `nodata=` override (terrain does).
- Library coverage = declared `bounds` bboxes, not survey footprints.
- Terra Draw editing on secondary views (only read-only mirror,
  `DrawingMirrorLayer.tsx`).
- Reusing an existing React STAC browser instead of growing
  `stac-search-panel.tsx` (~560 lines) — see [[stac-browser-components]].
- Registry-fed catalogue lists (stacindex / Portolan) for the STAC panel.

## Gotchas learned this sprint

- Base UI `Tooltip` trigger: passing an explicit `id` to the trigger span
  kills the tooltip (aria id override) — cost the basemap Library button.
- Base UI `Select` popup with hundreds of long items flew to the screen
  corner: pin `SelectContent` width to `--anchor-width`, truncate items.
- react-map-gl `<Layer>` waits for its source: the raster basemap layer stays
  dormant for "osm" (vector) and "none" without special-casing.
- Effects that mark themselves done via state or a ref can cancel their own
  fetch on re-run — keep listing effects idempotent (see item 1 above).
- Adding several sources from one open dialog needs functional atom updates
  (`setX((prev) => …)`), the captured list is one add stale.
- Bash heredocs keep failing in this environment; write Python patch scripts
  with the Write tool and run them.
