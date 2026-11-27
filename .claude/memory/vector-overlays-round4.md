---
name: vector-overlays-round4
description: 2026-11-27 vector overlays round 4 - why the pointer cursor must be rewritten every frame (terra-draw), the one attribution line crediting every view, compact GeoJSON, list-property categories, new-defaults migration, OCS GE vintages
type: project
---

# Vector overlays, round 4 (2026-11-27)

User docs: `docs/content/docs/features/vector-overlays.mdx`; schema: `docs/content/docs/dev/source-schema.mdx`. See also [[vector-overlays-round3]]. What is not in either:

**Pointer cursor.** terra-draw is always mounted and resets `canvas.style.cursor` on every mouse move. A hover cursor written only "on change" shows for one frame. `VectorFeaturePopup` rewrites `pointer` each frame while over a feature, and clears it only if it is still `pointer`. Any other hover cursor on the map needs the same.

**Attribution line.** One control, on the bottom-right view (`AttributionControlCollapsed`). MapLibre's control credits only the map it sits on, so it now takes `views` (a getter of the visible views' maps), reads their used tile managers (`map.style.tileManagers`, internal) and hands the credits over as `customAttribution`; it listens to the other maps' style, source and terrain events. A source no style layer uses is never credited: the building shadows fetch their own tiles, so `BuildingShadowLayer` mounts an empty GeoJSON source with the credit and a line layer of opacity 0. Not credited at all: georeferenced pictures (MapLibre image sources take no attribution) and IIIF overlays (a custom layer). The schema has no publication or citation field.

**Probing the line in a browser.** The box is a closed `<details>`: `innerText` is empty, read `textContent`.

**Per-view overlays.** `basemapPerView` defaults to true: in a split, `vectorOverlayIds` is view A's list only, B reads `vectorOverlayIdsB`. "Sync viz modes" does not cover basemaps or overlays.

**Compact GeoJSON** (`format: "compact"`): `keys` and `shared` top-level members, `expandCompactGeoJSON` in `lib/vector-sources.ts`; written by `scripts/build-unesco-vectors.mjs` for the components (0.9 MB).

**List properties.** Wikidata's `cls` is a comma-joined list of class ids: `categories[].separator` matches an item between separators; `popup.fields[].values` with `separator` names them.

**New defaults reach a saved list** (`lib/default-list.ts`): the ids already offered are stored under `vectorLibraryIdsSeen`; with no record, a default missing from a saved list is added once (so a default removed before 2026-11-27 comes back once).

**OCS GE.** The Géoplateforme serves one tile set per period. 2021-2023 lacks Rhône, Ille-et-Vilaine, Alpes-Maritimes, Gers, Var (404); 2017-2020 is complete. Both are entries.
