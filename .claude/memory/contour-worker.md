---
name: contour-worker
description: The "Contours in a Worker" setting (2026-11-16) - maplibre-contour inside MapLibre's own workers via importScriptInWorkers, DEM tiles answered from the main thread; gotchas and how it was tested
type: project
---

`contourWorkerAtom` (Settings, Streaming, on by default since 2026-11-17) routes ContoursLayer.tsx
through `lib/contour-worker-client.ts` + `lib/contour-worker-body.js` instead
of maplibre-contour's DemSource. HarelM's suggestion on maplibre-style-spec#1374
(2026-11-15); it makes our maplibre-contour#434 request unnecessary.

- The worker script is maplibre-contour's UMD build (`dist/index.min.js?raw`,
  relative node_modules path because the package `exports` hides dist/) plus
  the plain-JS body, concatenated into a Blob and loaded with
  `importScriptInWorkers`. The body may not import anything.
- `tv-contour://<key>/{z}/{x}/{y}?o=<JSON>` is registered in the workers; MapLibre
  loads vector tiles there, so isolines run off the main thread.
- DEM reads: http(s) fetched in the worker; any other scheme goes to the main
  thread as a `tv-contour-tile` message answered by `loadTileBitmap`.
- **Gotcha:** a worker message to the main thread must carry
  `targetMapId: "global-dispatcher"`. Without it every map's actor receives it
  and the ones without the handler complete it with null.
- **Gotcha when testing in the preview browser:** import maplibre-gl with the
  same `?v=` query the app uses, or you get a second module copy with its own
  worker pool and broadcasts hang.
- Verified 2026-11-16 in the preview browser without rendering (a test script
  in the workers called `self.makeRequest` on a `tv-contour://` URL): Mapterhorn
  53 KB tile in 0.27 s, LRM over Mapterhorn 50 KB in 1.1 s. Drawn contours not
  yet checked in a real browser.
- "cog-local" and the client COG path keep their own single worker (lib/cog-contour-worker.ts).
- MapLibre's pool is 4 workers since 2026-11-18 (src/main.tsx, was 1 on Chrome): each worker has its own LocalDemManager and cache. Timings in [[raster-compute-worker]].
- **Bug seen 2026-11-18, not fixed:** with the switch OFF, LRM contours (buildLrmDemSource) load and return 0 features (Mapterhorn, z12.6, real Chrome); absolute contours are fine. Another reason to delete the old path rather than keep it as a fallback.

**Why:** custom-scheme contours (VRT, LERC, demdiff, LRM) were traced on the main thread.
**How to apply:** if it proves stable in real use, it became the default on 2026-11-17 (the toggle stays as a fallback); once proven, delete buildRegistryDemSource/buildLrmDemSource and the toggle.
