---
name: lidar-lens-reference
description: LiDAR Lens (Tim Daw), a design Jonathan loves, on the meta tracker since 2026-11-04; its England and Wales 1 m DTM tile set and what of it the app has
type: reference
---

# LiDAR Lens, a design to learn from

Jonathan loves this design and added it to the meta tracker on 2026-11-04:
- https://lidarlens.sarsen.org/
- https://github.com/TimDaw37/lidar-lens
- https://x.com/Timdaw/status/2117576517459046542

What it serves: all of England and Wales as Terrarium-encoded lossless WebP
tiles at zoom 13 to 17, fetched live. England from the Environment Agency
LiDAR Composite DTM 1 m, Wales from the Welsh Government LiDAR DTM 1 m
(DataMapWales), both Open Government Licence. Beyond z17 its lens magnifies
the z17 data.

How it works: there is NO pre-built tileset to reuse. A service worker
(`live-sw.js`) makes the tiles in the browser at zoom 13 to 17 from the
Environment Agency WCS and, for Wales, from the Welsh Government DTM COG
through the author's private Cloudflare relay (the COG has no CORS). The
Wiltshire and Ure demos are pre-built Terrarium WebP sets on R2.

What the app has (2026-11-04): England through the EA WCS and, since
2026-11-04, Wales through the same national COG via titiler
(`custom-uk-wg-lidar-dtm1` in `lib/custom-sources.json`). Scotland and
Northern Ireland have no raw-height streaming endpoint; see
[[national-terrain-sources]]. DataMapWales's historical aerial photography
is sortie footprints only (WMS/WFS vectors, `geonode:ptv_digitised_sorties_*`),
no imagery service, so nothing for the historical catalogs.
