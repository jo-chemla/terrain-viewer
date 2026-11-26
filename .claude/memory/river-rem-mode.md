---
name: river-rem-mode
description: River REM app mode (appMode=rem) - where each part lives, the trend-in-a-module-slot plus URL revision design, Overpass mirror behaviour measured, what the longest-river rule picks wrong, how it was tested
type: project
---

# River REM app mode (2026-11-26)

`appMode=rem`: REM = DEM minus an IDW trend through the river's water level, live, no backend. Ported from Iconem/RiverREM_UI (its client engine) and OpenTopography RiverREM's defaults (interp_pts 1000, weights 1/d, k from sinuosity between 5 and 100, log color scale).

- Pure parts and tests: `lib/river-rem.ts` (way joining, clipping, resampling, running-minimum / PAV cleaning, k estimate, heap kNN IDW grid, polyline for `remLine`), `lib/river-rem-style.ts` (stretch baked into the color-relief stops), `lib/river-rem.test.ts`.
- `lib/river-rem-protocol.ts`: `riverrem://…?rev=N`. The trend grid is in a module slot on globalThis; the URL only carries its revision. react-map-gl turns the changed `tiles` prop into `setTiles`, so tiles reload with no Source or Map remount (checked: same map object, new tile bytes).
- `lib/river-rem-sample.ts` reads centerline heights through `fetchDecodedTile` and the shared decoded cache, at the source's maxzoom capped at z15 and lowered until under 48 tiles.
- `components/RiverRem/RiverRemLayers.tsx`: source, layer, centerline on every view; the engine (Overpass, sampling, trend) runs in view A only and writes `lib/river-rem-atoms.ts`. Every view uses `state.sourceA`.
- Panels: `components/TerrainControlPanel/river-rem-sections.tsx`, with their own fold atom (not SECTION_KEYS).

Gotchas:

- **Overpass** (measured 2026-11-26): overpass-api.de answered 502, private.coffee and kumi.systems hung past 45 s, maps.mail.ru answered in 13 to 21 s. `lib/overpass-rivers.ts` hedges: next mirror after 8 s or on a refusal, first answer wins. curl without a browser User-Agent gets 406 from overpass-api.de.
- `out geom(box)` returns null for nodes outside the box: the parser cuts the way there. Without the box a 60 km Mississippi view was 600 kB.
- **Longest named river** is RiverREM's rule and is often not the main river: near Greenville MS it picks Deer Creek (113 km of meanders) over the Mississippi (91 km). The docs example uses `remRiver=named`.
- OSM's Mississippi centerline has 40 vertices over 62 km and cuts across point bars: the running minimum is what keeps those land heights out of the trend.
- Steps in the river's own REM on USGS 3DEP are hydro-flattening steps between surveys, not a bug.
- Git Bash heredocs break on backticks in the script body: write the script to a file.

Tested with agent-browser on port 5195 (Allier at Moulins, Mississippi at Greenville, split view, a `remLine` set through `window.__tv.setState`, 3D). Not run: an actual file export, drawing a line with the pointer, a non-Mapterhorn terrain source.
