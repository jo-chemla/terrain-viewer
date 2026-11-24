---
name: Pre-rendered relief library survey
description: 2026-11-24: the "relief" Library group (libraryGroup), ArcGIS Online's baked half alpha (forceOpaque), underzoom via tiletx://, and the relief tile services rejected and why
type: project
---

The basemap Library's **Pre-rendered relief (archaeology)** section is the `relief` key of `lib/library-groups.ts`; entries join it with `"libraryGroup": "relief"` (generic: any key gets a section). 89 entries on 2026-11-24 (12 Maya + 5 more MARI-GISLAB, DLR Antarctica, 71 national/regional).

**Gotchas**
- ArcGIS Online hosted tile services of 8-bit single-band rasters (MARI-GISLAB SVF and local dominance) serve RGBA PNG with alpha 114-132 on every data pixel: they draw half transparent at 100 %. `forceOpaque: true` (tiletx://) fixes it. Multi-band (RGB) layers are 255. Also seen on Berlin's DGM1 hillshade WMS and IGN RGE ALTI ombrage.
- MARI's tiles come back `application/octet-stream` (PNG at low zoom, JPEG at high): tiletx's `fetchBitmap` therefore only skips JSON/HTML/XML/text answers, never requires `image/*`.
- `underzoom` (1-3) synthesises tiles below a service's minzoom from its children, bounds-filtered; keep it 1 for sources with wide bounds but sparse strips (G-LiHT, M-REDD transects), or every parent fetches 4-16 empty children.
- LINZ basemaps need `api=`; use the app's existing key (`c01m2g7exyw8b5d968xt5axxrgg`), never a made-up one.
- Swedish (minkarta.lantmateriet.se), Upper Austria (DORIS ImageServer) and AHN (ahn.arcgisonline.nl) relief endpoints are viewer back ends with no published outside-use terms; they may move.

**Rejected (2026-11-24)**: Wales (GeoTIFF only, no CORS), Scotland SRSP (colour ramps only), NI (ZIP only), Denmark (token), Finland NLS (key; GTK copy used), Estonia (3857 layer broken), Latvia (unreachable/licence), Lithuania (401), PDOK AHN WMS (colour heights only), Slovenia ZRC SAZU (EPSG:3794 cache only), Tirol (refused connection, retry), BEV (registration), Friuli/Trentino/Florence (no CORS), PCN Italy (https→http), Oregon DOGAMI, PAMAP, Sardinia and Vorarlberg (no licence stated; Sardinia and Vorarlberg work), MARI's 16 settlement-density services (not relief, could be another group). No public tiles found for Belize/Caracol, PACUNAM beyond MARI, Cambodia CALI, Peru.
