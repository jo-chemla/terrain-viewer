---
name: commercial-dem-api-access
description: Vantor Precision3D and Airbus WorldDEM - the actual API endpoints to ask for, their vertical datums, and why the NASA CSDA route cannot stream
metadata:
  type: project
---

Jonathan wants **API-key access to Vantor Precision3D (1 m) and Airbus
WorldDEM / WorldDEM Neo (5 m)**. Noted 2026-09-23; no key held yet.

## The endpoint to actually ask for

**`https://api.maxar.com/discovery/v1/`** is a real STAC API and answers **401**
without a key — so it is exactly the "API key access" wanted, and being STAC it
drops into this app's existing catalog search once a key exists. Documented at
`https://developers.maxar.com/docs/discovery/`. This is what
[uw-cryo/coincident](https://github.com/uw-cryo/coincident) queries for its
`vantor` alias. The app's STAC panel has no way to send an auth header yet;
that is the one piece of work a key would create.

Airbus runs OneAtlas separately, with a free trial that includes the WorldDEM
layer. Jonathan also holds an **up42** credential, which is Airbus-adjacent and
worth trying first.

## Vertical datums - the part that actually bites

From [uw-cryo/groundcontrol](https://github.com/uw-cryo/groundcontrol)'s
`docs/vdatum.md`, which is the best short reference on this found so far:

| product | frame |
|---|---|
| Vantor Precision3D | `ellipsoid:g1674` - WGS84 **G1674** stated explicitly, aligned to ITRF2008 @ 2005.0 |
| Copernicus GLO-30/90 | EGM2008 orthometric on an ensemble grid, rebased to ITRF2014 |
| 3DEP | NAVD88 orthometric (GEOID18-realized) |
| ArcticDEM / REMA | ellipsoidal ITRF2014; strips **unregistered**, ~4 m absolute |
| EarthDEM | ellipsoidal ITRF2014, unregistered at every level |

Two things to carry into this app:

- The bare **WGS84 ensemble** (`EPSG:4326`, `EPSG:326xx`) is ~2 m of deliberate
  ambiguity across realizations, and for ellipsoidal heights the realization
  *is* the height datum. A source that says only "WGS84" has not told you.
- **A measured offset of geoid magnitude means the datum assumption is wrong**,
  not that the sources are misregistered. Co-registration bias is metres;
  ellipsoidal-vs-orthometric is tens of metres, up to ±100 m. This is now
  written into `/docs/dev/demdiff-protocol` as the diagnostic for the Σ button,
  along with the fact that the library's EGM96/EGM2008 geoid grids make the
  conversion itself a difference.

Differencing P3D against anything else will also hit its **5-15 year composite
window** (coincident issue #136) - it is not a snapshot.

## Why the CSDA route cannot stream

`https://csdap.earthdata.nasa.gov/stac`, collections `maxar-sdx` (P3D) and
`airbus-dem` (WorldDEM), wired up as presets in `lib/stac-presets.ts`. The
catalog is open and CORS-open so search works, but every DEM asset href is an
`s3://` URI behind an Earthdata login, a EULA and per-request approval. A
browser cannot fetch `s3://` at all — these presets are discovery-only by
construction, not by oversight. Do not "fix" them.

Checked and rejected: the CSDA **`airbus`** collection (which coincident uses
for TanDEM-X) is raw L1B SAR single-look complex, not a DEM. Not worth a
preset.

## Accuracy reference

[lmaden/gedi-p3d-error-models](https://github.com/lmaden/gedi-p3d-error-models)
fits Bayesian hierarchical error models for Precision3D **DTM (18 sites)** and
**CHM (16 sites)** against GEDI L2A, submitted to the ISPRS Journal. The CHM
half is directly comparable to this app's nDSM/canopy-height difference
sources. Posterior summaries are in the repo's `data_derived/`.

See also [[national-terrain-sources]] for why this matters: nothing open is
finer than 30 m across Turkey, the Caucasus, Russia, the Balkans, Central,
South and South East Asia, or most of Africa.
