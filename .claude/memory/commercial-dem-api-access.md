---
name: commercial-dem-api-access
description: Wanted: API-key access to Vantor Precision3D and Airbus WorldDEM; why the NASA CSDA route cannot stream and what a key would unlock
metadata:
  type: project
---

Jonathan wants to find **API-key access to Vantor Precision3D (1 m) and Airbus
WorldDEM / WorldDEM Neo (5 m)** at some point. Noted 2026-09-23; no key held
yet, nothing to implement until one exists.

**Why the catalog route is a dead end for streaming.** Both live in NASA's CSDA
catalog (`https://csdap.earthdata.nasa.gov/stac`, collections `maxar-sdx` and
`airbus-dem`), wired up as the `csda-maxar-dem` and `csda-airbus-dem` presets in
`lib/stac-presets.ts`. The catalog itself is open and CORS-open, so search works
and shows exactly what exists where — but every DEM asset href is an `s3://`
URI behind an Earthdata login, a EULA and per-request approval. A browser cannot
fetch `s3://` at all, so these presets are discovery-only by construction, not by
oversight. Do not "fix" them.

**What a key would change.** Airbus runs a OneAtlas elevation API whose free
trial includes the WorldDEM layer; Vantor sells Precision3D through its own
delivery platform. Either is then an ordinary custom source with a credential,
the same shape as Mapbox/MapTiler keys in `settings-atoms.ts` — nothing new is
needed in the tile pipeline, only somewhere to put the key and a templated
endpoint.

**Why it matters.** These are the two best global commercial DEMs and the only
realistic answer to the gaps the world sweep found: nothing open finer than 30 m
across Turkey, the Caucasus, Russia, the Balkans, Central and South and South
East Asia, or most of Africa. See [[national-terrain-sources]].

Also recorded there: an up42 credential exists, which is Airbus-adjacent and
worth checking first.
