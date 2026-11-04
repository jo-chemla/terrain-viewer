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

What the app has (2026-11-04): England only, through the Environment
Agency WCS as raw Float32 (`lib/custom-sources.json`, "GBR - England EA
LIDAR Composite DTM 1m"), about 75 % coverage. No Welsh DTM terrain source:
DataMapWales appears only as a historical-photo index and in the national
datasets table. Nothing from LiDAR Lens itself is used; its tiles would be a
candidate if the author's terms allow it (ask first), and the Welsh DTM is
a gap either way. See [[national-terrain-sources]].
