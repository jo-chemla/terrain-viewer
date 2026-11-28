---
name: style-overlay-fonts-sprites
description: 2026-11-28 several MapLibre styles on one map - the tvglyphs:// glyph router (fonts per style), sprites added per style id, never setSprite; the copies in public/styles/ (gpx.studio, Carte Facile) and their build script
type: project
---

# Style overlays: fonts and sprites per style (2026-11-28)

See [[vector-overlays-round4]]. User docs: `docs/content/docs/features/vector-overlays.mdx`.

**Fonts.** A map has one `glyphs` address. Every style laid on the map (`VectorOverlayLayers` StyleOverlay, `VectorBasemapLayer`) calls `routeGlyphs` (`lib/style-overlay.ts`): the map's glyphs become `tvglyphs://{fontstack}/{range}.pbf` and each font the style names is registered to that style's own glyphs address (first registration wins). The protocol (registered in `TerrainViewer.tsx`) routes on the stack's FIRST font; an unregistered font goes to OpenFreeMap in Noto Sans. Check in a page: `globalThis.__tvGlyphRoutes`.

**Sprites.** An overlay's sprite is `map.addSprite("vo-<entry id>", url)` and its image names are prefixed (`withSprite`). The OSM basemap adds its sprite as `"default"`. Never call `map.setSprite`: it drops every other sprite.

**Copies served by the app** (`public/styles/`): gpx.studio's liberty-satellite, liberty-topo, osm (its hosts send no CORS header) and Carte Facile's aerial (lives in an npm bundle). Regenerate with `node scripts/build-vector-styles.mjs` (pinned upstream commits, needs network and sharp); what each copy dropped is in its `metadata["terrain-viewer:changes"]`, and `lib/vector-sources.test.ts` checks every address is open and keyless and every font is one OpenFreeMap serves. Nobody at gpx.studio was asked: the copies rest on the licences (MIT, BSD 3-Clause, CC BY 4.0), with credit.
