---
name: wms-nodata-two-paths
description: wms-raw sources are built twice (display float32dem:// and client float32dem-bbox://); both must carry the nodata markers, and holes are a mask, not the fill value
type: project
---

A `wms-raw` source reaches the float32dem protocol by two routes: the display
tiles (`lib/source-builder.ts`, `float32dem://…`) and the client upstream that
every derived mode, the demdiff operands, contours and exports read
(`useClientDemUpstream` in `components/LayersAndSources/MapSources.tsx`,
`float32dem-bbox://<encoded>/{z}/{x}/{y}`). Until 2026-09-28 only the first
carried `__nodatafloor` / `__nodatafill`, so the IGN nDSM (DSM − DTM) read
IGN's -9999 reprojection smear as ground: spikes up to ~990 m along the Rade
de Brest coast. Any new route to the protocol must go through
`appendNodataMarkers`.

**Why:** the smear is continuous from -9999 up to valid ground; values just
above the -20 m floor pass any threshold, and the fill value (0 m) is itself
valid-looking ground to a difference.

**How to apply:** `fetchFloat32Raster` returns a `hole` mask (sentinel or at/
below the floor; a dilated smear band was tried and measured unnecessary once
both paths carry the floor); tiles encode holes at the fill height
with alpha 254 (app decoders treat alpha < 255 as nodata, MapLibre reads only
RGB). Keep the mask through any new resampling step. Test with
`.cache/pw/ndsmspikes.mjs`-style decoding of demdiff tiles (count cells > 60 m),
not by eye; IGN WMS often times out at coverage edges, so use 150 s per tile.
