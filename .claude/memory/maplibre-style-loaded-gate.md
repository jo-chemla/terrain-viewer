---
name: maplibre-style-loaded-gate
description: map.isStyleLoaded() waits for every tile of every source; gate addSource/addLayer readiness on style._loaded instead, or slow sources never get the layer
type: project
---

`map.isStyleLoaded()` is `Style.loaded()`: false until the style JSON is in AND every source's tiles have landed AND the image manager is idle. An init that retries a fixed number of times on it silently gives up on a slow source (a VRT reprojecting several COGs per tile): contours never appeared over the Mexico VRT while they did over LERC, for months, and it looked like a protocol problem.

**How to apply:** gate on the style document only (`map.style._loaded`, see `styleJsonLoaded` in `components/LayersAndSources/ContoursLayer.tsx`); the `load` event already implies it. Never spend a retry attempt on that wait. Same trap in any effect that early-returns on `isStyleLoaded()`.
