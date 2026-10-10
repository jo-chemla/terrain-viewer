---
name: mobile-layout-frames
description: Single shared bottom edge for all bottom overlays (root fixed inset-0, overlays absolute); no --vh hack; isMobile breakpoint matched to Tailwind sm (640); the phone-portrait bottom sheet and its collapsed-bar lift
type: project
---

# Mobile layout — one bottom edge, no `--vh`

**The rule:** every bottom-anchored overlay (historical timeline panel, minimap,
collapsed-timeline clock toggle, sidebar) is `position: absolute` inside
TerrainViewer's root div, which is `fixed inset-0` on ALL platforms. Do not add
new `position: fixed` bottom-anchored overlays, and do not reintroduce a
JS-measured viewport height.

**Why:** the app previously sized the root on mobile with a `--vh` custom
property (a JS copy of `window.innerHeight`, updated on resize) while the
timeline panel/minimap were `fixed bottom-0` against the layout viewport. Two
different "bottoms" that drift apart whenever mobile browser chrome animates or
the resize event lags — the panel stuck out past the visible screen and never
reliably aligned with the minimap/scalebar clearances measured in the other
frame. A fixed element's `bottom: 0` already tracks dynamic browser toolbars
natively, so `fixed inset-0` on the root + `absolute` children gives one shared
edge with zero JS.

**Related conventions (same change, Aug 2026):**
- `useIsMobile` breakpoint is **640** to match Tailwind's `sm:` — every
  mobile/desktop CSS split in the app flips at `sm:`, and the old 768 left a
  640–767px band where JS layout math (sidebar footprint, timeline right
  offset) disagreed with what CSS rendered.
- The timeline panel on mobile: title hidden, pills in one horizontally
  scrollable `flex-nowrap` line (each pill `shrink-0`), `max-h-[65dvh]`
  backstop, `pb-[env(safe-area-inset-bottom)]` (enabled by
  `viewport-fit=cover` in index.html's viewport meta).
- Minimap/scale clearance above the panel stays driven by the measured
  panel height ([[camera-sync]] is unrelated; see
  `historicalTimelinePanelHeightAtom` in lib/layout-constants.ts).

## Phone portrait: the side panel is a bottom sheet (2026-10-10)

`useIsBottomSheet()` (hooks/use-mobile.ts) = `(max-width: 639px) and
(orientation: portrait)`. There the same TerrainControlPanel Card is a
full-width sheet along the root's bottom edge; landscape phones (wider than
640, so not even `isMobile`) and desktop keep the side panel untouched.

- **States:** collapsed = `isSidebarOpenAtom` false (so the map tap that
  closes the panel, the product tour that opens it and `?sidebarCollapsed`
  keep working unchanged); open = `bottomSheetSnapAtom` "half" (50 % of the
  root) or "full" (root minus 64 px). The snap atom is plain `atom`, not
  stored. The handle + title bar is one drag zone (`touch-none`, pointer
  capture; the title and icon buttons keep their taps); a tap toggles
  collapsed/half, a flick (> 0.5 px/ms) goes to the next stop.
- **The sheet is the bottom edge:** the collapsed bar's measured height
  (handle + title row + `env(safe-area-inset-bottom)`, via a zero-width probe
  div) goes to `bottomSheetBarHeightAtom` and is added to the same lift as
  the docked profile (`profileDockLift` in TerrainViewer and the timeline
  panel; ProfileDock sits on it). So collapsed, the timeline, minimap, scale
  bar and timeline toggle sit just above the bar. Open, the sheet (z-50)
  covers them without moving them, and the camera's bottom padding becomes
  half the root height so the map centres in the visible half.
- `getSidebarFootprintPx(open, isMobile, isBottomSheet)` is 0 for the sheet
  (no right-hand footprint).
- `Card` (components/ui/card.tsx) is a plain React 18 function component: a
  `ref` on it never reaches the DOM. The sheet code reaches the Card as the
  bar's `parentElement`.
- Dev only: the React Scan toolbar (`#react-scan-root`) and the TanStack
  devtools button cover the bottom of a phone screen and eat taps on the
  handle; headless tests hide `#react-scan-root` (`.cache/pw/mobile-sheet.mjs`).
