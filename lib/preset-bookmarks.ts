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
// `thumb` is left null (renders as the existing neutral placeholder — see
// BookmarkRow/BookmarkGroupHeader's `b.thumb ? <img> : <ImageOff>` fallback)
// since a real preview image needs an actual rendered screenshot per
// location; drop one in here (a JPEG/PNG data URL or a bundled /public
// asset path both work, since the row just does `<img src={thumb}>`) once
// one's been captured.
import type React from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { parseBookmarkSearch, type Bookmark } from "./bookmarks"

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
    name: "Matterhorn, Alps — Hypsometric Relief",
    ts: 0,
    thumb: null,
    search: presetSearch({
      lat: 45.9763, lng: 7.6586, zoom: 12.5, pitch: 60, bearing: 0,
      viewMode: "3d", showHillshade: true, showColorRelief: true, colorRamp: "hypsometric",
    }),
  },
  {
    id: "preset-grand-canyon",
    name: "Grand Canyon, USA — Hillshade",
    ts: 0,
    thumb: null,
    search: presetSearch({
      lat: 36.0544, lng: -112.1401, zoom: 12, pitch: 65, bearing: -20,
      viewMode: "3d", showHillshade: true, showColorRelief: true, colorRamp: "wiki",
    }),
  },
  {
    id: "preset-petra",
    name: "Petra, Jordan — Sky-View Factor",
    ts: 0,
    thumb: null,
    search: presetSearch({
      lat: 30.3285, lng: 35.4444, zoom: 15, pitch: 55, bearing: 0,
      viewMode: "3d", showReliefVisualization: true, showSvf: true, showLrm: false,
    }),
  },
  {
    id: "preset-paris-historical",
    name: "Paris — Historical Imagery",
    ts: 0,
    thumb: null,
    search: presetSearch({
      lat: 48.8566, lng: 2.3522, zoom: 15.5, pitch: 0, bearing: 0,
      viewMode: "2d", appMode: "historical", historicalBeta: true,
      showRasterBasemap: true, basemapSourceA: "historical",
    }),
  },
  {
    id: "preset-iceland-compare",
    name: "Iceland — Basemap Compare",
    ts: 0,
    thumb: null,
    search: presetSearch({
      lat: 63.9850, lng: -19.0450, zoom: 12, pitch: 50, bearing: 0,
      viewMode: "3d", splitStyle: "side-by-side", gridLayout: "2x1", basemapPerView: true,
      basemapSourceA: "esri", basemapSourceB: "google", showHillshade: true,
    }),
  },
]

/** Restores a preset unconditionally (no "same family, skip the viewport"
 *  logic — every preset click IS a jump to a new place, unlike the user's
 *  own bookmarks/lib/bookmarks.ts's restoreBookmark, which has to tell those
 *  two cases apart) — always eases the camera there and applies every other
 *  field via setState, same mechanism as a real bookmark restore. */
export function restorePreset(
  preset: Bookmark,
  setState: (updates: Record<string, unknown>) => void,
  mapRef?: React.RefObject<MapRef>,
) {
  const patch = parseBookmarkSearch(preset.search)
  const map = mapRef?.current?.getMap()
  if (map) {
    map.easeTo({
      center: [patch.lng as number, patch.lat as number],
      zoom: patch.zoom as number,
      bearing: patch.bearing as number,
      pitch: patch.pitch as number,
      duration: 800,
    })
  }
  setState(patch)
}
