# Getting Started

Terrain Viewer is a browser-based terrain and historical-imagery visualization tool built on [MapLibre GL](https://maplibre.org/maplibre-gl-js/docs/) via [react-map-gl](https://visgl.github.io/react-map-gl/). Every setting lives in the URL query string, so any view is shareable as a plain link.

## Using the hosted app

The app is deployed at [terrain-viewer.iconem.com](https://terrain-viewer.iconem.com/) — no install needed. Open it, pick a location, and toggle visualization modes from the sidebar.

A dedicated historical-imagery-only entry point is available at [historical-satellite.iconem.com](https://historical-satellite.iconem.com/) — same app, defaulting straight into Historical mode (see [Basemaps & Historical Imagery](/features/basemaps-and-historical)).

## Running locally

```bash
git clone https://github.com/iconem/elevation-terrain-visualizer.git
cd elevation-terrain-visualizer

pnpm install
pnpm run dev      # http://localhost:5173
pnpm run build    # bundles to dist/
```

## The URL as app state

Nearly every sidebar control — viewport (lat/lng/zoom/pitch/bearing), active terrain/basemap sources, every visualization toggle and its options, split-screen layout, historical dates — is mirrored to the URL query string via [nuqs](https://nuqs.dev/docs/basic-usage). That means:

- Copying the address bar URL always reproduces the exact current view for someone else.
- [Bookmarks](/features/bookmarks) are really just a saved query string plus a thumbnail.
- Embedding a specific configuration (e.g. in an iframe) is just linking to the right URL — see `?project=` and `terrainUrl=`/`basemapUrl=` for pointing straight at a custom source without registering it first.

## Where to go next

- [Feature Overview](/features/) — a map of what's in the sidebar
- [Terrain Visualization Modes](/features/visualization-modes) — hillshade, hypsometric tint, relief/terrain-analysis derivatives
- [Basemaps & Historical Imagery](/features/basemaps-and-historical) — satellite basemaps and the historical timeline
- [Bookmarks](/features/bookmarks) — saving and organizing views
- [Bring Your Own Data](/features/byod) — adding your own terrain/basemap sources, including local files
