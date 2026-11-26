---
name: river-rem-mode
description: River REM app mode (appMode=rem) - where each part lives, the trend-in-a-module-slot plus URL revision design, QLever before Overpass, the main-river ranking, why a floodplain banded (Mapterhorn rounds by zoom), WMS cache poisoning, DEMs with no water, how it was tested
type: project
---

# River REM app mode (2026-11-26, polished the same day)

`appMode=rem`: REM = DEM minus a trend through the river's water level, live, no backend. Ported from Iconem/RiverREM_UI (its client engine) and OpenTopography RiverREM's defaults (interp_pts 1000, weights 1/d, k from sinuosity between 5 and 100, log color scale).

- Pure parts and tests: `lib/river-rem.ts` (way joining, clipping, resampling, running-minimum / PAV cleaning, median filter, k estimate, IDW and nearest-centerline grids, `riverScore`, `quantizationStep` / `dequantizeDem`, GeoJSON in and out, polyline for `remLine`), `lib/river-rem-style.ts`, tests in `lib/river-rem.test.ts` and `lib/river-rem-polish.test.ts`.
- `lib/river-rem-protocol.ts`: `riverrem://…?rev=N` (and `&abs=1`, the Elevation display: same kernel, no trend). The trend grid is in a module slot on globalThis; the URL only carries its revision. The slot also holds tile statistics, per-tile height samples (the Elevation auto range, 2nd to 98th percentile) and tile listeners.
- `lib/river-rem-sample.ts` reads centerline heights through `fetchDecodedTile`; a point in a void takes `nearestGround` (median of the nearest ring of valid pixels).
- `lib/overpass-rivers.ts`: QLever first, the Overpass mirrors after it, hedged.
- `components/RiverRem/RiverRemLayers.tsx`: source, layer, contours (`ContoursLayer` with `dem` = the riverrem template, idPrefix `remcontour`), centerline on every view; the engine and the progress toast run in view A only. Every view uses `state.sourceA`.
- Panels: `components/TerrainControlPanel/river-rem-sections.tsx`; fold state in `riverRemSectionsOpenAtom`, moved by the sidebar's fold all through `RIVER_REM_SECTION_KEYS` (in `lib/river-rem-atoms.ts`: a non-component export in the panel file breaks Fast Refresh).

Gotchas, each measured:

- **Banding on a floodplain is the DEM, not the REM.** Mapterhorn rounds heights by zoom: 1 m up to z11, 0.5 m at z12, 0.25 m at z13, 0.125 m at z14 (AWS Terrain: whole metres to z10, 1/256 m from z11). Remedies: the source is declared with half the tile size so MapLibre asks one zoom deeper (`remDetail`, auto = 1, 0 for `float32dem-bbox://`), and rounded tiles are smoothed within their half step (`dequantizeDem`, 48 px halo from the neighbors, about 40 ms per 512 px tile).
- **WMS reads were poisoned by a cancelled request.** `fetchWmsPaddedGrid` cached the first requester's promise; when that request was aborted the rejection stayed in the cache and the tile failed at 0 ms for good ("signal is aborted"). Fixed in `lib/normal-derived-protocol.ts` (a failed read leaves the cache, a live requester reads again). It bit every computed mode on WMS sources after a pan.
- **A WMS tile must go through `fetchPaddedElevationGrid`**, not the plain z/x/y template: `readTile` in the protocol does it.
- **IDW's heap was at its worst on river data**: samples come in river order, so nearly every one replaced the root (4.8 s for k = 100, 1000 samples, 256 grid). Cells now bound the search by the k-th distance of the cell above and to the left: 0.5 s, same neighbors.
- **Tiles of a new trend are all computed before React runs the effect that would listen for them**: the tile listener of the "drawing" step is registered at mount.
- **Main river**: length in view times OSM tag count (Mississippi 60 tags, Deer Creek 4; both QLever's `osm2rdf:facts` and Overpass's tags give it). Longest alone picks Deer Creek near Greenville.
- **QLever** (qlever.dev/api/osm-planet, the uni-freiburg host redirects with a 308 that a POST does not follow): `geof:sfIntersects(?wkt, "POLYGON(...)")` with a constant works, 0.3 to 6 s; a centroid-in-box filter took 73 s; relations carry `waterway=river` too (600 kB each), so `?way rdf:type osm:way`. Overpass the same day: main server 502/406, two mirrors hung, one 10 to 21 s.
- **DEMs with no water** (GEM-15): 966 of 1000 centerline points in a void; bank readings there range from −29 to 36 m around a 30 m river, so the result is approximate whatever the cleaning (median 31 then monotone fit is used).
- OSM's Mississippi centerline has 40 vertices over 62 km and cuts across point bars: the running minimum keeps those land heights out.
- East-west stripes on the Greenville view are steps between lidar surveys in the source, present before and after every change here.
- Git Bash heredocs break on backticks and quotes in the body, and the working copy is CRLF: write scripts with the Write tool and edit with Edit.

Tested 2026-11-26 with agent-browser (Mississippi at Greenville, Allier at Moulins; Mapterhorn, AWS, USGS 3DEP ImageServer, IGN LiDAR HD WMS, GEM-15 VRT; bookmark save and restore of all rem* fields; import GeoJSON and KML, export; contours; Elevation display; Fisk 1944 sheet from Allmaps in a split). Not run: drawing a line with the pointer, 3D with contours, a phone, an actual GeoTIFF export of the Elevation display.
