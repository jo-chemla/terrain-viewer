// Curated, read-only "starter" viewpoints bundled with the app — a handful of
// good-looking location + visualization-mode combinations so a first-time
// visitor has something interesting to click before ever saving their own
// bookmark. Deliberately a plain in-memory array, NOT part of the user's own
// localStorage-backed bookmarksAtom (see lib/bookmarks.ts): restoring,
// renaming, or deleting a personal bookmark can never touch these, and an app
// update can freely add/change/remove entries without migrating anyone's
// saved data. Rendered as its own small read-only strip above the user's own
// bookmark list (see bookmarks-section.tsx's "Featured" section).
//
// `thumb` points at a bundled /public asset (a plain path works fine here —
// the row just does `<img src={thumb}>`, same as a real bookmark's own
// captureBookmarkThumbnail() data URL) rather than the neutral ImageOff
// placeholder BookmarkRow/BookmarkGroupHeader fall back to when thumb is
// null. Captured at public/bookmark-thumbs/ — the map canvas only, clipped
// to exclude the sidebar, at each preset's own saved viewport.
import type React from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { parseBookmarkSearch, easeToBookmarkViewport, type Bookmark } from "./bookmarks"

/** Builds a bookmark-shaped query string from a sparse set of field
 *  overrides — any field left unspecified resolves to that field's own
 *  QUERY_STATE_PARSERS default on restore (see parseBookmarkSearch), same as
 *  a fresh app load with no URL params at all. */
function presetSearch(overrides: Record<string, string | number | boolean>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(overrides)) params.set(key, String(value))
  return params.toString()
}

export const PRESET_BOOKMARKS: Bookmark[] = [
  {
    id: "preset-matterhorn",
    name: "Matterhorn, Alps — Custom Hypsometric Relief",
    ts: 0,
    thumb: "/bookmark-thumbs/matterhorn.jpg",
    search: presetSearch({
      zoom: 12.31, lat: 45.9686, lng: 7.6499,
      showColorRelief: true, colorRamp: "temp_19lev",
      hypsoSliderMinBound: 0, hypsoSliderMaxBound: 20, customHypsoMinMax: true,
      minElevation: 2330, maxElevation: 4220, colorReliefOpacity: 0.5,
    }),
  },
  {
    id: "preset-grand-canyon",
    name: "Grand Canyon, USA — Hypsometric Tint",
    ts: 0,
    thumb: "/bookmark-thumbs/grand-canyon.jpg",
    search: presetSearch({
      zoom: 11.13, lat: 36.1257, lng: -112.146, pitch: 61, bearing: 58.6,
      showColorRelief: true, colorRamp: "wiki",
      hypsoSliderMinBound: 400, hypsoSliderMaxBound: 3500,
    }),
  },
  {
    id: "preset-paris-historical",
    name: "Paris — Historical Imagery (Google Earth)",
    ts: 0,
    thumb: "/bookmark-thumbs/paris-historical.jpg",
    search: presetSearch({
      appMode: "historical", viewMode: "2d", zoom: 12.64, lat: 48.8569, lng: 2.3264, pitch: 0,
      showRasterBasemap: true, basemapSourceA: "historical", dateA: 1648339200000,
      historicalBeta: true, historicalActiveSourceA: "ge-historical",
    }),
  },
  {
    id: "preset-amazon-rivers-contours",
    name: "Amazon Rivers, Brazil — Deep Hypso + Contours",
    ts: 0,
    // No captured thumbnail yet — the row falls back to its ImageOff
    // placeholder (see bookmarks-section.tsx) until one lands in
    // public/bookmark-thumbs/.
    thumb: null,
    search: presetSearch({
      zoom: 10.11, lat: -5.6075, lng: -63.92, pitch: 0,
      showColorRelief: true, customHypsoMinMax: true,
      minElevation: 32.3, maxElevation: 70,
      hypsoSliderMinBound: 30, hypsoSliderMaxBound: 70,
      colorRamp: "deep", rasterBasemapOpacity: 0.2, hillshadeOpacity: 0.2, colorReliefOpacity: 1,
      showContoursAndGraticules: true, contourMinor: 2, contourMajor: 10,
    }),
  },
  {
    id: "preset-amazon-rivers",
    name: "Amazon Rivers, Brazil — Deep Hypso",
    ts: 0,
    thumb: null,
    search: presetSearch({
      zoom: 10.11, lat: -5.6075, lng: -63.92, pitch: 0,
      showColorRelief: true, customHypsoMinMax: true,
      minElevation: 32.3, maxElevation: 70,
      hypsoSliderMinBound: 30, hypsoSliderMaxBound: 70,
      colorRamp: "deep", rasterBasemapOpacity: 0.2, hillshadeOpacity: 0.2, colorReliefOpacity: 1,
    }),
  },
  {
    id: "preset-iceland-overlay",
    name: "Iceland — Bing vs. AWS Overlay Compare",
    ts: 0,
    thumb: "/bookmark-thumbs/iceland-overlay.jpg",
    search: presetSearch({
      viewMode: "2d", zoom: 6.1, lat: 63.7946, lng: -18.2345, pitch: 50,
      splitStyle: "overlay", sourceB: "aws", showRasterBasemap: true, basemapSourceA: "bing",
      dateA: 1072825200000, tellsBeta: true, tellsFrozen: true,
      overlayOpacity: 0.8834786817944542, rasterBasemapOpacity: 0.8,
    }),
  },
]

/** Restores a preset unconditionally (no "same family, skip the viewport"
 *  logic — every preset click IS a jump to a new place, unlike the user's
 *  own bookmarks/lib/bookmarks.ts's restoreBookmark, which has to tell those
 *  two cases apart) — always moves the camera there and applies every other
 *  field via setState, same mechanism as a real bookmark restore. */
export function restorePreset(
  preset: Bookmark,
  setState: (updates: Record<string, unknown>) => void,
  mapRef?: React.RefObject<MapRef>,
) {
  const patch = parseBookmarkSearch(preset.search)
  const map = mapRef?.current?.getMap()
  if (map) easeToBookmarkViewport(map, patch)
  setState(patch)
}
