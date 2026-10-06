---
name: maplibre-3d-overlays-idea
description: Noted for later - MapLibre GL JS PR #8567 (3D overlays / draped custom layers) is the hook for adding 3D overlays to Terrain Viewer
type: project
---

# 3D overlays, later (noted 2026-10-06)

The user wants 3D overlays at some point (not now). The upstream hook is
https://github.com/maplibre/maplibre-gl-js/pull/8567. When it lands in a
release, check what it offers (draped custom layers, 3D model overlays) and
how it meets the Allmaps warped layer (which has no pitch support today, see
[[allmaps-overlays]]) and the draping notes in docs/content/docs/dev/draping.mdx.

**Why:** the user asked to keep the reference.
**How to apply:** when touching overlay rendering or bumping maplibre-gl,
look at that PR's status first.
