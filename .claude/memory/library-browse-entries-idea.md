---
name: library-browse-entries-idea
description: Library entries that open the Add-source modal on the STAC tab (built 2026-11-14 for STAC; other customizable additions still an idea) instead of resolving to a single URL
metadata:
  type: project
---

Parked 2026-09-19 at the user's request ("keep this idea for later").

## Built 2026-11-14 (STAC only)

- `stac: { preset, collection? }` on a Library entry (`LibraryStacLink`, lib/settings-atoms.ts) adds Browse beside Add. Static catalogs (LINZ, OpenTopography) take the absolute child `collection.json` URL as the collection, since that is the panel's id for them.
- Browse-only datasets live in their own list `SAMPLE_TERRAIN_BROWSE_ONLY` in custom-sources.json, NOT in SAMPLE_TERRAIN_SOURCES: about ten readers of that list (coverage, Load all, ?sourceA=, docs tables, STAC export, product tour) assume a URL. The modal merges them into its sections (index -1: placed by "Global - ", bounds, loadWithSamples only).
- Handoff: `seedStacPreset(target, preset, { collection, search: true })`, same sequential close-then-open as the Catalogs Browse. The panel auto-searches once on mount.
- Found on the way: the panel's first collection listing reset any seeded collection (so the CSDA presets' own `collection` never reached the picker either); bboxes past ±180 at low zoom made PGC answer 400; LINZ nz-elevation names its DEM COG `visual`, which the terrain filter dropped, so that preset never listed a DEM. All three fixed in stac-search-panel.tsx.
- Unverified in a real browser: the dialog transitions (in the agent browser the closed Library stays mounted with data-ending-style, which looks like both dialogs open; it is not).

## The idea

A Library entry today is a URL that becomes a source. Some datasets cannot be
that: **EarthDEM** has no mosaic, only per-scene strips, so the only sensible
"add" is *browse the catalog over your area*. The same is true of ArcticDEM
and REMA strips, OpenTopography's 283 rasters, and LINZ's per-tile elevation.

So: let a Library entry carry `stac?: { preset: string; collection?: string }`.
Its button reads **Browse** rather than Add, and opens the Add-source modal on
the STAC tab with that catalog and collection preselected.

The user's framing is broader than STAC: *"would probably group the STAC
endpoints we carry, as well as other customizable additions"* — i.e. the
Library becomes the one place you discover data, whether it resolves to a URL
directly or hands you off to a search. Design it as "entry → which tab of the
Add modal, preconfigured", not as "entry → STAC".

## Why it is cheap

The two modals are already siblings in `terrain-source-section.tsx` (~376-377),
so no state has to be lifted far:

1. `SampleLike` gains the optional field; the row swaps its button and calls a
   new `onBrowseStac` prop (`sample-sources-modal.tsx`).
2. `stac-search-panel.tsx` already keeps a module-level `remembered[target]` of
   `{ presetId, collectionId, ... }` — export a function that seeds it.
3. `CustomTerrainSourceModal` takes an `initialTab`.
4. The section closes the Library and opens the Add modal on that tab.

## Current state

EarthDEM is reachable today through the existing `pgc` STAC preset, which names
it and carries its licence restriction (US federal employees, US federal
contractors, US-government-funded researchers only). See [[handoff-2026-09-19]].
