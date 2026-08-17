---
name: camera-sync-architecture
description: PR #10 camera/terrain sync fixes in TerrainViewer.tsx — elevation as 6th parameter, settle mechanics, upstream MapLibre warts, dead ends
metadata:
  type: project
---

All fixes are in `components/TerrainViewer.tsx`. Root-caused against
`node_modules/maplibre-gl/dist/maplibre-gl-dev.js` source (line numbers cited
below are from maplibre-gl 5.24). User confirmed working ("WORKING GREAT").

**Why:** `transform.elevation` — the altitude of the camera's target point,
read via `Map#getCameraTargetElevation`, written via `map.transform.setElevation`
— is the sixth camera parameter beyond center/zoom/bearing/pitch/roll. Two views
agreeing on all five of the others but disagreeing on this one draw the same
ground at different screen heights. Almost every symptom in this branch was that
parameter going unsynced, stale, or corrected too bluntly.

## Fix 1 — elevation forwarded in `handleViewMove`

MapLibre updates elevation by two different rules mid-gesture:
- The **dragged** view: `Map#_elevationFreeze` is set on first drag frame
  (`:68642`) and cleared only when the gesture finishes (`:68694`) — elevation
  is frozen at drag-start altitude.
- Every **synced** view: driven by `jumpTo`, which re-resolves elevation against
  its own terrain as its first act (`:69328`) — so it tracks live ground under
  the moving center.

**Fix:** `handleViewMove` reads `getCameraTargetElevation()` from the moved view
and forwards it as `jumpTo({ ..., elevation })`. `jumpTo` applies an explicit
`elevation` option *after* its own automatic re-resolve (`:69333`), so it wins.
`elevation` is a documented public `CameraOptions` field.

## Fix 2 — `recalculateZoomAndCenter` for the idle settle

**Symptom:** ~500ms after mouseup the camera jumped slightly (single view too).

**Wrong approach (dead end):** `transform.setElevation(ground)` moves the
camera's *target* while leaving the camera where it is — a lurch by however much
the elevation was off (up to thousands of meters crossing terrain).

**Fix:** `transform.recalculateZoomAndCenter(terrain)` (`:55548`, `:56232`) holds
the **camera position** fixed and solves for the center/zoom that put the target
back on the ground along the same view ray. Nothing moves on screen.

Two guards make this safe:
1. **`ELEVATION_SETTLE_EPSILON_M = 1`** — only fires when height is genuinely
   stale (after a pan across terrain). Does NOT fire for padding changes, resizes,
   or split-mode switches. Without this: every settle re-derives center/zoom →
   focus point walks off target on each Off/Overlay/Side switch (confirmed
   regression). Also guarantees termination (without it the idle→jumpTo loop runs
   forever by a hair each time).
2. **`lastInteractedViewRef`** — set from `onPointerDownCapture` on the pane div.
   Only the view you last touched is re-anchored; every other view is copied
   wholesale from it (center, zoom, bearing, pitch, elevation). In overlay,
   `clip-path` also clips hit-testing, so a press left of the wipe → A, right → B.

## Fix 3 — `easeTo` leaves `_elevationFreeze` stuck on

`Camera._prepareElevation` sets `Map#_elevationFreeze = true` unconditionally
(`:69552`), but `_finalizeElevation` — the **only** clearer — runs only when
`options.freezeElevation` is passed (`:69524`). A completed interactive drag on
that map is the only other clearer.

So a plain `easeTo` (e.g. the padding ease) leaves the flag stuck on forever.
The flag suppresses MapLibre's own per-frame reclamp (`:73822`).

**Consequences (all fixed by passing `freezeElevation: true` on the padding easeTo):**
- The very first drag after load jumped (camera height sat at sea level from
  before DEM tiles existed; drag computed against a plane thousands of meters low).
- The two panes ended up in different internal states depending on which one you'd
  last dragged.

## Fix 4 — ground-clamping bookkeeping keyed by map instance, not view id

`centerClampedToGround` (default `true`) re-resolves camera height every rendered
frame (`:73822`) — the bob/climb effect. Disabled once terrain settles.

**Bug:** "have we disabled it" was keyed by view id. A view id outlives the map
behind it (toggling split off/on builds a brand-new `<Map>` for view B). An
id-keyed flag then read "already done" for a map that never had it done.

**Fix:** read `map.getCenterClampedToGround()` live. The ref is gone.
**Rule:** any per-map-instance state in TerrainViewer must NOT be keyed by view id.

## Fix 5 — `pointerDownRef` guards programmatic camera commands

`jumpTo`/`easeTo` both begin with `Map#stop()` → `handlers.stop(false)` →
`handler.reset()` on every input handler (`:68486`). Issuing one while a pointer
is already down but hasn't moved yet (so `isMoving()` is false, an idle can fire)
silently eats the gesture. The window: pointer-down-but-not-yet-moved.

**Fix:** `pointerDownRef` tracked on `window` in the capture phase (so a release
outside the map still clears it). `resettleTerrainElevation` returns early while
set. The epsilon from Fix 2 removes most of the opportunity anyway.

**Rule: never issue a programmatic camera command while a pointer is held.** If
you must change something camera-adjacent during a gesture, use `map.transform.*`
setters directly — they don't call `stop()`.

## Fix 6 — terrain blinking on load

`setTerrain` is expensive: constructs a new `Terrain` + `RenderToTexture`, drops
the RTT tile cache (`:72673`), does not destruct the old pair. Two causes:
- Elevation settle used to call `setTerrain()` on every idle.
- `applyTerrain` stacked `sourcedata` listeners (effect re-ran on every
  `mapLoaded` change, each run that found no source yet added another listener).

**Fix:** settle no longer calls `setTerrain`. `applyTerrain` de-registers its
pending listener before re-adding (tracked in a `WeakMap` keyed by map). Skips
`setTerrain` when bound source object *and* exaggeration already match. Compares
source **object** (not id) via `map.terrain?.tileManager?.getSource()` — a source
can be remounted under the same id with different tiles.

## Dead ends — do not re-derive

| Approach | Why it failed |
|---|---|
| Persistent `idle` listener re-affirming `setTerrain(getTerrain())` | Rebuilds Terrain + RTT, drops cache on every idle → blinking + leaks |
| Padding gated on `gridConfig.cols > 1` / `rows > 1` | Wrong — a lone pane also needs padding to center under the sidebar |
| Overlay panes forced to `right: 0` | Constraint is identical value, not zero — zero jumps camera on Off↔Overlay |
| `recalculateZoomAndCenter` on every settle, no epsilon | Walks focus point off target on every mode switch, never converges |
| `transform.setElevation(ground)` as the settle | Preserves center but lurches by the full elevation error |
| Per-view independent re-derivation | Each view's answer depends on its own DEM, panes drift apart |
| Chasing individual elevation-reset call sites one at a time | Whack-a-mole; stuck `_elevationFreeze` (Fix 3) was the real shared cause |

## Testing checklist

1. First drag after load — no jump.
2. Pan across big elevation change — no lurch ~500ms after mouseup.
3. Off → Overlay → Side → Off — Matterhorn stays framed; focus point doesn't drift.
4. Drag each pane in turn (especially B) in Overlay/Side — other pane follows, no bob.
5. Press-and-hold, pause, then drag — gesture not eaten, both panes.
6. Toggle sidebar/timeline — glide together; split pill still 1:1 with pointer.
7. Terrain load — no blinking.
