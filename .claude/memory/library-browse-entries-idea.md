---
name: library-browse-entries-idea
description: Deferred idea — Library entries that open the Add-source modal on a preset tab (STAC, and later other customizable additions) instead of resolving to a single URL
metadata:
  type: project
---

Parked 2026-09-19 at the user's request ("keep this idea for later"). Not built.

## The idea

A Library entry today is a URL that becomes a source. Some datasets cannot be
that: **EarthDEM** has no mosaic, only per-scene strips, so the only sensible
"add" is *browse the catalogue over your area*. The same is true of ArcticDEM
and REMA strips, OpenTopography's 283 rasters, and LINZ's per-tile elevation.

So: let a Library entry carry `stac?: { preset: string; collection?: string }`.
Its button reads **Browse** rather than Add, and opens the Add-source modal on
the STAC tab with that catalogue and collection preselected.

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
