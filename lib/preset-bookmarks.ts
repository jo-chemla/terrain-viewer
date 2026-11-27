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
import { parseBookmarkSearch, easeToBookmarkViewport, bookmarkHref, type Bookmark } from "./bookmarks"

/** Builds a bookmark-shaped query string from a sparse set of field
 *  overrides — any field left unspecified resolves to that field's own
 *  QUERY_STATE_PARSERS default on restore (see parseBookmarkSearch), same as
 *  a fresh app load with no URL params at all. */
function presetSearch(overrides: Record<string, string | number | boolean>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(overrides)) params.set(key, String(value))
  return params.toString()
}

export const PRESET_BOOKMARKS: (Bookmark & { reload?: boolean })[] = [
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
    // The River REM mode (appMode=rem), side by side: the REM on the left,
    // the same REM under Harold Fisk's 1944 meander map on the right (plate
    // 22, sheet 5, georeferenced in Allmaps and bundled in the Basemap
    // Library). The river is named: "Main river" finds it too, but a preset
    // should not depend on a ranking. Hillshade off: the sheet is read
    // against the REM's colors alone.
    // The camera is the sheet's: its center (-91.1258, 33.1467; the sheet
    // spans 0.464 degrees of longitude, -91.358 to -90.894) at the zoom
    // where that width is a 960 px pane, half a 1920 px window (10.506), so
    // the sheet's left and right edges sit at view B's edges there. A link
    // holds a zoom, not an extent: a narrower window crops the sheet's
    // sides, a wider one shows the REM beside it.
    id: "preset-mississippi-rem",
    name: "Mississippi at Greenville — River REM beside Fisk's 1944 meander map",
    ts: 0,
    thumb: "/bookmark-thumbs/mississippi-rem.jpg",
    search: presetSearch({
      appMode: "rem", viewMode: "2d", zoom: 10.5, lat: 33.1467, lng: -91.1258, pitch: 0,
      remRiver: "named", remRiverName: "Mississippi River",
      splitStyle: "side-by-side", showRasterBasemap: true, basemapPerView: true,
      overlayBasemapIdsB: "custom-basemap-allmaps-ac79c53138d6b057", overlaysStack: "top", showHillshade: false,
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
    // Thumbnail rendered by the tile service's browser engine
    // (tile-server/, /render.jpg with this query, 1600 x 1137).
    id: "preset-cevennes-slope",
    name: "Cévennes, Ardèche–Lozère border — Black-and-White Slope",
    ts: 0,
    thumb: "/bookmark-thumbs/cevennes-slope.jpg",
    search: presetSearch({
      zoom: 11.32, lat: 44.5061, lng: 4.0005,
      showHillshade: false, showTerrainAnalysis: true,
      slopeOpacity: 0.8, slopeMaxDegrees: 45, slopeColorRamp: "black-and-white",
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
      historicalActiveSourceA: "ge-historical",
    }),
  },
  {
    // Sixth, not near the top: it reloads the page and fetches a large CSV.
    // A whole link rather than a set of fields: it loads a remote drawing
    // and starts the Feature Iterator, which only a page load does (see
    // restorePreset).
    id: "preset-crater-candidates",
    name: "Crater candidates — Feature Iterator on a remote CSV, four views",
    ts: 0,
    thumb: "/bookmark-thumbs/crater-candidates.jpg",
    reload: true,
    search: "zoom=12.24&splitStyle=side-by-side&gridLayout=2x2&terrainSourceB=mapterhorn&showColorRelief=true&showRasterBasemap=true&vizSync=false&vizViews=showHillshade:A;showColorRelief:A;showRasterBasemap:B;showLightingEffects:C;showPhong:C;showReliefVisualization:D;showSvf:D;showSlope:A;showTerrainAnalysis:A&drawingUrl=https://raw.githubusercontent.com/wrong-nebula/earth-anomalies/refs/heads/main/detections.csv&scrollTo=featureIterator&iteratorSort=quality&customHypsoMinMax=true&hypsoAutoRange=true&showLightingEffects=true&slopeMaxDegrees=14&showReliefVisualization=true&showSvf=true&showLrm=false&svfMin=90&showTerrainAnalysis=true&illuminationDir=16.59&illuminationAlt=53.36&lightDayOfYear=110&lightTimeOfDay=11.25&basemapSourceA=google&basemapSourceC=google&colorRamp=deep",
  },
  {
    // The Rio Purus as a River REM. The terrain there is a surface model
    // (the forest canopy, 25 to 40 m above the water), so the range is 0 to
    // 45 m with a linear stretch where the mode's default (0 to 10 m, log)
    // leaves everything but the channel black. The river is named, as on
    // the Mississippi. The id is the earlier hypsometric preset's, kept.
    id: "preset-amazon-rivers-contours",
    name: "Rio Purus, Amazon Basin, Brazil — River REM",
    ts: 0,
    thumb: "/bookmark-thumbs/amazon-rivers.jpg",
    search: presetSearch({
      appMode: "rem", viewMode: "2d", zoom: 10.11, lat: -5.6075, lng: -63.92, pitch: 0,
      remRiver: "named", remRiverName: "Rio Purus",
      remMax: 45, remStretch: "linear", showHillshade: false,
    }),
  },
  {
    id: "preset-willamette",
    name: "Willamette River, Oregon — Deep Hypso",
    ts: 0,
    thumb: "/bookmark-thumbs/willamette.jpg",
    search: presetSearch({
      zoom: 11.88, lat: 44.745, lng: -123.154, pitch: 0,
      showColorRelief: true, customHypsoMinMax: true,
      minElevation: 48.4, maxElevation: 60.6,
      hypsoSliderMinBound: 30, hypsoSliderMaxBound: 70,
      colorRamp: "deep", rasterBasemapOpacity: 0.2, hillshadeOpacity: 0.2, colorReliefOpacity: 1,
    }),
  },
  {
    // The maya-lidar project (lib/projects.json) in an overlay split: its
    // twelve lidar renders over Tikal on view A, the forest canopy alone on
    // view B (ESRI World Imagery, the sharpest keyless imagery there, with
    // no overlays: basemapPerView is on by default, so B reads its own,
    // empty, overlayBasemapIdsB). The wipe at 0.8 leaves the lidar 80% of
    // the width and the forest the right 20%. A whole link: only a page
    // load seeds a project's sources into the list.
    id: "preset-maya-lidar",
    name: "Tikal, Maya Lowlands — lidar renders against the forest canopy",
    ts: 0,
    thumb: "/bookmark-thumbs/maya-lidar.jpg",
    reload: true,
    search: "project=maya-lidar&splitStyle=overlay&splitRatio=0.8&basemapSourceA=esri&basemapSourceB=esri",
  },
  {
    id: "preset-iceland-overlay",
    name: "Iceland — Bing vs. AWS Overlay Compare",
    ts: 0,
    thumb: "/bookmark-thumbs/iceland-overlay.jpg",
    search: presetSearch({
      viewMode: "2d", zoom: 6.39, lat: 65.0406, lng: -18.5289, pitch: 0,
      splitStyle: "overlay", showRasterBasemap: true, basemapSourceA: "bing",
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
  preset: Bookmark & { reload?: boolean },
  setState: (updates: Record<string, unknown>) => void,
  mapRef?: React.RefObject<MapRef | null>,
) {
  // A preset that is a whole link (a remote drawing, the iterator started
  // from the link) is opened as that link.
  if (preset.reload) { window.location.assign(bookmarkHref(preset)); return }
  const patch = parseBookmarkSearch(preset.search)
  const map = mapRef?.current?.getMap()
  if (map) easeToBookmarkViewport(map, patch)
  setState(patch)
}
