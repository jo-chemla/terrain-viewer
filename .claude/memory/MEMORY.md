# Project Memory Index

- [Camera sync architecture](camera-sync.md) — PR #10 fixes: elevation as 6th camera param, recalculateZoomAndCenter settle, _elevationFreeze wart, drag-eaten-by-stop, dead ends
- [Docs screenshots context](screenshots-context.md) — Playwright setup/gotchas for capturing real docs screenshots, URL/lightbox conventions, docs-update branch history
- [docs-update handoff](handoff-docs-update.md) — current state for a fresh agent picking up the docs-update branch: what's done, deliberately deferred, and the one known-unresolved app bug
- [Phong/Matcap live-layer sharpness](phong-live-sharpness.md) — why live phong reads softer than native hillshade (baked 8-bit normal grid, not the lighting equation), the tile-churn regression to avoid, and the rework options
- [Embed bridge](embed-bridge.md) — meta-app iframe→wrapper state sync: 1 Hz postMessage poll, why not history patching or same-origin DNS tricks, origin allowlist
- [Mobile layout frames](mobile-layout-frames.md) — one shared bottom edge: root fixed inset-0, bottom overlays absolute (never fixed), no --vh hack, isMobile = sm/640
- [National terrain sources](national-terrain-sources.md) — verification rule, sentinel/ImageServer/WCS2 traps, non-3857 COGs via titiler, bounds+underzoom behaviour, what was rejected and why
- [Git remotes](git-remotes.md) — main is mirrored at jo-chemla and Iconem; origin has two push URLs so one push lands in both
- [STAC browser components](stac-browser-components.md) — reuse stac-map / GeoLibre browser components before growing the STAC panel further
- [Catalogue-search sprint handoff](handoff-catalogue-search.md) — state after the 2026-09 library / coverage / STAC / Liberty sprint: what is unverified in a real browser and what was deferred
- [URL-loaded data and split-view helpers](url-loaded-data.md) — URL-as-source-id on any view, drawingUrl, remote vector parsing, permuteViewsUpdates, timelineActiveSideAtom; unverified in a browser
- [Titiler DEM gotchas](titiler-dem-gotchas.md) — pass the file nodata, reproject=bilinear for the warp, maxzoom decides who upsamples; how the DSM − DTM derived source (demdiff://) is wired
- [Sprint handoff 2026-09-19](handoff-2026-09-19.md) — snapshot compositing, URL API and docs generators, derived terrain (dem-diff), titiler DEM fixes, Bhotekoshi on NextGIS: shipped, unverified, deferred, gotchas
- [Library browse entries (deferred idea)](library-browse-entries-idea.md) — Library rows that open the Add modal on a preset tab instead of resolving to one URL; why EarthDEM needs it.
- [Commercial DEM API access (wanted)](commercial-dem-api-access.md) — Vantor/Airbus: the Maxar Discovery STAC endpoint to ask for, product vertical datums, why CSDA is discovery-only
- [Google 3D coverage](google-3d-coverage-dead-end.md) — the 3D Tiles tree cannot answer it (depth is the same over rural Nepal and Paris); Earth’s own bpb layer can, classified by response size
- [Esri 3D coverage](esri-3d-coverage.md) — Esri has no global photorealistic mesh; typeKeywords:"IntegratedMesh" finds 10 900 services where the free-text tag finds 48; Scene Viewer ?url= opens one alone
